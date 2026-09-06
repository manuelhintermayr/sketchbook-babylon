# Architecture

In-depth notes on how the engine is wired together. Pair with `CLAUDE.md` / `context.md` for the high-level orientation, and with `git log` for *why*.

## Module layers

```
┌─────────────────────────────────────────────────────────────────┐
│  index.html                                                     │
│    Sketchbook.installErrorOverlay()                             │
│    Sketchbook.showTitleScreen() → Sketchbook.World(scenePath)   │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│  World (src/ts/world/World.ts, ~650 LOC)                        │
│    renderer • composer • labelRenderer • camera • graphicsWorld │
│    physicsWorld • outlineEffect                                 │
│    LoadingManager • InputManager • CameraOperator • CameraShake │
│    Sky • ambientSound • backgroundMusic • sfxBus • worldLabels  │
│    PauseMenu • SettingsModal • DialogBox singleton              │
│    scenarios[] • paths[] • characters[] • vehicles[]            │
│    updatables[] (sorted by IUpdatable.updateOrder)              │
│    audioListener • gui (lil-gui)                                │
│                                                                 │
│  Heavy setup is in helpers (called from constructor):           │
│    setup/RendererPipeline   - renderer + composer + FXAA;       │
│                                tickRenderPipeline draws each    │
│                                frame; tickCannonDebug for the   │
│                                debug-physics overlay            │
│    setup/HTMLBootstrap      - DOM scaffolding                   │
│    setup/ParamsGUI          - lil-gui panel + persistence       │
│    setup/MapSwitcher        - Map & Scenarios map dropdown      │
│    setup/DefaultNPCInjector - Anna/Ben/Carla/Dieter             │
│    setup/AnimalInjector     - wandering dogs/cats,              │
│                                flying birds, butterflies        │
│    loading/SceneLoader      - GLTF userData dispatcher          │
└─────────────────────────────────────────────────────────────────┘
              │
              ▼
┌─────────────────────────────────────────────────────────────────┐
│  Per-frame loop                                                 │
│    requestAnimationFrame → render(world)                        │
│      update(timeStep)  →  for each updatables: u.update()       │
│      tickRenderPipeline(world)  →  composer.render() (FXAA on)  │
│                                  or renderer.render() (FXAA off)│
│                                  + outlineEffect.renderPass()   │
│                                  + labelRenderer.render() CSS2D │
└─────────────────────────────────────────────────────────────────┘
```

## Update order (lower runs first)

Slot constants are defined in `src/ts/enums/UpdateOrder.ts`. Each slot is spaced by 10 so a new entry can squeeze between two existing ones without renumbering everything.

| Slot (value) | Class(es) |
|---|---|
| `CharacterPhysics` (10) | `Character` - physics step, state-machine update, control input |
| `VehiclePhysics` (20) | `Vehicle` - physics step, control input, hard-landing detection, stuck-recovery |
| `Input` (30) | `InputManager` - drains mouse/keyboard buffers, dispatches to receiver. `InfoStack` shares the slot |
| `Camera` (40) | `CameraOperator` - orbit/free-cam input, position lerp |
| `Environment` (50) | `Sky` - sun position, day/night cycle, CSM frustum sync. `ShapeEntity` shares the slot |
| `Scenarios` (60) | `RaceContent` - per-frame plane crossings against checkpoints |
| `World` (100) | `Grass` (shader time / player-position uniforms), `Ocean` (wave / normal-map), `WanderingAnimals` (state machine + body sync), `Birds` (orbit + flap + per-bird PositionalAudio update), `Butterflies` (Lissajous drift + visibility cull) |
| `Audio` (110) | `ProceduralAudio` (engine + ambient + background music) - master-volume sync, oscillator parameter modulation; `Speaker` shares the slot. `SfxBus` is event-driven, no per-frame update |
| `Prompts` (130) | `ProximityPrompt` - per-frame squared-distance check vs. player; show/hide DOM label, dispatch `proximity-near`/`proximity-far` events on transitions |
| `Labels` (140) | `WorldLabels` - distance-cull CSS2D name tags |
| `PostCamera` (150) | `CameraShake` - adds transient camera-position offset after CameraOperator finalises the frame's camera |

`updateOrder` is the IUpdatable contract; lil-gui's onChange handlers and Scenario.launch don't run inside this loop.

## World construction sequence

