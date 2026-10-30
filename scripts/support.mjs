import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const root = fileURLToPath(new URL('../', import.meta.url));
export const statePath = new URL('../.runtime/state.json', import.meta.url);
export const manifest = JSON.parse(readFileSync(new URL('../tracepath.runtime.json', import.meta.url), 'utf8'));
export const origins = { 'orders-api': 'http://127.0.0.1:4410', 'mock-payments': 'http://127.0.0.1:4411' };
export const receiver = 'http://127.0.0.1:4412';

export function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}
export function readState() {
  try { return JSON.parse(readFileSync(statePath, 'utf8')); }
  catch { throw new Error('Start this checkout with npm start first.'); }
}
export function compose(args, state, capture = false) {
  return execFileSync('docker', ['compose', '-p', 'tracepath-public-demo', '-f', 'compose.yaml', ...args], {
    cwd: root,
    env: { ...process.env, TRACEPATH_DEMO_TOKEN: state.token, TRACEPATH_REVISION: state.revision },
    stdio: capture ? 'pipe' : 'inherit',
    encoding: 'utf8',
    timeout: 240_000,
  });
}
export const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
