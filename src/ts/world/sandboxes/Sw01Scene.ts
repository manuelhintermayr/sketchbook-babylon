import * as THREE from 'three';

import { BaseScene } from './BaseScene';
import { applySignMaterials, loadSignFbx } from './creditsSign';

// Faithful 1:1 port of swift502 v0.1.0 (October 2018) demo scene -
// see `docs/js/index.js` in the upstream tag. The reference scene is:
//
//   Ground            (0, -1, 0)   half-extents (5,  1, 5)    static
//   Heavy crate slab  (-4, 1, 0)   half-extents (1, 0.5, 4)   mass 10
//   Heavy crate pillar (4, 2, 3)   half-extents (1, 2,   1)   mass 10
//   Plank             (0, 5, 3)    half-extents (4, 0.02, 0.3) mass 5  - drops at start
//   Plank             (-1, 3, -3)  half-extents (3, 0.02, 0.3) mass 5  - drops at start
//   Credits sign      (-0.5, 0, 4.5) rotY=π/2  - sign.fbx
//   Credits sign     scale 1.7× clone at +X 1   - sign.fbx (different credits texture)
//
// Characters: player + bob (FollowCharacter) + john (Random),
// all spawning at (0, 0, 0). The original used `game_man.fbx` for
// the model; we keep the engine's standard boxman so the rest of
// the controller / state machine pipeline works unchanged.
//
// Sign is loaded async via FBXLoader, so the scene exposes a
// static createAsync() factory and index.html dispatches through
// the helper for sw-v01.

export class Sw01Scene extends BaseScene
{
	public static async createAsync(): Promise<Sw01Scene>
	{
		const sign = await loadSignFbx();
		return new Sw01Scene(sign);
	}

	constructor(signFbx: THREE.Group)
	{
		super();

		// Permanent map (ground + signs) lives directly on the scene -
		// they're static and don't reset across scenario restarts.
		// Dynamic objects (crates, planks) and character spawns go
		// inside the scenario container so a Shift+R re-launch resets
		// them, matching the v0.1 demo's "reload the page to reset"
		// behaviour.
		const scenario = new THREE.Object3D();
		scenario.userData = {
			name: 'swift502 v0.1 demo',
			data: 'scenario',
			default: 'true',
			desc_title: 'swift502 v0.1',
			desc_content: 'October 2018 - the original demo. Two heavy crates to shove, two planks dropping at start, two credit signs, and Bob + John following + wandering.',
			camera_angle: 0,
		};

		// 10x2x10 ground centered at (0, -1, 0) - top surface at y=0.
		addStaticBox(this.scene, 0, -1, 0, 10, 2, 10, 0xcccccc);

		// Two heavy crates the player can shove around (mass 10).
		addDynamicBox(scenario, -4, 1, 0, 2, 1, 8, 10, 0xcccccc);
		addDynamicBox(scenario,  4, 2, 3, 2, 4, 2, 10, 0xcccccc);

		// Two thin planks falling from above (mass 5). Drop on launch.
		addDynamicBox(scenario,  0, 5,  3, 8, 0.04, 0.6, 5, 0xcccccc);
		addDynamicBox(scenario, -1, 3, -3, 6, 0.04, 0.6, 5, 0xcccccc);

		// Two credits signs. The original FBX has 4 sub-meshes (sign,
		// grass, sign_shadow, credits) - each gets its own textured
		// Lambert material the way docs/js/index.js wired them up. The
		// first sits at (-0.5, 0, 4.5) rotated 90° around Y; the 1.7x
		// clone uses a different `credits` texture (the larger
		// "credits.png" vs "credits2.png"), nudges its sign + credits
		// sub-meshes back along local Z, and lands next to the first
		// sign at (0.5, 0, 4.5) after a translateZ(1) in its own
		// rotated frame (local Z = world +X under rotY=π/2).
		applySignMaterials(signFbx, false);
		signFbx.translateZ(4.5);
		signFbx.translateX(-0.5);
		signFbx.rotateY(Math.PI / 2);
		this.scene.add(signFbx);
		// Static collider behind the small sign panel (matches
		// upstream half-extents 0.3 × 0.45 × 0.1).
		addStaticCollider(this.scene,
			signFbx.position.x, signFbx.position.y + 0.45, signFbx.position.z,
			0.6, 0.9, 0.2);

		const signClone = signFbx.clone();
		signClone.scale.multiplyScalar(1.7);
		applySignMaterials(signClone, true);
		signClone.translateZ(1); // local Z under rotY=π/2 → world +X
		this.scene.add(signClone);
		addStaticCollider(this.scene,
			signClone.position.x, signClone.position.y + 0.58, signClone.position.z,
			0.8, 1.16, 0.32);

		// Player + Bob (FollowCharacter) + John (Random) - all at
		// (0, 0, 0) like `world.SpawnCharacter()` with default position
		// in v0.1. Physics resolves the overlap into something visible
		// within the first frames.
		const playerSpawn = new THREE.Object3D();
		playerSpawn.position.set(0, 0, 0);
		playerSpawn.userData = { data: 'spawn', type: 'player', name: 'user' };
		scenario.add(playerSpawn);

		const bob = new THREE.Object3D();
		bob.position.set(0, 0, 0);
		bob.userData = { data: 'spawn', type: 'character_ai', name: 'Bob', behaviour: 'follow' };
		scenario.add(bob);

		const john = new THREE.Object3D();
		john.position.set(0, 0, 0);
		john.userData = { data: 'spawn', type: 'character_ai', name: 'John', behaviour: 'random' };
		scenario.add(john);

		this.scene.add(scenario);
	}
}

