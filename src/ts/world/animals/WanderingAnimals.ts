import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { World } from '../World';
import { IWorldEntity } from '../../interfaces/IWorldEntity';
import { EntityType } from '../../enums/EntityType';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { attachNameLabel } from '../ui/NameLabel';
import { t } from '../../i18n';

import { Animal, MEOW_DURATION, TAME_FOLLOW_DIST, TAME_THRESHOLD, targetSpeedFor } from './AnimalBehavior';
import { applyAnimalAnimation } from './AnimalAnimator';
import { spawnAnimals, queryGroundHeight, GROUND_QUERY_INTERVAL_S } from './AnimalSpawner';
import { AnimalVoiceBus } from '../audio/AnimalVoices';

// Voice fade in seconds. 0.45 covers the bark; cat meow runs longer
// (set via MEOW_DURATION on a per-animal basis, see playVoice).
const BARK_VOICE_DURATION = 0.45;

// Wandering dogs and cats around the player spawn. This file is the
// *manager*: it owns the per-animal hierarchical model groups, the
// spawn placement, the cannon dynamic body for each animal, the
// off-map raycasts, and the CSS2D label anchors. All per-animal
// state-machine decisions live in DogBehavior / CatBehavior; the
// visual model lives in CatBuilder / DogBuilder, and the per-limb
// animation lives in AnimalAnimator.
//
// Each animal carries a small DYNAMIC cannon body (sphere) so the
// physics world resolves three things automatically:
//
//   - terrain: body sits on the trimesh, no manual ground-snap math
//   - player: capsule-vs-sphere collision so the boxman can bump a
//     dog out of the way
//   - other animals: sphere-vs-sphere so dogs and cats don't walk
//     through each other
//
// Manager only writes body.velocity.x/z each frame from the AI's
// desired motion; cannon does the rest, including jumps (we kick
// body.velocity.y at the start, gravity pulls it back, the body's
// 'collide' event flips the airborne flag back off on touch-down).
//
// Each animal carries its own Three.Group so the cat-game-style
// animations (idle breath, walk-cycle, run-cycle, jump pose) can drive
// independent per-limb transforms - a single InstancedMesh would only
// give us a uniform matrix per instance.

const _toPlayer = new THREE.Vector3();
const _toTarget = new THREE.Vector3();
const _dir = new THREE.Vector3();

