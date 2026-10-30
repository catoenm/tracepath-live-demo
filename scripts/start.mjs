import { mkdirSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { git, compose, statePath, root, origins } from './support.mjs';

if (git('status', '--porcelain'))
  throw new Error('Commit source changes before starting so traces name the exact Git revision.');
const state = { token: randomUUID(), revision: git('rev-parse', 'HEAD') };
mkdirSync(new URL('../.runtime/', import.meta.url), { recursive: true, mode: 0o700 });
writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
compose(['build', 'api'], state);
compose(['up', '-d', '--remove-orphans', '--no-build', '--wait', '--wait-timeout', '60'], state);
for (const origin of Object.values(origins)) {
  const response = await fetch(`${origin}/health`, { signal: AbortSignal.timeout(3000) });
  const body = await response.json();
  if (!response.ok || body.revision !== state.revision)
    throw new Error(`Revision mismatch at ${origin}`);
}
console.log(
  `Demo running at revision ${state.revision}.\nAPI: ${origins['travel-api']}\nWeather: ${origins['mock-weather']}\nRun npm run scenarios from ${root}`,
);
