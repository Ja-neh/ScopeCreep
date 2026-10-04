# Tests

`npm test` runs every `tests/**/*.test.mjs` file with Node's built-in test runner (`node:test`, no extra packages). The tests use the real game code, real Three.js objects and real Rapier physics, without a browser or WebGL. The full suite takes about 30 seconds.

Run it before every commit. If a test fails, either your change broke something that used to work, or you changed behaviour on purpose and must update that test in the same commit.

## What the tests cover

| File | Guards |
| --- | --- |
| `terrain.test.mjs` | Terrain mesh and heightfield collider describe the same ground |
| `island.test.mjs` | Island layout: landing beach, sea depth under the ship, village plateau at the far end, size; the Level 3 layout (6x the plateau, same beach) |
| `landingZone.test.mjs` | Walking off the ship to the beach, no hopping downhill, parked helicopters |
| `cover.test.mjs` | Tree, rock and bush placement rules, rock cover, triangle budget, scenery tiles (low detail far away, nothing in the fog), hiding in bushes, AI cover spots |
| `weapons.test.mjs` | Machine gun, reload, knife and backstab, quick knife, aim zoom, cleanup |
| `aliens.test.mjs` | Trooper sight, damage, concealment, hearing, call-outs, no friendly fire, death |
| `brute.test.mjs` | Brute charge and slam, outrunning it, double damage to its back |
| `village.test.mjs` | Level 3 village at night: moon and stars, 6x the size with hundreds of houses on the plateau, closed, walk-in and ruined houses with no overlaps, landed ships you can walk under, walking from the path up the avenue into the hall, solid walls and walk-in houses, mesh and light budgets, teardown |
| `level03.test.mjs` | Level 3 so far: night start below the gate with the crew and the generators objective, no jungle inside the village, up the avenue to the square where the force field bars the way with the crew keeping up, the crew following round a street corner, the sandbox level, clean teardown |
| `warden.test.mjs` | Level 3's boss fight: the Warden wakes when the player walks into the hall, the shield holds until both crystals are shot, plasma volleys, the shockwave (jump it), enraged at half health with new crystals and troopers, winning, room for the squad in the hall, the sandbox [F6], teardown |
| `generators.test.mjs` | Level 3's force field and its generators: three guarded generators by the ships with beams to the dome, the dome keeping people and bullets out, holding [E] to shut a generator down (progress, draining, reach), aliens that never stop coming to a running generator, aliens from every direction once in the village, wave 2 at the sealed hall door, revive points and coming back at the last one, teardown |
| `waveDirector.test.mjs` | Wave order, lanes, spawn pacing, pauses between waves, completion |
| `renderQuality.test.mjs` | Graphics settings: the player's choice is applied and remembered, Auto resolution, the recommendation (from the graphics card, then the measured frame rate), software renderers start light |
| `models.test.mjs` | Character models stay cheap to draw (merged parts), keep their colours and glow, and free everything on dispose |
| `squad.test.mjs` | AI squadmates: formation around the player, following the player's trail round a wall and catching up, shooting aliens, no friendly fire, being hunted and fighting back, reviving each other and the player, bleeding out |
| `landing.test.mjs` | Level 2 opening: camera sweep and skip, crew walking off, helicopters clearing the ship and landing, pilots, starting view, going down during the opening, supply crate (ammo and health) |
| `level02.test.mjs` | Level 2 end to end: landing, three waves, objective and victory, the player downed and revived, bleeding out, reviving a squadmate with [E], defeat and retry, the sandbox level (revive, respawn, F4 squad toggle), wave size and spread, the alive cap, the controls card, clean teardown |
| `uiOverlay.test.mjs` | HUD layers never swallow the clicks the game needs to lock the mouse |
| `level1Compat.test.mjs` | Shared code still behaves as Level 1 expects (player, camera, ocean, input, projectiles, deck walking) |

## How it runs outside the browser

- `support/loader.mjs` loads `.glsl` files as empty strings and `config.json` as a default export, the way Vite does. It also swaps the battleship model loader for `support/battleshipModelStub.mjs`, which reads only the collider meshes from the GLB.
- `support/testWorld.mjs` provides:
  - `createTestWorld()`: a GameWorld stand-in with real physics, scripted input (`world.input.hold('forward')`) and a UI recorder (`world.ui.callsTo('showToast')`).
  - `stepWorld(world, seconds, { level, onFrame })`: runs frames in the same 8-phase order as `GameWorld._loop`.
  - `bodyCount(world)`: checks that teardown left no physics bodies behind.
- `Math.random` is seeded in each test file, so AI and scatter behave the same on every run.

## Writing a test

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTestWorld, stepWorld } from './support/testWorld.mjs';

test('what must stay true, in plain words', async () => {
  const world = await createTestWorld();
  // build only what the test needs, step the world, then assert on the outcome
});
```

Test outcomes a player would notice, such as "the dummy dies" or "the player reaches the beach". Avoid internal details that will change. Aim tests at real positions on the island, not at spots that only work by luck.

Tests in one file share the seeded `Math.random`, so a test sees different random numbers depending on which tests ran before it. Don't let a result depend on where an AI happens to wander. Check it from both a solo run (`--test-name-pattern`) and a full-file run.

Compare entities by identity, as in `assert.ok(alien.perception.target === player, 'player seen')`. Don't write `assert.equal(target, player)`. When that fails, the runner tries to print the whole entity, including the physics world and scene it references, and it can hang instead of reporting the failure.
