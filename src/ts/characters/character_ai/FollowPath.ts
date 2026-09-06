import { Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { FollowTarget } from './FollowTarget';
import { ICharacterAI } from '../../interfaces/ICharacterAI';
import { PathNode } from '../../world/scenarios/PathNode';
import { Vehicle } from '../../vehicles/Vehicle';
import { EntityType } from '../../enums/EntityType';
import { PhysicsWorld } from '../../physics/PhysicsWorld';

export class FollowPath extends FollowTarget implements ICharacterAI
{
	public nodeRadius: number;
	public reverse: boolean = false;

	private staleTimer: number = 0;
	private targetNode: PathNode;

	constructor(firstNode: PathNode, nodeRadius: number)
	{
		super(firstNode.object, 0);
		this.nodeRadius = nodeRadius;
		this.targetNode = firstNode;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		// Todo only compute once in followTarget
		let source = new Vector3();
		let target = new Vector3();
		Utils.getWorldPosition(this.character, source);
		Utils.getWorldPosition(this.target, target);
		let viewVector = target.subtract(source);
		viewVector.y = 0;

		// All the throttle / reverse / stuck-detection branches below
		// only make sense when the character is driving a vehicle. NPCs
		// on foot (Anna / Ben walking the default-spawn loop) hit this
		// path too and would crash on .collision; skip the whole block
		// for them - FollowTarget already drives the on-foot motion.
		if (this.character.controlledObject !== undefined)
		{
			const vehicle = this.character.controlledObject as unknown as Vehicle;
			let targetToNextNode = this.targetNode.nextNode.object.position.subtract(this.targetNode.object.position);
			targetToNextNode.y = 0;
			targetToNextNode.normalize();
			let slowDownAngle = Vector3.Dot(viewVector.normalizeToNew(), targetToNextNode);
			let speed = PhysicsWorld.linearSpeed(vehicle.collision);

			const isBoat = this.character.controlledObject.entityType === EntityType.Boat;

			if (!isBoat && slowDownAngle < 0.7 && viewVector.length() < 50 && speed > 10)
			{
				this.character.controlledObject.triggerAction('reverse', true);
				this.character.controlledObject.triggerAction('throttle', false);
			}

			// Stuck-detection respawns the vehicle to the next path node. Boats
			// are always 'off the ground' and slow, so the wheel/speed heuristic
			// would teleport them constantly; skip it for Boat.
			if (!isBoat)
			{
				if (speed < 1 || vehicle.rayCastVehicle.numWheelsOnGround === 0) this.staleTimer += timeStep;
				else this.staleTimer = 0;
				if (this.staleTimer > 5)
				{
					let worldPos = new Vector3();
					Utils.getWorldPosition(this.targetNode.object, worldPos);
					worldPos.y += 3;
					PhysicsWorld.teleport(vehicle.collision, worldPos, vehicle.initQuaternion);
					PhysicsWorld.zeroVelocity(vehicle.collision);
					this.staleTimer = 0;
				}
			}
		}

		// Path-progression - runs for both vehicle and on-foot cases.
		if (viewVector.length() < this.nodeRadius)
		{
			if (this.reverse)
			{
				super.setTarget(this.targetNode.previousNode.object);
				this.targetNode = this.targetNode.previousNode;
			}
			else
			{
				super.setTarget(this.targetNode.nextNode.object);
				this.targetNode = this.targetNode.nextNode;
			}
		}
	}
}
