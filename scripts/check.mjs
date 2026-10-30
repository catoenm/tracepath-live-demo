import { readdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { root } from './support.mjs';
for (const directory of ['src', 'scripts', 'tests']) {
  for (const file of readdirSync(new URL(`../${directory}/`, import.meta.url))) {
    if (file.endsWith('.mjs'))
      execFileSync(process.execPath, ['--check', `${directory}/${file}`], {
        cwd: root,
        stdio: 'inherit',
      });
  }
}
console.log('All JavaScript modules pass syntax validation.');
