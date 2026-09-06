# Changelog

All notable changes to this project are documented here. Earlier
versions (0.4 through 0.7) are summarised at the bottom; the bulk of
the file is the 0.8.0 release on top, where every commit is listed
with the same level of detail the README timeline used to carry.

The format follows [Keep a Changelog](https://keepachangelog.com/)
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.8.0] - 2026-05

The biggest release on this fork. Front-of-screen UI overhaul, a wave
of new gameplay features, ambient creatures, a procedural audio system,
and a long performance + architecture pass. ~50% of `World.ts` deleted
from the upstream baseline, four god-classes (Character, Vehicle, World,
AnimalModels) extracted into focused helpers, ~3500 per-second
allocations eliminated from hot paths.

### UI

- **Design tokens** - central `tokens.css` (~50 colour / typography / spacing / shadow / motion custom properties; `class="dark"` on `<html>` flips the surface palette to dark mode). All CSS modules reference the tokens - no scattered magic numbers.
- **Title screen** - bouncing-cube card + "click or press any key" gate that doubles as the audio-autoplay user gesture. Top-right icon buttons for dark mode and sound mute (the latter writes `localStorage['sketchbook.soundMuted']`, seeded into `Master_Audio` on next boot). Language picker (en / de / es) at the bottom.
- **Loading screen** - live percentage + bar driven by `LoadingManager`.
- **Pause menu** - opens on Esc and actually pauses (timeScale=0, restores prior state on Resume) with Resume / Settings / Restart Scenario / Reload.
- **Settings modal** - four cards (General / Graphics / Audio / Controls) that write through lil-gui controllers so every existing `onChange` handler (CSM, mouse sensitivity) keeps firing. The General card carries the language picker (reload via iris-wipe), Dark mode toggle, and Reset settings (wipes every persisted `sketchbook.*` localStorage key + reload). Audio card carries Master_Audio with visual disable for Sound_Effects + Background_Music sub-toggles while master is off. Graphics card opens with Low / High preset shortcuts that flip Shadows + Outlines together. `gui.save()` runs after every modal write so toggle clicks persist immediately. Bidirectional sync via `gui.onChange` so debug-panel changes re-render the modal toggles when both views are open.
- **Branching NPC dialog** - layered on top of `ProximityPrompt` (portrait, speaker line, numbered choices, mouse + 1-9 keys). Anna / Ben / Carla / Dieter all got hand-written 3-node trees explaining the world. Participants are `dialogFreeze`'d (player + NPC stop moving and drop their actions), every other on-screen UI surface is hidden via `html.dialog-active`, the NPC rotates to face the player. Players exit only by picking a closing choice (every dialog has one); Esc + walk-away dropped so the typewriter can't be yanked mid-sentence.
- **Dialog typewriter** - NPC dialog text reveals one character at a time (28 ms cadence). Choices stay hidden until the line finishes. Click the bar or press E / Enter / Space to skip.
- **Mobile dialog layout** - `@media (max-width: 600px)` splits the dialog into two free-standing cards: speech bubble pinned to the top (avatar + speaker + scrollable text band, max-height 28vh), choices float at the bottom of the viewport via `position: fixed`. World stays visible in the gap. `backdrop-filter` dropped on mobile because it was making the box the containing block for any `position: fixed` descendant.
- **Error overlay** - catches `window.onerror` + `unhandledrejection` into a frosted card with stack + Reload + Copy details.
- **Iris transition** - singleton CSS clip-path overlay (700 ms cubic-bezier circle wipe). Wired into the map switcher, scenario restart, pause-menu reload, and the Settings reset/locale-change paths.
- **Floating CSS2D world labels** - `WorldLabels` registry on top of the existing CSS2DRenderer with distance culling (10 m) and a single `Labels` feature gate that covers the player tag (`label.player` translated to "You" / "Du" / "Tú"), NPC names (from `userData.name`), and dog/cat tags (`animal.dog` / `animal.cat`). Uses Three's `visible` flag instead of toggling DOM display - cheaper for the CSS2D pass.
- **Touch controls** - virtual joystick spawns anywhere on the canvas (drag-to-spawn) instead of a fixed corner. Action button cluster is fully context-aware: foot-near-NPC shows E/F, in-vehicle shows brake + vehicle-specific extras (V/X for car/boat, ascend/descend + Q/E yaw for aircraft, ascend/descend for rocket), passenger shows seat-switch only, dialog hides everything. 2-column staircase layout so the primary action sits over the joystick thumb. Localised labels with touch-aware prompt strings ("Toca E para hablar con Anna" instead of "Press E"). Synthesises KeyboardEvent / MouseEvent pairs so InputManager handles them as if from a hardware keyboard / mouse.
- **i18n + language picker** - flat translation table (en / de / es), `t(key, vars)` lookup, persisted to `localStorage['sketchbook.locale']`. Title screen, pause menu, settings modal, error overlay, dialogs, and world labels all translated. Title-screen language picker triggers a reload via the iris-wipe.
- **HUD controls list fixes** - X (Switch seats) now shows in the driving HUD whenever the vehicle's GLB authored connectedSeats; the HUD no longer freezes on the AI-driver vehicle's controls list at scenario start.
- **Common controls helper** - duplicated on-screen-help rows (V / F / Shift+R / Shift+C) extracted into `commonGlobalControls()` + `commonVehicleControls()` in `core/CommonControls.ts`. 18 duplicated rows → 5 central definitions.
- **"Map & Scenarios" lil-gui panel** - the Scenarios folder was renamed; `addMapSwitcher` runs at the start of `loadScene` so the map dropdown lands on top, scenario buttons collapse into a `Scenarios` sub-folder lazily on first launch link. All top-level folders ship collapsed by default.
- **Dark mode reaches the rest of the UI** - dialog, SweetAlert, lil-gui all follow the toggle.
- **Pointer-lock dropped** - drag-to-look only. Pointer-lock was inconsistent across browsers and broke iframe embeds.
- **Shared `#debug-stack` column** - FPS box + lil-gui live in the same flex column instead of overlapping.
- **`ProximityPrompt` rebuilt as a stateless distance check** - replaces the older TriggerCube-driven enter/exit state machine with a per-frame squared-distance comparison against the player (mirrors `WorldLabels`'s approach). TriggerCube is gone; the containment test lives directly in `ProximityPrompt.update()`. Per-frame orphan-detection tears the prompt down when its `targetCharacter` leaves `world.characters[]` so stale prompts after a scenario switch don't linger.
- **Welcome dialog** mentions recently added features.

### New Features

- **Camera Shake** - sineNoise-based per-frame camera offset triggered by vehicle hard landings. Static fire-and-forget API, three presets (collision / land / boost), quadratic decay envelope, toggle in Settings.
- **Stuck / flip auto-recovery** - Vehicle base method that watches a per-frame distance-traveled window and an upside-down timer (chassis upY < cos(80°) - anything past horizontal counts as flipped, leaving 45° hills uncaught at upY ≈ 0.7). Lifts and yaw-resets when either threshold trips; fires a `collision` camera shake on recovery. Per-subclass opt-out: boats / rockets fully off, air vehicles flip-only.
- **Procedural engine sound** - per-vehicle Web Audio synthesiser (2-layer sawtooth + square exhaust through a lowpass + bandpass-filtered noise intake). RPM modulated by chassis speed. Five timbre profiles: car / heli / airplane / boat / rocket.
- **Outline effect** - depth-Sobel toon pass: pre-renders scene linear depth into a `HalfFloatType` render target via a `THREE.MeshDepthMaterial` override (which wires three's standard skinning + morph-target chunks so animated NPCs render in their actual pose, not bind pose), then blends a Sobel kernel over the framebuffer via a fullscreen quad. Sky / Stars / Earth / Moon / Grass / Ocean opt onto a new `RenderLayer.OutlineSkip` layer so the depth pre-pass skips them. Threshold is ratio-based (`edge / max(avgDepth, 1e-6)` against `relativeThreshold`). Plays alongside the FXAA composer; toggle in Settings, default off (the High preset flips it on).
- **Star field at night** - 2000 points on the upper hemisphere of a camera-anchored shell with a twinkle shader. nightFactor is derived from sun position, so they fade in at dusk and stay full in space.
- **Procedural ambient soundscape** - wind (filtered noise) + water (LFO-swept bandpass). Water gain gated by `Math.abs(cam.y - 12) < 10` so only audible while the camera is within 10 m of the ocean's y-level. Bird chirps live in per-bird `BirdSound` (see Audio system).
- **Bundled background music** - looped shuffle through three tracks generated with [Suno AI](https://suno.com/). Reuses the shared THREE AudioContext through `ProceduralAudio`. Gated by `params.Background_Music`, scaled by `Master_Volume * Music_Volume`.
- **Per-character `CharacterSfx`** - footsteps / jump / land / door clunk emit through a per-Character `THREE.PositionalAudio` (refDistance 4, rolloff 1.5, maxDistance 35) attached to the character body. Same role EngineSound has for vehicles. Every character (player + NPCs) emits its own sounds: Anna walking the loop fades with distance; an AI driver entering its vehicle gets the door clunk at the vehicle, not at the player.
- **Procedural SfxBus** - player-UI events that aren't tied to a character or vehicle: race checkpoint + lap fanfare, dialog whoosh, ProximityPrompt + PauseMenu UI ticks, IrisTransition whoosh, Vehicle crash (350 ms throttle, impact > 4) and RocketShip liftoff boom. Each play* method builds its tiny synth on demand and lets the browser GC the nodes once the burst finishes.
- **`Master_Audio` mute switch** - master gate that mutes every audio source in one click. `getMasterVolume` returns 0 for the continuous synths; `World.applyAudioListenerVolume()` zeroes the THREE.AudioListener for the 3D-positional path. Sub-toggles in the settings UI grey out while master is off. Default reads `localStorage['sketchbook.soundMuted']` so the title-screen mute button persists; toggling either side (title screen, settings modal, debug panel) mirrors `sketchbook.soundMuted` so all three views stay in sync.
- **`Sound_Effects` flag** - one player-facing toggle gating EngineSound, AmbientSound, BirdSound, SfxBus, CharacterSfx and AnimalVoices. `Background_Music` keeps its own toggle so the player can mute speech / explosions while leaving music on (or vice versa).
- **Wandering animals** - 1 dog + 2 cats (deliberately calm count) spawned deterministically around the spawn pad. Each animal builds as a Three.Group with named handles for body / head / tail / legs / ears so a per-frame animator drives idle-breath, walk-cycle, run-cycle and jump pose independently. Each carries a dynamic cannon sphere on a new `Animals` collision group - cannon resolves terrain, player capsule and animal-vs-animal contact (the manual ground-snap path is gone). Jump is a real physics arc kicked by `body.velocity.y`; the body's `collide` event flips an `airborne` flag back off on landing. Procedural voices: dog bark on approach (square + bandpass), cat meow when threatened (FM sweep), cat purr-loop near tamed cats (LFO-modulated sawtooth) - mouth animation timed off the same `voiceTimer` the synth ramps. Per-species AI in `DogBehavior` / `CatBehavior` Strategy classes (singletons); shared idle/wander/tame logic in an `AnimalBehavior` base. Tamed pets close to 3 m, face the player every frame even while idle, and the dog pins position + heading inside bark range.
- **Flying birds** - 2 birds orbiting on circular paths with sin-flap wings and banking turns. Per-bird `THREE.PositionalAudio` with FM-chirp synth (sine carrier + sine modulator + bandpass) attached to each bird's group; chirps fall off with distance. Each bird has a kinematic cannon sphere on the Animals collision group. Altitude band 5..14 m above the player's spawn-Y (captured once on first frame, never re-read so jumps + falls don't drag the swarm); X/Z stay player-relative so the flock stays in view. Frustum cull past 80 m skips wing flap + body sync; group position keeps updating so chirps still come from the bird's actual position.
- **Ambient butterflies** - 2 butterflies drifting on a Lissajous path (cos + sin with co-prime frequency multipliers so motion never loops). Altitude band 1.0..1.5 m above the player's spawn-Y so they read as chest-height regardless of whether the spawn pad sits at y=0 or on Inthenew's elevated helipad. Distance-culled at 30 m, DoubleSide wing material, kinematic cannon sphere on the Animals collision group.

### Maps

The swift502 v0.1 + v0.2 original demo scenes vendored alongside the v0.3 + v0.4 socketControl maps that 0.7.0 brought in - all four released-tag-era maps now selectable from the dropdown.

- **swift502 v0.1 (foundation)** - the v0.1 build had no `.glb` level; the demo was constructed inline in JS (`docs/js/index.js`). Recreated as a procedural sandbox (`Sw01Scene.ts`) that builds the v0.1 silhouette from primitives - tiled platform, dynamic spheres, static cubes, credit sign with grass tuft, plus the v0.1 roster of player + Bob (FollowCharacter) + John (Random).
- **swift502 v0.2 (test world)** - `build/models/test_world/scene.glb` from the v0.2.0 tag vendored verbatim as `build/assets/world_v02.glb`. Loaded async at runtime by `Sw02Scene` which translates the v0.2-era `extras.physics='convex'/'trimesh'` + `extras.mass='1'` userData into Sketchbook's current `userData.data='physics'/'spawn'` dispatch format (the v0.2 GLB pre-dates the format Sketchbook 0.3+ uses). Player at the v0.2 demo's hand-picked `(1.13, 3, -2.2)` spawn; John (Random) at `(5, 2, 1)`; Bob (FollowCharacter) at `(-5, 2, 3)` - the original `examples/characters.html` roster.
- The v0.3 + v0.4 maps (vendored as `world_sc_v03.glb` + `world_sc_v04.glb` from the [tkkaushik369/socketControl](https://github.com/tkkaushik369/socketControl) flavour) were already brought in by 0.7.0; this release just labels them consistently in the dropdown.
- `NPCSpawnPoint` grew a `userData.behaviour: 'random' | 'follow'` switch so the v0.1 / v0.2 AI characters can drive the existing `RandomBehaviour` / `FollowTarget` AI modules without needing a path graph.

### Renames + defaults

- `Has_Day_Night_Cycle` → `Sun_Cycle` (the old name only described half of what it does). `Has_Night_Time` greys out via lil-gui's `enable(false)` while Sun_Cycle is off.
- Em-dashes replaced repo-wide with hyphens.

### Performance

- **Pool Vector3 / Quaternion scratches in upstream physics paths** - `physicsPreStep` / `physicsPostStep` / wheel-update / springRotation across Helicopter, Airplane, Car, Vehicle and Character ran at 60 Hz per instance and allocated ~3500 throwaway objects per second through the upstream code. Module-scoped scratches that get `.set()` / `.copy()` into each call. Pure GC pressure relief.
- **Hot-path allocations dropped on upstream code** - `Character.feetRaycast` no longer allocates two CANNON.Vec3 + a rayCastOptions object per physics step (module-scoped scratches reused across characters). `Character.inputReceiverUpdate`'s viewVector copies into the existing field-bound vector instead of replacing it. `Grass.refreshPushers` pools its candidate objects in a grow-only field array. `Character.moveVector` strict `=== 0` → `lengthSq() < 1e-6` epsilon. Ocean's per-call lambda + `Math.PI/180` → module-scoped `DEG2RAD` constant.
- **Clamp renderer pixelRatio** - cap `setPixelRatio` at 2. Phones and tablets often report DPR 3-4 which forces the GPU to render 9-16× the pixels for sharpness gains the eye barely registers past 2×. Desktop displays unaffected.
- **Halve CSM shadow map size** - `shadowMapSize` 2048 → 1024 across the 3 cascades. Drops shadow-pass work from ~12.6 MP/frame to ~3.15 MP and saves ~37 MB VRAM.
- **GPU shader pre-compile** - `LoadingManager.doneLoading` awaits `renderer.compileAsync(scene, camera)` before lifting the loading screen. Three.js otherwise compiles each unique material+light permutation lazily on first sight, causing 20-200 ms frame stalls. compileAsync walks the scene up front and yields between programs so the loading screen stays responsive.
- **Livelier ocean shader** - deeper trough, brighter crest, faster scroll on the upstream Inthenew ocean (from 0.6.0).
- **Lawn responds to vehicles** - upstream grass (from 0.7.0) only deformed under the player; pushers now extend to vehicles too. Plus a lighter base Lambert material so the meadow doesn't go black past the LOD cut.
- **`MapSwitcher`: drop redundant validValues array** - upstream `addMapSwitcher` (from 0.7.0) was building a fresh `string[]` of all valid map ids just to call `.indexOf(stored)` on it once. Replaced with a direct `for ... in` lookup against the existing `choices` map.

### Refactoring / Internals

- **`world/` folder reorganisation + World god-class split** - `src/ts/world/` had ~26 files at root and a 1306-LOC `World` class doing renderer setup, HTML scaffolding, lil-gui wiring, scene loading, NPC injection, and orchestration all at once. Cohesive feature domains grouped into subfolders (`world/spawn/`, `world/ui/`, `world/scenarios/`, `world/setup/`, `world/loading/`, `world/audio/`, `world/animals/`); single-function helpers under `setup/` and `loading/` (`bootstrapHTML`, `setupRendererPipeline`, `addMapSwitcher`, `injectDefaultSceneNPCs`, `injectWanderingAnimals`, `injectFlyingBirds`, `injectButterflies`, `createParamsGUI`, plus `loadScene`). The per-frame GPU dispatch (composer / renderer FXAA branch + outline overlay + CSS2D label projection + cannon debug) moved out of `World.render` into `tickRenderPipeline(world)` / `tickCannonDebug(world)` siblings of `setupRendererPipeline`. World.ts: 1306 → ~650 LOC. Public surface (`world.renderer`, `world.composer`, `world.audioListener`, etc.) preserved so external consumers (LoadingManager, OutlineEffect) work unchanged.
- **Vehicle helpers** - three concerns extracted from the Vehicle base: `StuckRecovery` (sample window, flip timer, cooldown, lift+yaw-only reset; subclasses opt out by flipping public flags on the helper), `VehicleAudioBridge` (engine sound updatable + crash collide listener; `attach()` / `detach()` ensure the closure doesn't pin the vehicle in memory across scenario switches), `WheelManager` (free `syncWheelTransforms()` and `updateWheelProps()` against `rayCastVehicle.wheelInfos`). Vehicle.ts: 685 → 559 LOC.
- **Character bridges** - two extractions from the 1081-LOC Character class: `CharacterPhysicsBridge` (`physicsPreStep` / `feetRaycast` / `physicsPostStep` ~130 LOC of cannon math + ground-stick velocity write + jump kickoff + their hot-path scratches) and `CharacterInputBridge` (`handleKeyboardEvent` / `handleMouseButton` / `handleMouseMove` / `handleMouseWheel` / `triggerAction` ~80 LOC of input routing). Public API unchanged: state files keep calling `this.character.feetRaycast()`, World keeps calling `char.physicsPreStep(body, char)`. Character.ts: 1081 → 856 LOC.
- **Audio package** - shared Web Audio plumbing (THREE.AudioListener context, master gain, lifecycle) lives in a `ProceduralAudio` base; subclasses provide `shouldPlay()`, `buildSynth()`, `teardownSynth()`, `updateSynth()`. Cross-cutting helpers in `AudioHelpers.ts`: `getMasterVolume(world)`, `ensureAudioListener(world)`, `createMediaAudioElement(audioUrl)` - replace what used to be 6 + 4 + 1 inline copies. The audio package types against a slim `AudioWorldContext` interface (params + camera + audioListener + ocean) instead of the full `World` class - 8 audio classes decoupled. World still satisfies the contract structurally so no callsite changes needed; Speaker stays on `World` because `IWorldEntity.addToWorld(world: World)` forces the full type.
- **`AnimalModels` split** - the 532-LOC file mixed types, palettes, low-level mesh helpers, two species builders, and a 180-line per-frame animator. Final layout: `AnimalModels.ts` (types + colour palettes + low-level mesh helpers `mat`/`makeLeg`/`makeTail`/`applyShadow`/`FOOT_OFFSET`), `CatBuilder.ts` (`buildCatModel`), `DogBuilder.ts` (`buildDogModel`), `AnimalAnimator.ts` (`applyAnimalAnimation` broken into 4 pose-specific helpers). Spawn placement + the shared `queryGroundHeight` raycast moved into `AnimalSpawner.ts`. WanderingAnimals.ts: 518 → 361 LOC. `BirdSound` + `AnimalVoices` moved from `world/animals/` to `world/audio/` since they're audio classes. `mulberry32` PRNG lifted from three duplicate copies into `core/FunctionLibrary`.
- **Semantic UpdateOrder enum** - replace 17 hand-picked `updateOrder` magic numbers with named slots (`CharacterPhysics → VehiclePhysics → Input → Camera → Environment → Scenarios → World → Audio → Prompts → Labels → PostCamera`), spaced by 10 so a new slot can squeeze between two existing ones without renumbering.

### Fixed

- **RocketShip liftoff stage NaN** - upstream RocketShip (from 0.6.0) had no bound check on `LIFTOFF_STAGES[stage]`; if the player dropped `enginePower` mid-ascent, `stage` could overshoot and `LIFTOFF_STAGES[4]` was undefined → undefined * enginePower = NaN → NaN in `body.velocity` → EngineSound throws `'AudioParam.value: non-finite'`. Fix clamps the index with `Math.min`. EngineSound also got a defensive layer (frame-skip on non-finite speedSq + reset rpm to idle).
- **RocketShip flight-timer cleanup on world removal** - upstream `RocketShip` kept five `setInterval` handles for liftoff staging + cruise/descent velocity push, leaked across scenario switches. `removeFromWorld` now cancels them and hides the planet menu.
- **Speaker pendingResume queue cleanup** - upstream `Speaker` (from 0.7.0) parked audio elements on a static queue waiting for the first user gesture; `removeFromWorld` only paused the dom element but didn't splice the static reference, blocking GC and eventually firing `.play()` on a removed dom node. Splice the element out of the queue.
- **Car / Boat gear off-by-one** - upstream `gearsMaxSpeeds[gear-1]` returned undefined at gear 0, divisor went NaN, engine force wrote NaN into cannon's body.velocity. Clamp gear to `[1..maxGears]` before the lookup.
- **`SimulatorBase` divide-by-zero** - upstream `1 / fps` with fps = 0 yielded Infinity. Clamp `Math.max(1, value)` in constructor + `setFPS`.
- **Vehicle cannon-body collide-listener leak** - upstream `Vehicle` registered the 'collide' listener as an anonymous function, so removing the vehicle on scenario switch couldn't detach it - the closure pinned the vehicle in memory. Stash the listener as a field, `removeEventListener` in `removeFromWorld`. Heap snapshot diff verified: Body count grows ~+13 over 10 scenario switches now (was ~+250).
- **Camera no longer clips through floor on steep down-look** - upstream camera-orbit raycast didn't clamp polar angle hard enough.
- **Wheels locked to chassis at speed** - cannon-es interpolation timing on the wheel transforms didn't match the chassis interpolation, so wheels visibly lagged at high speed. Fix samples both at the same `interpolatedPosition` step.

## [0.7.5] - 2026-03

Notblox features port ([iErcann](https://github.com/iErcann)).

### Added

- **TriggerCube** + **ProximityPrompt** entity pair from
  [iErcann/Notblox](https://github.com/iErcann/Notblox), reshaped for
  single-player. The multiplayer / ECS layer is dropped, the entities
  themselves become single-player Sketchbook-style classes. They
  underpin in-game NPC interaction prompts and any future "step into
  a zone to do X" mechanic.

## [0.7.0] - 2025-11

socketControl features port ([tkkaushik369](https://github.com/tkkaushik369)).

### Added

- Curve-based race tracking with checkpoint planes.
- Instanced grass field with LOD.
- 3D positional audio Speaker.
- CylinderCollider + SphereCollider.
- ShapeSpawnPoint for dynamic box/sphere primitives.
- NPC system (standing or path-following) with floating name tags via
  a CSS2D pass.
- sketchbook v0.3 + v0.4 maps from socketControl.
- Four code-built sandbox scenes (`test`, `test2`, `test3`, `example`).
- Scenarios-panel map switcher.
- THREE.js Editor compatibility (`ThreejsEditor/project.json`).

### Skipped

- Water (Inthenew's wave ocean is better), extended character states
  (already in upstream), all multiplayer / ECS / networking plumbing.

## [0.6.0] - 2025-08

[Inthenew](https://github.com/Inthenew) port - day / night cycle,
boats, rocketship.

### Added

- Day / night cycle with sky shader and sun position controls.
- Wave-based ocean with vertex displacement and a height query that
  boats actually ride; replaces the original flat water.
- Boats with wave-aware physics and a Boat Race scenario.
- Lap tracking on the three car races.
- Rocketship - chassis, smoke particles, planet-select modal,
  Earth ↔ Moon flight + auto-landing.
- Earth + Moon visible as celestial bodies; lunar gravity (~1.62
  m/s²) on the moon.
- Vehicles GUI tuning sliders.
- Free-camera quality-of-life: `T` teleport, `Z` overlay toggle,
  return-to-forward slerp.

### Notes

Inthenew squashes upstream commits, so each feature was re-ported
individually with `--author="inthenew <matthew@slocum.io>"` and the
original date. The level (`build/assets/world.glb`) was replaced with
Inthenew's so all the hand-tuned coordinates stay in sync.

Asset re-creation: Inthenew's upstream hotlinked six third-party
images that couldn't legally be vendored (DeviantArt fan-art, an
anonymous Imgur upload, Farmers Almanac and Adobe Stock photos, a
Future plc CDN asset, a Wikimedia photo with attribution
requirements). All replaced with DALL-E generated equivalents shipped
under `src/img/`.

## [0.5.1] - 2024-09

[cjmott](https://github.com/cjmott) toolchain modernisation.

### Changed

- Updated the codebase to run on the latest version of all packages.
- Switched from `cannon.js` (no longer maintained) to `cannon-es`.
- Updated to the new version of THREE.js, replacing `Geometry` and
  `Face3` with `BufferGeometry`.
- Updated the sky shaders to use a THREE.js example.

### Follow-up: 2026-04 - version 0.4.1.2

A second pass on top of cjmott's work: dependencies updated to
current versions (TypeScript 6, ESLint, three.js r183, webpack 5),
legacy in-repo utility copies replaced with maintained npm packages
(lil-gui, stats.js, cannon-es-debugger), unused legacy files dropped.
Behaviour and architecture preserved.

## [0.5.0] - 2024-02

Joy-Con port ([barhatsor](https://github.com/barhatsor)).

### Added

- Joy-Con / gamepad support originally written by
  [Bar Hatsor](https://github.com/barhatsor) in
  [benhatsor/Joycon-Sketchbook](https://github.com/benhatsor/Joycon-Sketchbook).
  Original commits preserved via `format-patch` / `am`.

### Notes

The controller layer only synthesises keyboard/mouse events, so the
engine itself is untouched. The unpinned `cdn.cde.run/Joycon.min.js`
was vendored under `vendor/joycon/`.

## [0.4.0] - 2020-09

Final tagged release from the original author
[swift502](https://github.com/swift502). Tagged 4 September 2020;
swift502's "no more interest" public farewell came in February 2023
(quoted below) but no further code changes shipped after the v0.4.0
tag.

### Added / Polish

- npm package published as [`sketchbook`](https://www.npmjs.com/package/sketchbook).
- README polish: thumbnail switched to repo-vendored `src/img/thumbnail.png` (the v0.3 README had pulled the screenshot from imgur), Discord + travis-CI badges added.
- Air-vehicle exit rotation fix - exiting an airplane mid-flight no longer left the character spinning.
- Vehicle seat-improvement merge (PR #31): cleaner driver / passenger seat differentiation.
- Final refinement passes on character + vehicle handling; no new gameplay surface beyond v0.3.

### Map (`build/assets/world.glb`)

The same world.glb that 0.3 used, lightly tweaked. Vendored in this
fork as `world_sc_v04.glb` (taken from the [tkkaushik369/socketControl](https://github.com/tkkaushik369/socketControl)
flavour, which carried similar tweaks). Selectable from the Map
dropdown as **sketchbook v0.4 (socketControl)**.

### Final farewell (February 2023)

> As I have no more interest in developing this project, it comes to
> a conclusion. […] If you wish to modify Sketchbook feel free to
> fork it. The [NPM package](https://www.npmjs.com/package/sketchbook)
> name is available, and I'll give it away to anyone who asks for it.
> The package has never worked properly.

## [0.3.0] - 2020-01

[swift502](https://github.com/swift502) — the version that introduced
**vehicles** to Sketchbook.

### Added

- **Cars** - third-person driveable vehicle with cannon.js raycast suspension, four wheels, drive / steer / brake controls.
- **Airplanes** - flight model with throttle / pitch / yaw / roll, lift derived from forward velocity, take-off + landing on runways.
- **Helicopters** - ascend / descend on Shift / Space, pitch + yaw + roll on WASD/QE.
- **Vehicle entry / exit state** - walk-up animation, door-open animation, sit transition.
- **GLB-driven map authoring** - level + vehicles + spawn points all loaded from a single `world.glb` with `userData` markers (`data: 'physics'`, `data: 'spawn'`, etc.) the engine dispatches on. Replaces the v0.2 hand-coded scene-construction in `examples/characters.html`.
- **Scenarios** in dat.GUI - launch a chosen spawn / scenario from the right-hand panel.
- **Cascaded shadow maps (CSM)** - replaces the single shadow camera with a 3-cascade rig that follows the camera; sharper shadows near the player without dropping detail across the whole map.
- **Sleeping bodies** - cannon physics bodies sleep when stationary so the broadphase doesn't tick them every frame.
- **Path system** - `userData.data='pathNode'` graph for AI vehicle drivers and walking NPCs. Underpins the Car AI driver.
- **Car AI** - example AI driver follows a path, stops at signs, recovers from collisions.

### Map (`build/assets/world.glb`)

A complete sandbox map with race tracks, ramps, parking, runways and
a helipad - the level Sketchbook is best known for. Vendored in this
fork as `world_sc_v03.glb` (the [tkkaushik369/socketControl](https://github.com/tkkaushik369/socketControl)
flavour, which is materially the same level with later socketControl
tweaks). Selectable from the Map dropdown as **sketchbook v0.3
(socketControl)**.

## [0.2.0] - 2018-11

[swift502](https://github.com/swift502) — **first GLB-loadable scene**
and a more flexible state system.

### Added

- **`build/models/test_world/scene.glb`** - a small GLB-driven test
  level. Replaces the v0.1 hand-coded geometry construction. The
  level has a few static colliders, a couple of ramps, and a flat
  ground surface for character + AI testing.
- **Frame skipping** - logic update is decoupled from render frame so
  the game runs at consistent simulation speed even when the GPU
  drops below 60 fps.
- **Generalised state system** - character animation state machine
  abstracted out of the previous v0.1 inline implementation; new
  states can be authored by extending a base class.
- **Multi-character AI demo** - `examples/characters.html` spawns one
  player + multiple AI characters (`Random` behaviour) walking around
  the test world.
- **Settings overlay**: F to spawn a ball, T to toggle slow motion,
  V to change view distance, Shift+C for the free camera (the same
  free-cam shortcut Sketchbook still uses today).

### Map (vendored from upstream)

The v0.2 `build/models/test_world/scene.glb` is vendored verbatim in
this fork as `build/assets/world_v02.glb` and loaded at runtime by
`Sw02Scene` (under `src/ts/world/sandboxes/`). The sandbox class
translates the v0.2-era `extras.physics` / `extras.mass` userData
into Sketchbook's current `userData.data='physics'/'spawn'` dispatch
format - the v0.2 GLB pre-dates that pattern. Player spawn at the v0.2
demo's hand-picked `(1.13, 3, -2.2)` plus the original `examples/characters.html`
roster (John with Random behaviour, Bob with FollowCharacter).
Selectable from the Map dropdown as **swift502 v0.2 (test world)**.

## [0.1.0] - 2018-10

[swift502](https://github.com/swift502) — **the first tagged release**
of Sketchbook, the foundation everything since builds on.

### Added

- **Three.js scene + Cannon.js physics** - the core engine pairing
  that defines Sketchbook to this day.
- **Variable, FPS-independent time scale** - logic clock decoupled
  from render clock, so a slow-motion / fast-forward toggle doesn't
  warp physics integration step.
- **FXAA anti-aliasing** - cheap fullscreen-quad antialiasing,
  no MSAA dependency.
- **Custom damped-spring simulation** - the spring solver that
  drives character orientation lerp + velocity smoothing
  (`SpringSimulator` / `RelativeSpringSimulator` lived under this
  name from day one).
- **Third-person camera** - orbit around the player with mouse drag,
  spring-damped target follow.
- **Raycast character controller with capsule collisions** - a
  cannon.js capsule body for the player, raycasts down each frame
  to detect ground for "stick to ground" velocity smoothing instead
  of relying on contact normals (which fluctuate on rough trimesh).
- **State-based animation system** - explicit state classes (Idle,
  Walk, Sprint, Falling, JumpIdle, etc.) drive both the animation
  blend and the physics behaviour. The state-machine pattern that
  the entire character codebase still rides on.
- **Character AI** - `Random` and `FollowTarget` behaviours that mutate
  the character's `viewVector` etc. without bypassing the state
  machine.

### Map (procedural recreation)

v0.1 didn't ship a `.glb` level - the build only carried character +
sign FBX source models, and the demo scene was constructed inline in
JS. The 0.1 vibe is recreated as a procedural sandbox in this fork
(`src/ts/world/sandboxes/Sw01Scene.ts`) - a small flat ground with a
single reference column, one player spawn at origin, and one AI
character. Selectable from the Map dropdown as **swift502 v0.1
(foundation)**. Demonstrates the foundational character physics +
state-based animation that everything since builds on, with the
simplest possible AI alongside.
