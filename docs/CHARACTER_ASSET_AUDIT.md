# Character asset screening — 30 October 2026

## Result

Microsoft Defender reported **no threats** in both the workspace scan (including the eight supplied archives) and a separate scan of their extracted contents. Both commands completed with exit code 0. This is a negative antivirus result, not a guarantee that every file is harmless. No supplied Blender project, embedded script, or executable was run.

Defender antivirus and real-time protection were enabled. Its reported signature timestamp was 29 October 2026, 18:50:56 (machine-local display). Scanner: platform `4.18.26100.4-0`, custom scan with `-DisableRemediation` to preserve files.

Archive entry names were checked for absolute paths and parent traversal, and entry types were restricted to regular files/directories before extraction. Listings contained Blender, FBX, TGA, HDR and desktop.ini files; no standalone executable or script entry was listed. Blender files have not yet been inspected for embedded scripts.

The originals remain unchanged. Extracted source files, SHA-256 archive hashes, a metadata-only inspection script, and `asset-metadata.json` are in the workspace's sibling `model-audit/` directory, outside the game's public assets.

## Game and integration contracts

ScopeCreep uses Three.js, Rapier, Vite, and a PartyKit server. It combines ship stations and jet combat with squad-based beach combat and a village finale: disable shield generators, defeat the Warden, and rescue hostages.

Relevant implementation reviewed: main level registry, architecture and codebase guides, player model and its call sites, SoldierModel, AlienModel, GroundCombatant, AlienBrute, AlienWarden, level introductions, existing GLTF battleship loader, and graphics quality controls.

- `PlayerModel` currently builds a capsule-based avatar. Replacements must retain first-person hiding, crouch, mounting visibility, collider debug visibility, and disposal.
- `SoldierModel` and `AlienModel` build jointed procedural actors. `GroundCombatant` requires a mesh, movement/aim animation, fallen pose, hit flash, and disposal; armed enemies also use a muzzle transform.
- Character origins are at the feet and forward is -Z. Visual replacement must preserve existing capsule physics and gameplay timing.
- The Warden is a grounded arena enemy with a roughly 4.6 m capsule, plasma volleys and a slam/shockwave attack. A large winged creature needs an explicit scale/arena-fit assessment.
- Character movement runs in phase 4; gameplay and animation run in phase 5; cameras run in phase 6. Existing GLTF loading is for the battleship, not an interchangeable animated character pipeline.

## PC observed

ASUS VivoBook X515DA/M515DA; AMD Ryzen 7 3700U; AMD Radeon RX Vega 10 graphics; 14,976,663,552 bytes usable physical memory (about 13.95 GiB). Windows reports 2 GiB adapter RAM; this is not a measured browser graphics-memory budget. No gameplay performance benchmark has been performed with these assets.

## Asset findings

| Archive | Extracted size | Finding | Readiness |
| --- | ---: | --- | --- |
| Ashe OW2 Basic | 158.9 MiB | Ashe, BOB, rifle and coach gun in four `.blend` files | Blender inspection and conversion required |
| Deadpool (XForce) Basic | 75.1 MiB | One `.blend` file | Blender inspection and conversion required |
| Firion Basic | 225.6 MiB | One `.blend` file | Blender inspection and conversion required |
| Junker Queen (Wastelander) Basic | 82.7 MiB | One `.blend` file | Blender inspection and conversion required |
| Bahamut NT Basic | 68.7 MiB | One `.blend` file | Blender inspection, arena fit and conversion required |
| FFVII Remake - Galiant Beast | 248.2 MiB | 171,248 triangles; 44 TGA textures; zero FBX animation stacks | Optimize and animate before integration |
| Final Fantasy XVI - Bahamut | 1,012.8 MiB | 337,630 triangles; 81 TGA textures; zero FBX animation stacks | Highest source texture burden; optimize and animate before integration |
| Marvel Rivals - Gorr | 512.5 MiB | Body 96,121 triangles; sword 29,688; 74 TGA textures; zero FBX animation stacks in either file | Optimize and animate before integration |

Triangle counts come from FBX polygon indices, triangulating each polygon as n−2; they are source counts, not measured rendered counts. FBX Geometry record totals in the JSON include records that may be morph shapes, and must not be interpreted as draw-call counts. No separate textures alongside `.blend` files does not imply that they have no textures: those may be packed internally or referenced externally.

