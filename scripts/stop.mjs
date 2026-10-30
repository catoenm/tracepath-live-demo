import { compose, readState } from './support.mjs';
compose(['down', '--remove-orphans', '--timeout', '10'], readState());
console.log('Stopped the public demo. Its disposable database has been removed.');
