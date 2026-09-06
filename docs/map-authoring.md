# Map authoring

`loadScene(world, loadingManager, model)` (in `src/ts/world/loading/SceneLoader.ts`) walks every node in the loaded model (either a `.glb` or a procedural `BaseScene` subclass) and dispatches on `userData.data` / `userData.type` / `material.name`. This is the entire surface for adding content without writing TypeScript.

The bundled level (`build/assets/world.glb`) is authored in Blender and exported with custom properties passed through; the glTF loader stores them as `node.metadata.gltf.extras` and `Utils.userData(node)` exposes them as one mutable object per node. The four sandbox scenes (`src/ts/world/sandboxes/Test*.ts`) demonstrate the same conventions in code and are good copy-paste starting points.

## Quick reference

| `userData.data` | `userData.type` | Other userData | Effect |
|---|---|---|---|
| `physics` | `box` | (uses `scaling.{x,y,z}`) | Static `BoxCollider` |
| `physics` | `trimesh` | (geometry-driven, child primitives included) | Static `TrimeshCollider` |
| `physics` | `cylinder` | (`scaling.x` → radius, `scaling.y` → height) | Static `CylinderCollider`, 12 segments |
| `path` | – | `name` | Path container; nested `pathNode` children become a graph |
| `pathNode` | – | `name`, `nextNode`, `previousNode` | Graph node referenced by `data: 'path'` parent |
| `scenario` | – | `name`, `desc_title`, `desc_content`, `default`, `spawn_always`, `invisible`, `camera_angle` | Scenario container; nested spawn children get spawned on launch |
| `spawn` | `player` | – | Player Character at this transform; tagged "Du" |
| `spawn` | `npc` \| `character_ai` \| `character_follow` | `name`, `first_node` | Standing NPC, or path-following if `first_node` set |
| `spawn` | `car` \| `heli` \| `airplane` \| `boat` \| `rocketship` | `driver` (`'player'` / `'ai'`), `first_node` | Vehicle from `build/assets/{type}.glb` |
| `spawn` | `shape` | `subtype` (`'box'`/`'sphere'`), `mass`, `radius` | Dynamic Havok primitive |
| `speaker` | – | `audio` (URL) | 3D positional audio source (yellow wireframe sphere) |

| `material.name` | Effect |
|---|---|
| `ocean` / `ocean.001` | Ocean wave shader; original mesh becomes invisible carrier, tiled wave grid laid over |
| `grass` | Instanced 300k-blade grass field, 60-unit LOD swap to empty mesh past the threshold |

| Mesh `name` | Effect |
|---|---|
| `Layer0_001` | Moon-surface mesh - gets the `moon-with-flowers.png` texture applied (Inthenew quirk) |

## Examples

The sandbox helpers imported below live in `src/ts/world/sandboxes/BaseScene.ts`. They mirror the three.js idioms the socketControl scenes were written in: unit boxes scaled into shape, empties carrying userData, hidden half-extent physics markers. Every example runs inside a `BaseScene` subclass constructor, where `this.scene` is the Babylon scene and `this.root` the node `loadScene` walks.

### A static physics box

```ts
import { lambert, physicsBoxFor, unitBox } from './BaseScene';

// In a sandbox BaseScene constructor:
const ground = unitBox(this.scene, this.root, lambert(this.scene, 0xcccccc), 'ground');
ground.scaling.set(124, 0.2, 124);

// Hidden marker at half the scale, tagged { data: 'physics', type: 'box' }.
physicsBoxFor(this.scene, ground);
```

In Blender: add a Cube, set custom property `data: physics` and `type: box`, scale it to taste, export GLB with custom-properties enabled. Sketchbook makes it invisible at load time (including the per-material child primitives the glTF loader creates).

### A scenario with a player spawn

```ts
import { empty } from './BaseScene';

const scenario = empty(this.scene, this.root, 'scenario1', {
    name: 'Free roam (default)',
    data: 'scenario',
    default: 'true',                  // launched automatically on map load
    desc_title: 'Default spawn',
    desc_content: 'Explore the world!',
    camera_angle: 0,
});

const player = empty(this.scene, scenario, 'user', { data: 'spawn', type: 'player' });
player.position.set(0, 2, 0);
```

`desc_title` matters - if it's one of the values in the `RACE_TITLES` set inside `Scenario.ts` (`Oval race`, `Tunnel race`, `Figure 8 race`, `Boat Race`), the curve-based race-checkpoint system kicks in.

### An AI-driven car following a path

```ts
// 1. Build a Path graph
const path = empty(this.scene, this.root, 'lap_path', { data: 'path', name: 'lap_path' });
['n1', 'n2', 'n3', 'n4'].forEach((n, i, arr) => {
    const node = empty(this.scene, path, n, {
        data: 'pathNode',
        name: n,
        previousNode: arr[(i - 1 + arr.length) % arr.length],
        nextNode: arr[(i + 1) % arr.length],
    });
    node.position.set(/* … */);
});

// 2. Drop an AI car into a scenario
const aiCar = empty(this.scene, scenario, 'car_ai', {
    data: 'spawn',
    type: 'car',
    driver: 'ai',
    first_node: 'n1',
});
aiCar.position.set(0, 1, 0);
```

