// The island chart: the chart a level feeds (terrain sampler, projection, colours) and the live
// intel it draws — the player, the squad, the objective pins and the aliens still alive. The chart
// rides always-on in the top-right corner; [M] expands it to the full one.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createTestWorld, stepWorld, bodyCount } from './support/testWorld.mjs';
import { BeachEnvironment } from '../src/levels/level02/BeachEnvironment.js';
import {
  mapTerrainFromEnvironment, projectPoint, headingAngle, terrainColor
} from '../src/ui/components/MapOverlay.js';
import { Level02 } from '../src/levels/Level02.js';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

test('the chart samples the island: sea in the south, the landing beach, the village plateau', async () => {
  const world = await createTestWorld();
  const environment = new BeachEnvironment(world);
  const terrain = mapTerrainFromEnvironment(environment);

  // The bounds wrap the playable scatter with a belt of sea to frame the island
  assert.equal(terrain.bounds.minX, environment.scatterBounds.minX - 30);
  assert.equal(terrain.bounds.maxZ, environment.scatterBounds.maxZ + 30);
  assert.ok(terrain.bounds.minZ < -500, 'the village end of the island is on the chart');

  // South of the waterline (z = 200) the chart is open water; the beach is dry sand above it
  assert.ok(terrain.heightAt(0, 220) < -0.3, 'the anchorage reads as sea');
  assert.ok(terrain.heightAt(0, 190) > 0.3 && terrain.heightAt(0, 190) < 2.5, 'the landing beach reads as sand');
  // The far end is the village plateau (12 m), well above anything on the beach
  assert.ok(Math.abs(terrain.heightAt(0, -340) - 12) < 0.01, 'the village plateau reads high');

  // The sampler is the environment's own ground, not a copy of it
  assert.equal(terrain.heightAt(5, -100), environment.heightAt(5, -100));
  assert.equal(terrain.pathDistance(5, -100), environment.pathDistance(5, -100));

  environment.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0);
});

test('the chart is north-up: beach at the bottom, east to the right, the arrow turns with the view', async () => {
  const world = await createTestWorld();
  const environment = new BeachEnvironment(world);
  const { bounds } = mapTerrainFromEnvironment(environment);
  const width = 352;
  const height = 451;
  const p = { x: 0, y: 0 };

  const beach = projectPoint(bounds, width, height, 0, 240, { x: 0, y: 0 });
  const village = projectPoint(bounds, width, height, 0, -340, { x: 0, y: 0 });
  assert.ok(beach.y > village.y, 'the southern beach sits below the village');
  assert.ok(beach.y > height * 0.9, 'the waterline runs along the bottom of the chart');

  projectPoint(bounds, width, height, 160, 0, p);
  assert.ok(p.x > width / 2, 'east is to the right');
  projectPoint(bounds, width, height, 0, 0, p);
  assert.ok(Math.abs(p.x - width / 2) < 1, 'the island centre is the chart centre');

  assert.ok(headingAngle(0) === 0, 'facing north: the arrow points up');
  assert.ok(headingAngle(Math.PI / 2) < 0, 'turning right turns the arrow clockwise');

  environment.dispose();
  world.clearEntities();
});

test('the chart colours read at a glance: sea, sand, grass and the jungle path', () => {
  const out = [0, 0, 0];
  terrainColor(-5, false, out);
  assert.ok(out[2] > out[0], 'open sea is blue');

  terrainColor(0.05, false, out);
  assert.ok(out[2] > out[0], 'the wet sand at the waterline stays dark');

  terrainColor(0.5, false, out);
  assert.ok(out[0] > 150 && out[0] > out[1] && out[1] > out[2], 'dry sand is pale');

  terrainColor(5, false, out);
  assert.ok(out[1] > out[0], 'inland grass is green');

  const plain = [...out];
  terrainColor(5, true, out);
  assert.ok(out[0] > plain[0] && out[1] > plain[1], 'the path lightens the ground it crosses');
});