// Static visual + physics box at (x,y,z) of full size (w,h,d). The
// physics marker uses half-extents in its scale (BoxCollider treats
// scale.x as cannon's half-extent directly - SceneLoader convention),
// while the visual mesh uses the full size as scale on a unit
// BoxGeometry. Mismatching the two would either collide against an
// invisible larger volume (player floats above the visible ground) or
// fall through one smaller than visible.
function addStaticBox(
	target: THREE.Object3D,
	x: number, y: number, z: number,
	w: number, h: number, d: number,
	color: number,
): void
{
	const vis = new THREE.Mesh(
		new THREE.BoxGeometry(),
		new THREE.MeshLambertMaterial({ color }),
	);
	vis.scale.set(w, h, d);
	vis.position.set(x, y, z);
	vis.castShadow = true;
	vis.receiveShadow = true;
	target.add(vis);

	const phy = new THREE.Mesh(new THREE.BoxGeometry());
	phy.scale.set(w / 2, h / 2, d / 2);
	phy.position.set(x, y, z);
	phy.userData = { data: 'physics', type: 'box' };
	target.add(phy);
}

// Dynamic box that ShapeSpawnPoint will turn into a CANNON-driven
// entity at scenario launch. The marker mesh's scale is the FULL
// visual size (ShapeEntity halves it internally to feed cannon's
// half-extent constructor). visible=false here keeps the marker
// from rendering alongside the ShapeEntity clone, which adds itself
// at visible=true.
function addDynamicBox(
	target: THREE.Object3D,
	x: number, y: number, z: number,
	w: number, h: number, d: number,
	mass: number,
	color: number,
): void
{
	const spawn = new THREE.Mesh(
		new THREE.BoxGeometry(),
		new THREE.MeshLambertMaterial({ color }),
	);
	spawn.scale.set(w, h, d);
	spawn.position.set(x, y, z);
	spawn.castShadow = true;
	spawn.receiveShadow = true;
	spawn.visible = false;
	spawn.userData = {
		data: 'spawn',
		type: 'shape',
		subtype: 'box',
		mass: String(mass),
	};
	target.add(spawn);
}

// Just the collision body, no visual - for the invisible static box
// the v0.1 demo planted behind each credits sign. Half-extent
// convention same as addStaticBox.
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

