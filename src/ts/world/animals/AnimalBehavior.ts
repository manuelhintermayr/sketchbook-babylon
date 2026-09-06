import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { AnimalModel } from './AnimalModels';
import { VoiceKind } from '../audio/AnimalVoices';

// Domain definition for the wandering-animals system: the data each
// animal carries each frame, the state-machine alphabet, the tuning
// constants, and the abstract behavior strategy that every animal
// kind implements. Subclasses (DogBehavior, CatBehavior) live in
// their own files and only encode the species-specific reactions to
// the player; the common helpers (idle/wander coin flip, tame
// follow loop, tame predicate) are inherited.
//
// All mutable state lives on the Animal record - behaviors are
// stateless singletons reused across every animal of their kind.

export type AnimalKind = 'dog' | 'cat';
export type AnimalState = 'idle' | 'wander' | 'flee' | 'approach' | 'bark' | 'tame' | 'meow' | 'jump';

// How long a meow holds the cat in place before it switches to flee.
// Matches the AnimalVoices meow synth duration (0.6 s) plus a touch
// so the mouth animation finishes before the cat bolts.
export const MEOW_DURATION = 0.7;

// Initial vertical velocity applied to the animal body at jump
// kickoff. Combined with cannon's world gravity (-9.81) this gives a
// hang-time around 0.5 s and a peak height ~0.4 m above the ground
// (multiplied down by the per-animal scale).
export const JUMP_KICK = 4.0;
// Probability the next idle/wander roll picks a jump instead.
export const JUMP_CHANCE = 0.18;

// Distance at which dogs notice the player and start approaching.
export const DOG_NOTICE = 15;
// Distance the dog tries to maintain while barking.
export const DOG_BARK_DIST = 3;
// Approach / chase speed. Matches the low-poly-cat-game reference's
// player-run speed (8.5), which is the value the leg-cycle anim
// (cycleSpeed=13 in AnimalAnimator) was tuned against.
export const DOG_PURSUE_SPEED = 8.5;
// Player has to walk this far past DOG_NOTICE before the dog gives up.
export const DOG_GIVEUP = 10;

// Distance at which cats start fleeing.
export const CAT_FLEE_DIST = 10;
// Cat flee speed - same as the reference run speed so the gallop
// animation tempo matches the actual ground travel.
export const CAT_FLEE_SPEED = 8.5;

// Both kinds: after this many interactions (cat flees, dog barks) the
// animal flips to 'tame' and follows the player at a polite distance.
export const TAME_THRESHOLD = 2;
export const TAME_FOLLOW_DIST = 3;
// Walk speed when following the player. Reference cat-game uses 3.8
// for ordinary walking; our tame follow is the same so the walk-cycle
// (cycleSpeed=8) lines up with the actual stride length.
export const TAME_FOLLOW_SPEED = 3.8;

// Generic 'wander' speed shared by both kinds. Reference cat-game
// walk speed - leg-cycle anim was tuned against this value.
export const WANDER_SPEED = 3.8;

export interface Animal
{
	kind: AnimalKind;
	position: THREE.Vector3;
	velocity: THREE.Vector3;
	heading: number;
	state: AnimalState;
	stateTimer: number;
	target: THREE.Vector3;
	animPhase: number;
	scale: number;
	interactionCount: number;
	homePosition: THREE.Vector3;
	// Empty Object3D added to graphicsWorld; its position is updated
	// each frame to match the instanced animal so its CSS2D label
	// follows along. The label itself lives as a child of this anchor.
	labelAnchor: THREE.Object3D;
	// Off-map detection throttle. Body y is now driven by cannon, but
	// we still raycast the terrain occasionally to spot animals that
	// have wandered off the trimesh (no contact = falling forever) and
	// redirect them home before they're lost.
	groundQueryTimer: number;
	// Strategy reference - DOG_BEHAVIOR or CAT_BEHAVIOR singleton from
	// the matching subclass file. Lets WanderingAnimals.update
	// polymorphically dispatch to the right state machine without an
	// `if (kind === ...)` branch per animal.
	behavior: AnimalBehavior;
	// Hierarchical visual model with named handles (body, head, legs,
	// tail, ears) the per-frame animator drives. Replaces the previous
	// instanced-mesh approach so each animal can blink, breathe and
	// run independently.
	model: AnimalModel;
	// Voice trigger queue. Behaviour layer sets this on a state
	// transition (e.g. dog enters bark, cat starts meowing); the
	// manager consumes it next frame, fires the synth via
	// AnimalVoiceBus, and resets to null. Decouples behaviour from
	// the audio bus so the state machine doesn't need a world ref.
	pendingVoice: VoiceKind | null;
	// Seconds of mouth-animation remaining for the active voice.
	// Counts down each frame; while > 0 the model's mouth opens.
	voiceTimer: number;
	// Cannon dynamic body for collision against the player capsule,
	// the trimesh terrain, and other animal bodies. Manager writes
	// the AI's desired horizontal velocity into body.velocity.x/z
	// each frame and reads body.position back into animal.position.
	body: CANNON.Body;
	// 'collide' listener reference, stashed so removeFromWorld can
	// detach it. Without an explicit removeEventListener, the closure
	// keeps the animal pinned in memory across scenario switches.
	collideListener: ((e: any) => void) | undefined;
	// True while a jump is in flight (kick fired, gravity acting,
	// no collision with ground yet). Decoupled from the state machine
	// so a behaviour transition mid-jump (e.g. dog notices player and
	// flips to bark) doesn't strand vertical physics in an
	// inconsistent state.
	airborne: boolean;
	// Cached body radius. Manager subtracts it from body.position.y
	// before placing the visual root so the model's foot offset lands
	// the paws on the ground (cannon's sphere body sits with its
	// centre 1 radius above the contact point).
	bodyRadius: number;
}

