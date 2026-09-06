import { Scene, StandardMaterial, Texture, TransformNode, Vector3 } from '@babylonjs/core';

import { loadModel } from '../../core/LoadingManager';
import * as Utils from '../../core/FunctionLibrary';
import { BaseScene, empty, staticBoxCollider } from './BaseScene';
import { applySignMaterials, loadSign } from './creditsSign';

// Faithful 1:1 port of swift502 v0.2.0 (`examples/characters.html`).
// The reference scene loads `test_world/scene.glb` (vendored here as
// `world_v02.glb`) and applies node-by-node logic that matches the
// upstream LoadExampleWorld() exactly:
//
//   if userData.mass !== undefined → hidden, no physics
//   else if userData.visible='true'  → lambert material with map
//                                       (userData.map → vendored png),
//                                       shadows on
//   else if userData.visible='false' → hidden
//
//   then independently of visibility (still in the no-mass branch):
//   if userData.physics='convex'  → static collider
//   if userData.physics='trimesh' → static collider
//
// Convex collapses to a TrimeshCollider in our engine - Sketchbook
// current has no convex-hull primitive and the v0.2 GLB only uses
// `convex` for static proxies (every mass-bearing convex node also
// carries `mass='1'` which short-circuits to invisible+no-physics
// before the physics branch fires), so trimesh-vs-capsule narrowphase
// is sufficient.
//
// Two credits signs from the sign model, scaled / placed exactly like
// the upstream LoadExampleWorld() second half: small original at world
// (-3, 0, 10), 1.7x clone at (-2, 0, 10).
//
// Player at (1.13, 3, -2.2) facing world -Z, John (Random) at
// (5, 2, 1), Bob (FollowCharacter) at (-5, 2, 3).

const AO_BAKE_PATH = 'build/assets/ao_bake.png';

export class Sw02Scene extends BaseScene
{
	public static async createAsync(scene: Scene): Promise<Sw02Scene>
	{
		const [world, sign] = await Promise.all([
			loadModel(scene, 'build/assets/world_v02.glb'),
			loadSign(scene),
		]);
		return new Sw02Scene(scene, world.root, sign.root);
	}

	constructor(scene: Scene, loadedRoot: TransformNode, signRoot: TransformNode)
	{
		super(scene);

		// Walk the GLB and apply the per-node rules from v0.2's
		// LoadExampleWorld(). Done in-place: the loader hands us a
		// fresh tree per session.
		const aoBake = loadTexture(scene, AO_BAKE_PATH);
		Utils.traverse(loadedRoot, (node) =>
		{
			const ud = Utils.userData(node);

			// mass-bearing nodes (Icosphere / Cone / Cylinder /
			// Cube_Quad in this GLB) are hidden and given no physics
			// - they were placeholder visuals upstream, never wired
			// to a body. Matches the original `if(mass !== undefined)
			// obj.visible = false;` short-circuit.
			if (ud.mass !== undefined)
			{
				node.setEnabled(false);
				return;
			}

			// visible='true' nodes get a lambert material with a
			// texture map. ud.map is a relative filename ('ao_bake.png');
			// without one, fall back to the GLB's existing material map
			// (every material in the v0.2 GLB has an empty name, so
			// this is mostly a no-op for non-textured nodes).
			if (ud.visible === 'true' && Utils.isRenderableMesh(node))
			{
				let map: Texture | null;
				if (ud.map === 'ao_bake.png') map = aoBake;
				else if (typeof ud.map === 'string') map = loadTexture(scene, 'build/assets/' + ud.map);
				else
				{
					const existing = node.material as any;
					map = existing?.albedoTexture ?? existing?.diffuseTexture ?? null;
				}
				const material = new StandardMaterial('v02', scene);
				material.specularColor.set(0, 0, 0);
				material.diffuseTexture = map;
				node.material = material;
				node.receiveShadows = true;
			}
			else if (ud.visible === 'false')
			{
				node.setEnabled(false);
			}

			// Static colliders (only fires when mass is undefined per
			// the outer check). `convex` and `trimesh` both map to
			// SceneLoader's trimesh handler, which builds a Havok mesh
			// shape from the geometry.
			if (ud.physics === 'convex' || ud.physics === 'trimesh')
			{
				ud.data = 'physics';
				ud.type = 'trimesh';
			}
		});

		loadedRoot.parent = this.root;

		// Two credits signs - same model as v0.1, but placed differently:
		// the upstream LoadExampleWorld() puts the first sign's collider
		// at (-3, 0.45, 10) with the model translated -0.45 along local Y
		// (so the visual sits with its base at world y=0), and the 1.7x
		// clone's collider at (-2, 0.58, 10) with an extra -0.13 local
		// translateY. We mirror that by parking each model inside a
		// wrapper node positioned at the collider's world point.
		applySignMaterials(scene, signRoot, false);
		signRoot.position.y -= 0.45;
		signRoot.rotation.y = Math.PI / 2;
		const wrapper1 = empty(scene, this.root, 'signWrapper1');
		wrapper1.position.set(-3, 0.45, 10);
		signRoot.parent = wrapper1;
		staticBoxCollider(scene, this.root, new Vector3(-3, 0.45, 10), new Vector3(0.6, 0.9, 0.2));

		const sign2 = signRoot.clone('signClone', null, false) as TransformNode;
		sign2.scaling.scaleInPlace(1.7);
		applySignMaterials(scene, sign2, true);
		sign2.position.y -= 0.13;
		const wrapper2 = empty(scene, this.root, 'signWrapper2');
		wrapper2.position.set(-2, 0.58, 10);
		sign2.parent = wrapper2;
		staticBoxCollider(scene, this.root, new Vector3(-2, 0.58, 10), new Vector3(0.8, 1.16, 0.32));

		// Scenario + characters. Original v0.2 had no scenario system;
		// we wrap the dynamic spawns in one so Shift+R re-launches the
		// initial state, which mirrors v0.2's "reload page to reset"
		// behaviour. Static map (GLB + signs) lives on the root so it
		// stays through restarts.
		const scenario = empty(scene, this.root, 'scenario', {
			name: 'swift502 v0.2 demo',
			data: 'scenario',
			default: 'true',
			desc_title: 'swift502 v0.2',
			desc_content: 'October 2019 - the test_world demo. Curved sphere ground with convex/trimesh colliders, two credits signs, and Bob + John following + wandering.',
			camera_angle: 0,
		});

		// Player at the v0.2 hand-picked spawn, rotated 180° around Y
		// so the marker's local +Z (= our forward convention, see
		// FunctionLibrary.getForward) lines up with world -Z, matching
		// the original `setOrientationTarget(new Vector3(0, 0, -1))`.
		const playerSpawn = empty(scene, scenario, 'user', { data: 'spawn', type: 'player', name: 'user' });
		playerSpawn.position.set(1.13, 3, -2.2);
		playerSpawn.rotation.y = Math.PI;

		const john = empty(scene, scenario, 'John', { data: 'spawn', type: 'character_ai', name: 'John', behaviour: 'random' });
		john.position.set(5, 2, 1);

		const bob = empty(scene, scenario, 'Bob', { data: 'spawn', type: 'character_ai', name: 'Bob', behaviour: 'follow' });
		bob.position.set(-5, 2, 3);
	}
}

// glTF UVs start top-left, so the textures load un-flipped.
function loadTexture(scene: Scene, path: string): Texture
{
	return Utils.loadTexture(scene, path, false);
}
