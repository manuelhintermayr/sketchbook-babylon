# UI system

The May 2026 UI pass adopted seven pieces of an in-house design system as functional features. This doc is the catalogue.

## Design tokens (`src/css/modules/tokens.css`)

Every other module references CSS custom properties from here. Drop a `class="dark"` on `<html>` to flip the surface palette to dark mode (the `[data-theme="sketchbook"].dark` block at the bottom of the file overrides surface / on-surface / outline).

Highlights:

- **Brand:** `--color-primary` (gold `#FFB900`) + `--color-primary-shadow` for the signature 4px press effect; `--color-tertiary` (blue `#568db5`) for accents and the "me" name tag.
- **Surfaces:** five-step neutral scale (`--color-surface`, `…dim`, `…container`, `…container-high`, `…container-highest`) so cards stack visually.
- **Typography:** `--font-headline` / `--font-body` (Solway), `--font-label` (Catamaran), `--font-mono` (Cutive Mono), `--font-display-alt` (Alfa Slab One). Ten-step size scale (`--text-display` … `--text-overline`).
- **Spacing:** `--space-1` (0.25rem) … `--space-20` (5rem).
- **Shadows:** `--shadow-gold` (the 4px press shadow), `--shadow-keycap` (multi-layer inset for `.ctrl-key`), `--text-shadow-overlay` (1px+3px black drop for readable text over 3D scenes).
- **z-index ordering:** `--z-dropdown` (10) … `--z-stats` (10000). Use these instead of arbitrary numbers - collisions are easy to introduce otherwise.

If you add a new overlay, declare its z-index from this scale and pull all colour / size / motion constants through `var(--…)`.

## Overlay catalogue

```
                                 z-index           triggered by
                                 ───────           ──────────────────
TitleScreen        --z-modal     (40)              index.html, before World()
LoadingScreen      0             (always at back)  LoadingManager.constructor
PlanetMenu         --z-modal     (40)              RocketShip apogee
DialogBox          --z-overlay   (30)              ProximityPrompt with dialog
PauseMenu          --z-modal     (40)              Esc (after pauseMenu.enable())
SettingsModal      --z-modal     (40)              PauseMenu → Settings
ErrorOverlay       --z-toast     (50)              window.onerror, unhandledrejection
NameLabel          (CSS2D pass)                    attachNameLabel(target, name, isPlayer)
StatsBox           --z-stats     (10000)           stats.js, toggle via Debug_FPS
```

### TitleScreen (`src/ts/world/ui/TitleScreen.ts`)

Pre-game card with bouncing cube + version label + "click or press any key to start". Lives at `--z-modal`. Returns a `Promise<void>` that resolves on first user gesture; the gesture also unblocks browser audio autoplay (Speaker depends on this). Bootstraps fonts itself so it looks correct even before `main.css` has finished applying.

A language picker (en / de / es) sits at the bottom of the card, plus two icon buttons in the top-right - dark-mode toggle and sound-mute toggle. The sound-mute button writes `localStorage['sketchbook.soundMuted']`, which `ParamsGUI` reads on next boot to seed the `Master_Audio` flag - so the player's choice carries through the page reload.

### LoadingScreen + progress (`src/css/modules/loadingScreen.css`, `src/ts/core/UIManager.ts`)

Built into the `<div id="loading-screen">` injected by `bootstrapHTML(world)` (in `src/ts/world/setup/HTMLBootstrap.ts`). The percentage label and bar are driven by `UIManager.setLoadingProgress(percent)`, called by `LoadingManager` on every `xhr.progress` and on each `doneLoading()`. Width animates via `transition: width var(--motion-fast)`.

### PlanetMenu (`src/css/modules/planetMenu.css`)

Earth/Moon picker that opens at the rocketship's apogee. Pre-existing; not new in this pass - listed here for completeness.

### DialogBox (`src/ts/world/ui/DialogBox.ts`)

Singleton bottom-anchored card. Schema:

```ts
interface Dialog
{
    start: string;
    nodes: { [id: string]: DialogNode };
}

interface DialogNode
{
    speaker: string;
    role?: string;
    portrait?: string;     // single character; defaults to first letter of speaker
    text: string;
    choices: DialogChoice[];
}

interface DialogChoice
{
    label: string;
    next: string | 'end';
}
```

Mouse + 1–9 keys pick a choice. Players exit only by picking a closing choice (every dialog has one that routes to `'end'`); Esc + walk-away are intentionally non-dismissing so the typewriter can't be yanked mid-sentence by stray input or residual velocity. Both player and NPC are dialogFreeze'd so the world keeps simulating around them but neither moves.

Default NPC dialogs live in `src/ts/world/scenarios/defaultDialogs.ts`. The dialog tree is cached by locale, so successive scenario launches in the same language reuse the previous build instead of re-running the ~36 `t()` lookups.

### PauseMenu (`src/ts/world/ui/PauseMenu.ts`)

Esc-driven full-screen overlay. Disabled (`isEnabled = false`) until `world.pauseMenu.enable()` is called from the welcome-dialog success branch - that prevents Esc from opening pause over the loader.

