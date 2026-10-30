import Redis from 'ioredis';
import { pool } from './database.mjs';
import { operation } from './telemetry.mjs';
const cache = new Redis(process.env.REDIS_URL, {
  maxRetriesPerRequest: 1,
  commandTimeout: 2000,
  connectTimeout: 2000,
});
cache.on('error', (error) => console.error('Places cache:', error.message));
const key = (destination) => `tracepath:places:${destination}`;
export async function readCachedPlaces(destination) {
  return operation('places.cache.read', async () => {
    const value = await cache.get(key(destination));
    return value ? JSON.parse(value) : null;
  });
}
export async function readPlacesDatabase(destination) {
  return operation('places.database.read', async () => {
    await pool.query('SELECT pg_sleep(0.2)');
    const result = await pool.query(
      'SELECT id, name, category, indoor FROM demo_places WHERE destination = $1 ORDER BY id',
      [destination],
    );
    if (!result.rows.length) throw new Error('No places for this destination');
    return result.rows;
  });
}
export async function cachePlaces(destination, places) {
  return operation('places.cache.write', async () => {
    await cache.set(key(destination), JSON.stringify(places), 'EX', 60);
  });
}
export async function loadPlaces(input) {
  return operation('places.load', async () => {
    const cached = await readCachedPlaces(input.destination);
    if (cached) return { places: cached, cache: 'hit' };
    const places = await readPlacesDatabase(input.destination);
    await cachePlaces(input.destination, places);
    return { places, cache: 'miss' };
  });
}
