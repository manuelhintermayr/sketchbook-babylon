import { Node, Scene, TransformNode, Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { BaseScene, empty, lambert, staticBoxCollider, unitBox } from './BaseScene';
import { applySignMaterials, loadSign } from './creditsSign';

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
// The sign is loaded async, so the scene exposes a static
// createAsync() factory and index.html dispatches through it for
// sw-v01.

export class Sw01Scene extends BaseScene
{
	public static async createAsync(scene: Scene): Promise<Sw01Scene>
	{
		const sign = await loadSign(scene);
		return new Sw01Scene(scene, sign.root);
	}

	constructor(scene: Scene, signRoot: TransformNode)
	{
		super(scene);

		// Permanent map (ground + signs) lives directly on the root -
		// they're static and don't reset across scenario restarts.
		// Dynamic objects (crates, planks) and character spawns go
		// inside the scenario container so a Shift+R re-launch resets
		// them, matching the v0.1 demo's "reload the page to reset"
		// behaviour.
		const scenario = empty(scene, this.root, 'scenario', {
			name: 'swift502 v0.1 demo',
			data: 'scenario',
			default: 'true',
			desc_title: 'swift502 v0.1',
			desc_content: 'October 2018 - the original demo. Two heavy crates to shove, two planks dropping at start, two credit signs, and Bob + John following + wandering.',
			camera_angle: 0,
		});

		// 10x2x10 ground centered at (0, -1, 0) - top surface at y=0.
		addStaticBox(scene, this.root, 0, -1, 0, 10, 2, 10, 0xcccccc);

		// Two heavy crates the player can shove around (mass 10).
		addDynamicBox(scene, scenario, -4, 1, 0, 2, 1, 8, 10, 0xcccccc);
		addDynamicBox(scene, scenario,  4, 2, 3, 2, 4, 2, 10, 0xcccccc);

		// Two thin planks falling from above (mass 5). Drop on launch.
		addDynamicBox(scene, scenario,  0, 5,  3, 8, 0.04, 0.6, 5, 0xcccccc);
		addDynamicBox(scene, scenario, -1, 3, -3, 6, 0.04, 0.6, 5, 0xcccccc);

		// Two credits signs. The model has 4 sub-meshes (sign, grass,
		// sign_shadow, credits) - each gets its own textured material
		// the way docs/js/index.js wired them up. The first sits at
		// (-0.5, 0, 4.5) rotated 90° around Y; the 1.7x clone uses a
		// different `credits` texture (the larger "credits.png" vs
		// "credits2.png"), nudges its sign + credits sub-meshes back
		// along local Z, and lands next to the first sign at
		// (0.5, 0, 4.5) - upstream translated it by 1 along its own
		// rotated Z (local Z = world +X under rotY=π/2).
		applySignMaterials(scene, signRoot, false);
		signRoot.parent = this.root;
		signRoot.position.set(-0.5, 0, 4.5);
		signRoot.rotation.y = Math.PI / 2;
		// Static collider behind the small sign panel (matches
		// upstream half-extents 0.3 × 0.45 × 0.1).
		staticBoxCollider(scene, this.root,
			new Vector3(signRoot.position.x, signRoot.position.y + 0.45, signRoot.position.z),
			new Vector3(0.6, 0.9, 0.2));

		const signClone = signRoot.clone('signClone', this.root, false) as TransformNode;
		signClone.scaling.scaleInPlace(1.7);
		applySignMaterials(scene, signClone, true);
		signClone.position.set(0.5, 0, 4.5);
		staticBoxCollider(scene, this.root,
			new Vector3(signClone.position.x, signClone.position.y + 0.58, signClone.position.z),
			new Vector3(0.8, 1.16, 0.32));

		// Player + Bob (FollowCharacter) + John (Random) - all at
		// (0, 0, 0) like `world.SpawnCharacter()` with default position
		// in v0.1. Physics resolves the overlap into something visible
		// within the first frames.
		empty(scene, scenario, 'user', { data: 'spawn', type: 'player', name: 'user' });
		empty(scene, scenario, 'Bob', { data: 'spawn', type: 'character_ai', name: 'Bob', behaviour: 'follow' });
		empty(scene, scenario, 'John', { data: 'spawn', type: 'character_ai', name: 'John', behaviour: 'random' });
	}
}

// Static visual + physics box at (x,y,z) of full size (w,h,d). The
// physics marker uses half-extents in its scale (BoxCollider treats
// the marker scale as half extents - SceneLoader convention), while
// the visual mesh uses the full size as scale on a unit box.
// Mismatching the two would either collide against an invisible
// larger volume (player floats above the visible ground) or fall
// through one smaller than visible.
function addStaticBox(
	scene: Scene,
	target: Node,
	x: number, y: number, z: number,
	w: number, h: number, d: number,
	color: number,
): void
{
	const vis = unitBox(scene, target, lambert(scene, color), 'staticBox');
	vis.scaling.set(w, h, d);
	vis.position.set(x, y, z);

	staticBoxCollider(scene, target, new Vector3(x, y, z), new Vector3(w, h, d));
}

// Dynamic box that ShapeSpawnPoint will turn into a Havok-driven
// entity at scenario launch. The marker mesh's scale is the FULL
// visual size (ShapeEntity halves it internally for the half-extent
// box shape). The marker itself stays hidden so it doesn't render
// alongside the ShapeEntity clone, which shows itself on spawn.
function addDynamicBox(
	scene: Scene,
	target: Node,
	x: number, y: number, z: number,
	w: number, h: number, d: number,
	mass: number,
	color: number,
): void
{
	const spawn = unitBox(scene, target, lambert(scene, color), 'dynamicBox');
	spawn.scaling.set(w, h, d);
	spawn.position.set(x, y, z);
	spawn.isVisible = false;
	Utils.setUserData(spawn, {
		data: 'spawn',
		type: 'shape',
		subtype: 'box',
		mass: String(mass),
	});
}
