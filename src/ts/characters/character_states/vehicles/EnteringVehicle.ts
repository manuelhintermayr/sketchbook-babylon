import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import
{
	CharacterStateBase,
} from '../_stateLibrary';
import { Character } from '../../Character';
import { IControllable } from '../../../interfaces/IControllable';
import { Driving } from './Driving';
import { VehicleSeat } from '../../../vehicles/VehicleSeat';
import { Side } from '../../../enums/Side';
import { Sitting } from './Sitting';
import { SeatType } from '../../../enums/SeatType';
import { EntityType } from '../../../enums/EntityType';
import * as Utils from '../../../core/FunctionLibrary';
import { SpringSimulator } from '../../../physics/spring_simulation/SpringSimulator';

const _zero = new Vector3();

export class EnteringVehicle extends CharacterStateBase
{
	private vehicle: IControllable;
	private animData: any;
	private seat: VehicleSeat;

	private initialPositionOffset: Vector3 = new Vector3();
	private startPosition: Vector3 = new Vector3();
	private endPosition: Vector3 = new Vector3();
	private startRotation: Quaternion = new Quaternion();
	private endRotation: Quaternion = new Quaternion();

	private factorSimulator: SpringSimulator;

	constructor(character: Character, seat: VehicleSeat, entryPoint: TransformNode)
	{
		super(character);

		this.canFindVehiclesToEnter = false;
		this.vehicle = seat.vehicle;
		this.seat = seat;

		const side = Utils.detectRelativeSide(entryPoint, seat.seatPointObject);
		this.animData = this.getEntryAnimations(seat.vehicle.entityType);
		this.playAnimation(this.animData[side], 0.1);

		// Door clunk - open at the start of the entry animation, close
		// later when physics is re-enabled (see the sit branch below).
		// Per-character positional - the AI driver entering its vehicle
		// also gets a clunk at its position, not the player's.
		if (seat.door !== undefined) this.character.sfx?.playDoor();

		this.character.resetVelocity();
		this.character.tiltContainer.rotation.z = 0;
		this.character.setPhysicsEnabled(false);
		this.character.setParent(this.seat.vehicle as unknown as TransformNode);

		this.startPosition.copyFrom(entryPoint.position);
		this.startPosition.y += 0.53;
		this.endPosition.copyFrom(seat.seatPointObject.position);
		this.endPosition.y += 0.6;
		this.initialPositionOffset.copyFrom(this.startPosition).subtractInPlace(this.character.position);

		this.startRotation.copyFrom(Utils.getQuaternion(this.character));
		this.endRotation.copyFrom(Utils.getQuaternion(this.seat.seatPointObject));

		this.factorSimulator = new SpringSimulator(60, 10, 0.5);
		this.factorSimulator.target = 1;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		if (this.animationEnded(timeStep))
		{
			this.character.occupySeat(this.seat);
			this.character.setPosition(this.endPosition.x, this.endPosition.y, this.endPosition.z);

			if (this.seat.type === SeatType.Driver)
			{
				if (this.seat.door)
				{
					this.seat.door.physicsEnabled = true;
					this.character.sfx?.playDoor();
				}
				this.character.setState(new Driving(this.character, this.seat));
			}
			else if (this.seat.type === SeatType.Passenger)
			{
				this.character.setState(new Sitting(this.character, this.seat));
			}
		}
		else
		{
			if (this.seat.door)
			{
				this.seat.door.physicsEnabled = false;
				this.seat.door.rotation = 1;
			}

			let factor = Utils.clamp(this.timer / (this.animationLength - this.animData.end_early), 0, 1);
			let sineFactor = Utils.easeInOutSine(factor);
			this.factorSimulator.simulate(timeStep);

			let currentPosOffset = Vector3.Lerp(this.initialPositionOffset, _zero, this.factorSimulator.position);
			let lerpPosition = Vector3.Lerp(this.startPosition.subtract(currentPosOffset), this.endPosition, sineFactor);
			this.character.setPosition(lerpPosition.x, lerpPosition.y, lerpPosition.z);

			Quaternion.SlerpToRef(this.startRotation, this.endRotation, this.factorSimulator.position, Utils.getQuaternion(this.character));
		}
	}

	private getEntryAnimations(type: EntityType): any
	{
		switch (type)
		{
			case EntityType.Airplane:
				return {
					[Side.Left]: 'enter_airplane_left',
					[Side.Right]: 'enter_airplane_right',
					end_early: 0.3
				};
			default:
				return {
					[Side.Left]: 'sit_down_left',
					[Side.Right]: 'sit_down_right',
					end_early: 0.0
				};
		}
	}
}
