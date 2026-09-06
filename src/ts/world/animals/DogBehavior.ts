import * as THREE from 'three';

import {
	AnimalBehavior,
	Animal,
	DOG_NOTICE,
	DOG_BARK_DIST,
	DOG_GIVEUP,
} from './AnimalBehavior';

// Module-scoped scratch vector - reused across every dog update each
// frame to dodge per-call Vector3 allocations.
const _toPlayer = new THREE.Vector3();

// Dog state machine: idle → notice player → approach → bark → give up
// or dis-engage. Repeated player encounters tip the dog into 'tame'
// (handled by AnimalBehavior.updateTame).
class DogBehavior extends AnimalBehavior
{
	public update(dog: Animal, playerDist: number, playerPos: THREE.Vector3): void
	{
		if (this.isTame(dog))
		{
			this.updateTame(dog, playerDist, playerPos, DOG_NOTICE);
			return;
		}

		// Notice → start approaching (only enter if not already engaged).
		if (dog.state !== 'approach' && dog.state !== 'bark' && playerDist < DOG_NOTICE)
		{
			dog.state = 'approach';
			dog.stateTimer = 10;
		}

		if (dog.state === 'approach')
		{
			dog.target.set(playerPos.x, 0, playerPos.z);

			// Got within bark range -> flip to bark + count interaction.
			// pendingVoice queues the bark synth; mouth + head shake
			// animate via voiceTimer in WanderingAnimals.
			if (playerDist < DOG_BARK_DIST * 2)
			{
				dog.state = 'bark';
				dog.stateTimer = 3 + Math.random() * 2;
				dog.interactionCount++;
				dog.pendingVoice = 'bark';
			}

			// Player walked far enough to give up → head home.
			if (playerDist > DOG_NOTICE + DOG_GIVEUP)
			{
				dog.state = 'wander';
				dog.stateTimer = 3;
				dog.target.copy(dog.homePosition);
			}
		}

		if (dog.state === 'bark')
		{
			// Stay at bark distance - chase if the player drifts away,
			// hold position + face the player if already in range.
			_toPlayer.subVectors(playerPos, dog.position);
			_toPlayer.y = 0;
			const dist = _toPlayer.length();
			if (dist > DOG_BARK_DIST)
			{
				dog.target.set(playerPos.x, 0, playerPos.z);
			}
			else
			{
				// Pin target to current spot so the manager zeroes
				// velocity, then override heading so the dog visibly
				// tracks the player instead of frozen at last facing
				// (manager only updates heading from velocity direction).
				dog.target.set(dog.position.x, 0, dog.position.z);
				dog.heading = Math.atan2(_toPlayer.x, _toPlayer.z);
			}

			if (playerDist > DOG_NOTICE + DOG_GIVEUP)
			{
				dog.state = 'wander';
				dog.stateTimer = 3;
				dog.target.copy(dog.homePosition);
			}

			if (dog.stateTimer <= 0)
			{
				if (playerDist < DOG_NOTICE)
				{
					dog.state = 'approach';
					dog.stateTimer = 5;
				}
				else
				{
					dog.state = 'idle';
					dog.stateTimer = 3;
				}
			}
		}

		if ((dog.state === 'idle' || dog.state === 'wander') && dog.stateTimer <= 0)
		{
			this.transitionToIdleOrWander(dog);
		}
	}
}

// Singleton - DogBehavior is stateless; one instance is shared across
// every dog. Exporting only the singleton (not the class) keeps the
// surface tight: there's no reason to ever construct another one.
export const DOG_BEHAVIOR: AnimalBehavior = new DogBehavior();