### A standing NPC with a dialog

NPC dialog isn't authored in the GLB - `userData.first_node` is the only interesting property on the marker. The dialog tree is wired in code from `world/scenarios/defaultDialogs.ts`; pass it to `NPCSpawnPoint` via the constructor `options` parameter:

```ts
import { TransformNode } from '@babylonjs/core';
import { NPCSpawnPoint } from './spawn/NPCSpawnPoint';
import { getDefaultDialogs } from './scenarios/defaultDialogs';
import * as Utils from '../core/FunctionLibrary';

const marker = new TransformNode('Anna', world.scene);
marker.parent = defaultScenario.rootNode;
marker.position.set(5, 18, -5);
Utils.setUserData(marker, { name: 'Anna', first_node: 'npc_node_1' });   // first_node optional - wandering

const { dialog, role } = getDefaultDialogs()['Anna'];
defaultScenario.spawnPoints.push(new NPCSpawnPoint(marker, { dialog, role }));
```

Or just stand silent (no E-prompt appears):

```ts
defaultScenario.spawnPoints.push(new NPCSpawnPoint(marker));
```

### A grass patch

```ts
import { MeshBuilder } from '@babylonjs/core';
import * as Utils from '../../core/FunctionLibrary';

// CreateGround already lies flat (three needed a rotated PlaneGeometry).
const grass = MeshBuilder.CreateGround('grassLawn', { width: 2, height: 2 }, this.scene);
grass.parent = this.root;
grass.scaling.set(5, 5, 5);
grass.position.set(57, 0.11, 57);
const material = lambert(this.scene, 0x000000, { name: 'grass' });   // ← the name triggers the Grass class
Object.assign(Utils.materialUserData(material), { instances: 50000 });
grass.material = material;
```

`SceneLoader` instantiates `Grass(child, world)`; the lawn covers `scaling.x` × `scaling.z` half-extents around the mesh. Default instance count is 300 000; override via `material.metadata.userData.instances` (what `Utils.materialUserData` writes to).

### A dynamic shape (box) the player can knock around

```ts
const box = unitBox(this.scene, scenario, lambert(this.scene, 0xccffff), 'shape_box_1');
box.scaling.set(1, 0.4, 1);
box.position.set(15, 2, -15);
Utils.setUserData(box, {
    data: 'spawn',
    type: 'shape',
    subtype: 'box',
    mass: 1,
});
```

For a sphere: `sphereMesh(this.scene, scenario, 0.3, material)` plus `subtype: 'sphere'` and `radius: 0.3` in userData.

### A 3D positional speaker

```ts
const speaker = empty(this.scene, this.root, 'speaker', {
    data: 'speaker',
    audio: 'audio/ambient_loop.mp3',
});
speaker.position.set(40, 5, -10);
```

The audio path is fed to `<audio>` directly. Loops by default; `PositionalAudio.setRefDistance(2)` so attenuation kicks in past ~2 units. Master volume is wired to `world.audioListener.setMasterVolume()` from `SettingsModal`.

## Things to know

- **Empties vs meshes:** spawn / scenario / path / pathNode markers are usually empties (`TransformNode`); physics markers are meshes (the geometry doubles as the collision shape for trimesh; for box, the geometry is just a placeholder and `scaling` is what counts). Speaker is an empty.
- **Scale conventions:** for `physics: box` the marker's `scaling` is read as the box's *half* extents (`physicsBoxFor` halves a visual mesh's scale for you). For `physics: cylinder`, `scaling.x` = radius, `scaling.y` = height. For `spawn: shape` the marker carries the *full* visual size (ShapeEntity halves it).
- **userData in code:** always go through `Utils.setUserData(node, {...})` / `Utils.userData(node)` (they live on `node.metadata.userData`); for materials use `Utils.materialUserData(material)`.
- **Rotations in code:** markers built in code use `node.rotation` (Euler, radians); the colliders convert it into the `rotationQuaternion` the body needs. Don't mix the two on one node.
- **`spawn_always` + `invisible`:** scenarios with both flags load on every map open and don't appear in the Scenarios picker - useful for "ambient vehicles" (e.g. the air-vehicles scenario in the Inthenew map).
- **`first_node`:** any AI driver or path-following NPC reads this; it's the *name* of the first `pathNode` node in any path.
- **Race detection:** the curve-based race system fires only if `desc_title` matches `RACE_TITLES` *and* the scenario contains an AI vehicle spawn with a `first_node`. Without the AI spawn there's no curve to fit.
- **Layer0_001 quirk:** Inthenew's Adobe-Illustrator export named the moon-surface mesh this way. We hard-code recognition in `world/loading/SceneLoader.ts` to apply the moon texture. If you make a fresh map, name your moon mesh whatever - but if you keep Inthenew's, leave the name alone.
