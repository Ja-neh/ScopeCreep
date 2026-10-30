# Combat and HUD requirements

Completion means implemented and verified; unchecked items remain outstanding.

- [x] Each human uses their own powers alongside guns.
- [x] Gorr fires bullets (3–5% final damage) and uses his sword (at least 25%).
- [x] Red winged aliens fly and spit green acid slime (10% final damage).
- [x] Black winged aliens fly and breathe fire (15–20% final damage).
- [x] Largest white winged alien is the boss, with all alien powers except guns.
- [x] Level 1: Gorr only; level 2: Gorr/red; level 3: Gorr/red/black.
- [x] Human incoming damage reduced 30%; specified percentage attacks retain their final percentages.
- [x] Teammate revives restore health, armor and standing appearance; squad wipe restores everyone at the checkpoint.
- [x] Outside the hall, alien reinforcements emerge from ships rather than resurrecting.
- [x] Human health and head portraits top-left; alien health bars overhead.
- [x] Boss health top-right; map hidden in hall; smooth hall-entry transition.
- [x] FPS/ms immediately left of Options.
- [x] Instructions accessible through an Options button, absent during play.
- [x] Bottom-center weapon HUD with visual tool icons.
- [x] Machine gun starts with 75 loaded and 225 reserve (300 total).
- [x] Held gun visible in first and third person.
- [x] Assistants stop bouncing.
- [x] Round map shows actual terrain/buildings/landmarks.
- [x] Player-inspection and surroundings camera controls.
- [x] Larger, taller boss hall.
- [x] Boss wing tornado attacks.
- [x] Boss resurrects up to 10 dead aliens per cast inside the hall, on a cooldown.

Validation: production build passed. Final affected gameplay checks: 39/39; UI/map checks: 9/9. The full regression run completed 291 tests; its obsolete gate-walker HUD expectation was updated and passed on rerun. The unrelated pre-existing flak-crew accuracy assertion remains failing. Logs and screenshots are in sibling model-audit/combat-hud-*.

Controls: H power; V first/third person; O inspect player; hold Z and move the mouse to look around. Instructions and sandbox tools are under Options.
