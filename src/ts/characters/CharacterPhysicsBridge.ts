import { Matrix, PhysicsBody, Quaternion, Vector3 } from '@babylonjs/core';
import type { IRaycastQuery } from '@babylonjs/core';

import * as Utils from '../core/FunctionLibrary';
import { CollisionGroups } from '../enums/CollisionGroups';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { Character } from './Character';

// Havok <-> Character glue for the physics tick. World.updatePhysics
// calls character.physicsPreStep() and physicsPostStep() each step;
// those methods on Character delegate here so the math + the body
// reads/writes sit in one file separate from the orchestration class.
//
// The capsule node is the body's transform node: writing its position
// teleports the body before the next step, and the after-step sync
// writes the simulated pose back - so `body position` below always
// means `character.characterCapsule.node.position`.
//
// All three functions take Character as a parameter and only touch
// public properties on it. Module-scoped scratches keep the hot path
// allocation-free across all characters in the scene.

const _simulatedVelocity = new Vector3();
const _newVelocity = new Vector3();
const _addThree = new Vector3();
const _normal = new Vector3();
const _q = new Quaternion();
const _m = new Matrix();
const _pointVel = new Vector3();
const _Y_AXIS = new Vector3(0, 1, 0);
// Reused per character per frame so feetRaycast doesn't allocate.
const _rayStart = new Vector3();
const _rayEnd = new Vector3();
const _rayOpts: IRaycastQuery = { collideWith: CollisionGroups.Default };

export function physicsPreStep(body: PhysicsBody, character: Character): void
{
	feetRaycast(character);

	// Raycast debug - position the small box mesh on the ground hit
	// or hanging below the body when nothing's underneath.
	const bodyPos = character.characterCapsule.node.position;
	if (character.rayHasHit)
	{
		if (character.raycastBox.isEnabled())
		{
			character.raycastBox.position.copyFrom(character.rayResult.hitPointWorld);
		}
	}
	else
	{
		if (character.raycastBox.isEnabled())
		{
			character.raycastBox.position.set(
				bodyPos.x,
				bodyPos.y - character.rayCastLength - character.raySafeOffset,
				bodyPos.z,
			);
		}
	}
}

export function feetRaycast(character: Character): void
{
	const capsule = character.characterCapsule;
	const bodyPos = capsule.node.position;
	_rayStart.set(bodyPos.x, bodyPos.y, bodyPos.z);
	_rayEnd.set(bodyPos.x, bodyPos.y - character.rayCastLength - character.raySafeOffset, bodyPos.z);
	_rayOpts.ignoreBody = capsule.body;
	character.rayHasHit = character.world.physicsWorld.raycastClosest(_rayStart, _rayEnd, _rayOpts, character.rayResult);
}

