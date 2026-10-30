import { pool } from './database.mjs';
import { loadPlaces } from './places.mjs';
import { planRoute } from './route-queue.mjs';
import { operation, outgoingHeaders } from './telemetry.mjs';
export async function fetchWeather(input) {
  return operation('weather.fetch', async () => {
    const response = await fetch(`${process.env.WEATHER_URL}/forecast`, {
      method: 'POST',
      headers: outgoingHeaders(),
      body: JSON.stringify({ destination: input.destination, condition: input.weather }),
      signal: AbortSignal.timeout(8000),
    });
    const result = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(result.error ?? 'Weather unavailable'), { status: 502 });
    return result;
  });
}
export async function saveItinerary(itinerary) {
  return operation('trip.save', async () => {
    await pool.query('SELECT pg_sleep(0.3)');
    const result = await pool.query(
      'INSERT INTO demo_itineraries (id, destination, itinerary) VALUES ($1,$2,$3) RETURNING id',
      [crypto.randomUUID(), itinerary.destination, JSON.stringify(itinerary)],
    );
    return { id: result.rows[0].id, ...itinerary };
  });
}
export async function planTrip(input) {
  return operation('trip.plan', async () => {
    let places;
    let forecast;
    if (input.parallel) {
      const outcomes = await Promise.allSettled([loadPlaces(input), fetchWeather(input)]);
      const failed = outcomes.find((outcome) => outcome.status === 'rejected');
      if (failed) throw failed.reason;
      [places, forecast] = outcomes.map((outcome) => outcome.value);
    } else {
      places = await loadPlaces(input);
      forecast = await fetchWeather(input);
    }
    const itinerary = await planRoute({ ...input, places: places.places, forecast });
    const saved = await saveItinerary(itinerary);
    return { ...saved, placesCache: places.cache, forecast };
  });
}
