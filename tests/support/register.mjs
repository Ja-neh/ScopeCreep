// Preloaded by `npm test` (node --import) to install the test module hooks.
import { register } from 'node:module';

register('./loader.mjs', import.meta.url);
