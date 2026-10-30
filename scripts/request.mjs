import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { readState, git, manifest, origins, receiver, wait } from './support.mjs';
const id = process.argv[2] ?? 'success';
const scenario = manifest.scenarios.find((item) => item.id === id);
const entry = manifest.entrypoints.find((item) => item.scenarioIds.includes(id));
if (!scenario || !entry)
  throw new Error(`Choose one of: ${manifest.scenarios.map((item) => item.id).join(', ')}`);
const state = readState();
if (state.revision !== git('rev-parse', 'HEAD') || git('status', '--porcelain'))
  throw new Error('Commit changes and restart before sending requests');
const operation = manifest.operations.find((item) => item.id === entry.operation);
const runId = randomUUID();
const results = await Promise.all(
  scenario.requests.map(async (payload, index) => {
    const requestId = `request-${index + 1}`;
    const response = await fetch(`${origins[operation.service]}${entry.route}`, {
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
);
await wait(300);
const response = await fetch(`${receiver}/spans/${runId}`, {
  headers: { 'x-demo-token': state.token },
  signal: AbortSignal.timeout(3000),
});
if (!response.ok) throw new Error('Could not retrieve recording');
const spans = await response.json();
writeFileSync(
  new URL('../.runtime/last-request.json', import.meta.url),
  JSON.stringify({ runId, scenario: id, revision: state.revision, results, spans }, null, 2),
  { mode: 0o600 },
);
console.log(JSON.stringify({ runId, scenario: id, spanCount: spans.length, results }, null, 2));
