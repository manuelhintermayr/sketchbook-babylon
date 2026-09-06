import { TransformNode, Vector3 } from '@babylonjs/core';

import { ICharacterAI } from '../../interfaces/ICharacterAI';
import * as Utils from '../../core/FunctionLibrary';
import { Vehicle } from '../../vehicles/Vehicle';
import { Character } from '../Character';
import { EntityType } from '../../enums/EntityType';
import { PhysicsWorld } from '../../physics/PhysicsWorld';

const _chassisVelocity = new Vector3();

export class FollowTarget implements ICharacterAI
{
	public character: Character;
	public isTargetReached: boolean;

	public target: TransformNode;
	private stopDistance: number;

	constructor(target: TransformNode, stopDistance: number = 1.3)
	{
		this.target = target;
		this.stopDistance = stopDistance;
	}

	public setTarget(target: TransformNode): void
	{
		this.target = target;
	}

	public update(timeStep: number): void
	{
		if (this.character.controlledObject !== undefined)
		{
			let source = new Vector3();
			let target = new Vector3();

			Utils.getWorldPosition(this.character, source);
			Utils.getWorldPosition(this.target, target);

			let viewVector = target.subtract(source);

			// Follow character
			if (viewVector.length() > this.stopDistance)
			{
				this.isTargetReached = false;
			}
			else
			{
				this.isTargetReached = true;
			}

			const vehicle = this.character.controlledObject as unknown as Vehicle;
			let forward = new Vector3(0, 0, 1).applyRotationQuaternionInPlace(Utils.getQuaternion(vehicle));
			viewVector.y = 0;
			viewVector.normalize();
			let angle = Utils.getSignedAngleBetweenVectors(forward, viewVector);

			vehicle.collision.getLinearVelocityToRef(_chassisVelocity);
			let goingForward = Vector3.Dot(forward, _chassisVelocity) > 0;
			let speed = _chassisVelocity.length();

			if (Vector3.Dot(forward, viewVector) < 0.0)
			{
				if (this.character.controlledObject.entityType === EntityType.Boat)
				{
					// Boats can't really reverse to face a target; nudge the
					// rudder so the hull starts swinging around instead.
					this.character.controlledObject.triggerAction('right', true);
					this.character.controlledObject.triggerAction('left', false);
				}
				else
				{
					this.character.controlledObject.triggerAction('reverse', true);
					this.character.controlledObject.triggerAction('throttle', false);
				}
			}
			else
			{
				this.character.controlledObject.triggerAction('throttle', true);
				this.character.controlledObject.triggerAction('reverse', false);
			}

			if (Math.abs(angle) > 0.15)
			{
				if (Vector3.Dot(forward, viewVector) > 0 || goingForward)
				{
					if (angle > 0)
					{
						this.character.controlledObject.triggerAction('left', true);
						this.character.controlledObject.triggerAction('right', false);
					}
					else
					{
						this.character.controlledObject.triggerAction('right', true);
						this.character.controlledObject.triggerAction('left', false);
					}
				}
				else
				{
					if (angle > 0)
					{
						this.character.controlledObject.triggerAction('right', true);
						this.character.controlledObject.triggerAction('left', false);
					}
					else
					{
						this.character.controlledObject.triggerAction('left', true);
						this.character.controlledObject.triggerAction('right', false);
					}
				}
			}
			else
			{
				this.character.controlledObject.triggerAction('left', false);
				this.character.controlledObject.triggerAction('right', false);
			}

			void speed;
		}
		else
		{
			let viewVector = this.target.position.subtract(this.character.position);
			this.character.setViewVector(viewVector);

			// Follow character
			if (viewVector.length() > this.stopDistance)
			{
				this.isTargetReached = false;
				this.character.triggerAction('up', true);
			}
			// Stand still
			else
			{
				this.isTargetReached = true;
				this.character.triggerAction('up', false);

				// Look at character
				this.character.setOrientation(viewVector);
			}
		}
	}
}
