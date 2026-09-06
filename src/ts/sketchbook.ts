import '../css/main.css';
export { World } from './world/World';

// Procedural sandbox scenes - surfaced here so index.html can do
// `new Sketchbook.TestScene()` etc. and pass the instance into the
// World constructor as an alternative to a .glb path. The four `Test*`
// / `Example` are ports from tkkaushik369/socketControl; the two
// `Sw*Scene` recreate the swift502 v0.1.0 + v0.2.0 demo levels in code
// (the originals predate Sketchbook's GLB+userData map authoring).
export { TestScene } from './world/sandboxes/TestScene';
export { Test2Scene } from './world/sandboxes/Test2Scene';
export { Test3Scene } from './world/sandboxes/Test3Scene';
export { Example } from './world/sandboxes/ExampleScene';
export { Sw01Scene } from './world/sandboxes/Sw01Scene';
export { Sw02Scene } from './world/sandboxes/Sw02Scene';

// Pre-game UI helpers usable directly from index.html before the World
// is built.
export { showTitleScreen } from './world/ui/TitleScreen';
export { installErrorOverlay } from './world/ui/ErrorOverlay';

// Touch controls - auto-installs on touch devices. No-op on desktop,
// so it's safe to import unconditionally.
import { TouchControls } from './core/TouchControls';
TouchControls.install();
