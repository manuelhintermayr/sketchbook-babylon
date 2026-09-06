<p align="center">
	<a href="https://projects.manuelhintermayr.com/sketchbook-upgraded/"><img src="./src/img/thumbnail.png"></a>
	<br>
	<a href="https://projects.manuelhintermayr.com/sketchbook-upgraded/">Live demo (v0.8.0, Webpack edition)</a>
	<br>
	<a href="https://projects.manuelhintermayr.com/sketchbook-nuxt/">Live demo (Nuxt 4 + Vue 3 edition)</a>
	<br>
	<a href="https://jblaha.art/sketchbook/latest">Original demo by swift502</a>
	<br>
</p>

# 📒 Sketchbook

A maintained extension of the original [swift502/Sketchbook](https://github.com/swift502) - a small web-based game engine on [three.js](https://github.com/mrdoob/three.js) and [cannon-es](https://github.com/pmndrs/cannon-es) with a focus on third-person controls, vehicles and scripted scenarios.

This fork pulls in the features from later community forks that I felt were worth keeping, rebuilds the project on current tooling (TypeScript, three.js r183, webpack 5; dependency baseline as of **1 May 2026**) and exposes everything through one engine. See the [project timeline](#project-timeline) for who did what.

> **Also available as a Nuxt 4 + Vue 3 SFC port:** [`manuelhintermayr/sketchbook-nuxt`](https://github.com/manuelhintermayr/sketchbook-nuxt) is a 1:1 port of this repo where the DOM/CSS-by-hand UI shell was rebuilt with Vue components, the lil-gui controls became reactive composables, and `localStorage` plumbing landed in `useUserPrefs` / `useEngineParams`. The engine itself (World, Character, Vehicle, Sky, Ocean…) is byte-for-byte identical.

## Features

### World

- Day / night cycle with a sky shader, sun position controls, and a black space backdrop above the launch apex.
- Earth and Moon visible as celestial bodies; lunar gravity (~1.62 m/s²) kicks in on the moon.
- 2000-star night sky (camera-anchored shell, additive twinkle shader) - fades in as the sun drops, full brightness in space.
- Wave-based ocean with vertex displacement and a height query that boats actually ride.
- Procedural [300k-blade grass field](https://www.eddietree.com/grass) (instanced, 30-unit LOD) - wired to any map material called `grass`.
- 3D positional audio sources ("Speaker") with browser-autoplay handling.
- Procedural engine sound per vehicle (sawtooth + square exhaust + filtered noise intake; per-type profiles for car / heli / airplane / boat / rocket); RPM scales with chassis speed.
- Procedural ambient soundscape - wind (filtered noise) and water (LFO-swept bandpass), water gated to camera proximity (only audible within 10 m of the ocean's y-level).
- Per-character positional SFX: footsteps (walk + sprint cadence), jump kickoff, landing thump (force-scaled), door clunk - each character (player + NPCs) carries its own THREE.PositionalAudio so steps fade with distance instead of playing flat.
- Procedural sound-effects bus for the player-UI events: race checkpoint ping + lap fanfare, dialog whoosh, prompt + pause UI ticks, iris-transition whoosh, vehicle crash (impact-throttled), rocket-liftoff boom. All signal-generated, no asset files.
- Bundled background music - looped shuffle through three tracks generated with [Suno AI](https://suno.com/), gated by `Background_Music` and scaled by `Master_Volume * Music_Volume`.
- One **Master Audio** mute switch (toggleable from the title screen, the Settings modal, and the debug panel - all three mirror through localStorage). When off every audio source goes silent: continuous synths via the master-volume helper, 3D-positional sources via the THREE listener gain. Music + sound-effects can each be muted independently when master is on.
- Variable timescale, FXAA, cascaded shadow maps, adjustable gravity (0–2×).
- Camera shake on vehicle hard landings (sineNoise-based, three presets: collision / land / boost).
- All settings persist to `localStorage` with a one-click reset.
- Iris-wipe transition (CSS clip-path circle, 700ms) when switching maps, restarting a scenario, or reloading from the pause menu.
- Optional depth-Sobel outline overlay (toon look) - toggle in Settings.

### Characters & NPCs

- Third-person camera, raycast capsule controller, full state machine (Sprint, Walk, Idle, Jump, Falling, Drop variants…).
- AI path-following - same convention used by both the AI vehicle drivers and standing/wandering NPCs.
- Name labels float above every character via a CSS2D pass; the player is tagged "You" / "Du" / "Tú" depending on the locale and stands out in blue.
- Two example NPCs walk a small loop at the default spawn, two more flank the player on idle.
- Wandering dogs & cats around the spawn area (1 dog + 2 cats, kept calm by design), with hierarchical low-poly models (per-limb walk / run / jump / idle-breathe animation), procedural voices (bark / meow / purr-loop near tamed cats), and dynamic cannon-sphere bodies so they collide with the player and each other. Dogs notice and bark, cats flee, both can be tamed; tame pets follow the player and turn to track them.
- Flying birds with per-bird positional FM-chirp audio (cat-game-style orbit motion, sin-flap wings, kinematic cannon body) - chirps fade with distance from each bird, replacing the old global ambient bird-chirp.
- Ambient butterflies on a Lissajous drift around the player, distance-culled at 30 m, kinematic cannon body so debug-physics shows them.
- Distance-culled CSS2D world labels via a central registry - one **Labels** toggle controls every floating tag (player, NPC names, dogs and cats - all translated through i18n); hides past 10 m to keep the UI quiet at distance.

### Vehicles

- Cars (with per-vehicle tuning sliders for friction, suspension, damping and engine force).
- Airplanes, helicopters.
- Boats with wave-riding physics and wave-aware AI path-following.
- Rocketship - 4-stage liftoff, smoke particle trail, planet-selection modal, automated Earth↔Moon transfer with soft auto-landing.
- Stuck / flip auto-recovery for player vehicles (lifts and yaw-resets after 6s of no movement under throttle, or 3s upside-down). Boats / Rocket opt out; air vehicles use flip-only.

### UI

- Title screen with bouncing-cube animation + language picker (gates audio autoplay).
- Loading screen with live percentage and progress bar driven by `LoadingManager`.
- Pause menu on Esc (timeScale=0, exits pointer lock) - Resume / Settings / Restart Scenario / Reload.
- Settings modal with General / Graphics / Audio / Controls cards (language picker, dark mode and a settings reset live in General) - writes through lil-gui controllers so existing `onChange` handlers fire.
- Branching NPC dialog with typewriter reveal (28ms cadence) - click bar or press E / Enter / Space to skip, choices appear after typing finishes.
- Error overlay catches `window.onerror` + `unhandledrejection` into a frosted card with stack + Reload + Copy details.
- Centralised design tokens (`tokens.css`) with `class="dark"` dark mode toggle on `<html>`.

### Scenarios & Maps

- Free-roam (default and aviation), Oval / Tunnel / Figure-8 car races, Boat Race, stunt ramps.
- Curve-based race-checkpoint system with a HUD lap counter.
- Switchable maps from the **Map & Scenarios** GUI panel (persists across reloads):
	- `Inthenew (v0.6, default)` - the bundled extended map (helipad spawn, races, marina, rocket island, day-night skybox)
	- `swift502 v0.1 (foundation)` - procedural recreation of the original 2018 demo (the v0.1 build pre-dated the GLB+userData map authoring, so the inline-JS scene from `docs/js/index.js` is rebuilt here from primitives); tiled platform + dynamic spheres + cubes + credit sign with grass + player + Bob (FollowCharacter) + John (Random).
	- `swift502 v0.2 (test world)` - the actual `build/models/test_world/scene.glb` from the v0.2.0 tag, vendored as `build/assets/world_v02.glb` and loaded at runtime; v0.2-era `extras.physics` / `extras.mass` userData translated on the fly into Sketchbook's current dispatch format. Player at the v0.2 demo's `(1.13, 3, -2.2)` spawn + John + Bob at the original coordinates.
	- `sketchbook v0.3 (socketControl)` - the swift502 v0.3 sandbox map (race tracks, ramps, runways, helipad), with later socketControl tweaks layered on
	- `sketchbook v0.4 (socketControl)` - the swift502 v0.4 final map, again with socketControl additions
	- Four code-built sandboxes from socketControl: `test`, `test2`, `test3`, `example` (TypeScript, editable directly)
- Compatibility with the [official three.js editor](https://threejs.org/editor/) - the sandbox project file is vendored under `ThreejsEditor/`.

### Authoring & extensibility

Map markers in `userData` light up code-side features automatically:

| Marker | Effect |
|---|---|
| `material.name === 'grass'` | Instanced grass field |
| `userData.data === 'speaker'` + `audio` | 3D positional audio source |
| `userData.type === 'cylinder'` | CANNON cylinder collider |
| `userData.type === 'shape'` + `subtype: box`/`sphere` | Dynamic physics primitive |
| `userData.type === 'npc'` / `character_ai` / `character_follow` | Standing or path-following NPC |

### Input

- Keyboard + mouse, free camera (`Shift+C`, `T` to teleport, `Z` to toggle the controls overlay).
- Joy-Con / gamepad via [benhatsor/joycon.js](https://github.com/benhatsor/joycon.js).
- On-screen touch controls (virtual joystick, jump / action / sprint buttons, drag-to-look) - auto-mounted on touch devices, dispatches synthesised keyboard + mouse events so the engine stays input-source-agnostic.
- i18n: English / Deutsch / Español with a language picker on the title screen; choice persists in `localStorage`. Pause menu, settings modal, error overlay and title-screen prompt are translated.

## Usage

Sketchbook needs to run on a local server (e.g. `npm run dev`) to load assets.

```html
<script src="sketchbook.min.js"></script>
<script>
	const world = new Sketchbook.World('scene.glb');
	// or pass a sandbox instance:
	// const world = new Sketchbook.World(new Sketchbook.Test3Scene());
</script>
```

## Running locally

1. Install a current LTS version of [Node.js](https://nodejs.org/en/).
2. `npm install`
3. `npm run build` - required before the first `npm run dev` because `build/sketchbook.min.js` is no longer committed.
4. `npm run dev` and open <http://localhost:8080>.
5. `npm run lint` to run ESLint over `src/ts/`.

## Documentation

Beyond this README, the repo carries a handful of complementary docs - pick the one that matches what you're doing:

- [`CHANGELOG.md`](./CHANGELOG.md) - per-version release notes in [Keep a Changelog](https://keepachangelog.com/) format. The 0.8.0 entry has every commit grouped by category (UI, new features, performance, refactoring, fixed); earlier versions are condensed.
- [`docs/architecture.md`](./docs/architecture.md) - engine internals: module layers, the per-frame loop, the `UpdateOrder` slot table, World's construction sequence, lifecycle interfaces, physics setup, rendering pipeline, audio subsystem, UI shell, and persistence layout.
- [`docs/map-authoring.md`](./docs/map-authoring.md) - full reference for the `userData` markers `loadScene` recognises (physics shapes, spawn points, scenarios, paths, speakers, ocean / grass material names) with copy-pasteable code examples for each.
- [`docs/ui-system.md`](./docs/ui-system.md) - design tokens (`tokens.css`) catalogue and the overlay walkthrough (TitleScreen, PauseMenu, SettingsModal, DialogBox, ErrorOverlay, NameLabel, etc.) - what each one is, where it lives, and how to add a new one.
- [`CLAUDE.md`](./CLAUDE.md) - Claude Code session memory. Repository layout, code conventions, frame mental model, mistakes to avoid. Mostly the same content as `context.md`, slightly different framing.
- [`context.md`](./context.md) - the same orientation primer for any other AI coding assistant (Cursor, Continue, Aider, Copilot Workspace, …). Read either this or `CLAUDE.md`, not both.

---

# Project timeline

> **Attribution policy:** every port below tries to preserve the original commits or at least the original authors via `git format-patch` / `git am` or `git commit --author="…" --date="…"`. The intent is to honour each upstream author's work - and only their work - in `git log`.
>
> **Versions + dates:** the dates on each entry are the dates the work originally landed in its upstream fork. The version numbers (`v0.5.0`, `v0.6.0`, `v0.7.0` …) were assigned **here** when the corresponding port was completed in `manuelhintermayr/sketchbook-upgraded` - the upstream forks didn't tag releases the same way, so the numbering is this fork's timeline overlay on top of the upstream history.
>
> **Detailed release notes** (per-commit Keep-a-Changelog entries) live in [`CHANGELOG.md`](./CHANGELOG.md). The timeline below is the narrative summary; the changelog has the granular detail.

## May 2026 - version 0.8.0 - UI overhaul, new features, refactoring pass ([manuelhintermayr](https://github.com/manuelhintermayr)) ([commit](https://github.com/manuelhintermayr/sketchbook-upgraded/commit/cecd8c2))

The biggest release on this fork - three concurrent strands of work landed across ~50 commits. Per-commit detail (every bullet that used to live here) is now in [`CHANGELOG.md`](./CHANGELOG.md); this entry summarises the three strands.

**UI**: a front-of-screen overhaul. A central CSS-tokens system now drives every module's colours / typography / spacing, with light + dark surfaces. New top-level screens cover what was missing: a bouncing-cube title screen that doubles as the audio-autoplay gate (with sound-mute + dark-mode + language toggles), a percentage-driven loading bar, an Esc pause menu (Resume / Settings / Restart / Reload), a Settings modal with four cards (General / Graphics / Audio / Controls) and Low / High quality presets, branching NPC dialog with typewriter reveal, an iris-wipe map-switch transition, distance-culled CSS2D world labels (player tagged "You" / "Du" / "Tú"), an `onerror` / `unhandledrejection` overlay, touch controls auto-mounted on mobile, and a flat-table i18n layer (en / de / es) with a title-screen language picker.

**New features**: gameplay additions and visual polish - camera shake on vehicle hard landings (three presets), stuck/flip auto-recovery on the Vehicle base, per-vehicle procedural Web Audio engine sounds (5 timbre profiles), a depth-Sobel toon outline pass with skinned-mesh-aware MeshDepthMaterial + scale-invariant ratio threshold, per-character positional SFX (footsteps / jump / land / door clunk via THREE.PositionalAudio per character), a procedural ambient soundscape (wind + ocean-gated water; bird chirps moved to per-bird PositionalAudio), 1 dog + 2 cats wandering with hierarchical models + procedural voices + real cannon physics + jump arcs, 2 flying birds with per-bird FM-chirp + frustum cull at 80 m, 2 ambient butterflies on a Lissajous drift (altitude anchored to spawn-Y), a 2000-star camera-anchored night sky, bundled background music shuffled through three Suno-AI-generated tracks, and a Master_Audio mute switch that mirrors through localStorage between title screen, Settings modal and the lil-gui debug panel. Plus HUD fixes (X seat-switch surfaces during driving, AI-driver vehicles no longer hijack the controls list at startup).

**Refactoring + performance**: a long internals pass with no user-visible behaviour change. `World.ts` split from a 1306-LOC god class into a ~650-LOC orchestrator with eight setup helpers and three new `world/` subfolders (`spawn/`, `ui/`, `scenarios/`). Vehicle gained `StuckRecovery` + `VehicleAudioBridge` + `WheelManager` helpers; Character grew `CharacterPhysicsBridge` + `CharacterInputBridge` so the orchestrator only handles state-machine coordination. The audio system collapsed onto a shared `ProceduralAudio` base + single `AudioContext` and now types against a slim `AudioWorldContext` interface instead of the full World class. Animal AI moved into Strategy classes; `AnimalModels` was split into `CatBuilder` / `DogBuilder` / `AnimalAnimator` / `AnimalSpawner`. Hot paths got module-scoped scratch pools (~3500 allocations/sec eliminated), magic-number `updateOrder` slots became a semantic enum, and a handful of perf knobs were tightened (pixelRatio capped at 2, shadow-map size halved, GPU shaders pre-compiled, outline RT to half-float, Birds frustum-culled past 80 m).

**Maps**: the swift502 v0.1 + v0.2 original demo scenes were vendored alongside the v0.3 + v0.4 maps that the v0.7.0 socketControl port already brought in - so every released-tag-era map up to v0.4 is now selectable from the Map dropdown. v0.2's `build/models/test_world/scene.glb` ships verbatim as `build/assets/world_v02.glb` and is loaded at runtime by a small sandbox class that translates v0.2-era `extras.physics` / `extras.mass` userData into Sketchbook's current dispatch format. v0.1 had no GLB level (the demo was constructed inline in JS), so it's recreated procedurally from primitives - same player + Bob + John roster + `(1.13, 3, -2.2)` player spawn the v0.1 / v0.2 demos used.

## March 2026 - version 0.7.5 - Notblox features port ([iErcann](https://github.com/iErcann)) ([commit](https://github.com/manuelhintermayr/sketchbook-upgraded/commit/31c51c472c3c908cdb2c28b75e973aa7ec565c9f))

Brings the **TriggerCube + ProximityPrompt** entity pair from [iErcann/Notblox](https://github.com/iErcann/Notblox) - the multiplayer / ECS layer is dropped, the entities themselves are reshaped into single-player Sketchbook-style classes. They underpin the in-game NPC interaction prompts and any future "step into a zone to do X" mechanic. (TriggerCube was later removed in 0.8.0 - ProximityPrompt absorbed the per-frame distance check directly to fix a desync bug; see CHANGELOG.)

## November 2025 - version 0.7.0 - socketControl features port ([tkkaushik369](https://github.com/tkkaushik369)) ([commit](https://github.com/manuelhintermayr/sketchbook-upgraded/commit/1c8619d546617a3b4a963fa83fb58bde2a7fffa9))

Mines features from [tkkaushik369/socketControl](https://github.com/tkkaushik369/socketControl) (MIT), skipping its multiplayer / ECS layer entirely. Each feature ships as its own commit attributed to tkkaushik369 where identifiable.

What landed: curve-based race tracking with checkpoint planes; instanced grass field with LOD; 3D positional audio Speaker; CylinderCollider + SphereCollider; ShapeSpawnPoint for dynamic box/sphere primitives; NPC system (standing or path-following) with floating name tags via a CSS2D pass; sketchbook v0.3 + v0.4 maps from socketControl plus four code-built sandbox scenes (`test`, `test2`, `test3`, `example`); Scenarios-panel map switcher; THREE.js Editor compatibility (`ThreejsEditor/project.json`).

Skipped: water (Inthenew's wave ocean is better), extended character states (already in upstream), all multiplayer / ECS / networking plumbing.

## August 2025 - version 0.6.0 - day/night cycle, boats & rocketship ([inthenew](https://github.com/Inthenew)) ([commit](https://github.com/manuelhintermayr/sketchbook-upgraded/commit/e939ca075ef2468e419b67921ab6d8b26e216fb5))

Pulls in [Inthenew/Sketchbook](https://github.com/Inthenew/Sketchbook): day/night cycle, wave-based ocean replacing the original flat water, boats with wave-aware physics + Boat Race scenario, lap tracking on the three car races, the full Rocketship feature (chassis, smoke particles, planet-select modal, Earth↔Moon flight + auto-landing), Earth + Moon as celestial bodies, lunar gravity, Vehicles GUI tuning sliders, Free-camera quality-of-life (`T` teleport, `Z` overlay toggle, return-to-forward slerp).

Inthenew squashes upstream commits, so each feature was re-ported individually with `--author="inthenew <matthew@slocum.io>"` and the original date. The level (`build/assets/world.glb`) was replaced with Inthenew's so all the hand-tuned coordinates (no-wave dock zone, race paths, rocket island) stay in sync.

**Asset re-creation:** Inthenew's upstream hotlinked six third-party images that couldn't legally be vendored (DeviantArt fan-art, an anonymous Imgur upload, Farmers Almanac and Adobe Stock photos, a Future plc CDN asset, and a Wikimedia photo with attribution requirements). All were dropped and replaced with DALL-E generated equivalents shipped under `src/img/` - same intent and visual style, no licence baggage.

## September 2024 - version 0.5.1 - [cjmott](https://github.com/cjmott) ([commit](https://github.com/cjmott/Sketchbook/commit/088fffc743818d13babeecd87c8ba3165cf13fcb))

> I plan to use Sketchbook as a basis to develop another project, so I have updated the code to run on the latest version of all the packages and switched from cannon.js, which is no longer maintained, to cannon-es.js. […] The biggest change has involved updating to the new version of THREE.js, which no longer supports the object types `Geometry` and `Face3`, replacing both with `BufferGeometry`. Note that I have also updated the sky shaders to use an example provided on the THREE.js website.

### April 2026 follow-up - version 0.5.1.2 - toolchain re-modernisation ([manuelhintermayr](https://github.com/manuelhintermayr)) ([commit](https://github.com/manuelhintermayr/sketchbook-upgraded/commit/1a99803b366f49385dfac80c76ab86371f154915))

A second pass on top of cjmott's work: dependencies updated to current versions (TypeScript 6, ESLint, three.js r183, webpack 5), legacy in-repo utility copies replaced with maintained npm packages (lil-gui, stats.js, cannon-es-debugger), unused legacy files dropped. Behaviour and architecture preserved - gameplay changes start in May.

## February 2024 - version 0.5.0 - Joy-Con port ([barhatsor](https://github.com/barhatsor)) ([commit](https://github.com/manuelhintermayr/sketchbook-upgraded/commit/1db12aa2ef697886b049386ef28a55e12f08acdd))

Adds Joy-Con / gamepad support originally written by [Bar Hatsor](https://github.com/barhatsor) in [benhatsor/Joycon-Sketchbook](https://github.com/benhatsor/Joycon-Sketchbook). Original commits preserved via `format-patch` / `am`. The controller layer only synthesises keyboard/mouse events, so the engine itself is untouched. The unpinned `cdn.cde.run/Joycon.min.js` was vendored under `vendor/joycon/`.

## September 2020 - version 0.4.0 - [swift502](https://github.com/swift502) ([commit](https://github.com/swift502/Sketchbook/commit/e23d2eabd1808478119dc633d836b5d8057a6010)) - final tagged release

NPM publish + last polish before swift502 stepped away from the project: thumbnail moved into the repo, Discord + travis-CI badges, airplane-exit rotation fix, vehicle-seat refinements (PR #31). No new gameplay surface beyond v0.3. The map is the same `world.glb` v0.3 introduced; this fork vendors the socketControl-tweaked variant as `world_sc_v04.glb`.

> February 2023 farewell: *As I have no more interest in developing this project, it comes to a conclusion. […] If you wish to modify Sketchbook feel free to fork it. The [NPM package](https://www.npmjs.com/package/sketchbook) name is available, and I'll give it away to anyone who asks for it. The package has never worked properly.*

## January 2020 - version 0.3.0 - [swift502](https://github.com/swift502) ([commit](https://github.com/swift502/Sketchbook/commit/2ee27b2608d8f2427e8a3ae16dfd0a8e3c4011fd)) - vehicles arrive

The version that turned Sketchbook from "character-physics demo" into a game-ready sandbox. **Cars, airplanes, and helicopters** all land in this release with vehicle-entry / exit animation states, raycast suspension, and full flight controls. Maps switch from hand-coded JS construction to **GLB-driven authoring** with `userData` markers (`data: 'physics'` / `data: 'spawn'` / `data: 'pathNode'`) - the same dispatcher pattern Sketchbook still uses today. **Cascaded shadow maps**, **dat.GUI scenarios panel**, **path-following AI** (vehicle drivers), **sleeping cannon bodies**, and the **`world.glb` sandbox map** with race tracks, ramps, runways and a helipad. This fork vendors the socketControl-tweaked variant of that map as `world_sc_v03.glb`.

## November 2018 - version 0.2.0 - [swift502](https://github.com/swift502) ([commit](https://github.com/swift502/Sketchbook/commit/2aeeafe259e9d66904dd83216118245080d0ca05)) - first GLB scene

First release with a **GLB-loadable level** (`build/models/test_world/scene.glb`, vendored here as `world_v02.glb` and selectable from the Map dropdown). Frame-skipping decouples the physics tick from the GPU frame so simulation speed stays stable below 60 fps. The character animation state machine gets generalised into a base class + state subclasses that v0.8 still extends. The example HTML spawns one player + multiple AI characters running the `Random` behaviour; controls overlay debuts (F to spawn a ball, T slow-mo, V view distance, Shift+C free camera).

## October 2018 - version 0.1.0 - [swift502](https://github.com/swift502) ([commit](https://github.com/swift502/Sketchbook/commit/b5387b47f1ff7611b0d970bc81576636e27e35af)) - the foundation

The first tagged release. Three.js scene + cannon.js physics with **variable, FPS-independent time scale**, **FXAA**, a **custom damped-spring simulation** (the `SpringSimulator` driving character orientation lerp + velocity smoothing), a **third-person camera** with mouse-drag orbit, a **raycast capsule character controller** with stick-to-ground velocity smoothing, an **explicit state-based animation system** (Idle / Walk / Sprint / Falling / JumpIdle / etc.), and **Random + FollowTarget character AI** behaviours. No vehicles, no GLB level - just the engine framework with character models + sign FBXs.

---

## Credits

- [swift502](https://github.com/swift502) - original Sketchbook engine.
- [cjmott](https://github.com/cjmott) - September 2024 toolchain revival (cannon-es, modern three.js).
- [Inthenew](https://github.com/Inthenew) - boats, wave ocean, races, day/night cycle, rocketship + moon, lunar gravity (v0.6.0 feature set).
- [Bar Hatsor (barhatsor)](https://github.com/barhatsor) - Joy-Con / gamepad integration.
- [tkkaushik369](https://github.com/tkkaushik369) - socketControl: race-checkpoint system, instanced grass field, Speaker, CylinderCollider, ShapeSpawnPoint, the four sandbox scenes, and the THREE.js editor workflow.
- [iErcann](https://github.com/iErcann) - Notblox: TriggerCube + ProximityPrompt design.

---

## License & third-party notices

This project is distributed under the **MIT License** (see [LICENSE](./LICENSE)), **Copyright (c) 2020 swift502** - the original author's copyright notice is preserved. The features merged from later community forks, the third-party libraries, and the asset provenance are consolidated - with their authors and, where determinable, their licenses - in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).