test('Level 2 feeds the map: the player, the crew, the beacon pin and exactly the aliens alive', async () => {
  const world = await createTestWorld({ seed: 3 });
  const level = new Level02(world);
  await level.init();

  // The chart is the level's own island
  const terrain = level.getMapTerrain();
  assert.equal(terrain.bounds.maxX, level.environment.scatterBounds.maxX + 30);
  assert.equal(terrain.heightAt(0, 190), level.environment.heightAt(0, 190));

  // The snapshot: the player, every squadmate but the player, and a quiet island
  let data = level.getMapData();
  assert.equal(data.player.x, level.player.position.x);
  assert.equal(data.player.z, level.player.position.z);
  assert.equal(data.player.yaw, level.player.yaw);
  assert.equal(data.mates.length, level.allies.members.length - 1, 'every member but the player');
  assert.ok(data.mates.every((mate) => mate.downed === false));
  assert.deepEqual(data.enemies, [], 'the island is quiet before the waves');
  assert.deepEqual(data.markers, [], 'no beacon pin before the push inland');
    assert.deepEqual(
      data.zones,
      [
        { id: 'forest', name: 'The Forest', z: 120 },
        { id: 'rocks', name: 'The Rockfields', z: -110 },
        { id: 'outskirts', name: 'Village Outskirts', z: -215 }
      ],
      'the zone lines ride the chart'
    );

  // The pin follows the live objective: it appears when the push inland is on — at the village gate
  level.state = 'objective';
  assert.deepEqual(
    level.getMapData().markers,
    [{ x: level._objectivePoint.x, z: level._objectivePoint.z, label: 'THE GATE' }],
    'the gate pin while pushing inland'
  );
  level.state = 'landing';

  // A hider waiting in the hills: on the chart, not yet hunting (dim), the brute reads bigger
  const trooper = level.createAlien('trooper', 0, 100);
  level.createAlien('brute', 20, -100);
  data = level.getMapData();
  assert.equal(data.enemies.length, 2);
  assert.equal(data.enemies.filter((enemy) => enemy.big).length, 1, 'the brute reads big on the chart');
  assert.ok(data.enemies.every((enemy) => enemy.alerted === false), 'hiders do not glow until they hunt');
  const trooperBlip = data.enemies.find((enemy) => !enemy.big);
  assert.equal(trooperBlip.x, trooper.position.x);
  assert.equal(trooperBlip.z, trooper.position.z);

  // Killing one drops it off the chart at once; the survivor stays
  trooper.health.takeDamage({ amount: 99999, source: level.player });
  data = level.getMapData();
  assert.equal(data.enemies.length, 1, 'the dead trooper is off the chart');
  assert.equal(data.enemies[0].big, true);

  // The on-screen charts are fed a few times a second, not every frame (the test UI reports them up)
  stepWorld(world, 1, { level });
  const feeds = world.ui.callsTo('updateMap');
  assert.ok(feeds.length >= 4 && feeds.length < 30, `fed ${feeds.length} times in a second`);
  assert.ok(Array.isArray(feeds.at(-1).args[0].enemies), 'the snapshot carries the enemy intel');

  level.dispose();
  world.clearEntities();
  assert.equal(bodyCount(world), 0, 'no physics bodies left');
});

test('the full chart opens on [M]; the corner chart is its own always-on element', () => {
  const source = read('../src/ui/components/MapOverlay.js');
  assert.match(source, /className = 'ui-map-overlay ui-hidden'/, 'the full chart must start hidden');
  assert.match(source, /className = 'ui-minimap ui-hidden'/, 'the corner chart starts hidden until the level shows it');
  assert.match(source, /showMinimap\(terrain\)/, 'the corner chart paints from the level terrain');
  assert.match(source, /this\.isMinimapVisible\) this\._drawChart/, 'the corner chart redraws with the live state');
});

test('a stage load pins the corner chart; the full chart and the corner swap, never stack', () => {
  const world = read('../src/core/GameWorld.js');
  assert.match(world, /if \(chart\) this\.ui\.showMinimap\(chart\)/, 'a stage with a chart brings the corner chart up');
  assert.match(world, /this\.ui\.hideMinimap\(\); \/\/ The full chart replaces the corner one/, 'the full chart takes the corner while it is out');
  assert.match(world, /now - \(this\._lastMapToggleAt \|\| 0\) < 250\) return/, 'a double-fired [M] cannot blink the full chart closed');
  const css = read('../src/ui/ui.css');
  assert.match(css, /\.ui-minimap\s*\{[^}]*pointer-events:\s*none/, 'the corner chart never eats the game\'s clicks');
});
