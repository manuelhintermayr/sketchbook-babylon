import { Quaternion, Vector3 } from '@babylonjs/core';

import
{
	CharacterStateBase,
} from '../_stateLibrary';
import { Character } from '../../Character';
import { VehicleSeat } from '../../../vehicles/VehicleSeat';
import { Side } from '../../../enums/Side';
import { SeatType } from '../../../enums/SeatType';
import { Driving } from './Driving';
import { Sitting } from './Sitting';
import * as Utils from '../../../core/FunctionLibrary';
import { Space } from '../../../enums/Space';

export class SwitchingSeats extends CharacterStateBase
{
	private toSeat: VehicleSeat;

	private startPosition: Vector3 = new Vector3();
	private endPosition: Vector3 = new Vector3();
	private startRotation: Quaternion = new Quaternion();
	private endRotation: Quaternion = new Quaternion();

	constructor(character: Character, fromSeat: VehicleSeat, toSeat: VehicleSeat)
	{
		super(character);

		this.toSeat = toSeat;
		this.canFindVehiclesToEnter = false;
		this.canLeaveVehicles = false;

		character.leaveSeat();
		this.character.occupySeat(toSeat);

		const right = Utils.getRight(fromSeat.seatPointObject, Space.Local);
		const viewVector = toSeat.seatPointObject.position.subtract(fromSeat.seatPointObject.position).normalize();
		const side = Vector3.Dot(right, viewVector) > 0 ? Side.Left : Side.Right;

		if (side === Side.Left)
		{
			this.playAnimation('sitting_shift_left', 0.1);
		}
		else if (side === Side.Right)
		{
			this.playAnimation('sitting_shift_right', 0.1);
		}

		this.startPosition.copyFrom(fromSeat.seatPointObject.position);
		this.startPosition.y += 0.6;
		this.endPosition.copyFrom(toSeat.seatPointObject.position);
		this.endPosition.y += 0.6;

		this.startRotation.copyFrom(Utils.getQuaternion(fromSeat.seatPointObject));
		this.endRotation.copyFrom(Utils.getQuaternion(toSeat.seatPointObject));
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		if (this.animationEnded(timeStep))
		{
			if (this.toSeat.type === SeatType.Driver)
			{
				this.character.setState(new Driving(this.character, this.toSeat));
			}
			else if (this.toSeat.type === SeatType.Passenger)
			{
				this.character.setState(new Sitting(this.character, this.toSeat));
			}
		}
		else
		{
			let factor = this.timer / this.animationLength;
			let sineFactor = Utils.easeInOutSine(factor);

			let lerpPosition = Vector3.Lerp(this.startPosition, this.endPosition, sineFactor);
			this.character.setPosition(lerpPosition.x, lerpPosition.y, lerpPosition.z);

			Quaternion.SlerpToRef(this.startRotation, this.endRotation, sineFactor, Utils.getQuaternion(this.character));
		}
	}
}