If every supplied TGA were uploaded as RGBA8 with a full mip chain, estimated texture allocations would be 606.7 MiB for Galiant Beast, 1,286.4 MiB for FFXVI Bahamut, and 662.7 MiB for Gorr. These are deliberately hypothetical totals, not measured VRAM use: not all maps are needed simultaneously, some are unused/duplicate, and formats/compression change the result. They nevertheless show why copying all raw maps into the browser is inappropriate without optimization.

## Agreed casting direction and remaining work

The user requests human-looking and Marvel-style characters for the main cast; non-human creatures for aliens and the Warden. Candidate main cast: Ashe, Deadpool, Firion, Junker Queen, and Gorr. Creature candidates: Galiant Beast and the two Bahamut variants. BOB's role remains to be assigned after visual inspection. Exact roles are provisional until rig and silhouette inspection.

Initial screening found no Blender installation. The subsequent authorized conversion and integration are described below. The original screening identified these necessary steps:

1. Obtain a trusted Blender executable and inspect projects with script auto-execution disabled; verify rigs, packed/external textures, materials, and bounds.
2. Create optimized runtime GLB derivatives. Start with a humanoid and one creature, reduce texture resolution and unused materials, and set geometry budgets from measurements on this PC.
3. Supply or build animation appropriate to the existing movement, aiming and attack interfaces; the inspected FBX models do not supply animation clips.
4. Integrate and inspect in sandbox levels, preserving physics, weapon sockets, damage readability, first-person visibility, and resource disposal.
5. Run the project's tests and production build, then measure browser frame time and memory with realistic actor counts before enabling the full cast.

## Conversion and movement implementation

Downloaded official portable Blender 4.5.15, verified SHA-256 `52dd02fd74877fa08e74b67d7854cf32468a232c02aaa19b6844c91285574f8d`, and scanned the extracted program with Defender (no threats found). All source projects were inspected with automatic script execution disabled. No embedded Text blocks or animation actions were present in the inspected scenes. Source files were preserved.

Nine GLBs now ship under `public/assets/characters/`. Each has one mesh primitive, one material, one embedded 1024/2048 atlas, and 14–20 bones. Triangle budgets: Deadpool 14k; Ashe/Firion/Junker Queen/Gorr 12k each; BOB 10k; Galiant 8k; Bahamut NT 14k; Bahamut XVI 20k. Export records and scripts are in sibling `model-audit/`. Rebuilt materials simplify source-specific shaders; facial morphs and individual finger bones are omitted in these derivatives.

Player: Deadpool. Named squadmates: Ashe, Junker Queen, Firion, Gorr. Other crew/pilots default to Ashe or BOB depending on construction. Regular aliens and the gate heavy use Galiant; the Warden uses Bahamut NT. FFXVI Bahamut is available in Character Lab only: its extended wing silhouette needs additional arena and attack-animation work before mission use.

CharacterVisual shares geometry/textures, clones per-actor skeletons and damage materials, normalizes bounds, and retains procedural fallbacks on load failure. Disposed actors reject late loads. Third-person motion uses analytic knee/elbow IK, physics-world foot probes, stance anchors that follow a supporting rigid body, pelvis lowering for crouch, gun grip targets and a damped recoil spring. WeaponPickup adds a timed reach interaction in the Character Lab and island missions. First-person rifle arms are a lightweight six-mesh gloved rig with grip and reload targets. Existing capsule movement and corpse physics remain authoritative; live limbs are animation-driven rather than freely simulated rigid bodies.

Initial browser inspection confirmed skin loading and procedural animation. Follow-up browser creation became unavailable in standalone sidebar mode, so the final IK/first-person poses have **not** received live visual approval or a reliable hardware performance benchmark. The initial lab displayed roughly 12–20 FPS during that browser session; this is insufficient evidence to certify smooth mission performance on this PC. Frame rate and hand/foot contacts need visual measurement in a foreground browser before declaring suitability complete.

The resulting motion is a procedural foundation. It does not include authored/motion-captured walk/run transitions, detailed third-person finger articulation, a true jointed active ragdoll, or production-quality weapon-specific reload/pickup clips. Matching modern commercial shooters still requires that animation and visual tuning work.

### Joint-lock correction

