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
const orderCount = () => Number(compose(['exec', '-T', 'database', 'psql', '-U', 'demo', '-d', 'demo', '-tAc', 'SELECT count(*) FROM demo_orders'], state, true).trim());
const before = orderCount();
let expectedInserts = 0;

async function exercise(entry, scenario) {
  const runId = randomUUID();
  const operation = manifest.operations.find((operation) => operation.id === entry.operation);
  const origin = origins[operation.service];
  assert.ok(origin, 'Only authored demo services can receive scenarios');
  let settled = false;
  const responses = Promise.all(scenario.requests.map(async (payload, index) => {
    const requestId = `request-${index + 1}`;
    const response = await fetch(`${origin}${entry.route}`, {
      method: entry.method,
      headers: { 'content-type': 'application/json', 'x-demo-token': state.token, 'x-tracepath-run': runId, 'x-tracepath-request': requestId },
      body: entry.method === 'GET' ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(20000),
    });
    return { requestId, status: response.status, body: await response.json() };
  })).finally(() => { settled = true; });
  let spans = [];
  let liveStarts = 0;
  const expectedCount = scenario.requests.reduce((sum, payload) => sum + (entry.payloadKind === 'order' ? payload.payment === 'declined' ? 4 : 5 : 1), 0);
  const deadline = Date.now() + 30000;
  do {
    const response = await fetch(`${receiver}/spans/${runId}`, { headers: { 'x-demo-token': state.token }, signal: AbortSignal.timeout(3000) });
    assert.equal(response.status, 200);
    spans = await response.json();
    liveStarts = Math.max(liveStarts, spans.filter((span) => span.endMs === undefined).length);
    if (settled && spans.length === expectedCount && spans.every((span) => span.endMs !== undefined)) break;
    await wait(50);
  } while (Date.now() < deadline);
  const results = await responses;
  assert.equal(spans.length, expectedCount, `Missing spans for ${scenario.id}`);
  if (entry.payloadKind !== 'empty') assert.ok(liveStarts > 0, 'Started spans must arrive before completion');
  for (const [index, payload] of scenario.requests.entries()) {
    const requestId = `request-${index + 1}`;
    const recorded = spans.filter((span) => span.requestId === requestId);
    const expected = entry.payloadKind === 'order'
      ? ['orders.create', 'inventory.check', 'payments.charge', 'payments.authorize', ...(payload.payment === 'approved' ? ['orders.save'] : [])]
      : [entry.operation];
    assert.deepEqual(recorded.map((span) => span.operation).sort(), expected.sort());
    assert.equal(new Set(recorded.map((span) => span.traceId)).size, 1);
    assert.equal(recorded.find((span) => !span.parentSpanId)?.operation, entry.operation);
    for (const span of recorded) {
      assert.equal(span.runId, runId);
      assert.equal(span.revision, state.revision);
      assert.equal(span.service, manifest.operations.find((operation) => operation.id === span.operation)?.service);
      assert.ok(span.endMs >= span.startMs && span.durationMs >= 0);
      if (span.parentSpanId) assert.ok(recorded.some((parent) => parent.spanId === span.parentSpanId));
    }
    const root = recorded.find((span) => !span.parentSpanId);
    assert.equal(root.error ?? false, payload.payment === 'declined');
    assert.equal(results[index].status, payload.payment === 'declined' ? 402 : entry.payloadKind === 'order' ? 201 : 200);
    if (entry.payloadKind === 'order') {
      if (payload.payment === 'approved') expectedInserts++;
      const charge = recorded.find((span) => span.operation === 'payments.charge');
      const authorize = recorded.find((span) => span.operation === 'payments.authorize');
      const inventory = recorded.find((span) => span.operation === 'inventory.check');
      assert.equal(authorize.parentSpanId, charge.spanId, 'HTTP must preserve W3C parentage');
      if (payload.parallel) assert.ok(Math.max(inventory.startMs, charge.startMs) < Math.min(inventory.endMs, charge.endMs));
      else assert.ok(inventory.endMs <= charge.startMs + 2);
    }
  }
  const roots = spans.filter((span) => !span.parentSpanId);
  assert.equal(new Set(roots.map((span) => span.traceId)).size, scenario.requests.length);
  if (roots.length > 1) assert.ok(Math.max(...roots.map((span) => span.startMs)) < Math.min(...roots.map((span) => span.endMs)));
  console.log(`${entry.method} ${entry.route} (${operation.service}) / ${scenario.id}: ${spans.length} spans, HTTP ${results.map((result) => result.status).join('/')}`);
  return { runId, endpointOperation: entry.operation, scenario: scenario.id, revision: state.revision, results, spans };
}

const recordings = [];
for (const entry of manifest.entrypoints) {
  for (const id of entry.scenarioIds) recordings.push(await exercise(entry, manifest.scenarios.find((scenario) => scenario.id === id)));
}
// Independent batches overlap too, while run IDs keep their telemetry isolated.
const orders = manifest.entrypoints.find((entry) => entry.operation === 'orders.create');
const batches = await Promise.all(['success', 'failure', 'concurrent'].map((id) => exercise(orders, manifest.scenarios.find((scenario) => scenario.id === id))));
recordings.push(...batches);
assert.ok(Math.max(...batches.map((run) => Math.min(...run.spans.map((span) => span.startMs)))) < Math.min(...batches.map((run) => Math.max(...run.spans.map((span) => span.endMs)))));
assert.equal(orderCount() - before, expectedInserts, 'Only approved orders may reach Postgres');
const unauthorized = await fetch(`${origins['orders-api']}/orders`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
assert.equal(unauthorized.status, 401);
writeFileSync(new URL('../.runtime/recordings.json', import.meta.url), JSON.stringify(recordings, null, 2), { mode: 0o600 });
console.log(`Verified ${recordings.length} recordings and ${expectedInserts} actual database inserts. Traces saved to .runtime/recordings.json.`);
