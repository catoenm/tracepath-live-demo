import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { manifest, origins, receiver, readState, compose, git, wait } from './support.mjs';
const state = readState();
assert.equal(git('status', '--porcelain'), '', 'Commit edits and restart before verifying');
assert.equal(state.revision, git('rev-parse', 'HEAD'), 'Restart after a commit');
for (const origin of Object.values(origins)) {
  const response = await fetch(`${origin}/health`);
  assert.equal((await response.json()).revision, state.revision);
}
const sql = (query) =>
  compose(
    ['exec', '-T', 'database', 'psql', '-U', 'demo', '-d', 'demo', '-tAc', query],
    state,
    true,
  ).trim();
const itineraryCount = () => Number(sql('SELECT count(*) FROM demo_itineraries'));
const before = itineraryCount();
let expectedInserts = 0;
async function collect(runId) {
  const response = await fetch(`${receiver}/spans/${runId}`, {
    headers: { 'x-demo-token': state.token },
    signal: AbortSignal.timeout(3000),
  });
  assert.equal(response.status, 200);
  return response.json();
}
function expectedOperations(entry, payload, cache) {
  const placeOps = [
    'places.load',
    'places.cache.read',
    ...(cache === 'miss' ? ['places.database.read', 'places.cache.write'] : []),
  ];
  if (entry.operation === 'places.load') return placeOps;
  if (entry.operation !== 'trip.plan') return [entry.operation];
  return [
    'trip.plan',
    ...placeOps,
    'weather.fetch',
    'weather.forecast',
    ...(payload.weather === 'unavailable'
      ? []
      : [
          'route.wait',
          'route.calculate',
          ...(payload.simulatePlannerFailure ? [] : ['trip.save']),
        ]),
  ];
}
function expectedStatus(entry, payload) {
  if (entry.operation === 'trip.plan')
    return payload.weather === 'unavailable' ? 502 : payload.simulatePlannerFailure ? 503 : 201;
  return payload.condition === 'unavailable' ? 503 : 200;
}
async function exercise(entry, scenario, cache = 'hit') {
  const runId = randomUUID();
  const operation = manifest.operations.find((op) => op.id === entry.operation);
  const origin = origins[operation.service];
  assert.ok(origin);
  let settled = false;
  const responses = Promise.all(
    scenario.requests.map(async (payload, index) => {
      const requestId = `request-${index + 1}`;
      const response = await fetch(`${origin}${entry.route}`, {
        method: entry.method,
        headers: {
          'content-type': 'application/json',
          'x-demo-token': state.token,
          'x-tracepath-run': runId,
          'x-tracepath-request': requestId,
        },
        body: entry.method === 'GET' ? undefined : JSON.stringify(payload),
        signal: AbortSignal.timeout(20000),
      });
      return { requestId, status: response.status, body: await response.json() };
    }),
  ).finally(() => {
    settled = true;
  });
  let spans = [];
  let liveStarts = 0;
  const deadline = Date.now() + 30000;
  do {
    spans = await collect(runId);
    liveStarts = Math.max(liveStarts, spans.filter((span) => span.endMs === undefined).length);
    if (
      settled &&
      spans.filter((span) => !span.parentSpanId && span.operation === entry.operation).length ===
        scenario.requests.length &&
      spans.every((span) => span.endMs !== undefined)
    ) {
      await wait(200);
      spans = await collect(runId);
      break;
    }
    await wait(50);
  } while (Date.now() < deadline);
  const results = await responses;
  if (['trip.plan', 'weather.forecast'].includes(entry.operation))
    assert.ok(liveStarts > 0, 'Observe running spans before completion');
  for (const [index, payload] of scenario.requests.entries()) {
    const recorded = spans.filter((span) => span.requestId === `request-${index + 1}`);
    assert.deepEqual(
      recorded.map((span) => span.operation).sort(),
      expectedOperations(entry, payload, cache).sort(),
      scenario.id,
    );
    assert.equal(new Set(recorded.map((span) => span.traceId)).size, 1);
    const root = recorded.find((span) => !span.parentSpanId);
    assert.equal(root.operation, entry.operation);
    for (const span of recorded) {
      assert.equal(span.runId, runId);
      assert.equal(span.revision, state.revision);
      assert.equal(
        span.service,
        manifest.operations.find((op) => op.id === span.operation)?.service,
      );
      assert.ok(span.endMs >= span.startMs && span.durationMs >= 0);
      if (span.parentSpanId)
        assert.ok(recorded.some((parent) => parent.spanId === span.parentSpanId));
    }
    const status = expectedStatus(entry, payload);
    assert.equal(results[index].status, status);
    assert.equal(root.error ?? false, status >= 400);
    if (entry.operation === 'trip.plan') verifyTrip(recorded, payload, results[index], cache);
    if (entry.operation === 'places.load') {
      assert.equal(results[index].body.cache, cache);
      assert.equal(results[index].body.places.length, 6);
    }
  }
  const roots = spans.filter((span) => !span.parentSpanId);
  assert.equal(new Set(roots.map((span) => span.traceId)).size, scenario.requests.length);
  if (roots.length > 1 && entry.operation !== 'places.load')
    assert.ok(
      Math.max(...roots.map((span) => span.startMs)) < Math.min(...roots.map((span) => span.endMs)),
    );
  console.log(
    `${entry.method} ${entry.route} (${operation.service}) / ${scenario.id}: ${spans.length} spans, HTTP ${results.map((result) => result.status).join('/')}`,
  );
  return {
    runId,
    endpointOperation: entry.operation,
    scenario: scenario.id,
    revision: state.revision,
    results,
    spans,
  };
}
function verifyTrip(spans, payload, result, cache) {
  const get = (id) => spans.find((span) => span.operation === id);
  const places = get('places.load');
  const weather = get('weather.fetch');
  assert.equal(
    get('weather.forecast').parentSpanId,
    weather.spanId,
    'Propagate HTTP trace context',
  );
  if (payload.parallel)
    assert.ok(
      Math.max(places.startMs, weather.startMs) <= Math.min(places.endMs, weather.endMs) + 2,
      'Allow SDK wall-clock rounding for sub-millisecond cache hits',
    );
  else assert.ok(places.endMs <= weather.startMs + 2);
  if (payload.weather === 'unavailable') return;
  const queued = get('route.wait');
  const worker = get('route.calculate');
  assert.equal(worker.parentSpanId, queued.spanId, 'Propagate W3C parent through BullMQ data');
  assert.equal(worker.service, 'route-worker');
  assert.ok(Math.max(places.endMs, weather.endMs) <= queued.startMs + 2);
  assert.ok(queued.startMs <= worker.startMs + 2 && worker.endMs <= queued.endMs + 2);
  if (payload.simulatePlannerFailure) {
    assert.ok(worker.error && queued.error);
    return;
  }
  assert.ok(queued.endMs <= get('trip.save').startMs + 2);
  expectedInserts++;
  assert.match(result.body.id, /^[a-f0-9-]{36}$/);
  assert.equal(result.body.placesCache, cache);
  assert.equal(result.body.destination, payload.destination);
  assert.equal(result.body.days.length, payload.days);
  if (payload.weather === 'rain')
    assert.ok(result.body.days.every((day) => day.stops.every((stop) => stop.indoor)));
  // Verify the worker's output was actually persisted, not just returned over HTTP.
  const saved = JSON.parse(
    sql(`SELECT itinerary FROM demo_itineraries WHERE id = '${result.body.id}'`),
  );
  assert.deepEqual(saved.days, result.body.days);
}
const recordings = [];
const trips = manifest.entrypoints.find((entry) => entry.operation === 'trip.plan');
const places = manifest.entrypoints.find((entry) => entry.operation === 'places.load');
const scenario = (id) => manifest.scenarios.find((item) => item.id === id);
compose(
  [
    'exec',
    '-T',
    'redis',
    'redis-cli',
    'DEL',
    ...['lisbon', 'kyoto', 'reykjavik'].map((city) => `tracepath:places:${city}`),
  ],
  state,
  true,
);
recordings.push(await exercise(trips, { ...scenario('success'), id: 'cache.miss' }, 'miss'));
recordings.push(await exercise(trips, { ...scenario('success'), id: 'cache.hit' }));
for (const city of ['kyoto', 'reykjavik'])
  recordings.push(
    await exercise(places, { ...scenario(`places.${city}`), id: `cache.miss.${city}` }, 'miss'),
  );
