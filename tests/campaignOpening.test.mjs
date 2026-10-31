import test from 'node:test';
import assert from 'node:assert/strict';
import { preloadCampaignAssets } from '../src/core/CampaignPreloader.js';
import { LEVEL_OPENINGS } from '../src/ui/components/StoryIntro.js';

test('campaign assets finish loading before the opening reaches 100 percent', async () => {
  const loaded = [];
  const progress = [];
  await preloadCampaignAssets(
    (fraction, label) => progress.push({ fraction, label }),
    async (url) => {
      loaded.push(url);
      return { ok: true, headers: { get: () => null }, arrayBuffer: async () => new ArrayBuffer(0) };
    }
  );
  assert.ok(loaded.some((url) => url.endsWith('/inside-spaceship.glb')));
  assert.ok(loaded.some((url) => url.endsWith('/characters/deadpool.glb')));
  assert.ok(loaded.some((url) => url.endsWith('/characters/elite-afton.glb')));
  assert.equal(progress.at(-1).fraction, 1);
  assert.equal(progress.at(-1).label, 'Ready');
});

test('every campaign level has its own opening and mission briefing', () => {
  for (const level of ['Level01InsideSpaceship', 'Level02', 'Level03']) {
    assert.ok(LEVEL_OPENINGS[level].scene);
    assert.ok(LEVEL_OPENINGS[level].narration);
    assert.ok(LEVEL_OPENINGS[level].mission);
  }
  assert.match(LEVEL_OPENINGS.Level01InsideSpaceship.mission, /Free the remaining main characters/);
  assert.match(LEVEL_OPENINGS.Level02.mission, /secure their transport/);
  assert.match(LEVEL_OPENINGS.Level03.mission, /Disable every generator/);
});
