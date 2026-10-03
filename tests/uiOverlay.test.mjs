// UI overlay: HUD layers must never swallow the clicks the game canvas needs to lock the mouse
// (no mouse lock means no aiming and no shooting).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(new URL(path, import.meta.url), 'utf8');

function cssRules(css) {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  return [...clean.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ selector: m[1].trim(), body: m[2] }));
}

// Full-screen screens that are meant to be clicked (and start hidden)
const INTERACTIVE_SCREENS = {
  '.ui-mission-result': '../src/ui/components/MissionResult.js',
  '.ui-main-menu': '../src/ui/components/MainMenu.js',
  '.ui-pause-overlay': '../src/ui/components/PauseMenu.js'
};

test('the overlay rule never outranks a component\'s own pointer-events', () => {
  for (const { selector, body } of cssRules(read('../src/main.css'))) {
    if (!/pointer-events\s*:\s*auto/.test(body)) continue;
    // An id selector outside :where() beats every class rule, re-enabling clicks on HUD layers
    const counted = selector.replace(/:where\([^)]*\)/g, '');
    assert.ok(!counted.includes('#'), `"${selector}" overrides HUD pointer-events: wrap the id in :where()`);
  }
});

test('full-screen HUD layers let clicks through to the game', () => {
  for (const { selector, body } of cssRules(read('../src/ui/ui.css'))) {
    const fixed = /position\s*:\s*fixed/.test(body);
    const fullScreen = /inset\s*:\s*0/.test(body) || (/width\s*:\s*100%/.test(body) && /height\s*:\s*100%/.test(body));
    if (!fixed || !fullScreen || selector in INTERACTIVE_SCREENS) continue;
    assert.match(body, /pointer-events\s*:\s*none/, `${selector} covers the screen but would catch clicks`);
  }
});

test('clickable full-screen screens start hidden', () => {
  for (const [selector, path] of Object.entries(INTERACTIVE_SCREENS)) {
    const source = read(path);
    assert.match(source, new RegExp(`className = '${selector.slice(1)} ui-hidden'`), `${selector} must start hidden`);
  }
});
