import { compose, readState } from './support.mjs';
compose(['down', '--timeout', '10'], readState());
console.log('Stopped the public demo. Its disposable database has been removed.');
