import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import { BaseScene } from './BaseScene';
import { applySignMaterials, loadSignFbx } from './creditsSign';

// Faithful 1:1 port of swift502 v0.2.0 (`examples/characters.html`).
// The reference scene loads `test_world/scene.glb` (vendored here as
// `world_v02.glb`) and applies node-by-node logic that matches the
// upstream LoadExampleWorld() exactly:
//
//   if userData.mass !== undefined → visible = false, no physics
//   else if userData.visible='true'  → MeshLambertMaterial with map
//                                       (userData.map → vendored png),
//                                       castShadow + receiveShadow
//   else if userData.visible='false' → visible = false
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
// Two credits signs from sign.fbx, scaled / placed exactly like the
// upstream LoadExampleWorld() second half: small original at world
// (-3, 0, 10), 1.7x clone at (-2, 0, 10).
//
// Player at (1.13, 3, -2.2) facing world -Z, John (Random) at
// (5, 2, 1), Bob (FollowCharacter) at (-5, 2, 3).

const AO_BAKE_PATH = 'build/assets/ao_bake.png';

export class Sw02Scene extends BaseScene
{
	public static async createAsync(): Promise<Sw02Scene>
	{
		const [gltf, sign] = await Promise.all([
			new Promise<THREE.Object3D>((resolve, reject) =>
			{
				new GLTFLoader().load(
					'build/assets/world_v02.glb',
					(g) => resolve(g.scene),
					undefined,
					(err) => reject(err),
				);
			}),
			loadSignFbx(),
		]);
		return new Sw02Scene(gltf, sign);
	}

	constructor(loadedRoot: THREE.Object3D, signFbx: THREE.Group)
	{
		super();

		// Walk the GLB and apply the per-node rules from v0.2's
		// LoadExampleWorld(). Done in-place: the loader hands us a
		// fresh tree per session.
		const aoBake = loadTexture(AO_BAKE_PATH);
		loadedRoot.traverse((node) =>
		{
			const ud = node.userData;
			if (ud === undefined) return;

			// mass-bearing nodes (Icosphere / Cone / Cylinder /
			// Cube_Quad in this GLB) are hidden and given no physics
			// - they were placeholder visuals upstream, never wired
			// to a body. Matches the original `if(mass !== undefined)
			// obj.visible = false;` short-circuit.
			if (ud.mass !== undefined)
			{
				node.visible = false;
				return;
			}

			// visible='true' nodes get a MeshLambertMaterial with a
			// texture map. ud.map is a relative filename ('ao_bake.png');
			// without one, fall back to the GLB's existing material map
			// (every material in the v0.2 GLB has an empty name, so
			// this is mostly a no-op for non-textured nodes).
			const mesh = node as THREE.Mesh;
			if (ud.visible === 'true' && (mesh as any).isMesh)
			{
				let map: THREE.Texture | null = null;
				if (ud.map === 'ao_bake.png') map = aoBake;
				else if (typeof ud.map === 'string') map = loadTexture('build/assets/' + ud.map);
				else
				{
					const existing = (mesh.material as THREE.MeshStandardMaterial | undefined);
					map = existing?.map ?? null;
				}
				mesh.material = new THREE.MeshLambertMaterial({ map });
				mesh.castShadow = true;
				mesh.receiveShadow = true;
			}
			else if (ud.visible === 'false')
			{
				node.visible = false;
			}

			// Static colliders (only fires when mass is undefined per
			// the outer check). `convex` and `trimesh` both map to
			// SceneLoader's trimesh handler, which builds a CANNON
			// Trimesh body from the mesh geometry.
			if (ud.physics === 'convex' || ud.physics === 'trimesh')
			{
				ud.data = 'physics';
				ud.type = 'trimesh';
			}
		});

		this.scene.add(loadedRoot);

		// Two credits signs - same FBX as v0.1, but placed differently:
		// the upstream LoadExampleWorld() puts the first sign's collider
		// at (-3, 0.45, 10) with the FBX translated -0.45 along local Y
		// (so the visual sits with its base at world y=0), and the 1.7x
		// clone's collider at (-2, 0.58, 10) with an extra -0.13 local
		// translateY. We mirror that by parking each FBX inside a
		// wrapper Object3D positioned at the collider's world point.
		applySignMaterials(signFbx, false);
		signFbx.translateY(-0.45);
		signFbx.rotateY(Math.PI / 2);
		const wrapper1 = new THREE.Object3D();
		wrapper1.position.set(-3, 0.45, 10);
		wrapper1.add(signFbx);
		this.scene.add(wrapper1);
		addStaticCollider(this.scene, -3, 0.45, 10, 0.6, 0.9, 0.2);

		const sign2 = signFbx.clone();
		sign2.scale.multiplyScalar(1.7);
		applySignMaterials(sign2, true);
		sign2.translateY(-0.13);
		const wrapper2 = new THREE.Object3D();
		wrapper2.position.set(-2, 0.58, 10);
		wrapper2.add(sign2);
		this.scene.add(wrapper2);
		addStaticCollider(this.scene, -2, 0.58, 10, 0.8, 1.16, 0.32);

		// Scenario + characters. Original v0.2 had no scenario system;
		// we wrap the dynamic spawns in one so Shift+R re-launches the
		// initial state, which mirrors v0.2's "reload page to reset"
		// behaviour. Static map (GLB + signs) lives on the scene root
		// so it stays through restarts.
		const scenario = new THREE.Object3D();
		scenario.userData = {
			name: 'swift502 v0.2 demo',
			data: 'scenario',
			default: 'true',
			desc_title: 'swift502 v0.2',
			desc_content: 'October 2019 - the test_world demo. Curved sphere ground with convex/trimesh colliders, two credits signs, and Bob + John following + wandering.',
			camera_angle: 0,
		};

		// Player at the v0.2 hand-picked spawn, rotated 180° around Y
		// so the marker's local +Z (= our forward convention, see
		// FunctionLibrary.getForward) lines up with world -Z, matching
		// the original `setOrientationTarget(new Vector3(0, 0, -1))`.
		const playerSpawn = new THREE.Object3D();
		playerSpawn.position.set(1.13, 3, -2.2);
		playerSpawn.rotation.y = Math.PI;
		playerSpawn.userData = { data: 'spawn', type: 'player', name: 'user' };
		scenario.add(playerSpawn);

		const john = new THREE.Object3D();
		john.position.set(5, 2, 1);
		john.userData = { data: 'spawn', type: 'character_ai', name: 'John', behaviour: 'random' };
		scenario.add(john);

		const bob = new THREE.Object3D();
		bob.position.set(-5, 2, 3);
		bob.userData = { data: 'spawn', type: 'character_ai', name: 'Bob', behaviour: 'follow' };
		scenario.add(bob);

		this.scene.add(scenario);
	}
}

function loadTexture(path: string): THREE.Texture
{
	const t = new THREE.TextureLoader().load(path);
	t.colorSpace = THREE.SRGBColorSpace;
	return t;
}

// Static physics-only collider, no visual. Sized in full extents
// (matching the visible-mesh convention), halved to half-extents on
// the marker because BoxCollider treats its size as cannon's
// half-extent. See SceneLoader's physics branch.
function addStaticCollider(
	target: THREE.Object3D,
	x: number, y: number, z: number,
	w: number, h: number, d: number,
): void
{
	const phy = new THREE.Mesh(new THREE.BoxGeometry());
	phy.scale.set(w / 2, h / 2, d / 2);
	phy.position.set(x, y, z);
	phy.userData = { data: 'physics', type: 'box' };
	target.add(phy);
}