When `open()`:
- Saves `world.timeScaleTarget` to `savedTimeScale`.
- `world.setTimeScale(0)` - physics + state machines freeze.
- `document.exitPointerLock()`.
- Adds `.visible` class.
- Focuses the first button for keyboard nav.

When `close()`:
- Restores `world.setTimeScale(savedTimeScale || 1)`.
- Removes `.visible`.

Buttons:
- **Resume** → `close()`.
- **Settings** → `onSettings()` callback (set by World → opens SettingsModal).
- **Restart Scenario** → `world.restartScenario()` (re-launches `lastScenarioID`).
- **Reload Page** → `location.reload()`.

The handler also peeks at `.swal2-container`, `#dialog-bar.visible`, `#settings-modal.visible` so Esc on a higher-priority modal doesn't open Pause.

### SettingsModal (`src/ts/world/ui/SettingsModal.ts`)

Four cards - General / Graphics / Audio / Controls - plus a Low / High quality preset shortcut row at the top of the Graphics card. The General card carries the language picker (en / de / es), Dark mode toggle, and a Reset settings button (wipes every persisted `sketchbook.*` localStorage key + reload). Every other control writes to `world.params[X]` and forwards via a lazy-built `Map<string, controller>` cache (built once from `world.gui.controllersRecursive()` on the first lookup) so every existing lil-gui `onChange` handler (CSM enable, mouse-sensitivity push to CameraOperator, etc.) fires automatically. No duplication of logic - the modal is a *view* over the same controllers.

Audio: `Master_Audio` is a master mute switch - when off, every audio source (continuous synths via `getMasterVolume`, 3D-positional sources via `World.applyAudioListenerVolume`) goes silent regardless of the sub-toggles. Sub-toggles for `Sound_Effects` and `Background_Music` grey out visually while master is off. `Master_Volume` calls `world.setMasterVolume(v)` directly (no lil-gui controller); `Music_Volume` is wired into BackgroundMusic's `perBusGain`. `SFX_Volume` exists in params for legacy reasons but isn't surfaced in the UI - SfxBus uses `Master_Volume` directly.

A `gui.onChange` listener mirrors any lil-gui debug-panel change back into the open modal so both views stay in sync. `gui.save()` runs on every modal write so toggle clicks persist immediately (lil-gui's own `onFinishChange` only fires on slider drag-end). `refresh()` runs on `open()` to pull the latest values back from params.

### ErrorOverlay (`src/ts/world/ui/ErrorOverlay.ts`)

`installErrorOverlay()` registers `window.onerror` and `window.onunhandledrejection`. The first error to fire shows the overlay; subsequent errors are swallowed (a cascade drowns out the useful first one). The card has:

- error code (e.g. `RUNTIME ERROR`, `UNHANDLED PROMISE`)
- title (the message)
- stack trace (in a `<pre>` block, scrollable)
- **Reload** - `location.reload()`
- **Copy details** - clipboard API with textarea fallback for older browsers

Installed from `index.html` *before* `Sketchbook.World()` is constructed so even bootstrap failures get the friendly card.

### NameLabel (`src/ts/world/ui/NameLabel.ts`)

`attachNameLabel(target: THREE.Object3D, name: string, isPlayer: boolean): CSS2DObject`. Creates a `<div class="name-label">` (or `.name-label.me` for the player), wraps it in a CSS2DObject anchored at `(0, 1.2, 0)` relative to the target, and adds it as a child. The label follows the target's world transform automatically.

Rendered each frame by `world.labelRenderer.render(graphicsWorld, camera)` - a `CSS2DRenderer` with its own absolutely-positioned overlay div (`pointer-events: none`). Distance culling and feature-flag gating run through `WorldLabels` (`src/ts/world/ui/WorldLabels.ts`), the registry on top of the CSS2D pass.

`CharacterSpawnPoint` calls this with `'Du'` + `isPlayer=true` after `takeControl()`. `NPCSpawnPoint` calls it with `userData.name` (or `NPC #N` fallback).

## Adding a new overlay

1. Create `src/css/modules/yourOverlay.css` using token vars only.
2. `@import "modules/yourOverlay.css";` from `src/css/main.css`.
3. Create `src/ts/world/ui/YourOverlay.ts` - class with `open()` / `close()`, builds the DOM in the constructor, appends to `document.body`.
4. Pick a z-index from the tokens scale; don't introduce new ones.
5. If it's modal: peek at the document for higher-priority modals before responding to Esc, so you don't fight PauseMenu.
6. Wire the trigger (PauseMenu button, World event, key handler).
7. If it's keyboard-driven, attach the listener in the constructor and remove it in any `dispose()` you add. Most overlays are singletons that live for the page lifetime, so cleanup is rarely needed.
8. If the overlay needs i18n strings, add the keys to `src/ts/i18n/index.ts` (en/de/es flat table) and look them up via `t('your.key')`.

## Theming

Every visual constant is a token. To add a theme:

```css
[data-theme="sketchbook"].my-theme
{
    --color-primary: #ff4081;
    --color-on-primary: #ffffff;
    /* … */
}
```

Then `document.documentElement.classList.add('my-theme')`.

The `dark` class is the only non-default theme shipped.
