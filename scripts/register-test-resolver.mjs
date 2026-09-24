// Registers the test-only resolver (see ./test-resolver.mjs) for `npm test`.
import { register } from 'node:module';

register('./test-resolver.mjs', import.meta.url);
