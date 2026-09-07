import { Mesh, MeshBuilder, PhysicsMotionType, PhysicsPrestepType, Scene, StandardMaterial, TransformNode, Vector3 } from '@babylonjs/core';

import { World } from '../World';
import { IWorldEntity } from '../../interfaces/IWorldEntity';
import { EntityType } from '../../enums/EntityType';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { mulberry32 } from '../../core/FunctionLibrary';
import { BirdSound } from '../audio/BirdSound';
import { SphereCollider } from '../../physics/colliders/SphereCollider';
import * as Utils from '../../core/FunctionLibrary';

// Flying birds as positional audio entities. Replaces the old global
// bird-chirp synth in AmbientSound: each bird now owns a small visual
// group + its own PositionalAudio so the player hears chirps from the
// direction the bird actually flies, falling off naturally with
// distance.
//
// Pattern adapted from the low-poly-cat-game HTML demo's birds
// section: each bird orbits a fixed centre on a circular path, flaps
// its wings on a sin-cycle, and bobs up/down. No state machine -
// birds just fly forever.

const BIRD_COUNT = 2;
const BIRD_PALETTE: Array<[number, number]> =
[
	[0x4477aa, 0x335588],
	[0xaa4444, 0x882222],
	[0xddaa44, 0xbb8822],
	[0x44aa66, 0x228844],
	[0xaa66bb, 0x884488],
];

// The cat-game models a 1-unit cat; sketchbook's character is ~1.8 m,
// so a raw bird (50 cm body) reads as a barely-visible speck from any
// distance. Scaling up by 2 puts them around seagull/pigeon size at
// player scale and they're spotable as silhouettes against the sky.
const BIRD_SCALE = 2.0;

// Spread the orbit centres across this square (×/z) around the origin.
// Inthenew's spawn area is roughly ±100; ±30 keeps birds visible from
// the spawn pad without crowding it.
const ORBIT_AREA = 60;
const ORBIT_RADIUS_MIN = 9;
const ORBIT_RADIUS_RANGE = 14;
const FLIGHT_HEIGHT_MIN = 5;
const FLIGHT_HEIGHT_RANGE = 9;
const FLAP_SPEED_MIN = 14;
const FLAP_SPEED_RANGE = 12;
const ORBIT_SPEED_MIN = 0.25;
const ORBIT_SPEED_RANGE = 0.4;

// Body radius - sphere sized to roughly the bird's silhouette at
// BIRD_SCALE. Animated (kinematic), not dynamic: gravity would pull
// the flock straight to the ground, so motion is driven by our orbit
// math each frame and Havok's job is just collision presence.
const BIRD_BODY_RADIUS = 0.4;

// Beyond this distance from the camera the bird is too small / too
// far away to read fine animation - we still keep the group's world
// position in sync (so PositionalAudio chirps come from the right
// direction) but skip the wing flap, banking roll, and body sync since
// none of them affect anything the player can perceive. Threshold
// sits past the chirp MAX_DISTANCE (60 m) with a small margin so the
// cull only kicks in once the bird is fully inaudible and visually a
// 1-pixel speck.
const FAR_CULL_DISTANCE_SQ = 80 * 80;

interface Bird
{
	group: TransformNode;
	leftWing: TransformNode;
	rightWing: TransformNode;
	sound: BirdSound;
	collider: SphereCollider;
	cx: number;
	cz: number;
	radius: number;
	height: number;
	speed: number;
	phase: number;
	flapSpeed: number;
	direction: number;
}

function mat(scene: Scene, color: number): StandardMaterial
{
	const material = new StandardMaterial('bird', scene);
	material.diffuseColor = Utils.linearColorFromHex(color);
	material.specularColor.set(0.05, 0.05, 0.05);
	return material;
}

interface BirdMesh
{
	group: TransformNode;
	leftWing: TransformNode;
	rightWing: TransformNode;
}

function part(mesh: Mesh, parent: TransformNode, material: StandardMaterial): Mesh
{
	mesh.material = material;
	mesh.parent = parent;
	mesh.isPickable = false;
	mesh.receiveShadows = true;
	return mesh;
}

