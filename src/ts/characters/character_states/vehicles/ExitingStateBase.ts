import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import * as Utils from '../../../core/FunctionLibrary';
import
{
	CharacterStateBase,
} from '../_stateLibrary';
import { Character } from '../../Character';
import { VehicleSeat } from '../../../vehicles/VehicleSeat';
import { IControllable } from '../../../interfaces/IControllable';
import { Vehicle } from '../../../vehicles/Vehicle';

const _chassisVelocity = new Vector3();
const _exitPos = new Vector3();

export abstract class ExitingStateBase extends CharacterStateBase
{
	protected vehicle: IControllable;
	protected seat: VehicleSeat;
	protected startPosition: Vector3 = new Vector3();
	protected endPosition: Vector3 = new Vector3();
	protected startRotation: Quaternion = new Quaternion();
	protected endRotation: Quaternion = new Quaternion();
	protected exitPoint: TransformNode;
	protected dummyObj: TransformNode;

	constructor(character: Character, seat: VehicleSeat)
	{
		super(character);

		this.canFindVehiclesToEnter = false;
		this.seat = seat;
		this.vehicle = seat.vehicle;

		this.seat.door?.open();

		this.startPosition.copyFrom(this.character.position);
		this.startRotation.copyFrom(Utils.getQuaternion(this.character));

		this.dummyObj = new TransformNode('exitDummy', character.getScene());
		this.dummyObj.rotationQuaternion = Quaternion.Identity();
	}

	public detachCharacterFromVehicle(): void
	{
		this.character.controlledObject = undefined;
		this.character.resetOrientation();
		this.character.world.attachNode(this.character);
		this.character.resetVelocity();
		this.character.setPhysicsEnabled(true);
		this.character.setPosition(this.character.position.x, this.character.position.y, this.character.position.z);
		this.character.inputReceiverUpdate(0);
		(this.vehicle as unknown as Vehicle).collision.getLinearVelocityToRef(_chassisVelocity);
		this.character.characterCapsule.body.setLinearVelocity(_chassisVelocity);
		this.character.feetRaycast();
		this.dummyObj.dispose();
	}

	public updateEndRotation(): void
	{
		const forward = Utils.getForward(this.exitPoint);
		forward.y = 0;
		forward.normalize();

		this.dummyObj.setParent(null);
		Utils.getWorldPosition(this.exitPoint, _exitPos);
		this.dummyObj.position.copyFrom(_exitPos);
		let target = this.dummyObj.position.add(forward);
		this.dummyObj.lookAt(target);
		this.dummyObj.setParent(this.seat.seatPointObject.parent);
		this.endRotation.copyFrom(Utils.getQuaternion(this.dummyObj));
	}
}
