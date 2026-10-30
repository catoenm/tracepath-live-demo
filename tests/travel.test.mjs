import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateRoute } from '../src/route-rules.mjs';
import { validateTrip, validateWeather, validatePlaces } from '../src/travel-input.mjs';
const places = [
  { id: 'a', name: 'Park', category: 'outdoors', indoor: false },
  { id: 'b', name: 'Museum', category: 'culture', indoor: true },
  { id: 'c', name: 'Market', category: 'food', indoor: true },
];
const trip = {
  destination: 'lisbon',
  days: 2,
  preference: 'outdoors',
  weather: 'sunny',
  parallel: true,
};
test('rain keeps all stops indoors; preferences change the order of sunny stops', () => {
  const base = { ...trip, places, forecast: { condition: 'sunny' } };
  assert.equal(calculateRoute(base).days[0].stops[0].id, 'a');
  assert.equal(calculateRoute({ ...base, preference: 'culture' }).days[0].stops[0].id, 'b');
  const rain = calculateRoute({ ...base, forecast: { condition: 'rain' } });
  assert.equal(rain.days.length, 2);
  assert.ok(rain.days.every((day) => day.stops.every((stop) => stop.indoor)));
  assert.throws(() => calculateRoute({ ...base, simulatePlannerFailure: true }), /Controlled/);
});
test('validate bounded travel inputs and reject invalid or missing bodies', () => {
  assert.equal(validateTrip(trip).simulatePlannerFailure, false);
  for (const bad of [
    null,
    [],
    {},
    { ...trip, days: 0 },
    { ...trip, days: 6 },
    { ...trip, destination: 'unknown' },
    { ...trip, weather: 'hurricane' },
    { ...trip, parallel: 'yes' },
  ])
    assert.throws(() => validateTrip(bad), { status: 400 });
  assert.deepEqual(validatePlaces({ destination: 'kyoto' }), { destination: 'kyoto' });
  assert.equal(validateWeather({ destination: 'kyoto', condition: 'rain' }).condition, 'rain');
});
