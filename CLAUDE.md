# CLAUDE.md - Claude Code memory for sketchbook-babylon

This file is loaded automatically by [Claude Code](https://claude.com/claude-code) at the start of every session in this repository. Keep it concise and current - re-read it before assuming anything.

## What this repo is

The Babylon.js + Havok edition of [sketchbook-upgraded](https://github.com/manuelhintermayr/sketchbook-upgraded), a maintained extension of [swift502/Sketchbook](https://github.com/swift502/Sketchbook) - a small web-based 3D game engine with third-person controls, vehicles, scripted scenarios. This repo runs on Babylon.js 9 (`@babylonjs/core` / `loaders` / `materials`) + Havok (`@babylonjs/havok`, Physics V2 API); the upstream line stays on three.js + cannon-es. Curated features from later community forks (Inthenew, socketControl, Notblox, benhatsor) are merged in. See `README.md` for the full timeline.

Status: Babylon port on branch `claude/babylon-migration` (September 2026) on top of the `claude/external-features` baseline snapshot (May 2026, three.js). Latest baseline: post-0.8.0 - UI overhaul + new features + a long internals pass (World.ts split, Vehicle's StuckRecovery / VehicleAudioBridge / WheelManager extracted, Character's PhysicsBridge / InputBridge extracted, AnimalModels split into AnimalModels + CatBuilder + DogBuilder + AnimalAnimator + AnimalSpawner, audio classes decoupled from World via AudioWorldContext interface).

## Build / run / lint

```bash
npm install               # once
npm run build             # bundles build/sketchbook.min.js + build/HavokPhysics.wasm - required before first dev
npm run dev               # webpack-dev-server at http://localhost:8080
npm run lint              # ESLint over src/ts
npx tsc --noEmit          # type-check without emitting (faster than full build for sanity checks)
```

The bundle is **not** committed; do not assume `build/sketchbook.min.js` exists fresh - run `npm run build` first. Havok is WebAssembly: `index.html` awaits `Sketchbook.initPhysics()` (from `src/ts/physics/PhysicsBoot.ts`) before constructing a `World`; the `.wasm` is imported for its URL and emitted by webpack's asset rule. Babylon's lazy shader `import()`s are folded into the single bundle via `LimitChunkCountPlugin`. `window.sketchbookWorld` is a console handle on the live World.

`build/assets/*.glb` and `build/assets/*.jpg` are committed (they're vendored level/vehicle models, not webpack output).

## Code conventions (match these - don't reformat)

- **Indentation:** tabs. ESLint will complain on spaces.
- **Quotes:** single (`'…'`).
- **Semicolons:** always.
- **Braces:** opening on next line for classes / functions / blocks (Allman):
  ```ts
  export class Foo
  {
      constructor()
      {
          ...
      }
  }
  ```
- **Imports:** group per area (`@babylonjs/*` first, then third-party, then internal). No barrel files. Babylon 9 declares most APIs in `*.pure.d.ts` files - grep those, not the thin re-export files.
- **Comments:** sparse and *why*-focused. Don't narrate code that names itself. Don't reference issue numbers / commits / "added by X" - that's `git log` territory.
- **No emojis** in code or commits unless the user asks.
- **No new files** without need - prefer extending an existing one. Especially no `*.md` files unless explicitly requested.

## Architecture map

- `src/ts/sketchbook.ts` - bundle entry point, exports `Sketchbook.World`, the four sandbox classes, `showTitleScreen`, `installErrorOverlay`.
- `src/ts/world/World.ts` - central orchestrator (~650 LOC). Holds renderer / physics / scenarios / updatables registry / lil-gui / audio listener / pause menu, plus the per-frame `update` + `render` loops. Heavy setup lives in dedicated helpers (see below).
- `src/ts/world/setup/` - single-function helpers called from World's constructor: `bootstrapHTML` (DOM scaffolding), `setupRendererPipeline` (Babylon Engine + right-handed Scene + FreeCamera + FXAA post-process + DOM label renderer + resize) plus `tickRenderPipeline` / `tickPhysicsDebug` (per-frame render dispatch; the debug overlay is Babylon's `PhysicsViewer`), `createParamsGUI` (lil-gui panel + persistence), `addMapSwitcher` (Map & Scenarios folder dropdown - runs first so the map sits on top), `injectDefaultSceneNPCs` (Anna/Ben/Carla/Dieter), `injectWanderingAnimals` (dogs/cats), `injectFlyingBirds` (birds + their per-bird positional chirps), `injectButterflies` (Lissajous-drifting butterflies), `wireV02GameMode` (B = ball spawn / T = slow-mo toggle / V = view-distance cycle on foot only - the v0.2 GameMode keys, globally available on every map).
- `src/ts/world/loading/SceneLoader.ts` - `loadScene(world, loadingManager, gltf)`: walks the GLTF and dispatches by `userData.data` to physics / spawn / scenario / path / ocean / grass / speaker constructors.
- `src/ts/world/scenarios/` - `Scenario`, `Path`, `PathNode`, `defaultDialogs`. The scenario subsystem.
- `src/ts/world/spawn/` - `Character/NPC/Vehicle/Shape SpawnPoint` + `ShapeEntity`. Marker-driven entity factories.
- `src/ts/world/ui/` - DOM overlays: `TitleScreen`, `PauseMenu`, `SettingsModal`, `DialogBox`, `ErrorOverlay`, `IrisTransition`, `NameLabel`, `WorldLabels`, plus `LabelRenderer` (projects anchor nodes to screen space - the CSS2DRenderer replacement).
- `src/ts/world/audio/` - `ProceduralAudio` base + `EngineSound` / `AmbientSound` (wind + water gated to ocean proximity) / `BackgroundMusic` / `Speaker` / `SfxBus` (race / dialog / iris / pause / vehicle crash / rocket boom) + per-character `CharacterSfx` (positional footsteps / jump / land / door) + `BirdSound` (positional FM chirp per bird) + `AnimalVoices` (bark / meow / purr-loop bus). Shared `AudioContext`, `AudioListener` and `PositionalAudio` (PannerNode wrapper) live in `SpatialAudio.ts` (plain Web Audio, replaces THREE.AudioListener / PositionalAudio); `AudioHelpers.ts` defines the slim `AudioWorldContext` interface every audio class types against (instead of importing `World`) plus `getMasterVolume(...)`, `ensureAudioListener(...)`, `createMediaAudioElement(url)`. `World.applyAudioListenerVolume()` propagates the Master_Audio mute flag to the audio listener so 3D-positional sources go silent alongside the continuous synths.
- `src/ts/world/animals/` - `WanderingAnimals` manager + `AnimalBehavior` / `DogBehavior` / `CatBehavior` (Strategy pattern, singleton instances) + `AnimalModels` (shared types + colour palettes + low-level mesh helpers `mat`/`makeLeg`/`makeTail`) + per-species builders `CatBuilder` / `DogBuilder` + the per-frame animator `AnimalAnimator` (idle / walk / run / jump pose dispatcher). `AnimalSpawner` owns the spawn placement pipeline + the shared `queryGroundHeight` raycast. `Birds` (flying birds, sound class lives in `audio/BirdSound`) and `Butterflies` (Lissajous-drifting ambient particles, animated Havok body) - both anchor altitude to the player's spawn-Y on first frame so the swarms read as fixed values regardless of map elevation. The shared `mulberry32` PRNG is in `core/FunctionLibrary`.
- `src/ts/world/sandboxes/` - procedural / vendored test scenes. `BaseScene` is the abstract base; subclasses `TestScene` / `Test2Scene` / `Test3Scene` / `ExampleScene` are socketControl ports built in their constructor. `Sw01Scene` is a 1:1 procedural recreation of the swift502 v0.1.0 demo; `Sw02Scene` is special - loads the vendored `build/assets/world_v02.glb` (swift502 v0.2.0 test world) and translates its `extras.physics` / `extras.mass` userData into the modern dispatch format on the fly. Both Sw01/Sw02 use the shared `creditsSign.ts` helper for the credits-sign GLB (converted from swift502's FBX; sign + grass + sign_shadow + credits sub-meshes with textured StandardMaterials).
- `src/ts/world/` (root) - visual environment entities + small subsystems: `Sky`, `Ocean`, `Grass`/`GrassShader`/`Perlin`, `OutlineEffect`, `RaceCheckpoint`/`RaceContent`, `ProximityPrompt`.
- `src/ts/core/` - shared infra: `LoadingManager` (glTF via `@babylonjs/loaders`, returns `LoadedModel {root, meshes, animationGroups}`), `InputManager`, `CameraOperator`, `CameraShake`, `CommonControls`, `UIManager`, `FunctionLibrary` (math + scene-graph helpers: `userData()` on `node.metadata`, `traverse`, three-compatible Euler helpers, `setupMeshProperties` PBR -> StandardMaterial), `CatmullRomCurve3` (port of three's spline for the race curves), `TouchControls`.
- `src/ts/characters/` - `Character` class + state machine (Idle, Walk, Sprint, Falling, Drop*, JumpRunning, vehicle states, etc.) + `CharacterPhysicsBridge` (preStep / postStep / feetRaycast - delegates from Character; also hard-zeroes body velocity while `dialogFreeze` is set so the player can't drift mid-dialog) + `CharacterInputBridge` (keyboard + mouse routing + triggerAction) + character_ai/ behaviours (FollowPath, FollowTarget, RandomBehaviour). Player identification: `Character.isPlayer: boolean` (set true in `CharacterSpawnPoint.takeControl()`); use `world.characters.find(c => c.isPlayer)` rather than `world.characters[0]` because async GLB loads can land an NPC at index 0 before the player resolves.
- `src/ts/vehicles/` - `Vehicle` base, `Car` / `Helicopter` / `Airplane` / `Boat` / `RocketShip`, plus three helpers extracted from Vehicle: `StuckRecovery` (stuck + flip auto-recovery state machine), `VehicleAudioBridge` (engine sound + crash collide listener), `WheelManager` (per-frame wheel transform sync + lil-gui wheel-prop apply).
- `src/ts/physics/` - `PhysicsBoot` (one-time Havok WASM init), `PhysicsWorld` (facade over Babylon's Physics V2 engine: manual `step()`, pre/post-step listeners, filtered raycasts, velocity / sleep / teleport helpers), `RaycastVehicle` (port of cannon-es's Bullet-style raycast vehicle on Havok bodies), `colliders/` (`BoxCollider`, `SphereCollider`, `CylinderCollider`, `CapsuleCollider`, `TrimeshCollider` - thin wrappers around `PhysicsShape*` + `PhysicsBody` sharing `ColliderBase`; masks go through `toMask()` because Havok wants unsigned filters).
- `src/ts/enums/` - `EntityType`, `CollisionGroups`, `SeatType`, `Side`, `Space`, `UpdateOrder` (semantic slot order), `RenderLayers`.
- `src/ts/i18n/` - `t(key, vars)` lookup, flat translation table (en/de/es), persisted to localStorage.
- `src/css/main.css` - imports all module CSS. `tokens.css` defines every shared CSS custom property; everything else uses `var(--…)`.

For deeper pointers see `docs/architecture.md` and `docs/map-authoring.md`.

## Mental model: how a frame happens

1. `World.render()` → request RAF → compute timestep
2. `World.update(timeStep)` runs every registered `IUpdatable.update()` sorted by `updateOrder`. Slots are named in `enums/UpdateOrder.ts` (× 10 spacing): `CharacterPhysics` (10) → `VehiclePhysics` (20) → `Input` (30) → `Camera` (40) → `Environment` (50, Sky/ShapeEntity) → `Scenarios` (60, RaceContent) → `World` (100, Grass/Ocean/WanderingAnimals/Birds/Butterflies) → `Audio` (110) → `Prompts` (130) → `Labels` (140) → `PostCamera` (150, CameraShake).
3. `scene.render()` with the FXAA post-process attached to the camera when `params.FXAA` is on (Bloom + DoF were dropped).
4. `OutlineEffect.beforeRender()` keeps a `DepthRenderer` + Sobel post-process alive while `params.Outlines` is on.
5. `labelRenderer.render(camera)` projects the DOM name labels above their anchors.

`world.params.Time_Scale` is the throttle. `setTimeScale(0)` pauses the physics + state updates entirely (PauseMenu uses this).

## Map / level authoring

The level lives in `build/assets/world.glb` (the Inthenew default) plus two socketControl alternatives (`world_sc_v03.glb`, `world_sc_v04.glb`) plus the vendored swift502 v0.2 test world (`world_v02.glb`, loaded by `Sw02Scene`) plus a procedural recreation of the swift502 v0.1 demo (`Sw01Scene`) plus four code-built socketControl sandboxes - 9 entries total. All are switchable from the **Map & Scenarios** GUI panel; the choice persists in `localStorage['sketchbook.map']`.

`loadScene(world, loadingManager, gltf)` (in `src/ts/world/loading/SceneLoader.ts`) walks every node in the scene and acts on `userData`:
- `data: 'physics'` + `type: box|trimesh|cylinder` → spawn matching static Havok body (the marker mesh doubles as the body's transform node)
- `data: 'spawn'` + `type: car|heli|airplane|boat|rocketship|player|npc|character_ai|character_follow|shape` → matching SpawnPoint
- `data: 'scenario'` → new Scenario container
- `data: 'path'` + nested `data: 'pathNode'` → Path graph (used by FollowPath AI + RaceContent)
- `data: 'speaker'` + `audio: '<url>'` → 3D positional audio source
- `material.name === 'ocean' | 'ocean.001'` → Ocean wave shader
- `material.name === 'grass'` → instanced grass field

For full list and example markers see `docs/map-authoring.md`.

## Things to NOT do

- Don't add multiplayer / Socket.io / ECS plumbing - explicit non-goal of this fork.
- Don't replace lil-gui with a custom panel - settings flow through it via `gui.controllersRecursive().find().setValue()` from the SettingsModal.
- Don't break commit attribution. When porting from a fork, use `--author="Original Author <email>"` and the original date so `git log` reflects who did the original work.
- Don't push to `main`/`master`. Active branch is `claude/external-features`. Other branches like `claude/inthenew-*` are historical.
- Don't downgrade dependencies. The April 2026 toolchain pass updated everything to current LTS.
- Don't use `Array.prototype.includes` blindly - `tsconfig.json` targets ES2015 in some paths. Use `indexOf(x) !== -1` if `tsc` complains.
- Don't write `node.rotation` on a node whose `rotationQuaternion` is set (Babylon ignores the Euler then). Use the `Utils.getQuaternion` / `setEulerComponent` helpers; physics bodies always get a `rotationQuaternion`.
- Don't step Havok from Babylon's render loop - `scene.physicsEnabled` is off on purpose; `World.updatePhysics` calls `physicsWorld.step()` with the Time_Scale-scaled delta (that is what keeps pause / slow-mo working).

## Ongoing TODO

- Bring over remaining iErcann/Notblox features (the physics-engine migration itself is done here on Havok; the three.js line has a Rapier variant in `manuelhintermayr/sketchbook-rapier`).
- Bundle size: `@babylonjs/core` is imported from the package root (8.5 MB minified). Switching to deep imports / side-effect-free entry points would shrink it considerably.
- Optionally evaluate pmndrs/ecctrl or pmndrs/BVHEcctrl as a controller alternative.

Everything else listed there is shipped.
