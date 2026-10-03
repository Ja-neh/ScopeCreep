// Node module hooks for running game code outside the browser:
// - .glsl shaders load as empty strings (no WebGL in tests)
// - .json loads as a default export, the way Vite imports config.json
// - the battleship model loader is swapped for a stub that reads only the collider meshes
//   from the GLB (GLTFLoader needs a browser)
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHIP_STUB = new URL('./battleshipModelStub.mjs', import.meta.url).href;

export async function resolve(specifier, context, next) {
  if (specifier.endsWith('models/BattleshipModel.js')) {
    return { url: SHIP_STUB, shortCircuit: true };
  }
  return next(specifier, context);
}

export async function load(url, context, next) {
  if (url.endsWith('.glsl')) {
    return { format: 'module', source: 'export default "";', shortCircuit: true };
  }
  if (url.endsWith('.json') && url.startsWith('file:')) {
    return { format: 'module', source: `export default ${fs.readFileSync(fileURLToPath(url), 'utf8')};`, shortCircuit: true };
  }
  return next(url, context);
}