```
Sketchbook.World(scenePath)
  ├─ setupRendererPipeline(this)  ← renderer + composer + FXAA + resize
  ├─ bootstrapHTML(this)          ← injects #loading-screen, #ui-container, #planet-menu, canvas
  ├─ initStats()
  ├─ createParamsGUI(this)        ← lil-gui panel + scenarioGUIFolder + persistence
  ├─ new PauseMenu(this)          ← Esc handler installed but disabled
  ├─ new SettingsModal(this)
  ├─ new InputManager / CameraOperator / Sky / CameraShake / OutlineEffect /
  │    AmbientSound / WorldLabels
  └─ if scenePath:
        loadingManager = new LoadingManager(this)
        loadingManager.onFinishedCallback = () => Swal.fire("Welcome…").then(() => {
            UIManager.setUserInterfaceVisible(true)
            pauseMenu.enable()              ← Esc now works
        })
        if string: loadingManager.loadGLTF(path, gltf => loadScene(this, lm, gltf))
        else (BaseScene): loadScene(this, lm, {scene: instance.scene})
```

`loadScene(world, lm, gltf)` (in `src/ts/world/loading/SceneLoader.ts`) walks every node, branches on `userData`, and registers entities. `addMapSwitcher(world)` runs at the start so the map dropdown lands above the scenario buttons. After parsing the GLB, it calls `injectDefaultSceneNPCs(world)` (programmatically adds Anna/Ben/Carla/Dieter on the Inthenew map), `injectWanderingAnimals(world)` (1 dog + 2 cats), `injectFlyingBirds(world)` (2 birds with per-bird positional chirps), `injectButterflies(world)` (2 ambient butterflies), then launches the default scenario. Animals + birds + butterflies are map-bound (re-injected only when the GLB reloads via the map switcher), not scenario-bound, so a scenario restart leaves them in place.

## Lifecycle interfaces

```
IUpdatable           updateOrder: number
                     update(timeStep, unscaledTimeStep): void

IWorldEntity         extends IUpdatable
                     entityType: EntityType
                     addToWorld(world): void
                     removeFromWorld(world): void

ISpawnPoint          spawn(loadingManager, world): void

ICollider            options: any
                     body: CANNON.Body
```

`world.add(entity)` calls `addToWorld` and `registerUpdatable`. `world.remove(entity)` does the inverse.

## State machines

- **Character** - `src/ts/characters/character_states/`. ~25 states (Idle, Walk, Sprint, JumpIdle, JumpRunning, Falling, DropIdle, DropRunning, DropRolling, EndWalk, IdleRotateLeft/Right, StartWalk*, EnteringVehicle, Driving, ExitingVehicle, etc.). State changes via `character.setState(new Walk(this))`. Each state has `onInputChange()` and `update()`.
- **Vehicle entry** - `VehicleEntryInstance` orchestrates the multi-frame walk-up + door-open + sit sequence.
- **AI behaviours** - `RandomBehaviour`, `FollowTarget`, `FollowPath`. Set via `character.setBehaviour(new FollowPath(node, speed))`. Behaviours mutate `character.viewVector` etc; the same state machine renders them.

## Physics

- One `CANNON.World` per `World`. Gravity scaled by `params.Gravity_Scale` (lunar mode = 1.62 m/s²).
- `physicsFrameRate = 60`, fixed `physicsFrameTime = 1/60`. Substeps via `world.step(...)` inside `World.update()`.
- Collision groups in `enums/CollisionGroups.ts`. The most-used pattern: `~CollisionGroups.TrimeshColliders` so dynamic primitives don't catch on static meshes' edges.
- `CannonDebugRenderer` is wired (toggle via `params.Debug_Physics`).

## Rendering pipeline

Setup lives in `src/ts/world/setup/RendererPipeline.ts` and is called once from `World`'s constructor. Per-frame work runs from `World.render`.

- `THREE.WebGLRenderer` with PCF shadows, ACES tone mapping, `pixelRatio` capped at 2 (`Math.min(window.devicePixelRatio, 2)`).
- `EffectComposer` chain: `RenderPass` → `FXAAShader`. FXAA can be toggled at runtime (`world.params.FXAA`); when off, `tickRenderPipeline` calls `renderer.render()` directly to bypass the composer pass cost. Bloom + DoF were dropped because the post-FX cost wasn't justifying the visual gain on integrated GPUs.
- `OutlineEffect` (in `src/ts/world/OutlineEffect.ts`) runs *after* the composer. Two-pass: depth pre-pass into a `HalfFloatType` render target via `MeshDepthMaterial` override (skips `RenderLayer.OutlineSkip` - sky / stars / earth / moon / grass / ocean), then a Sobel-edge fullscreen quad with a scale-invariant ratio threshold.
- `CSM` (cascaded shadow maps from three.js examples) attached to `Sky` with `shadowMapSize: 1024` × 3 cascades. `csm.setupMaterial(child.material)` is called for every loaded mesh during `loadScene`.
- `CSS2DRenderer` runs after the outline pass to project name-tag divs above their world-space anchor. Lives at `world.labelRenderer`, has its own absolutely-positioned overlay div with `pointer-events: none`. Distance culling is centralised through `WorldLabels` in `src/ts/world/ui/WorldLabels.ts`.
- GPU shader pre-compile: `LoadingManager.doneLoading` awaits `renderer.compileAsync(scene, camera)` before lifting the loading screen, so the first time the player turns toward an as-yet-unrendered asset doesn't stall the frame for shader compilation.

