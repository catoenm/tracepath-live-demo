import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readState, compose, origins, receiver, wait } from './support.mjs';

const state = readState();
const countItineraries = () =>
  Number(
    compose(
      [
        'exec',
        '-T',
        'database',
        'psql',
        '-U',
        'demo',
        '-d',
        'demo',
        '-tAc',
        'SELECT count(*) FROM demo_itineraries',
      ],
      state,
      true,
    ).trim(),
  );
const before = countItineraries();
const runId = randomUUID();
const started = Date.now();
compose(['pause', 'worker'], state, true);
try {
  const response = await fetch(`${origins['travel-api']}/itineraries`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-demo-token': state.token,
      'x-tracepath-run': runId,
      'x-tracepath-request': 'timeout-1',
    },
    body: JSON.stringify({
      destination: 'lisbon',
      days: 2,
      preference: 'balanced',
      weather: 'sunny',
      parallel: true,
    }),
    signal: AbortSignal.timeout(10000),
  });
  assert.equal(response.status, 503, JSON.stringify(await response.json()));
  assert.ok(Date.now() - started < 8000, 'The HTTP caller must not wait indefinitely');
} finally {
  compose(['unpause', 'worker'], state, true);
}
let spans = [];
for (let attempt = 0; attempt < 60; attempt++) {
  const response = await fetch(`${receiver}/spans/${runId}`, {
    headers: { 'x-demo-token': state.token },
    signal: AbortSignal.timeout(3000),
  });
  spans = await response.json();
  if (spans.some((span) => span.operation === 'route.calculate' && span.endMs)) break;
  await wait(100);
}
const worker = spans.find((span) => span.operation === 'route.calculate');
assert.ok(worker?.error, 'Resumed worker must reject the expired job');
assert.match(worker.message, /expired/);
assert.ok(!spans.some((span) => ['trip.save'].includes(span.operation)));
assert.equal(
  countItineraries(),
  before,
  'A timed-out HTTP request must never save an itinerary later',
);
console.log(
  'Paused worker: HTTP 503 within the wait deadline; resumed worker rejected the expired job; no itinerary database write.',
);