export function physicsPostStep(body: PhysicsBody, character: Character): void
{
	const bodyPos = character.characterCapsule.node.position;

	// Frozen by an open dialog - hold the body still. Without this the
	// state machine's lerp toward velocityTarget=0 would still take a
	// few frames to settle (and additive-mode states like Falling /
	// JumpRunning would keep the existing velocity entirely), letting
	// the character drift mid-conversation.
	if (character.dialogFreeze)
	{
		PhysicsWorld.zeroVelocity(body);
		return;
	}

	// Get velocities
	body.getLinearVelocityToRef(_simulatedVelocity);

	// Take local velocity, then turn local into global. The helper
	// allocates internally - leave that as the helper's contract;
	// pulling it apart here would couple us to its math.
	const arcadeLocal = _addThree.copyFrom(character.velocity).scaleInPlace(character.moveSpeed);
	const arcadeVelocity = Utils.appplyVectorMatrixXZ(character.orientation, arcadeLocal);

	// Additive velocity mode
	if (character.arcadeVelocityIsAdditive)
	{
		_newVelocity.copyFrom(_simulatedVelocity);

		const globalVelocityTarget = Utils.appplyVectorMatrixXZ(character.orientation, character.velocityTarget);
		const addX = arcadeVelocity.x * character.arcadeVelocityInfluence.x;
		const addY = arcadeVelocity.y * character.arcadeVelocityInfluence.y;
		const addZ = arcadeVelocity.z * character.arcadeVelocityInfluence.z;

		if (Math.abs(_simulatedVelocity.x) < Math.abs(globalVelocityTarget.x * character.moveSpeed) || Utils.haveDifferentSigns(_simulatedVelocity.x, arcadeVelocity.x)) { _newVelocity.x += addX; }
		if (Math.abs(_simulatedVelocity.y) < Math.abs(globalVelocityTarget.y * character.moveSpeed) || Utils.haveDifferentSigns(_simulatedVelocity.y, arcadeVelocity.y)) { _newVelocity.y += addY; }
		if (Math.abs(_simulatedVelocity.z) < Math.abs(globalVelocityTarget.z * character.moveSpeed) || Utils.haveDifferentSigns(_simulatedVelocity.z, arcadeVelocity.z)) { _newVelocity.z += addZ; }
	}
	else
	{
		_newVelocity.set(
			Utils.lerp(_simulatedVelocity.x, arcadeVelocity.x, character.arcadeVelocityInfluence.x),
			Utils.lerp(_simulatedVelocity.y, arcadeVelocity.y, character.arcadeVelocityInfluence.y),
			Utils.lerp(_simulatedVelocity.z, arcadeVelocity.z, character.arcadeVelocityInfluence.z),
		);
	}

	// If we're hitting the ground, stick to ground
	if (character.rayHasHit)
	{
		// Flatten velocity
		_newVelocity.y = 0;

		// Move on top of moving objects.
		const groundBody = character.rayResult.body;
		if (PhysicsWorld.isDynamic(groundBody))
		{
			PhysicsWorld.velocityAtWorldPoint(groundBody, character.rayResult.hitPointWorld, _pointVel);
			_newVelocity.x += _pointVel.x;
			_newVelocity.y += _pointVel.y;
			_newVelocity.z += _pointVel.z;
		}

		// Measure the normal vector offset from direct "up" vector
		// and transform it into a matrix.
		_normal.copyFrom(character.rayResult.hitNormalWorld);
		Quaternion.FromUnitVectorsToRef(_Y_AXIS, _normal, _q);
		Matrix.FromQuaternionToRef(_q, _m);

		// Rotate the velocity vector
		Vector3.TransformNormalToRef(_newVelocity, _m, _newVelocity);

		// Apply velocity
		body.setLinearVelocity(_newVelocity);
		// Ground character
		bodyPos.y = character.rayResult.hitPointWorld.y + character.rayCastLength + (_newVelocity.y / character.world.physicsFrameRate);
	}
	else
	{
		// If we're in air
		body.setLinearVelocity(_newVelocity);

		// Save last in-air information
		character.groundImpactData.velocity.copyFrom(_newVelocity);
	}

	// Jumping
	if (character.wantsToJump)
	{
		body.getLinearVelocityToRef(_newVelocity);

		// If initJumpSpeed is set
		if (character.initJumpSpeed > -1)
		{
			// Flatten velocity
			_newVelocity.y = 0;
			const speed = Math.max(character.velocitySimulator.position.length() * 4, character.initJumpSpeed);
			_newVelocity.set(
				character.orientation.x * speed,
				character.orientation.y * speed,
				character.orientation.z * speed,
			);
		}
		else
		{
			// Moving objects compensation
			PhysicsWorld.velocityAtWorldPoint(character.rayResult.body, character.rayResult.hitPointWorld, _pointVel);
			_newVelocity.subtractInPlace(_pointVel);
		}

		// Add positive vertical velocity
		_newVelocity.y += 4;
		body.setLinearVelocity(_newVelocity);
		// Move above ground by 2x safe offset value
		bodyPos.y += character.raySafeOffset * 2;
		// Reset flag
		character.wantsToJump = false;
	}
}
