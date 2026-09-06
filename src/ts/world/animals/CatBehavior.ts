import * as THREE from 'three';

import {
	AnimalBehavior,
	Animal,
	CAT_FLEE_DIST,
	MEOW_DURATION,
} from './AnimalBehavior';

// Module-scoped scratch vector - reused across every cat update each
// frame to dodge per-call Vector3 allocations.
const _toPlayer = new THREE.Vector3();

// Cat state machine: idle → player too close → flee in the radial-out
// direction → calm down. Repeated player encounters tip the cat into
// 'tame' (handled by AnimalBehavior.updateTame).
class CatBehavior extends AnimalBehavior
{
	public update(cat: Animal, playerDist: number, playerPos: THREE.Vector3): void
	{
		if (this.isTame(cat))
		{
			this.updateTame(cat, playerDist, playerPos, CAT_FLEE_DIST);
			return;
		}

		// Player too close -> protest with a meow first, then bolt.
		// The meow holds the cat in place for MEOW_DURATION (mouth
		// animation + sound), then drops into flee with a target ~40
		// units in the radial-out direction. Counts as one interaction
		// toward taming. Skip if already meow'ing or fleeing.
		if (cat.state !== 'flee' && cat.state !== 'meow' && playerDist < CAT_FLEE_DIST)
		{
			cat.state = 'meow';
			cat.stateTimer = MEOW_DURATION;
			cat.pendingVoice = 'meow';
			// Face the player while meowing - heading set so the head
			// turns toward the camera before bolting.
			_toPlayer.subVectors(playerPos, cat.position);
			_toPlayer.y = 0;
			cat.heading = Math.atan2(_toPlayer.x, _toPlayer.z);
			return;
		}

		// Meow expired -> flip into flee with the radial-out target.
		if (cat.state === 'meow' && cat.stateTimer <= 0)
		{
			cat.state = 'flee';
			cat.stateTimer = 3 + Math.random() * 2;
			cat.interactionCount++;
			_toPlayer.subVectors(cat.position, playerPos);
			_toPlayer.y = 0;
			_toPlayer.normalize().multiplyScalar(40);
			cat.target.set(cat.position.x + _toPlayer.x, 0, cat.position.z + _toPlayer.z);
			return;
		}

		if (cat.stateTimer <= 0 && cat.state !== 'flee' && cat.state !== 'meow')
		{
			this.transitionToIdleOrWander(cat);
		}

		if (cat.state === 'flee' && cat.stateTimer <= 0)
		{
			cat.state = 'idle';
			cat.stateTimer = 2 + Math.random() * 3;
		}
	}
}

// Singleton - CatBehavior is stateless; one instance is shared across
// every cat. Exporting only the singleton (not the class) keeps the
// surface tight: there's no reason to ever construct another one.
export const CAT_BEHAVIOR: AnimalBehavior = new CatBehavior();
