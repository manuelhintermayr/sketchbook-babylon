import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { World } from '../World';
import { IWorldEntity } from '../../interfaces/IWorldEntity';
import { EntityType } from '../../enums/EntityType';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { mulberry32 } from '../../core/FunctionLibrary';

// Ambient butterflies. Pure visual decoration - no audio, no physics
// body (they're too small to read as physical contact, and a kinematic
// sphere on top would just thrash the cannon broadphase). Pattern
// adapted from the low-poly-cat-game butterfly: each butterfly is a
// little 2-wing + body group drifting on a Lissajous-style path with
// a sin-modulated wing flap.
//
// Per-butterfly randomised orbit centre, two amplitudes, drift speed,
// phase and flap rate so the swarm looks like a real ambient flutter
// instead of a synchronised dance.

const BUTTERFLY_COUNT = 2;

// Real butterflies have ~5-10 cm wingspans; the cat-game model is
// 30 cm wide at scale 1. 0.45x lands at ~13 cm wingspan - garden
// butterfly size that doesn't dominate the camera at player scale.
const BUTTERFLY_SCALE = 0.45;

// Kinematic cannon sphere radius. Sized to roughly the visible
// silhouette so debug-physics actually shows them and a butterfly
// brushing the player capsule reads as contact instead of clipping.
const BUTTERFLY_BODY_RADIUS = 0.15;

const BUTTERFLY_PALETTE: number[] =
[
	0xffaa44, // orange
	0xffd84a, // yellow
	0xee5577, // pink
	0x88ccdd, // light blue
	0xddaa66, // tan
	0xffffff, // white
];

// Spawn area + drift amplitude in metres. Centres land within ±6 m of
// the player; the Lissajous motion adds another ±3-8 m on top so a
// butterfly can wander out to ~12 m away before drifting back.
const ORBIT_AREA = 12;
const ORBIT_AMP_MIN = 3;
const ORBIT_AMP_RANGE = 5;
// Y-range above the player's spawn-Y (captured once on first frame
// in spawnAnchorY). 1.0..1.5 m gets butterflies into chest range
// regardless of whether the spawn pad sits at y=0 or y=10.
const HEIGHT_MIN = 1.0;
const HEIGHT_RANGE = 0.5;
// Vertical drift amplitude on top of the static cy. Kept tight so the
// y-band stays in chest range.
const Y_DRIFT_AMP = 0.25;
const DRIFT_SPEED_MIN = 0.2;
const DRIFT_SPEED_RANGE = 0.2;
const FLAP_SPEED_MIN = 20;
const FLAP_SPEED_RANGE = 8;

// Distance cull. Butterflies are tiny and only useful as peripheral
// detail; past 30 m the wing geometry covers less than a pixel and
// is just CSM + post-FX overhead.
const CULL_DISTANCE = 30;
const CULL_DISTANCE_SQ = CULL_DISTANCE * CULL_DISTANCE;

interface Butterfly
{
	group: THREE.Group;
	leftWing: THREE.Mesh;
	rightWing: THREE.Mesh;
	body: CANNON.Body;
	cx: number;
	cz: number;
	cy: number;
	ax: number;
	az: number;
	driftSpeed: number;
	phase: number;
	flapSpeed: number;
}

interface ButterflyMesh
{
	group: THREE.Group;
	leftWing: THREE.Mesh;
	rightWing: THREE.Mesh;
}

function buildButterflyMesh(color: number): ButterflyMesh
{
	const group = new THREE.Group();
	// DoubleSide so the wings don't disappear when the butterfly is
	// banked or viewed edge-on - the geometry is paper-thin and the
	// camera will frequently catch a wing's underside.
	const wingMat = new THREE.MeshStandardMaterial({ color, flatShading: true, side: THREE.DoubleSide });
	const bodyMat = new THREE.MeshStandardMaterial({ color: 0x222222, flatShading: true });

	const leftWing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.25), wingMat);
	leftWing.position.x = -0.15;
	group.add(leftWing);

	const rightWing = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.02, 0.25), wingMat);
	rightWing.position.x = 0.15;
	group.add(rightWing);

	const body = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.2), bodyMat);
	group.add(body);

	return { group, leftWing, rightWing };
}

const _toCam = new THREE.Vector3();

