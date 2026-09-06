import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import * as Utils from '../../../core/FunctionLibrary';
import { Character } from '../../Character';
import { VehicleSeat } from '../../../vehicles/VehicleSeat';
import { Falling } from '../Falling';
import { ExitingStateBase } from './ExitingStateBase';
import { Vehicle } from '../../../vehicles/Vehicle';

export class ExitingAirplane extends ExitingStateBase
{

	constructor(character: Character, seat: VehicleSeat)
	{
		super(character, seat);

		this.endPosition.copyFrom(this.startPosition);
		this.endPosition.y += 1;

		const quat = Utils.getQuaternion(seat.vehicle as unknown as Vehicle);
		const forward = new Vector3(0, 0, 1).applyRotationQuaternionInPlace(quat);
		this.exitPoint = new TransformNode('airplaneExit', character.getScene());
		this.exitPoint.rotationQuaternion = Quaternion.Identity();
		this.exitPoint.lookAt(forward);
		this.exitPoint.position.copyFrom(this.endPosition);

		this.playAnimation('jump_idle', 0.1);
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		if (this.animationEnded(timeStep))
		{
			this.detachCharacterFromVehicle();
			this.character.setState(new Falling(this.character));
			this.character.leaveSeat();
			this.exitPoint.dispose();
		}
		else
		{
			let beginningCutoff = 0.3;
			let factor = Utils.clamp(((this.timer / this.animationLength) - beginningCutoff) * (1 / (1 - beginningCutoff)), 0, 1);
			let smoothFactor = Utils.easeOutQuad(factor);
			let lerpPosition = Vector3.Lerp(this.startPosition, this.endPosition, smoothFactor);
			this.character.setPosition(lerpPosition.x, lerpPosition.y, lerpPosition.z);

			// Rotation
			this.updateEndRotation();
			Quaternion.SlerpToRef(this.startRotation, this.endRotation, smoothFactor, Utils.getQuaternion(this.character));
		}
	}
}