The next review identified two concrete causes of stiff limbs: a universal 8 cm ankle target pulled longer-booted rigs below their sole height, while universal rifle placement put support grips outside several actors' arm reach. Foot placement now preserves each rig's ankle clearance, lowers the pelvis to retain knee flexion, raises the swing foot, and keeps boots level. Weapon placement/scale now use measured shoulder positions and arm lengths; the IK solver reserves a small flexion margin at maximum reach. Knee recovery flexion is stronger, elbow idle flexion is retained, and movement speed eases into/out of the gait.

`tests/humanoidMotion.test.mjs` loads the actual shipped geometry, skin weights, skeletons and inverse binds (only textures are stripped for headless tests). It checks all six humanoids over 120 moving frames: knee flexion varies through stance/swing, elbows remain bent and both wrists reach the rifle within 2.5 cm. Generic limb and first-person contact tests also pass. The tutorial supplied by the user was reviewed via its transcript; it demonstrates Unity's Animator and separate idle/walk/run assets. This correction remains a Three.js procedural system rather than claiming those authored clips were supplied.

The live browser initially showed fallback models because its development server had stopped. Restarting the server restored imported skins; failed cache entries are now evicted so subsequent level loads can retry. A subsequent Character Lab screenshot showed the imported cast with bent gun-holding arms and a displayed 58 FPS. This is a spot observation, not a sustained mission performance benchmark.

### Recorded animations acquired and integrated

Using the user's signed-in Mixamo session, downloaded Y Bot in T-pose, individual rifle idle/walk/run/fire/crouch-walk recordings, the 16-animation Basic Shooter Pack, and Aiming Gun (ground pickup to aiming). Exports use FBX Binary, 30 FPS and no keyframe reduction. Individual motion exports omit skin; locomotion exports enable In Place where offered. The untouched downloads are in sibling `Animations/Mixamo/`. Defender scanned that directory without detecting threats.

The six humanoid skins now have 18 retargeted runtime clips each, including a held crouch-idle pose derived from a recording. `HumanoidAnimationPlayer` blends their locomotion/weapon states and synchronizes reload, pickup and grenade actions to gameplay timers. Pickup duration is calibrated to the 2.4-second recording. Recorded horizontal motion and additional jump elevation are removed so the movement controller remains authoritative. Existing IK adjusts contacts rather than replacing the recorded gait. The creature rigs and first-person glove rig retain their separate animation paths; individual third-person finger articulation remains limited by the optimized skeletons.

`tests/recordedMotion.test.mjs` checks recorded playback and state changes on all six actual shipped rigs, finite tracks and physics-owned horizontal travel. The live Character Lab reported recorded motion ready for 6/6 humanoids, with a saved preview in `model-audit/mixamo-character-preview.jpg`. First-person weapon-specific posing and source-to-target contact calibration remain areas for further visual refinement; this does not claim commercial-shooter production quality.

Verification: full regression run completed with 258/259 passing; the sole flak-crew hit test also failed on the original baseline. The final recorded-motion, pickup and weapon checks passed 19/19. A second Defender scan of all animation downloads also found no threats. The ground rifle follows the grabbing hand during the recorded lift; the existing held rifle is hidden until pickup completes.
# Gameplay and pose follow-up (2026-10-30)

Final verification: production build passed (160 modules). Full regression passed 279/280 tests with two workers; only the pre-existing flak-crew accuracy assertion fails. The sustained force-field traversal, combined pickup/hero shields, mouth emitters, flight/landing and shipped-rig grip checks pass. Logs: sibling `model-audit/character-powers-final-regression.log` and `character-powers-build.log`; visible rifle preview: `character-powers-rifle-preview.jpg`.

- Gorr is alien-only; the menu selects and remembers one of five main characters.
- Walking/sprinting/crouching are 4.2/7.5/2 m/s. Walking animation follows player intent.
- H activates a distinct power for each main character; companions activate powers in combat.
- Only Gorr carries a rifle. Other alien attack sockets follow the head/mouth, including the sniper charge indicator.
- Winged Bahamut models fly using collision-tested kinematic movement and land for ground attacks.
- Empty hands use relaxed arms. Armed hands solve to visible rifle sockets with outward elbow poles; knife and bomb use one carrying hand.
- `tests/characterPowers.test.mjs` exercises actual shipped skeletons, both wrist contacts during recorded motion, empty-hand stance, mouth sockets, real physics flight/landing, healing, cooldowns, shields, hostile damage and obstruction by cover.

