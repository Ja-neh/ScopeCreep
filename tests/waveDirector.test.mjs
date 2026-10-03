// WaveDirector: wave order, lanes, spawn pacing, pauses between waves, completion.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WaveDirector } from '../src/ai/WaveDirector.js';

const WAVES = [
  { trooper: 2, lanes: ['centre'] },
  { trooper: 3, brute: 1, lanes: ['centre', 'west'] }
];

function createDirector() {
  const alive = [];
  const spawned = [];
  const director = new WaveDirector({
    waves: WAVES,
    betweenWavesSeconds: 5,
    spawnIntervalSeconds: 1,
    spawn: (type, lane) => {
      const unit = { type, lane };
      alive.push(unit);
      spawned.push(unit);
      return unit;
    },
    aliveCount: () => alive.length
  });
  const run = (seconds, step = 0.1) => {
    for (let t = 0; t < seconds; t += step) director.update(step);
  };
  return { director, alive, spawned, run };
}

test('units are dealt round-robin across lanes, heavier units last', () => {
  const list = WaveDirector.expand({ trooper: 3, brute: 1, lanes: ['a', 'b'] }, ['trooper', 'brute']);
  assert.deepEqual(list, [
    { type: 'trooper', lane: 'a' },
    { type: 'trooper', lane: 'b' },
    { type: 'trooper', lane: 'a' },
    { type: 'brute', lane: 'b' }
  ]);
});

test('nothing spawns before start()', () => {
  const { director, spawned, run } = createDirector();
  run(10);
  assert.equal(spawned.length, 0);
  assert.equal(director.state, 'idle');
  assert.equal(director.waveNumber, 0);
});

test('a wave spawns one unit per interval, then waits for them to die', () => {
  const { director, spawned, run } = createDirector();
  director.start();
  director.update(0.01);
  assert.equal(spawned.length, 1, 'first unit arrives immediately');
  run(1.05);
  assert.equal(spawned.length, 2);
  assert.equal(director.state, 'fighting');
  assert.equal(director.remaining, 2);
  run(30);
  assert.equal(director.state, 'fighting', 'stays on wave 1 while units live');
  assert.equal(director.waveNumber, 1);
});

test('clearing a wave pauses, then the next wave arrives; clearing the last finishes', () => {
  const { director, alive, spawned, run } = createDirector();
  director.start();
  run(2);
  alive.length = 0; // Wave 1 wiped out
  run(0.2);
  assert.equal(director.state, 'between');
  run(4);
  assert.equal(director.waveNumber, 1, 'still pausing');
  run(1.5);
  assert.equal(director.waveNumber, 2);
  run(5);
  assert.equal(spawned.length, 6);
  assert.equal(spawned.filter((u) => u.type === 'brute').length, 1);
  assert.deepEqual([...new Set(spawned.slice(2).map((u) => u.lane))].sort(), ['centre', 'west']);

  alive.length = 0;
  run(0.2);
  assert.equal(director.isDone, true);
});