for (const entry of manifest.entrypoints)
  for (const id of entry.scenarioIds) recordings.push(await exercise(entry, scenario(id)));
const batches = await Promise.all(
  ['success', 'weather.failure', 'concurrent'].map((id) => exercise(trips, scenario(id))),
);
recordings.push(...batches);
assert.ok(
  Math.max(...batches.map((run) => Math.min(...run.spans.map((span) => span.startMs)))) <
    Math.min(...batches.map((run) => Math.max(...run.spans.map((span) => span.endMs)))),
);
const workers = batches.flatMap((run) =>
  run.spans.filter((span) => span.operation === 'route.calculate'),
);
const peakWorkers = Math.max(
  ...workers.map(
    (span) =>
      workers.filter((other) => other.startMs <= span.startMs && other.endMs > span.startMs).length,
  ),
);
assert.equal(peakWorkers, 2);
assert.equal(itineraryCount() - before, expectedInserts);
const unauthorized = await fetch(`${origins['travel-api']}/itineraries`, {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: '{}',
});
assert.equal(unauthorized.status, 401);
const invalid = await fetch(`${origins['travel-api']}/itineraries`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-demo-token': state.token },
  body: JSON.stringify({ destination: 'unknown' }),
});
assert.equal(invalid.status, 400);
writeFileSync(
  new URL('../.runtime/recordings.json', import.meta.url),
  JSON.stringify(recordings, null, 2),
  { mode: 0o600 },
);
console.log(
  `Verified ${recordings.length} recordings, cache branches, rainy itineraries, failures, queue parentage, and ${expectedInserts} actual itinerary inserts.`,
);