export class Butterflies implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.World;
	public entityType: EntityType = EntityType.Decoration;

	private world: World | null = null;
	private butterflies: Butterfly[] = [];
	private animTime: number = 0;
	// Captured ONCE on first update, then never re-read. Anchors the
	// swarm's altitude band to the player's spawn elevation so the
	// values still read as "fixed min/max" but adapt to maps where
	// the spawn pad sits at y=10 (Inthenew helipad) instead of y=0.
	// null until the first frame fires.
	private spawnAnchorY: number | null = null;

	public addToWorld(world: World): void
	{
		this.world = world;
		const rng = mulberry32(321);

		for (let i = 0; i < BUTTERFLY_COUNT; i++)
		{
			const color = BUTTERFLY_PALETTE[Math.floor(rng() * BUTTERFLY_PALETTE.length)];
			const meshes = buildButterflyMesh(color);
			meshes.group.scale.setScalar(BUTTERFLY_SCALE);
			world.graphicsWorld.add(meshes.group);
			meshes.group.traverse((child) =>
			{
				const m = (child as THREE.Mesh).material;
				if (m && (m as THREE.Material).isMaterial) world.sky.csm.setupMaterial(m as THREE.Material);
			});

			// Kinematic body, same idea as Birds: cannon sees the contact
			// shape but never integrates motion - we drive position from
			// the lissajous each frame.
			const body = new CANNON.Body(
			{
				type: CANNON.Body.KINEMATIC,
				shape: new CANNON.Sphere(BUTTERFLY_BODY_RADIUS),
				position: new CANNON.Vec3(0, HEIGHT_MIN, 0),
				collisionFilterGroup: CollisionGroups.Animals,
				collisionFilterMask: CollisionGroups.Default | CollisionGroups.Characters
					| CollisionGroups.TrimeshColliders | CollisionGroups.Animals,
			});
			body.allowSleep = false;
			world.physicsWorld.addBody(body);

			this.butterflies.push(
			{
				group: meshes.group,
				leftWing: meshes.leftWing,
				rightWing: meshes.rightWing,
				body,
				cx: (rng() - 0.5) * ORBIT_AREA,
				cz: (rng() - 0.5) * ORBIT_AREA,
				cy: HEIGHT_MIN + rng() * HEIGHT_RANGE,
				ax: ORBIT_AMP_MIN + rng() * ORBIT_AMP_RANGE,
				az: ORBIT_AMP_MIN + rng() * ORBIT_AMP_RANGE,
				driftSpeed: DRIFT_SPEED_MIN + rng() * DRIFT_SPEED_RANGE,
				phase: rng() * Math.PI * 2,
				flapSpeed: FLAP_SPEED_MIN + rng() * FLAP_SPEED_RANGE,
			});
		}
	}

	public removeFromWorld(world: World): void
	{
		for (const bf of this.butterflies)
		{
			world.graphicsWorld.remove(bf.group);
			world.physicsWorld.removeBody(bf.body);
		}
		this.butterflies.length = 0;
		this.world = null;
	}

	public update(_timeStep: number, unscaledTimeStep: number): void
	{
		if (this.world === null) return;
		const dt = Math.min(unscaledTimeStep, 0.05);
		this.animTime += dt;

		const camPos = this.world.camera.position;
		const player = this.world.characters.find((c) => c.isPlayer);
		// X/Z stay player-relative so the swarm doesn't wander to the
		// other side of the map; Y is anchored to the player's spawn
		// elevation captured on first frame, then never updated -
		// "fixed values" relative to wherever the player started, not
		// fixed absolute world Y (which would put butterflies under-
		// ground on elevated maps like Inthenew's helipad).
		const playerX = player !== undefined ? player.position.x : 0;
		const playerZ = player !== undefined ? player.position.z : 0;

		if (this.spawnAnchorY === null && player !== undefined)
		{
			this.spawnAnchorY = player.position.y;
		}
		const anchorY = this.spawnAnchorY ?? 0;

		for (const bf of this.butterflies)
		{
			// Lissajous wandering: x/z around the player, y inside the
			// spawn-anchored band. Co-prime frequency multipliers (1,
			// 1.7, 1.9, 2.3) keep the path from looping cleanly.
			const t = this.animTime * bf.driftSpeed + bf.phase;
			const x = playerX + bf.cx + Math.cos(t) * bf.ax + Math.sin(t * 2.3) * 1.2;
			const y = anchorY + bf.cy + Math.sin(t * 1.7) * Y_DRIFT_AMP;
			const z = playerZ + bf.cz + Math.sin(t) * bf.az + Math.cos(t * 1.9) * 1.2;

			// Distance cull first - far-away butterflies skip every
			// per-frame write below (group transform, body position,
			// wing flap), so cannon's broadphase doesn't see them and
			// three's render skips the (already-invisible) geometry.
			_toCam.set(x - camPos.x, y - camPos.y, z - camPos.z);
			const visible = _toCam.lengthSq() < CULL_DISTANCE_SQ;
			if (bf.group.visible !== visible) bf.group.visible = visible;
			if (!visible) continue;

			bf.group.position.set(x, y, z);
			bf.group.rotation.y = t;
			bf.body.position.set(x, y, z);

			// Wings flap by rotating around their own Y axis (paper-thin
			// box geometry, so a Y rotation looks like a flap from any
			// camera angle without needing pivot groups). Mirror sign on
			// the second wing so they swing against each other.
			const flap = Math.sin(this.animTime * bf.flapSpeed) * 0.8;
			bf.leftWing.rotation.y = flap;
			bf.rightWing.rotation.y = -flap;
		}
	}
}