function buildBirdMesh(scene: Scene, scheme: [number, number]): BirdMesh
{
	const group = new TransformNode('bird', scene);
	const [bodyColor, wingColor] = scheme;
	const bodyMat = mat(scene, bodyColor);
	const wingMat = mat(scene, wingColor);
	const beakMat = mat(scene, 0xffaa44);
	const eyeMat = mat(scene, 0x111111);

	part(MeshBuilder.CreateBox('body', { width: 0.18, height: 0.18, depth: 0.5 }, scene), group, bodyMat);

	const head = part(MeshBuilder.CreateBox('head', { size: 0.16 }, scene), group, bodyMat);
	head.position.z = 0.3;

	const beak = part(MeshBuilder.CreateCylinder('beak', { diameterTop: 0, diameterBottom: 0.08, height: 0.13, tessellation: 4 }, scene), group, beakMat);
	beak.position.z = 0.45;
	beak.rotation.x = Math.PI / 2;

	for (const x of [-0.07, 0.07])
	{
		const eye = part(MeshBuilder.CreateSphere('eye', { diameter: 0.05, segments: 3 }, scene), group, eyeMat);
		eye.position.set(x, 0.03, 0.34);
	}

	// Wings are pivoted nodes so the mesh hangs out to the side and
	// rotation.z gives a flap from the shoulder rather than the centre.
	const leftWing = new TransformNode('leftWing', scene);
	leftWing.parent = group;
	leftWing.position.set(-0.09, 0.05, 0);
	const lwMesh = part(MeshBuilder.CreateBox('wing', { width: 0.42, height: 0.025, depth: 0.24 }, scene), leftWing, wingMat);
	lwMesh.position.x = -0.21;

	const rightWing = new TransformNode('rightWing', scene);
	rightWing.parent = group;
	rightWing.position.set(0.09, 0.05, 0);
	const rwMesh = part(MeshBuilder.CreateBox('wing', { width: 0.42, height: 0.025, depth: 0.24 }, scene), rightWing, wingMat);
	rwMesh.position.x = 0.21;

	const tail = part(MeshBuilder.CreateBox('tail', { width: 0.18, height: 0.04, depth: 0.18 }, scene), group, wingMat);
	tail.position.z = -0.3;

	return { group, leftWing, rightWing };
}