export class WanderingAnimals implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.World;
	public entityType: EntityType = EntityType.Decoration;

	private world: World | null = null;
	private animals: Animal[] = [];
	private voiceBus: AnimalVoiceBus | null = null;

	private static singleton: WanderingAnimals | null = null;
	public static getInstance(): WanderingAnimals | null { return WanderingAnimals.singleton; }
	public getAnimalPositions(): THREE.Vector3[]
	{
		const out: THREE.Vector3[] = [];
		for (const a of this.animals) out.push(a.position);
		return out;
	}

	constructor()
	{
		WanderingAnimals.singleton = this;
	}

	public addToWorld(world: World): void
	{
		this.world = world;
		this.voiceBus = new AnimalVoiceBus(world);

		// Spawn animals only after the trimesh terrain has been added to
		// the physics world (otherwise the height raycasts come back
		// empty and everything spawns at y=0 inside the ocean).
		this.animals = spawnAnimals(world);

		// Each animal owns its own Three.Group + cannon body. Add both
		// to the world here. Models hook into CSM for shadows; bodies
		// get a 'collide' listener so we can flip airborne off the
		// instant they touch terrain (or anything else). Listener is
		// stashed on the animal so removeFromWorld can detach it -
		// otherwise the closure pins the animal in memory across
		// scenario switches.
		for (const animal of this.animals)
		{
			world.graphicsWorld.add(animal.model.group);
			animal.model.group.traverse((child) =>
			{
				const m = (child as THREE.Mesh).material;
				if (m && (m as THREE.Material).isMaterial) world.sky.csm.setupMaterial(m as THREE.Material);
			});
			world.physicsWorld.addBody(animal.body);
			animal.collideListener = () =>
			{
				// First contact after a kick - flip airborne off so the
				// animator drops the jump pose. State machine is left
				// alone unless still in 'jump' (a behaviour transition
				// mid-air may have already changed it).
				if (animal.airborne)
				{
					animal.airborne = false;
					if (animal.state === 'jump')
					{
						animal.state = 'idle';
						animal.stateTimer = 0.5 + Math.random() * 1.5;
					}
				}
			};
			animal.body.addEventListener('collide', animal.collideListener);
		}

		// Attach label anchors + CSS2D tags. WorldLabels distance-culls
		// at 10 units and feature-gates on the unified params.Labels
		// toggle (on by default; same gate as Player + NPC tags).
		for (const animal of this.animals)
		{
			world.graphicsWorld.add(animal.labelAnchor);
			const text = animal.kind === 'dog' ? t('animal.dog') : t('animal.cat');
			const className = animal.kind === 'dog' ? 'name-label animal dog' : 'name-label animal cat';
			attachNameLabel(animal.labelAnchor, text, false, {
				className,
				maxDistance: 10,
				feature: 'Labels',
			});
		}
	}

	public removeFromWorld(world: World): void
	{
		for (let i = 0; i < this.animals.length; i++)
		{
			const animal = this.animals[i];
			world.graphicsWorld.remove(animal.model.group);
			world.graphicsWorld.remove(animal.labelAnchor);
			if (animal.collideListener !== undefined)
			{
				animal.body.removeEventListener('collide', animal.collideListener);
				animal.collideListener = undefined;
			}
			world.physicsWorld.removeBody(animal.body);
			if (animal.kind === 'cat' && this.voiceBus !== null)
			{
				this.voiceBus.stopPurrLoop('cat-' + i);
			}
		}
		this.voiceBus = null;
		this.world = null;
	}

	public update(_timeStep: number, unscaledTimeStep: number): void
	{
		if (this.world === null) return;

		const dt = Math.min(unscaledTimeStep, 0.05);
		const player = this.world.characters.find((c) => c.isPlayer);
		if (player === undefined) return;
		const playerPos = player.position;

		for (const animal of this.animals)
		{
			// Sync graphics-side position from the cannon body. Body
			// is the source of truth for x/y/z now; AI just steers
			// horizontal velocity, cannon handles collision + gravity.
			animal.position.set(
				animal.body.position.x,
				animal.body.position.y,
				animal.body.position.z,
			);

			_toPlayer.subVectors(animal.position, playerPos);
			_toPlayer.y = 0;
			const playerDist = _toPlayer.length();

			animal.stateTimer -= dt;
			animal.behavior.update(animal, playerDist, playerPos);

			// AI -> body velocity. Compute the desired horizontal speed
			// from the state machine + target, then write it on the
			// cannon body. We never touch body.velocity.y unless we're
			// kicking off a jump - that's the only way to keep gravity
			// + collision response consistent.
			//
			// animal.velocity is the AI's *intended* horizontal motion
			// (what the animator should see). body.velocity gets the
			// same value but cannon will modify it through damping +
			// collision response, so reading it back wouldn't match
			// what the animation should portray.
			const targetSpeed = targetSpeedFor(animal.state);
			let desiredVx = 0;
			let desiredVz = 0;
			if (targetSpeed > 0)
			{
				_toTarget.subVectors(animal.target, animal.position);
				_toTarget.y = 0;
				const dist = _toTarget.length();
				if (dist > 0.5)
				{
					_dir.copy(_toTarget).normalize();
					animal.heading = Math.atan2(_dir.x, _dir.z);
					desiredVx = _dir.x * targetSpeed;
					desiredVz = _dir.z * targetSpeed;
				}
			}
			animal.body.velocity.x = desiredVx;
			animal.body.velocity.z = desiredVz;
			animal.velocity.set(desiredVx, 0, desiredVz);

			// Off-map detection - throttled raycast spots animals that
			// have walked off the trimesh edge (ocean rim, ramp gaps)
			// where cannon collision finds nothing to land on. Redirect
			// them home before they fall into oblivion.
			animal.groundQueryTimer -= dt;
			if (animal.groundQueryTimer <= 0)
			{
				animal.groundQueryTimer = GROUND_QUERY_INTERVAL_S;
				const queryY = queryGroundHeight(this.world, animal.position.x, animal.position.z);
				if (queryY === null || queryY < 0.5)
				{
					animal.target.copy(animal.homePosition);
					animal.state = 'wander';
					animal.stateTimer = 3;
				}
			}

			// Keep the label anchor on top of the animal. CSS2DObject
			// uses the world position of its parent, so updating the
			// anchor each frame is what makes the tag follow.
			animal.labelAnchor.position.set(
				animal.position.x,
				animal.position.y + 0.7,
				animal.position.z,
			);

			// Pure time driver - matches the cat-game reference where
			// animTime += dt and the leg-cycle frequency comes solely
			// from cycleSpeed (13 run / 8 walk) inside AnimalModels.
			// Earlier velocity-coupled drivers stacked on top of that
			// and gave 4+ Hz leg flicker at sprint speed.
			animal.animPhase += dt;

			// Voice trigger queue. Behaviours set animal.pendingVoice on
			// state transitions (cat -> meow, dog approach -> bark);
			// here we fire the synth + start the mouth-animation timer.
			// Wrapped in try/catch so a broken AudioContext (autoplay
			// rejection, browser quirk, suspended state) can't crash
			// the for-loop and freeze every other animal's state
			// machine. Mouth animation still plays from voiceTimer.
			if (animal.pendingVoice !== null && this.voiceBus !== null)
			{
				try { this.voiceBus.play(animal.pendingVoice, animal.position); }
				catch (_e) { /* audio failed, animation still runs */ }
				animal.voiceTimer = animal.pendingVoice === 'meow' ? MEOW_DURATION : BARK_VOICE_DURATION;
				animal.pendingVoice = null;
			}
			if (animal.voiceTimer > 0) animal.voiceTimer = Math.max(0, animal.voiceTimer - dt);

			// Drive the visual model: position / rotation / per-frame
			// limb animation against the animal's own transform tree.
			this.applyModel(animal, dt);
		}

		// Purr loops for tame cats sitting near the player. Toggled per
		// animal each frame: start when conditions are met, stop the
		// moment the cat moves away or stops being tame. Multiple
		// nearby tame cats can purr at once - each loop is independent.
		this.updatePurrLoops(playerPos);

		// Per-frame master volume sync - keeps voices following
		// Master_Volume slider changes without having to wire an
		// onChange handler. Wrapped because the voice bus's audio
		// graph might be in a degraded state on some browsers.
		if (this.voiceBus !== null)
		{
			try { this.voiceBus.updateMasterVolume(); }
			catch (_e) { /* silent; volume will retry next frame */ }
		}
	}

	private updatePurrLoops(playerPos: THREE.Vector3): void
	{
		if (this.voiceBus === null) return;
		for (let i = 0; i < this.animals.length; i++)
		{
			const animal = this.animals[i];
			if (animal.kind !== 'cat') continue;
			const id = 'cat-' + i;
			const dx = animal.position.x - playerPos.x;
			const dz = animal.position.z - playerPos.z;
			const dist = Math.sqrt(dx * dx + dz * dz);
			const tame = animal.interactionCount >= TAME_THRESHOLD;
			const shouldPurr = tame && dist < TAME_FOLLOW_DIST;
			try
			{
				if (shouldPurr && !this.voiceBus.hasPurrLoop(id))
				{
					this.voiceBus.startPurrLoop(id, animal.position);
				}
				else if (!shouldPurr && this.voiceBus.hasPurrLoop(id))
				{
					this.voiceBus.stopPurrLoop(id);
				}
			}
			catch (_e) { /* audio failed; loop state will retry next frame */ }
		}
	}

	// Per-frame transform sync for one animal: world position from
	// physics-light integrator above, heading-driven yaw, then the
	// model-internal limb / tail / ear animation in AnimalAnimator.
	private applyModel(animal: Animal, _dt: number): void
	{
		const g = animal.model.group;
		// body.position.y is the sphere centre, which sits 1 radius
		// above the ground after collision. The visual model has its
		// FOOT_OFFSET shift inside, so plant the root at body bottom
		// (= body.position.y - radius) and the paws land flush.
		g.position.set(
			animal.position.x,
			animal.position.y - animal.bodyRadius,
			animal.position.z,
		);
		// heading = atan2(dx, dz). Three.js Y-rotation is CCW-from-above
		// positive; rotating the model's +Z forward axis by +heading
		// lines it up with the target direction (use +heading, not
		// -heading - the latter flips the model 180° so a "approaching"
		// dog visibly walks backwards).
		g.rotation.y = animal.heading;

		const speed = animal.velocity.length();
		const moving = speed > 0.3;
		const running = speed > 4;
		// 0..1 fade for mouth-open / bark-shake animation. Length of
		// the active voice is encoded in voiceTimer; we map it to a
		// linear fade for the model. Dog bark-shake reads the same
		// fraction so a "louder" early bark snaps the head harder.
		const voiceMax = animal.kind === 'cat' ? MEOW_DURATION : BARK_VOICE_DURATION;
		const voiceFraction = animal.voiceTimer > 0 ? animal.voiceTimer / voiceMax : 0;
		applyAnimalAnimation(animal.model, {
			t: animal.animPhase,
			speed,
			isDog: animal.kind === 'dog',
			moving,
			running,
			voiceFraction,
			jumping: animal.airborne,
			velocityY: animal.body.velocity.y,
		});
	}

}
