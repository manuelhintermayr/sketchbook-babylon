# context.md - AI agent onboarding

This file is a generic context primer for any AI coding assistant working on this repository (Cursor, Continue, Aider, Copilot Workspace, agent-mode Claude, etc.). [Claude Code](https://claude.com/claude-code) reads `CLAUDE.md` instead - same content, slightly different framing.

## TL;DR for fast bootstrapping

- **What:** maintained extension of the [swift502/Sketchbook](https://github.com/swift502/Sketchbook) 3D engine. Single-player only (no networking).
- **Stack:** TypeScript, three.js r183, cannon-es, lil-gui, webpack 5. ESLint enforced.
- **Branch:** `claude/external-features` is the active development line; `master` is upstream-aligned.
- **Build:** `npm install && npm run build` (required first), then `npm run dev` → <http://localhost:8080>.
- **Lint:** `npm run lint` (ESLint over `src/ts/`).
- **Type-check only:** `npx tsc --noEmit`.

## Repository tour

```
src/
├── css/
│   ├── main.css                    ← imports every module
│   └── modules/
│       ├── tokens.css              ← single source of truth for colour/typography/spacing
│       ├── pauseMenu.css, dialog.css, settingsModal.css, errorCard.css, titleScreen.css
│       └── …existing modules (base, leftPanel, loadingScreen, …)
├── img/                            ← DALL-E generated textures (Earth, Moon, smoke, …)
└── ts/
    ├── sketchbook.ts               ← bundle entry; re-exports public API
    ├── characters/                 ← Character + state machine + AI behaviours
    │                                  + CharacterPhysicsBridge + CharacterInputBridge
    ├── core/                       ← LoadingManager, InputManager, CameraOperator, CameraShake,
    │                                  CommonControls, UIManager, TouchControls, FunctionLibrary
    ├── enums/                      ← EntityType, CollisionGroups, SeatType, Side, Space,
    │                                  UpdateOrder (semantic slots), RenderLayers
    ├── i18n/                       ← t(key, vars) flat translation table (en/de/es)
    ├── interfaces/                 ← IUpdatable, IWorldEntity, ISpawnPoint, ICollider
    ├── physics/colliders/          ← Box, Sphere, Cylinder, Capsule, Trimesh wrappers
    ├── vehicles/                   ← Vehicle + Car/Helicopter/Airplane/Boat/RocketShip
    │                                  + StuckRecovery + VehicleAudioBridge + WheelManager
    └── world/
        ├── World.ts                ← orchestrator; ~650 LOC; per-frame loop + updatables registry
        ├── Sky.ts, Ocean.ts        ← visual environment entities at root
        ├── Grass.ts, GrassShader.ts, Perlin.ts
        ├── OutlineEffect.ts        ← depth-Sobel toon outline post-process
        ├── RaceCheckpoint.ts, RaceContent.ts
        ├── ProximityPrompt.ts      ← per-frame distance check + DOM label + interact key
        ├── setup/                  ← bootstrapHTML, setupRendererPipeline, createParamsGUI,
        │                              addMapSwitcher, injectDefaultSceneNPCs,
        │                              injectWanderingAnimals, injectFlyingBirds,
        │                              injectButterflies, v02GameMode (B/T/V keys)
        ├── loading/SceneLoader.ts  ← loadScene(world, lm, gltf): GLTF userData dispatcher
        ├── scenarios/              ← Scenario, Path, PathNode, defaultDialogs
        ├── spawn/                  ← Character/NPC/Vehicle/Shape SpawnPoint, ShapeEntity
        ├── ui/                     ← TitleScreen, PauseMenu, SettingsModal, DialogBox,
        │                              ErrorOverlay, IrisTransition, NameLabel, WorldLabels
        ├── audio/                  ← ProceduralAudio base + EngineSound, AmbientSound,
        │                              BackgroundMusic, Speaker, SfxBus, CharacterSfx,
        │                              BirdSound, AnimalVoices, AudioHelpers (shared utils)
        ├── animals/                ← WanderingAnimals + AnimalBehavior/Dog/Cat,
        │                              AnimalModels (types + helpers), CatBuilder, DogBuilder,
        │                              AnimalAnimator, AnimalSpawner, Birds, Butterflies
        └── sandboxes/              ← BaseScene + Test/Test2/Test3/Example +
                                       Sw01Scene + Sw02Scene + creditsSign helper
build/assets/                       ← world.glb, world_sc_v03.glb, world_sc_v04.glb,
                                       world_v02.glb, ao_bake.png, credits_sign/, vehicles
vendor/joycon/                      ← Joycon.min.js + Client.js + joycon-sketchbook.js (loaded
                                       directly via <script> from index.html, no bundling)
ThreejsEditor/project.json          ← upstream THREE.js editor compat - leave as-is
```

## Project conventions (do not violate without asking)

| Topic | Convention |
|---|---|
| Indent | tabs |
| Quotes | `'single'` |
| Braces | Allman (opening on new line) |
| Semicolons | always |
| Comments | sparse, *why*-focused, no PR/commit refs |
| New files | extend existing first; no new `.md` unless requested |
| Commits | preserve upstream authorship via `--author=` when porting |
| Branches | work on `claude/external-features`; never push to `master` |
| Emojis | none in code/commits unless user requests |
| ECS / Multiplayer | **not adopted** - explicitly out of scope |

## Engine mental model

- **Frame loop:** `World.render()` (RAF) → `World.update(timeStep)` → every registered `IUpdatable.update()` sorted by `updateOrder` → `tickRenderPipeline(world)` runs `composer.render()` (FXAA only - Bloom + DoF were dropped) → `outlineEffect.renderPass()` (if Outlines on) → `labelRenderer.render()` (CSS2D name tags).
- **Update order slots:** named in `enums/UpdateOrder.ts` - `CharacterPhysics → VehiclePhysics → Input → Camera → Environment → Scenarios → World → Audio → Prompts → Labels → PostCamera`. Spaced by 10 so new slots can squeeze between two existing ones without renumbering.
- **Pause:** `world.setTimeScale(0)` freezes everything. `PauseMenu` uses this; `SettingsModal` adjusts `params.Master_Volume` etc. through lil-gui controllers so existing onChange handlers fire.
- **Updatables:** anything visible (Ocean, Grass, Speaker, RaceContent, ProximityPrompt, Sky, Character, Vehicle, WanderingAnimals, etc.) implements `IUpdatable` and is registered via `world.registerUpdatable()` (or `world.add()` which also registers).
- **Player identification:** use `world.characters.find(c => c.isPlayer)`, not `world.characters[0]`. The `isPlayer` flag is set in `CharacterSpawnPoint.takeControl`; async GLB loads can land an NPC at index 0 before the player resolves.
- **Map authoring:** scenarios + spawns + physics + paths + grass + speakers all come from `userData` on nodes inside `world.glb`. The dispatcher is `loadScene(world, lm, gltf)` in `world/loading/SceneLoader.ts`. Markers are documented in `docs/map-authoring.md`.

## Where to add things

| You want to… | Touch this |
|---|---|
| Add a new vehicle | `src/ts/vehicles/`, register in `EntityType`, recognise in `src/ts/world/spawn/VehicleSpawnPoint` |
| Add a new world entity | implement `IUpdatable` (or `IWorldEntity` if it has add/remove lifecycle), pick an `UpdateOrder` slot, add to `src/ts/world/loading/SceneLoader.ts` if map-driven |
| Add a UI overlay | new file in `src/ts/world/ui/`, new module in `src/css/modules/`, `@import` it from `src/css/main.css` |
| Add an in-game shortcut | `World.ts` listens to a few `keydown` directly (`KeyT`, `KeyZ`); `InputManager` handles per-receiver input |
| Add a setting | extend `params` defaults in `src/ts/world/setup/ParamsGUI.ts`, register a lil-gui controller there; optionally add a row in `SettingsModal.refresh/build` |
| Add an NPC dialog | edit `src/ts/world/scenarios/defaultDialogs.ts`, hand it to `NPCSpawnPoint` constructor |
| Add a new map marker convention | add a `userData.data === 'X'` branch in `src/ts/world/loading/SceneLoader.ts` and document it in `docs/map-authoring.md` |
| Add a new spawn type | new file in `src/ts/world/spawn/` implementing `ISpawnPoint`, dispatch from `SceneLoader.ts` |
| Add a new translation | add the key to the flat table in `src/ts/i18n/index.ts` (entries cover en/de/es); look it up via `t(key)` |

## Hard rules

1. **Do not** introduce networking, ECS frameworks, or Socket.io.
2. **Do not** push to `master` or force-push any shared branch without explicit permission.
3. **Do not** rename or move existing public API (`Sketchbook.World`, scene class exports, `createWelcomeScreenCallback`) without checking call sites in `index.html` and dependent forks.
4. **Do not** vendor copyrighted assets without checking license. The Inthenew port replaced six hotlinked images with DALL-E equivalents specifically because of this - see the `README.md` v0.6.0 section.
5. **Do not** add `*.md` documentation files spontaneously. The user will ask.

## Reference docs

- `README.md` - user-facing feature list + project timeline + credits.
- `CHANGELOG.md` - per-version Keep-a-Changelog detail (the 0.8.0 entry has every commit grouped by category).
- `CLAUDE.md` - Claude Code memory (~ same content as this file, slightly different audience).
- `docs/architecture.md` - deeper engine internals.
- `docs/map-authoring.md` - full userData marker reference.
- `docs/ui-system.md` - design tokens + UI overlay catalogue.

## When unsure

Read `README.md`'s timeline first - it explains why each piece is the way it is. Then `git log --oneline` on the relevant file. Most architectural choices are documented in commit messages with the upstream author preserved.
