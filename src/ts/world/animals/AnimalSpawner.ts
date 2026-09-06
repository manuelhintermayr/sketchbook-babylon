import { PhysicsRaycastResult, TransformNode, Vector3 } from '@babylonjs/core';
import type { IRaycastQuery } from '@babylonjs/core';

import { World } from '../World';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { mulberry32 } from '../../core/FunctionLibrary';
import { SphereCollider } from '../../physics/colliders/SphereCollider';

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
// raycast -> model build -> physics body -> Animal record), and a
// trimesh ground raycast is shared between spawn placement and the
// off-map detection in WanderingAnimals.update.

const DOG_COUNT = 1;
const CAT_COUNT = 2;
const SPAWN_INNER = 18;   // keep clear of the spawn pad
const SPAWN_OUTER = 80;   // Inthenew map's playable area is ~200 wide

// Off-map detection re-samples the trimesh every 100ms per animal. Y
// is no longer lerped (Havok owns position now); the raycast only
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

// Body radius per kind. Sphere collider sized to the visible model
// footprint - cats slimmer, dogs stockier.
const CAT_BODY_RADIUS = 0.28;
const DOG_BODY_RADIUS = 0.38;
// Body mass - light enough that the player capsule (mass 1) shoves
// them out of the way, heavy enough that animal-vs-animal nudges
// read as actual contact.
const ANIMAL_MASS = 0.25;
// Light linear damping kills residual sideways drift from collision
// response without controlling speed (the AI writes the body velocity
// directly each frame).
const ANIMAL_DAMPING = 0.1;

const _rayStart = new Vector3();
const _rayEnd = new Vector3();
const _rayResult = new PhysicsRaycastResult();
// The trimesh ground is on the Default group; the ray only wants that
// (characters / animals / vehicles would shadow the terrain sample).
const _groundQuery: IRaycastQuery = { collideWith: CollisionGroups.Default };

// Cast a ray straight down from y=100 into the physics world. Returns
// null if no hit, which signals the caller to bail out (animal
// probably wandered off the map).
export function queryGroundHeight(world: World, x: number, z: number): number | null
{
	_rayStart.set(x, 100, z);
	_rayEnd.set(x, -10, z);
	_rayResult.reset();
	const hit = world.physicsWorld.raycastClosest(_rayStart, _rayEnd, _groundQuery, _rayResult);
	return hit ? _rayResult.hitPointWorld.y : null;
}

// Build all wandering animals for the current map. Returns the array
// the manager pushes into its own state; the manager owns lifecycle
// (scene attach / collision observer / label anchors / removal).
export function spawnAnimals(world: World): Animal[]
{
	const rng = mulberry32(456);
	const animals: Animal[] = [];
	const scene = world.scene;

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
			const pos = new Vector3(x, y, z);

			const labelAnchor = new TransformNode(kind + 'Label', scene);
			labelAnchor.position.copyFrom(pos);

			const schemes = kind === 'dog' ? DOG_SCHEMES : CAT_SCHEMES;
			const scheme = schemes[Math.floor(rng() * schemes.length)];
			const model = kind === 'dog' ? buildDogModel(scene, scheme) : buildCatModel(scene, scheme);
			const baseScale = kind === 'dog' ? DOG_BASE_SCALE : CAT_BASE_SCALE;
			model.group.scaling.setAll(baseScale * scale);
			model.group.position.copyFrom(pos);

			// Sphere body, sized to the visible footprint. Spawn it half
			// a body-radius above the terrain so it doesn't start
			// interpenetrating and shoot upward on the first physics step.
			const radius = kind === 'dog' ? DOG_BODY_RADIUS : CAT_BODY_RADIUS;
			const collider = new SphereCollider(scene, {
				mass: ANIMAL_MASS,
				radius,
				position: new Vector3(x, y + radius + 0.05, z),
				collisionFilterGroup: CollisionGroups.Animals,
				// Collide with terrain (Default + TrimeshColliders), the
				// player capsule (Characters), and other animal bodies.
				collisionFilterMask: CollisionGroups.Default | CollisionGroups.Characters
					| CollisionGroups.TrimeshColliders | CollisionGroups.Animals,
				allowSleep: false,
			});
			collider.body.setLinearDamping(ANIMAL_DAMPING);
			// Zero inertia = infinite inertia: the sphere shouldn't roll
			// about (cannon's fixedRotation).
			collider.body.setMassProperties({ mass: ANIMAL_MASS, inertia: Vector3.Zero() });

			animals.push(
				{
					kind,
					position: pos.clone(),
					velocity: new Vector3(),
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
					collider,
					body: collider.body,
					airborne: false,
					bodyRadius: radius,
					collideObserver: null,
				});
			placed++;
		}
	};

	place('dog', DOG_COUNT);
	place('cat', CAT_COUNT);
	return animals;
}