// State -> voice mapping helper. Used by behaviours to mark the
// transition; the manager reads `pendingVoice` and fires the synth.
export function voiceForState(state: AnimalState): VoiceKind | null
{
	if (state === 'meow') return 'meow';
	if (state === 'bark') return 'bark';
	return null;
}

// State → speed table used by the manager when integrating velocity.
// Lives here (not on the manager) because the values are part of the
// behavior tuning surface - keeping them next to the constants they
// derive from makes the relationship obvious.
export function targetSpeedFor(state: AnimalState): number
{
	switch (state)
	{
		case 'flee':     return CAT_FLEE_SPEED;
		case 'approach': return DOG_PURSUE_SPEED;
		// 0.45 keeps the bark approach below the run threshold (4.0)
		// so the dog walks - not gallops - the last few metres while
		// barking. Higher values flipped the leg cycle into run anim.
		case 'bark':     return DOG_PURSUE_SPEED * 0.45;
		case 'tame':     return TAME_FOLLOW_SPEED;
		case 'wander':   return WANDER_SPEED;
		case 'meow':     return 0;  // freezes the cat for the meow duration
		case 'jump':     return 0;  // body keeps its inertia from before kick
		default:         return 0;
	}
}

export abstract class AnimalBehavior
{
	public abstract update(animal: Animal, playerDist: number, playerPos: THREE.Vector3): void;

	protected isTame(animal: Animal): boolean
	{
		return animal.interactionCount >= TAME_THRESHOLD;
	}

	// Three-way pick between idle (stand still), wander (walk to a
	// random nearby spot), and jump (small playful hop). Jump only
	// fires when the animal is grounded so we don't stack jumps mid-
	// air; the manager's vertical-physics layer handles the rest.
	// Used by both kinds when nothing else is happening.
	protected transitionToIdleOrWander(animal: Animal): void
	{
		if (!animal.airborne && Math.random() < JUMP_CHANCE)
		{
			animal.state = 'jump';
			animal.stateTimer = 1.5;
			animal.airborne = true;
			animal.body.velocity.y = JUMP_KICK;
			return;
		}
		if (Math.random() < 0.5)
		{
			animal.state = 'idle';
			animal.stateTimer = 2 + Math.random() * 4;
		}
		else
		{
			animal.state = 'wander';
			animal.stateTimer = 2 + Math.random() * 3;
			const wanderAngle = animal.heading + (Math.random() - 0.5) * Math.PI;
			const wanderDist = 10 + Math.random() * 20;
			animal.target.set(
				animal.position.x + Math.cos(wanderAngle) * wanderDist,
				0,
				animal.position.z + Math.sin(wanderAngle) * wanderDist,
			);
		}
	}

	// Tame animals follow the player at a polite distance; idle when too
	// close, transition out when the player has wandered off. Same
	// shape for dogs and cats - only the "give up" radius differs (cat:
	// original flee distance; dog: original notice distance).
	protected updateTame(
		animal: Animal,
		playerDist: number,
		playerPos: THREE.Vector3,
		giveUpDist: number,
	): void
	{
		if (playerDist > giveUpDist)
		{
			// Only flip from 'tame' to idle/wander once. If we're
			// already in idle/wander from a previous frame, run the
			// state's timer down before re-randomising - calling
			// transitionToIdleOrWander every frame picked a fresh
			// wander target each tick, which made the pet spin in
			// place at 60 Hz.
			if (animal.state === 'tame')
			{
				this.transitionToIdleOrWander(animal);
			}
			else if ((animal.state === 'idle' || animal.state === 'wander') && animal.stateTimer <= 0)
			{
				this.transitionToIdleOrWander(animal);
			}
		}
		else if (playerDist < TAME_FOLLOW_DIST)
		{
			animal.state = 'idle';
			animal.stateTimer = 1;
			// Tame and within follow distance: face the player every frame
			// so the pet tracks them when they walk around it. The normal
			// heading update only fires while moving (targetSpeed > 0), so
			// without this an idle pet would keep its old facing forever.
			const dx = playerPos.x - animal.position.x;
			const dz = playerPos.z - animal.position.z;
			if (dx * dx + dz * dz > 0.01)
			{
				animal.heading = Math.atan2(dx, dz);
			}
		}
		else
		{
			animal.target.set(playerPos.x, 0, playerPos.z);
			animal.state = 'tame';
		}
	}
}
