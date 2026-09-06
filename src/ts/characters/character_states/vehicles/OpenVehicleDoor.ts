import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import
{
	CharacterStateBase,
} from '../_stateLibrary';
import { Character } from '../../Character';
import { VehicleSeat } from '../../../vehicles/VehicleSeat';
import { Side } from '../../../enums/Side';
import { Idle } from '../Idle';
import { EnteringVehicle } from './EnteringVehicle';
import * as Utils from '../../../core/FunctionLibrary';
import { SpringSimulator } from '../../../physics/spring_simulation/SpringSimulator';

export class OpenVehicleDoor extends CharacterStateBase
{
	private seat: VehicleSeat;
	private entryPoint: TransformNode;
	private hasOpenedDoor: boolean = false;

	private startPosition: Vector3 = new Vector3();
	private endPosition: Vector3 = new Vector3();
	private startRotation: Quaternion = new Quaternion();
	private endRotation: Quaternion = new Quaternion();

	private factorSimluator: SpringSimulator;

	constructor(character: Character, seat: VehicleSeat, entryPoint: TransformNode)
	{
		super(character);

		this.canFindVehiclesToEnter = false;
		this.seat = seat;
		this.entryPoint = entryPoint;

		const side = Utils.detectRelativeSide(entryPoint, seat.seatPointObject);
		if (side === Side.Left)
		{
			this.playAnimation('open_door_standing_left', 0.1);
		}
		else if (side === Side.Right)
		{
			this.playAnimation('open_door_standing_right', 0.1);
		}

		this.character.resetVelocity();
		this.character.rotateModel();
		this.character.setPhysicsEnabled(false);

		this.character.setPhysicsEnabled(false);
		this.character.setParent(this.seat.vehicle as unknown as TransformNode);

		this.startPosition.copyFrom(this.character.position);
		this.endPosition.copyFrom(this.entryPoint.position);
		this.endPosition.y += 0.53;

		this.startRotation.copyFrom(Utils.getQuaternion(this.character));
		this.endRotation.copyFrom(Utils.getQuaternion(this.entryPoint));

		this.factorSimluator = new SpringSimulator(60, 10, 0.5);
		this.factorSimluator.target = 1;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		if (this.timer > 0.3 && !this.hasOpenedDoor)
		{
			this.hasOpenedDoor = true;
			this.seat.door?.open();
		}

		if (this.animationEnded(timeStep))
		{
			if (this.anyDirection())
			{
				this.character.vehicleEntryInstance = null;
				this.character.world.attachNode(this.character);
				this.character.setPhysicsEnabled(true);
				this.character.setState(new Idle(this.character));
			}
			else
			{
				this.character.setState(new EnteringVehicle(this.character, this.seat, this.entryPoint));
			}
		}
		else
		{
			this.factorSimluator.simulate(timeStep);

			let lerpPosition = Vector3.Lerp(this.startPosition, this.endPosition, this.factorSimluator.position);
			this.character.setPosition(lerpPosition.x, lerpPosition.y, lerpPosition.z);

			Quaternion.SlerpToRef(this.startRotation, this.endRotation, this.factorSimluator.position, Utils.getQuaternion(this.character));
		}
	}
}
