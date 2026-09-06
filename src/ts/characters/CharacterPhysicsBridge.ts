import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import * as Utils from '../core/FunctionLibrary';
import { CollisionGroups } from '../enums/CollisionGroups';
import { Character } from './Character';

// Cannon <-> Character glue for the physics tick. World.updatePhysics
// calls character.physicsPreStep() and physicsPostStep() each step;
// those methods on Character delegate here so the math + the cannon
// reads/writes sit in one file separate from the orchestration class.
//
// All three functions take Character as a parameter and only touch
// public properties on it. Module-scoped scratches keep the hot path
// allocation-free across all characters in the scene.

const _simulatedVelocity = new THREE.Vector3();
const _newVelocity = new THREE.Vector3();
const _addThree = new THREE.Vector3();
const _normal = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _m = new THREE.Matrix4();
const _pointVel = new CANNON.Vec3();
const _addCannon = new CANNON.Vec3();
const _Y_AXIS = new THREE.Vector3(0, 1, 0);
// Reused per character per frame so feetRaycast doesn't allocate.
// Cannon trimesh raycasts are expensive enough on their own without
// GC pressure piled on top.
const _rayStart = new CANNON.Vec3();
const _rayEnd = new CANNON.Vec3();
const _rayOpts = { collisionFilterMask: CollisionGroups.Default, skipBackfaces: true };

export function physicsPreStep(body: CANNON.Body, character: Character): void
{
	feetRaycast(character);

	// Raycast debug - position the small box mesh on the ground hit
	// or hanging below the body when nothing's underneath.
	if (character.rayHasHit)
	{
		if (character.raycastBox.visible)
		{
			character.raycastBox.position.x = character.rayResult.hitPointWorld.x;
			character.raycastBox.position.y = character.rayResult.hitPointWorld.y;
			character.raycastBox.position.z = character.rayResult.hitPointWorld.z;
		}
	}
	else
	{
		if (character.raycastBox.visible)
		{
			character.raycastBox.position.set(
				body.position.x,
				body.position.y - character.rayCastLength - character.raySafeOffset,
				body.position.z,
			);
		}
	}
}

export function feetRaycast(character: Character): void
{
	const body = character.characterCapsule.body;
	_rayStart.set(body.position.x, body.position.y, body.position.z);
	_rayEnd.set(body.position.x, body.position.y - character.rayCastLength - character.raySafeOffset, body.position.z);
	character.rayHasHit = character.world.physicsWorld.raycastClosest(_rayStart, _rayEnd, _rayOpts, character.rayResult);
}

export function physicsPostStep(body: CANNON.Body, character: Character): void
{
	// Frozen by an open dialog - hold the body still. Without this the
	// state machine's lerp toward velocityTarget=0 would still take a
	// few frames to settle (and additive-mode states like Falling /
	// JumpRunning would keep the existing velocity entirely), letting
	// the character drift mid-conversation.
	if (character.dialogFreeze)
	{
		body.velocity.x = 0;
		body.velocity.y = 0;
		body.velocity.z = 0;
		return;
	}

	// Get velocities
	_simulatedVelocity.set(body.velocity.x, body.velocity.y, body.velocity.z);

	// Take local velocity, then turn local into global. The helper
	// allocates internally - leave that as the helper's contract;
	// pulling it apart here would couple us to its math.
	const arcadeLocal = _addThree.copy(character.velocity).multiplyScalar(character.moveSpeed);
	const arcadeVelocity = Utils.appplyVectorMatrixXZ(character.orientation, arcadeLocal);

	// Additive velocity mode
	if (character.arcadeVelocityIsAdditive)
	{
		_newVelocity.copy(_simulatedVelocity);

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
			THREE.MathUtils.lerp(_simulatedVelocity.x, arcadeVelocity.x, character.arcadeVelocityInfluence.x),
			THREE.MathUtils.lerp(_simulatedVelocity.y, arcadeVelocity.y, character.arcadeVelocityInfluence.y),
			THREE.MathUtils.lerp(_simulatedVelocity.z, arcadeVelocity.z, character.arcadeVelocityInfluence.z),
		);
	}

	// If we're hitting the ground, stick to ground
	if (character.rayHasHit)
	{
		// Flatten velocity
		_newVelocity.y = 0;

		// Move on top of moving objects. Inline the .add() instead of
		// going through Utils.threeVector (which would allocate).
		if (character.rayResult.body.mass > 0)
		{
			character.rayResult.body.getVelocityAtWorldPoint(character.rayResult.hitPointWorld, _pointVel);
			_newVelocity.x += _pointVel.x;
			_newVelocity.y += _pointVel.y;
			_newVelocity.z += _pointVel.z;
		}

		// Measure the normal vector offset from direct "up" vector
		// and transform it into a matrix.
		_normal.set(character.rayResult.hitNormalWorld.x, character.rayResult.hitNormalWorld.y, character.rayResult.hitNormalWorld.z);
		_q.setFromUnitVectors(_Y_AXIS, _normal);
		_m.makeRotationFromQuaternion(_q);

		// Rotate the velocity vector
		_newVelocity.applyMatrix4(_m);

		// Apply velocity
		body.velocity.x = _newVelocity.x;
		body.velocity.y = _newVelocity.y;
		body.velocity.z = _newVelocity.z;
		// Ground character
		body.position.y = character.rayResult.hitPointWorld.y + character.rayCastLength + (_newVelocity.y / character.world.physicsFrameRate);
	}
	else
	{
		// If we're in air
		body.velocity.x = _newVelocity.x;
		body.velocity.y = _newVelocity.y;
		body.velocity.z = _newVelocity.z;

		// Save last in-air information
		character.groundImpactData.velocity.x = body.velocity.x;
		character.groundImpactData.velocity.y = body.velocity.y;
		character.groundImpactData.velocity.z = body.velocity.z;
	}

	// Jumping
	if (character.wantsToJump)
	{
		// If initJumpSpeed is set
		if (character.initJumpSpeed > -1)
		{
			// Flatten velocity
			body.velocity.y = 0;
			const speed = Math.max(character.velocitySimulator.position.length() * 4, character.initJumpSpeed);
			body.velocity.set(
				character.orientation.x * speed,
				character.orientation.y * speed,
				character.orientation.z * speed,
			);
		}
		else
		{
			// Moving objects compensation
			character.rayResult.body.getVelocityAtWorldPoint(character.rayResult.hitPointWorld, _addCannon);
			body.velocity.vsub(_addCannon, body.velocity);
		}

		// Add positive vertical velocity
		body.velocity.y += 4;
		// Move above ground by 2x safe offset value
		body.position.y += character.raySafeOffset * 2;
		// Reset flag
		character.wantsToJump = false;
	}
}
