# Map authoring

`loadScene(world, loadingManager, gltf)` (in `src/ts/world/loading/SceneLoader.ts`) walks every node in the loaded scene (either a `.glb` or a procedural `BaseScene` subclass) and dispatches on `userData.data` / `userData.type` / `material.name`. This is the entire surface for adding content without writing TypeScript.

The bundled level (`build/assets/world.glb`) is authored in Blender and exported with userData passed through. The four sandbox scenes (`src/ts/world/sandboxes/Test*.ts`) demonstrate the same conventions in code and are good copy-paste starting points.

## Quick reference

| `userData.data` | `userData.type` | Other userData | Effect |
|---|---|---|---|
| `physics` | `box` | (uses `scale.{x,y,z}`) | Static `BoxCollider` |
| `physics` | `trimesh` | (geometry-driven) | Static `TrimeshCollider` |
| `physics` | `cylinder` | (`scale.x` → radius, `scale.y` → height) | Static `CylinderCollider`, 12 segments |
| `path` | – | `name` | Path container; nested `pathNode` children become a graph |
| `pathNode` | – | `name`, `nextNode`, `previousNode` | Graph node referenced by `data: 'path'` parent |
| `scenario` | – | `name`, `desc_title`, `desc_content`, `default`, `spawn_always`, `invisible`, `camera_angle` | Scenario container; nested spawn children get spawned on launch |
| `spawn` | `player` | – | Player Character at this transform; tagged "Du" |
| `spawn` | `npc` \| `character_ai` \| `character_follow` | `name`, `first_node` | Standing NPC, or path-following if `first_node` set |
| `spawn` | `car` \| `heli` \| `airplane` \| `boat` \| `rocketship` | `driver` (`'player'` / `'ai'`), `first_node` | Vehicle from `build/assets/{type}.glb` |
| `spawn` | `shape` | `subtype` (`'box'`/`'sphere'`), `mass`, `radius` | Dynamic CANNON primitive |
| `speaker` | – | `audio` (URL) | 3D positional audio source (yellow wireframe sphere) |

| `material.name` | Effect |
|---|---|
| `ocean` / `ocean.001` | Ocean wave shader; original mesh becomes invisible carrier, tiled wave grid laid over |
| `grass` | Instanced 300k-blade grass field, 30-unit LOD swap to empty mesh past the threshold |

| Mesh `name` | Effect |
|---|---|
| `Layer0_001` | Moon-surface mesh - gets the `moon-with-flowers.png` texture applied (Inthenew quirk) |

## Examples

### A static physics box

```js
// In a sandbox BaseScene constructor:
const ground = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xcccccc })
);
ground.scale.set(124, 0.2, 124);
this.scene.add(ground);

const groundPhy = new THREE.Mesh(new THREE.BoxGeometry());
groundPhy.scale.copy(ground.scale).divideScalar(2);
groundPhy.position.copy(ground.position);
groundPhy.userData = { data: 'physics', type: 'box' };
this.scene.add(groundPhy);
```

In Blender: add a Cube, set custom property `data: physics` and `type: box`, scale it to taste, export GLB with custom-properties enabled. Sketchbook makes it invisible at load time.

### A scenario with a player spawn

```js
const scenario = new THREE.Object3D();
scenario.userData = {
    name: 'Free roam (default)',
    data: 'scenario',
    default: 'true',                  // launched automatically on map load
    desc_title: 'Default spawn',
    desc_content: 'Explore the world!',
    camera_angle: 0,
};

const player = new THREE.Object3D();
player.position.set(0, 2, 0);
player.userData = { data: 'spawn', type: 'player' };
scenario.add(player);

this.scene.add(scenario);
```

`desc_title` matters - if it's one of the values in the `RACE_TITLES` set inside `Scenario.ts` (`Oval race`, `Tunnel race`, `Figure 8 race`, `Boat Race`), the curve-based race-checkpoint system kicks in.

### An AI-driven car following a path

