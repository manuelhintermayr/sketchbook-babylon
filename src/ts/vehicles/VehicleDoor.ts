import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import { Vehicle } from './Vehicle';
import * as Utils from '../core/FunctionLibrary';
import { VehicleSeat } from './VehicleSeat';
import { Side } from '../enums/Side';

const _chassisVelocity = new Vector3();

export class VehicleDoor
{
	public vehicle: Vehicle;
	public seat: VehicleSeat;
	public doorObject: TransformNode;
	public doorVelocity: number = 0;
	public doorWorldPos: Vector3 = new Vector3();
	public lastTrailerPos: Vector3 = new Vector3();
	public lastTrailerVel: Vector3 = new Vector3();

	public rotation: number = 0;
	public achievingTargetRotation: boolean = false;
	public physicsEnabled: boolean = false;
	public targetRotation: number = 0;
	public rotationSpeed: number = 5;

	public lastVehicleVel: Vector3 = new Vector3();
	public lastVehiclePos: Vector3 = new Vector3();

	private sideMultiplier: number;

	constructor(seat: VehicleSeat, object: TransformNode)
	{
		this.seat = seat;
		this.vehicle = seat.vehicle as unknown as Vehicle;
		this.doorObject = object;

		const side = Utils.detectRelativeSide(this.seat.seatPointObject, this.doorObject);
		if (side === Side.Left) this.sideMultiplier = -1;
		else if (side === Side.Right) this.sideMultiplier = 1;
		else this.sideMultiplier = 0;
	}

	public update(timestep: number): void
	{
		if (this.achievingTargetRotation)
		{
			if (this.rotation < this.targetRotation)
			{
				this.rotation += timestep * this.rotationSpeed;

				if (this.rotation > this.targetRotation)
				{
					this.rotation = this.targetRotation;
					this.achievingTargetRotation = false;
					this.physicsEnabled = true;
				}
			}
			else if (this.rotation > this.targetRotation)
			{
				this.rotation -= timestep * this.rotationSpeed;

				if (this.rotation < this.targetRotation)
				{
					this.rotation = this.targetRotation;
					this.achievingTargetRotation = false;
					this.physicsEnabled = false;
				}
			}
		}

		// Pure yaw around the hinge - replaces the whole rotation, like
		// setRotationFromEuler(0, y, 0) did.
		Quaternion.RotationYawPitchRollToRef(this.sideMultiplier * this.rotation, 0, 0, Utils.getQuaternion(this.doorObject));
	}

	public preStepCallback(): void
	{
		if (this.physicsEnabled && !this.achievingTargetRotation)
		{
			// Door world position
			Utils.getWorldPosition(this.doorObject, this.doorWorldPos);

			// Get acceleration
			this.vehicle.collision.getLinearVelocityToRef(_chassisVelocity);
			let vehicleVel = _chassisVelocity.clone();
			let vehicleVelDiff = vehicleVel.subtract(this.lastVehicleVel);

			// Get vectors
			const quat = Utils.getQuaternion(this.vehicle);
			const back = new Vector3(0, 0, -1).applyRotationQuaternionInPlace(quat);
			const up = new Vector3(0, 1, 0).applyRotationQuaternionInPlace(quat);

			// Get imaginary positions
			let trailerPos = Utils.applyAxisAngle(back.clone(), up, this.sideMultiplier * this.rotation).addInPlace(this.doorWorldPos);
			let trailerPushedPos = trailerPos.subtract(vehicleVelDiff);

			// Update last values
			this.lastVehicleVel.copyFrom(vehicleVel);
			this.lastTrailerPos.copyFrom(trailerPos);

			// Measure angle difference
			let v1 = trailerPos.subtract(this.doorWorldPos).normalize();
			let v2 = trailerPushedPos.subtract(this.doorWorldPos).normalize();
			let angle = Utils.getSignedAngleBetweenVectors(v1, v2, up);

			// Apply door velocity
			this.doorVelocity += this.sideMultiplier * angle * 0.05;
			this.rotation += this.doorVelocity;

			// Bounce door when it reaches rotation limit
			if (this.rotation < 0)
			{
				this.rotation = 0;

				if (this.doorVelocity < -0.08)
				{
					this.close();
					this.doorVelocity = 0;
				}
				else
				{
					this.doorVelocity = -this.doorVelocity / 2;
				}
			}
			if (this.rotation > 1)
			{
				this.rotation = 1;
				this.doorVelocity = -this.doorVelocity / 2;
			}

			// Damping
			this.doorVelocity = this.doorVelocity * 0.98;
		}
	}

	public open(): void
	{
		this.achievingTargetRotation = true;
		this.targetRotation = 1;
	}

	public close(): void
	{
		this.achievingTargetRotation = true;
		this.targetRotation = 0;
	}

	public resetPhysTrailer(): void
	{
		// Door world position
		Utils.getWorldPosition(this.doorObject, this.doorWorldPos);

		// Get acceleration
		this.lastVehicleVel = new Vector3();

		// Get vectors
		const quat = Utils.getQuaternion(this.vehicle);
		const back = new Vector3(0, 0, -1).applyRotationQuaternionInPlace(quat);
		this.lastTrailerPos.copyFrom(back.addInPlace(this.doorWorldPos));
	}
}