## Audio

All audio modules live in `src/ts/world/audio/` and share a single `THREE.AudioContext.getContext()` so the browser's ~6-context limit is never an issue, regardless of vehicle count.

- `ProceduralAudio` is the abstract base for *continuous* synths (engine, ambient, background music). Subclasses provide `shouldPlay()`, `buildSynth()`, `teardownSynth()`, `updateSynth()`. The base handles the master-gain ramp, lazy AudioContext acquisition, and the lifecycle so each subclass focuses on the oscillator graph. Defensive: EngineSound's `updateSynth` skips frames where the chassis velocity is non-finite (and resets `rpm` to idle if it has accumulated NaN).
- `EngineSound` (per-Vehicle) has 5 timbre profiles (car / heli / airplane / boat / rocket) selected via `vehicle.engineSoundProfile`. RPM is modulated by chassis speed.
- `AmbientSound` - wind + water synth. Water gain gated by `Math.abs(cam.y - 12) < 10` (only audible while the camera is within 10 m of the ocean's y-level). Bird chirps live in per-bird `BirdSound` instead of being baked in here.
- `BackgroundMusic` (extends `ProceduralAudio`) loops bundled music tracks; gated by `params.Background_Music` and scaled by `Master_Volume * Music_Volume`.
- `SfxBus` is event-driven (not a `ProceduralAudio` subclass). Carries the player-UI sounds (race checkpoint + lap fanfare, dialog whoosh, prompt + pause UI ticks, iris-transition whoosh, vehicle crash, rocket boom). Per-character action sounds (footsteps / jump / land / door) live in per-character `CharacterSfx` instead. Each `play*` method builds its tiny burst synth on demand and lets the browser GC the nodes once the burst finishes.
- `CharacterSfx` (per-Character) - positional audio for every character (player + NPCs). Each character carries a permanent THREE.PositionalAudio attached to its body (refDistance 4, rolloff 1.5, maxDistance 35) that distance-attenuates footsteps / jump / land / door clunk. The same role EngineSound has for vehicles.
- `Speaker` is the map-driven 3D positional audio source built from a `userData.data='speaker'` marker. It uses `createMediaAudioElement(url)` from `AudioHelpers` to build the `<audio>` + `<source>` DOM, wraps it in `THREE.PositionalAudio.setMediaElementSource(el)`, attaches to its own Object3D.
- `BirdSound` is a per-bird PositionalAudio attached to each bird's group, with its own FM-chirp synth (sine carrier + sine modulator + bandpass) on a 5–12 s Poisson chirp schedule.
- `AnimalVoices` is the procedural bark / meow / purr-loop bus for wandering animals, fired on state transitions via `pendingVoice` so behaviours don't need a world ref. Uses StereoPannerNode + manual distance-gain instead of full PositionalAudio (the synths are short enough that the lighter pipeline reads as positional too).
- `AudioHelpers` exports three shared utilities: `getMasterVolume(world)` (returns 0 when `Master_Audio` is off), `ensureAudioListener(world)` (lazy-create THREE.AudioListener attached to camera), and `createMediaAudioElement(url)` (the `<audio>` + `<source>` DOM pair Speaker uses). Replaces what used to be 6 + 4 inline copies across the audio classes.
- `Master_Audio` mute switch routes through `World.applyAudioListenerVolume()` which sets the THREE listener gain to 0 - this propagates mute to the 3D-positional path (BirdSound / CharacterSfx / Speaker) that doesn't go through `getMasterVolume`. Title-screen mute button, Settings modal toggle, and lil-gui debug panel all mirror through `localStorage['sketchbook.soundMuted']`.
- `THREE.AudioListener` is attached lazily to `world.camera` the first time a `Speaker` is constructed. Stored at `world.audioListener` so `SettingsModal` can call `setMasterVolume(v / 100)`.
- Browser autoplay-policy gating: every Speaker that fails to autoplay registers itself on a static queue; a single `pointerdown`/`keydown` listener on `window` plays everything queued. The queue cleans up on `removeFromWorld` so scenario switches before the first gesture don't leak references.

## UI shell (May 2026 ui-system pass)

All overlay files live under `src/ts/world/ui/` (moved there in the 0.8.0 reorganisation).

| Component | File | Open / close trigger |
|---|---|---|
| TitleScreen | `src/ts/world/ui/TitleScreen.ts` | Shown by index.html before `new World()`; resolves on first user gesture |
| Loading bar | `src/ts/core/UIManager.ts` (`setLoadingProgress`) | Driven by `LoadingManager` per `xhr.progress` and `doneLoading` |
| PauseMenu | `src/ts/world/ui/PauseMenu.ts` | Esc (after `enable()`); buttons: Resume, Settings, Restart, Reload |
| SettingsModal | `src/ts/world/ui/SettingsModal.ts` | PauseMenu → Settings; writes through lil-gui controllers (cached as a Map for O(1) lookup) |
| DialogBox | `src/ts/world/ui/DialogBox.ts` | Singleton; opened by `ProximityPrompt` when `dialog` param is set |
| IrisTransition | `src/ts/world/ui/IrisTransition.ts` | Singleton CSS clip-path wipe - used for map switches and scenario restarts |
| ErrorOverlay | `src/ts/world/ui/ErrorOverlay.ts` | `window.onerror` + `unhandledrejection` (installed by index.html) |
| NameLabel | `src/ts/world/ui/NameLabel.ts` | `attachNameLabel(character, name, isPlayer)` from spawn points |
| WorldLabels | `src/ts/world/ui/WorldLabels.ts` | Distance-culling registry on top of CSS2DRenderer; `attachNameLabel` goes through it |

All overlays are `position: fixed; z-index: var(--z-modal)` (or higher for `--z-toast` = error). Tokens in `src/css/modules/tokens.css`. Dark mode swap via `class="dark"` on `<html>`.

## Persistence

- `localStorage['sketchbook-settings']` - full lil-gui state via `gui.save()` / `gui.load()`. Restored on World construction (in `setup/ParamsGUI.ts`); persisted on every change via `gui.onFinishChange`.
- `localStorage['sketchbook.map']` - selected map id. Read by `index.html` before constructing World; written by the Scenarios-panel map dropdown (`setup/MapSwitcher.ts`).
- `localStorage['sketchbook.locale']` - selected language (en / de / es). Set by the title-screen language picker; read by `i18n` on module load.

## Sandbox scenes (BaseScene subclasses)

`src/ts/world/sandboxes/BaseScene.ts` is an abstract class with a `THREE.Scene` and three vehicle-mesh slots (kept for upstream compat - Sketchbook always loads vehicles from `.glb`, so the slots are unused). Subclasses populate `this.scene` with meshes carrying the same userData markers as a `.glb`. `World` accepts either a string `.glb` path or a `BaseScene` instance - the latter is wrapped in a `{scene: …}` fake-GLTF and runs through the same `loadScene` path.

Subclasses:
- **`TestScene` / `Test2Scene` / `Test3Scene` / `Example`** - procedural socketControl-style sandboxes, built synchronously in their constructor.
- **`Sw01Scene`** - 1:1 recreation of the swift502 v0.1.0 demo (tiled platform + bounce spheres + credit sign + Bob (FollowCharacter) + John (Random)). Async via `static createAsync()` because it loads the credits-sign FBX.
- **`Sw02Scene`** - 1:1 port of the swift502 v0.2.0 test world. Loads the vendored `build/assets/world_v02.glb` verbatim and translates its v0.2-era `extras.physics` / `extras.mass` userData on the fly into the modern `userData.data='physics'/'spawn'` dispatch format.
- **`creditsSign.ts`** - shared helper used by both Sw01 and Sw02 to materialise the credits-sign FBX with its 4 sub-mesh Lambert materials (sign, grass, sign_shadow, credits).

## Map switcher

`addMapSwitcher(world)` (in `src/ts/world/setup/MapSwitcher.ts`, called from `loadScene`) adds a `Map` dropdown to the Scenarios folder with nine options: Inthenew (default), `sw-v01` (procedural swift502 v0.1 demo via `Sw01Scene`), `sw-v02` (vendored swift502 v0.2 GLB via `Sw02Scene`), `sc-v03`, `sc-v04`, `sc-test`, `sc-test2`, `sc-test3`, `sc-example`. Selecting writes to `localStorage['sketchbook.map']` and reloads the page (covered by an iris-wipe transition). `index.html` reads the value on next load and dispatches to either `glbPaths[…]` or the matching `sceneClasses[…]` (using `createAsync()` if exposed, otherwise `new`).
