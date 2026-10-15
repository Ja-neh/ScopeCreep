# Tests

`npm test` runs every `tests/**/*.test.mjs` file with Node's built-in test runner (`node:test`, no extra packages). The tests use the real game code, real Three.js objects and real Rapier physics, without a browser or WebGL. The full suite takes about 30 seconds.

Run it before every commit. If a test fails, either your change broke something that used to work, or you changed behaviour on purpose and must update that test in the same commit.

## What the tests cover

| File | Guards |
| --- | --- |
| `terrain.test.mjs` | Terrain mesh and heightfield collider describe the same ground |
| `island.test.mjs` | Island layout: landing beach, sea depth under the ship, village plateau at the far end, size; the Level 3 layout (6x the plateau, same beach) |
| `landingZone.test.mjs` | Walking off the ship to the beach, no hopping downhill, parked helicopters |
| `wreckage.test.mjs` | Level 2's beach wreckage: two burned boats with fallen soldiers around them, crates as chest-high cover, everything off the landings and the walk inland, clean teardown |
| `cover.test.mjs` | Tree, rock and bush placement rules, rock cover, triangle budget, scenery tiles (low detail far away, nothing in the fog), hiding in bushes, AI cover spots |
| `coverDamage.test.mjs` | Destructible cover: health pooled by kind (bush < tree < rock), shots through a bush cut it down and stop hiding anyone, the machine gun fells trees in about seven hits and rocks in about two dozen, explosions shred only what is inside their radius, a thrown grenade arcs and detonates where it lands (heard, busy cover torn, figures nearby hurt), a trooper flushes a watched player with a grenade and never hurts its own side |
| `weapons.test.mjs` | Machine gun, reload, recoil climbing and settling back, knife and backstab, quick knife, the bomb on slot 3 (a throw lobs at the crosshair, the blast hurts what it lands on and never the thrower), the wheel cycling gun/knife/bomb, aim zoom, cleanup |
| `map.test.mjs` | The island map ([M]): the chart samples the real island (sea south of the waterline, the landing beach, the village plateau high), north-up reading (beach at the bottom, east to the right, the arrow turning with the view), the terrain colours, and Level 2's live feed — the player, every squadmate but the player, the beacon pin, and exactly the aliens still alive (the brute reads big, hiders stay dim until they hunt, the dead drop off at once, refreshed a few times a second rather than every frame) |
| `aliens.test.mjs` | Trooper sight, damage, concealment, hearing, call-outs, no friendly fire, death |
| `brute.test.mjs` | Brute charge and slam, outrunning it, double damage to its back |
| `village.test.mjs` | Level 3 village at night: moon and stars, 6x the size with hundreds of houses on the plateau, closed, walk-in and ruined houses with no overlaps, landed ships you can walk under, walking from the path up the avenue into the hall, solid walls and walk-in houses, mesh and light budgets, teardown |
| `level03.test.mjs` | Level 3 so far: night start below the gate with the crew and the generators objective, no jungle inside the village, up the avenue to the square where the force field bars the way with the crew keeping up, the crew following round a street corner, the sandbox level, clean teardown |
| `warden.test.mjs` | Level 3's boss fight: the Warden wakes when the player walks into the hall, the shield holds until both crystals are shot, plasma volleys, the shockwave (jump it), enraged at half health with new crystals and troopers, winning, room for the squad in the hall, the sandbox [F6], teardown |
| `ending.test.mjs` | Level 3's opening sweep over the village (title card, held player, ends on the player's view, skip) and its ending: cages locked until the Warden falls then freed with [E], night turning to dawn, the camera leaving the hall, the credits and their skip, the mission result, teardown |
| `generators.test.mjs` | Level 3's force field and its generators: three guarded generators by the ships with beams to the dome, the dome keeping people and bullets out, holding [E] to shut a generator down (progress, draining, reach), aliens that never stop coming to a running generator, aliens from every direction once in the village, wave 2 at the sealed hall door (aliens from both sides of the hall until enough are killed), revive points and coming back at the last one, aliens losing the player after a respawn (wandering off, a respite), crates by the revive points, shield pickups and the shield wearing down, teardown |
| `waveDirector.test.mjs` | Wave order, lanes, spawn pacing, refused spawns retried instead of dropped, pauses between waves and their countdown, completion |
| `renderQuality.test.mjs` | Graphics settings: the player's choice is applied and remembered, Auto resolution, the recommendation (from the graphics card, then the measured frame rate), software renderers start light |
| `audio.test.mjs` | Sound engine: the six core effects, silent no-op without an AudioContext, lazy unlock (announcing the fresh context to companion systems once), saved volume and mute, hurt throttling, the concurrent-voice cap, distance fall-off and cutoff |
| `music.test.mjs` | The adaptive score: its eight states (the menu's trailer groove and the mission-opening intro groove — two loud synthesized two-bar drum-and-bass loops — plus the ambience-only state) and five stingers (the game-start impact included), the lazy build once an AudioContext exists (the menu theme starts on the first gesture), crossfade targets per state (only real changes retune), stingers synthesizing voices, the silent no-op, and dispose stopping every source |
| `models.test.mjs` | Character models stay cheap to draw (merged parts), keep their colours and glow, and free everything on dispose |
| `physicsJuice.test.mjs` | Physics juice: killing blows topple corpses as dynamic ragdolls kicked along the blow, cleaned up with the body on prune and teardown; artillery detonations toss nearby corpses, shove standing fighters without hurting them, scorch the ground with decals, and still play the fireball on a friendly hit; shockwave knockback; decals lie flat, fade with age and recycle through a fixed pool |
| `imageUpgrade.test.mjs` | Image upgrade: the periodic noise tile wraps seamlessly and still varies; one opaque 256x256 cloud shade tile projects the sun, drifts downwind, and is shared by reference with the ocean and lit materials; the shadow rig fits its depth to the sun, snaps to shadow-map texels and follows a focus; the post stack sizes its targets to the drawing buffer, blooms at a quarter resolution, falls back without float color buffers, and disposes cleanly |
| `squad.test.mjs` | AI squadmates: formation around the player, following the player's trail round a wall and catching up, shooting aliens, no friendly fire, being hunted and fighting back, reviving each other and the player, bleeding out |
| `landing.test.mjs` | Level 2 opening: camera sweep and skip, crew walking off, helicopters clearing the ship and landing, pilots, starting view, going down during the opening, supply crate (holding [E] to patch up, draining when released) |
| `level02.test.mjs` | Level 2 end to end: landing, three waves with their call-outs and the break between them counting down, ship-camping pressure (aliens massing at the gangway with call-outs until the player is ashore), the survivors going to ground after the waves (a holding force across the island that never pushes for the beach, dim on the map until they see you, the push resuming when the last is down), the final ambush springing on the push inland (holding the beacon until broken), objective and victory, the player downed and revived, bleeding out, reviving a squadmate with [E] (the crate yielding to it), defeat and retry, the sandbox level (revive, respawn, F4 squad toggle, the pressure preview), the score following the mission (the mission-opening intro groove and deploy swell, the surf taking over when the camera reaches the player, tension, combat, the held-wave suspense and sting, the victory and defeat stings), wave size and spread, the alive cap, the controls card, clean teardown |
| `uiOverlay.test.mjs` | HUD layers never swallow the clicks the game needs to lock the mouse |
| `level1Compat.test.mjs` | Shared code still behaves as Level 1 expects (player, camera, ocean, input, projectiles, deck walking) |

## How it runs outside the browser

- `support/loader.mjs` loads `.glsl` files as empty strings and `config.json` as a default export, the way Vite does. It also swaps the battleship model loader for `support/battleshipModelStub.mjs`, which reads only the collider meshes from the GLB.
- `support/testWorld.mjs` provides:
  - `createTestWorld()`: a GameWorld stand-in with real physics, scripted input (`world.input.hold('forward')`), a UI recorder (`world.ui.callsTo('showToast')`), an audio recorder (`world.audio.callsTo('play')`) and a music recorder (`world.music.callsTo('setState')`).
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
