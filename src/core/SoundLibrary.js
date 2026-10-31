// Local, credited CC0 recordings. No remote requests during combat.
const steps = (surface) => ['l1', 'r1', 'l2', 'r2'].map(step => `step-${surface}-${step}.ogg`);
export const SOUND_FILES = {
  gunshot: ['rifle-shot.wav'],
  plasma: ['plasma.ogg'],
  hit: ['impact.ogg'],
  hurt: ['impact.ogg'],
  explosion: ['explosion.ogg'],
  reload: ['reload.wav'],
  alienCall: ['creature-1.wav', 'creature-2.wav', 'creature-3.wav', 'creature-snarl.ogg'],
  footstep: steps('stone'),
  footstepSand: steps('sand'),
  flyby: ['ship-engine.ogg'],
  wingbeat: ['wing-rush.ogg'],
  abduction: ['tractor-beam.ogg'],
  cageOpen: ['cell-release.ogg'],
  fire: ['fire-breath.ogg'],
  slime: ['acid-spit.ogg']
};
export const AUDIO_FILES = [...new Set(Object.values(SOUND_FILES).flat())];

export function footstepSound(gameWorld) {
  return gameWorld?.currentLevel?.constructor?.name === 'Level02' ? 'footstepSand' : 'footstep';
}