```js
// 1. Build a Path graph
const path = new THREE.Object3D();
path.name = 'lap_path';
path.userData = { data: 'path', name: 'lap_path' };
['n1', 'n2', 'n3', 'n4'].forEach((n, i, arr) => {
    const node = new THREE.Object3D();
    node.name = n;
    node.position.set(/* … */);
    node.userData = {
        data: 'pathNode',
        name: n,
        previousNode: arr[(i - 1 + arr.length) % arr.length],
        nextNode: arr[(i + 1) % arr.length],
    };
    path.add(node);
});
this.scene.add(path);

// 2. Drop an AI car into a scenario
const aiCar = new THREE.Object3D();
aiCar.position.set(0, 1, 0);
aiCar.userData = {
    data: 'spawn',
    type: 'car',
    driver: 'ai',
    first_node: 'n1',
};
scenario.add(aiCar);
```

### A standing NPC with a dialog

NPC dialog isn't authored in the GLB - `userData.first_node` is the only interesting property on the marker. The dialog tree is wired in code from `world/scenarios/defaultDialogs.ts`; pass it to `NPCSpawnPoint` via the constructor `options` parameter:

```ts
import { NPCSpawnPoint } from './spawn/NPCSpawnPoint';
import { getDefaultDialogs } from './scenarios/defaultDialogs';

const marker = new THREE.Object3D();
marker.position.set(5, 18, -5);
marker.userData.name = 'Anna';
marker.userData.first_node = 'npc_node_1';   // optional - wandering
defaultScenario.rootNode.add(marker);

const { dialog, role } = getDefaultDialogs()['Anna'];
defaultScenario.spawnPoints.push(new NPCSpawnPoint(marker, { dialog, role }));
```

Or just stand silent (no E-prompt appears):

```ts
defaultScenario.spawnPoints.push(new NPCSpawnPoint(marker));
```

### A grass patch

```js
const grass = new THREE.Mesh(
    new THREE.PlaneGeometry(2, 2),
    new THREE.MeshStandardMaterial({ color: 0x000000 })
);
grass.scale.set(5, 5, 5);
grass.position.set(57, 0.11, 57);
grass.rotation.x = -Math.PI / 2;
grass.material.name = 'grass';                 // ← this triggers the Grass class
grass.material.userData = { instances: 50000 };
this.scene.add(grass);
```

`SceneLoader` instantiates `Grass(child, world)`. Default instance count is 300 000; override via `material.userData.instances`.

### A dynamic shape (box) the player can knock around

```js
const box = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial({ color: 0xccffff })
);
box.scale.set(1, 0.4, 1);
box.position.set(15, 2, -15);
box.userData = {
    data: 'spawn',
    type: 'shape',
    subtype: 'box',
    mass: 1,
};
scenario.add(box);
```

For a sphere: `subtype: 'sphere'`, plus `radius: 0.3` in userData.

### A 3D positional speaker

```js
const speaker = new THREE.Object3D();
speaker.position.set(40, 5, -10);
speaker.userData = {
    data: 'speaker',
    audio: 'audio/ambient_loop.mp3',
};
this.scene.add(speaker);
```

The audio path is fed to `<audio>` directly. Loops by default; `THREE.PositionalAudio.setRefDistance(2)` so attenuation kicks in past ~2 units. Master volume is wired to `world.audioListener.setMasterVolume()` from `SettingsModal`.

## Things to know

- **Empties vs meshes:** spawn / scenario / path / pathNode markers are usually empties (THREE.Object3D); physics markers are meshes (the geometry doubles as the collision shape for trimesh; for box, the geometry is just a placeholder and `scale` is what counts). Speaker is an empty.
- **Scale conventions:** for `physics: box` the *full* scale is the AABB extent (Sketchbook divides by 2 internally for half-extents). For `physics: cylinder`, `scale.x` = radius, `scale.y` = height.
- **`spawn_always` + `invisible`:** scenarios with both flags load on every map open and don't appear in the Scenarios picker - useful for "ambient vehicles" (e.g. the air-vehicles scenario in the Inthenew map).
- **`first_node`:** any AI driver or path-following NPC reads this; it's the *name* of the first `pathNode` node in any path.
- **Race detection:** the curve-based race system fires only if `desc_title` matches `RACE_TITLES` *and* the scenario contains an AI vehicle spawn with a `first_node`. Without the AI spawn there's no curve to fit.
- **Layer0_001 quirk:** Inthenew's Adobe-Illustrator export named the moon-surface mesh this way. We hard-code recognition in `world/loading/SceneLoader.ts` to apply the moon texture. If you make a fresh map, name your moon mesh whatever - but if you keep Inthenew's, leave the name alone.
