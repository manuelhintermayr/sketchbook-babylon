import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { World } from '../World';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { mulberry32 } from '../../core/FunctionLibrary';

import { Animal, AnimalKind } from './AnimalBehavior';
import { DOG_BEHAVIOR } from './DogBehavior';
import { CAT_BEHAVIOR } from './CatBehavior';
import { CAT_SCHEMES, DOG_SCHEMES } from './AnimalModels';
import { buildCatModel } from './CatBuilder';
import { buildDogModel } from './DogBuilder';

// Spawn placement + ground-query helpers for WanderingAnimals.
// Lifted out of the manager so the manager itself stays focused on
// per-frame AI / physics integration / voice routing. The spawn
// pipeline is one cohesive concern (random angle + radius -> ground
// raycast -> model build -> cannon body -> Animal record), and a
// trimesh ground raycast is shared between spawn placement and the
// off-map detection in WanderingAnimals.update.

const DOG_COUNT = 1;
const CAT_COUNT = 2;
const SPAWN_INNER = 18;   // keep clear of the spawn pad
const SPAWN_OUTER = 80;   // Inthenew map's playable area is ~200 wide

// Off-map detection re-samples the trimesh every 100ms per animal. Y
// is no longer lerped (cannon owns position now); the raycast only
// catches animals that have walked off the terrain so they can be
// redirected home.
export const GROUND_QUERY_INTERVAL_S = 0.1;

// Cat-game models are authored at "real" scale (cat ≈ 2 units long,
// dog ≈ 2.3 units long). Sketchbook needs them lawn-mower sized so
// the lawn isn't dwarfed - shrink the whole top group uniformly. Per-
// animal `scale` (set in place()) multiplies on top for population
// variation.
const CAT_BASE_SCALE = 0.225;
const DOG_BASE_SCALE = 0.275;

// Cannon body radius per kind. Sphere collider sized to the visible
// model footprint - cats slimmer, dogs stockier.
const CAT_BODY_RADIUS = 0.28;
const DOG_BODY_RADIUS = 0.38;
// Body mass - light enough that the player capsule (mass 1) shoves
// them out of the way, heavy enough that animal-vs-animal nudges
// read as actual contact.
const ANIMAL_MASS = 0.25;
// Light linear damping kills residual sideways drift from collision
// response without controlling speed (the AI writes body.velocity
// directly each frame).
const ANIMAL_DAMPING = 0.1;

const _rayStart = new CANNON.Vec3();
const _rayEnd = new CANNON.Vec3();
const _rayResult = new CANNON.RaycastResult();

// Cast a ray straight down from y=100 into the cannon physics world.
// The trimesh ground is on Default group so the default mask catches
// it. Returns null if no hit, which signals the caller to bail out
// (animal probably wandered off the map).
export function queryGroundHeight(world: World, x: number, z: number): number | null
{
	_rayStart.set(x, 100, z);
	_rayEnd.set(x, -10, z);
	_rayResult.reset();
	const hit = world.physicsWorld.raycastClosest(
		_rayStart, _rayEnd,
		{ collisionFilterMask: CollisionGroups.Default, skipBackfaces: true },
		_rayResult,
	);
	return hit ? _rayResult.hitPointWorld.y : null;
}

// Build all wandering animals for the current map. Returns the array
// the manager pushes into its own state; the manager owns lifecycle
// (graphicsWorld.add / collide listener / label anchors / removal).
export function spawnAnimals(world: World): Animal[]
{
	const rng = mulberry32(456);
	const animals: Animal[] = [];

	const place = (kind: AnimalKind, count: number): void =>
	{
		let placed = 0;
		let attempts = 0;
		while (placed < count && attempts < count * 50)
		{
			attempts++;
			const angle = rng() * Math.PI * 2;
			const spawnRadius = SPAWN_INNER + rng() * (SPAWN_OUTER - SPAWN_INNER);
			const x = Math.cos(angle) * spawnRadius;
			const z = Math.sin(angle) * spawnRadius;

			const y = queryGroundHeight(world, x, z);
			if (y === null || y < 1) continue;

			// Per-population variation on top of the species base scale
			// so dogs and cats look like a real population.
			const scale = kind === 'dog' ? 0.85 + rng() * 0.3 : 0.7 + rng() * 0.35;
			const pos = new THREE.Vector3(x, y, z);

			const labelAnchor = new THREE.Object3D();
			labelAnchor.position.copy(pos);

			const schemes = kind === 'dog' ? DOG_SCHEMES : CAT_SCHEMES;
			const scheme = schemes[Math.floor(rng() * schemes.length)];
			const model = kind === 'dog' ? buildDogModel(scheme) : buildCatModel(scheme);
			const baseScale = kind === 'dog' ? DOG_BASE_SCALE : CAT_BASE_SCALE;
			model.group.scale.setScalar(baseScale * scale);
			model.group.position.copy(pos);

			// Sphere body, sized to the visible footprint. Spawn it half
			// a body-radius above the terrain so it doesn't start
			// interpenetrating and shoot upward on the first physics step.
			const radius = kind === 'dog' ? DOG_BODY_RADIUS : CAT_BODY_RADIUS;
			const body = new CANNON.Body({
				mass: ANIMAL_MASS,
				shape: new CANNON.Sphere(radius),
				position: new CANNON.Vec3(x, y + radius + 0.05, z),
				collisionFilterGroup: CollisionGroups.Animals,
				// Collide with terrain (Default + TrimeshColliders), the
				// player capsule (Characters), and other animal bodies.
				collisionFilterMask: CollisionGroups.Default | CollisionGroups.Characters
					| CollisionGroups.TrimeshColliders | CollisionGroups.Animals,
				linearDamping: ANIMAL_DAMPING,
				fixedRotation: true,  // sphere shouldn't roll about
			});
			body.allowSleep = false;

			animals.push(
			{
				kind,
				position: pos.clone(),
				velocity: new THREE.Vector3(),
				heading: rng() * Math.PI * 2,
				state: 'idle',
				stateTimer: rng() * 5,
				target: pos.clone(),
				animPhase: rng() * Math.PI * 2,
				scale,
				interactionCount: 0,
				homePosition: pos.clone(),
				labelAnchor,
				// Stagger first raycast across the interval so all 18
				// animals don't sample on the same frame and tank it.
				groundQueryTimer: rng() * GROUND_QUERY_INTERVAL_S,
				behavior: kind === 'dog' ? DOG_BEHAVIOR : CAT_BEHAVIOR,
				model,
				pendingVoice: null,
				voiceTimer: 0,
				body,
				airborne: false,
				bodyRadius: radius,
				collideListener: undefined,
			});
			placed++;
		}
	};

	place('dog', DOG_COUNT);
	place('cat', CAT_COUNT);
	return animals;
}