export class Birds implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.World;
	public entityType: EntityType = EntityType.Decoration;

	private world: World | null = null;
	private birds: Bird[] = [];
	private animTime: number = 0;
	// Captured ONCE on first update, then never re-read. Anchors the
	// flight altitude band to the player's spawn elevation so the
	// values still read as "fixed min/max" but adapt to maps where
	// the spawn pad sits at y=10 (Inthenew helipad) instead of y=0.
	// null until the first frame fires.
	private spawnAnchorY: number | null = null;

	public addToWorld(world: World): void
	{
		this.world = world;

		const rng = mulberry32(789);
		for (let i = 0; i < BIRD_COUNT; i++)
		{
			const scheme = BIRD_PALETTE[Math.floor(rng() * BIRD_PALETTE.length)];
			const meshes = buildBirdMesh(world.scene, scheme);
			meshes.group.scaling.setAll(BIRD_SCALE);
			world.addNode(meshes.group);
			world.sky.registerShadowCaster(meshes.group);

			// Animated body: same collision group + mask as the wandering
			// animals so a bird that dives close to the player gets pushed
			// out of the way rather than clipping through. Position is
			// fully driven by our orbit math each frame; the TELEPORT
			// prestep moves the body without a velocity (like cannon's
			// kinematic position writes did), so a bird sweeping through
			// the player nudges instead of launching them. Havok never
			// integrates forces on the bird itself.
			const collider = new SphereCollider(world.scene, {
				radius: BIRD_BODY_RADIUS,
				position: new Vector3(0, FLIGHT_HEIGHT_MIN, 0),
				collisionFilterGroup: CollisionGroups.Animals,
				collisionFilterMask: CollisionGroups.Default | CollisionGroups.Characters
					| CollisionGroups.TrimeshColliders | CollisionGroups.Animals,
			});
			collider.body.setMotionType(PhysicsMotionType.ANIMATED);
			collider.body.setPrestepType(PhysicsPrestepType.TELEPORT);

			this.birds.push(
				{
					group: meshes.group,
					leftWing: meshes.leftWing,
					rightWing: meshes.rightWing,
					sound: new BirdSound(meshes.group, world),
					collider,
					cx: (rng() - 0.5) * ORBIT_AREA,
					cz: (rng() - 0.5) * ORBIT_AREA,
					radius: ORBIT_RADIUS_MIN + rng() * ORBIT_RADIUS_RANGE,
					height: FLIGHT_HEIGHT_MIN + rng() * FLIGHT_HEIGHT_RANGE,
					speed: ORBIT_SPEED_MIN + rng() * ORBIT_SPEED_RANGE,
					phase: rng() * Math.PI * 2,
					flapSpeed: FLAP_SPEED_MIN + rng() * FLAP_SPEED_RANGE,
					direction: rng() > 0.5 ? 1 : -1,
				});
		}
	}

	public removeFromWorld(world: World): void
	{
		for (const bird of this.birds)
		{
			world.sky.unregisterShadowCaster(bird.group);
			bird.sound.dispose();
			world.removeNode(bird.group);
			bird.collider.dispose();
		}
		this.birds.length = 0;
		this.world = null;
	}

	public update(_timeStep: number, unscaledTimeStep: number): void
	{
		if (this.world === null) return;
		const dt = Math.min(unscaledTimeStep, 0.05);
		this.animTime += dt;

		// X/Z stay player-relative so the flock doesn't wander to the
		// other side of the map; height is anchored to the player's
		// spawn elevation captured on first frame, then never updated -
		// "fixed values" relative to wherever the player started, not
		// fixed absolute world Y (which would put birds underground on
		// elevated maps like Inthenew's helipad).
		const player = this.world.characters.find((c) => c.isPlayer);
		const playerX = player !== undefined ? player.position.x : 0;
		const playerZ = player !== undefined ? player.position.z : 0;

		if (this.spawnAnchorY === null && player !== undefined)
		{
			this.spawnAnchorY = player.position.y;
		}
		const anchorY = this.spawnAnchorY ?? 0;

		const camPos = this.world.camera.position;

		for (const bird of this.birds)
		{
			// Orbit on the (cx, cz) circle around the player. direction
			// flips the angular velocity sign so half the birds fly
			// clockwise. height bobs gently with a slow secondary sin
			// inside the fixed world-Y altitude band.
			const a = this.animTime * bird.speed * bird.direction + bird.phase;
			const x = playerX + bird.cx + Math.cos(a) * bird.radius;
			const z = playerZ + bird.cz + Math.sin(a) * bird.radius;
			const y = anchorY + bird.height + Math.sin(this.animTime * 0.4 + bird.phase) * 0.6;

			// Group position is always updated so the bird's
			// PositionalAudio chirp keeps coming from the bird's actual
			// flight position even after the visual cull kicks in.
			bird.group.position.set(x, y, z);

			const dx = x - camPos.x;
			const dy = y - camPos.y;
			const dz = z - camPos.z;
			const distSq = dx * dx + dy * dy + dz * dz;

			if (distSq < FAR_CULL_DISTANCE_SQ)
			{
				// Tangent of the orbit gives the heading; bank a tiny
				// constant roll into the turn so the silhouette reads as
				// flying, not sliding sideways.
				const tx = -Math.sin(a) * bird.direction;
				const tz = Math.cos(a) * bird.direction;
				bird.group.rotation.y = Math.atan2(tx, tz);
				bird.group.rotation.z = bird.direction * 0.18;

				const flap = Math.sin(this.animTime * bird.flapSpeed) * 0.85;
				bird.leftWing.rotation.z = flap;
				bird.rightWing.rotation.z = -flap;

				// Animated body follows the visual exactly. Havok will
				// resolve any contact (player capsule, ground animals)
				// by pushing the other body away - the bird itself is
				// unmoved because it's animated. Only kept in sync
				// while in range; far birds can't collide with anything
				// the player cares about.
				bird.collider.node.position.set(x, y, z);
			}

			// Sound scheduler runs regardless: chirps on a 5-12 s timer,
			// trivial cost per frame, and silently no-ops when the
			// PositionalAudio attenuates to zero past MAX_DISTANCE.
			bird.sound.update();
		}
	}
}
