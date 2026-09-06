import { PhysicsBody, Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { KeyBinding } from '../core/KeyBinding';
import * as Utils from '../core/FunctionLibrary';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';
import { LoadedModel } from '../core/LoadingManager';

const _velocity = new Vector3();
const _angVel = new Vector3();
const _worldForward = new Vector3();
const _velocityNorm = new Vector3();
const _forward = new Vector3();
const _euler = new Vector3();
const _FORWARD_AXIS = new Vector3(0, 0, 1);

// Ported from Inthenew/Sketchbook (MIT). The boat reuses the raycast
// vehicle base for collision and wheel contacts, but drives itself by
// writing the body velocity directly in physicsPreStep and rides the
// visible waves by overriding the chassis y from
// world.ocean.getWaveHeightAt(). Pitch and roll are forced to zero so
// the hull stays level on top of the wave grid.
export class Boat extends Vehicle implements IControllable
{
	public entityType: EntityType = EntityType.Boat;
	public drive = 'awd';
	public isBoat = true;

	private _speed = 0;
	get speed(): number { return this._speed; }

	public forwardSpeed = 10;
	public reverseSpeed = 5;
	public accelerationIncrement = 0.5;
	public turnSpeed = 100;

	private steeringWheel: TransformNode | null = null;
	private steeringSimulator: SpringSimulator;
	private gear = 1;
	private shiftTime = 0.2;
	private shiftTimer = 0;
	private characterWantsToExit = false;

	constructor(model: LoadedModel)
	{
		super(model, {
			radius: 0.25,
			suspensionStiffness: 20,
			suspensionRestLength: 0.35,
			maxSuspensionTravel: 1,
			frictionSlip: 0.8,
			dampingRelaxation: 2,
			dampingCompression: 2,
			rollInfluence: 0.8,
		});
		this.readBoatData(model);

		this.actions = {
			throttle: new KeyBinding('KeyW'),
			reverse: new KeyBinding('KeyS'),
			brake: new KeyBinding('Space'),
			left: new KeyBinding('KeyA'),
			right: new KeyBinding('KeyD'),
			exitVehicle: new KeyBinding('KeyF'),
			seat_switch: new KeyBinding('KeyX'),
			view: new KeyBinding('KeyV'),
		};

		this.steeringSimulator = new SpringSimulator(60, 10, 0.6);

		// Boats sit still on water and tilt with waves - both auto-recovery
		// gates would teleport them constantly. Disable both.
		this.recovery.stuckRecoveryEnabled = false;
		this.recovery.flipRecoveryEnabled = false;

		this.engineSoundProfile = ENGINE_PROFILES.boat;

		this.collision.setAngularDamping(0.9);
	}

	public noDirectionPressed(): boolean
	{
		return !this.actions.throttle.isPressed
			&& !this.actions.reverse.isPressed
			&& !this.actions.left.isPressed
			&& !this.actions.right.isPressed;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		// The raycast vehicle wants wheels for collision, but a boat
		// has none visually - hide the wheel objects every frame.
		this.wheels.forEach(wheel => { wheel.wheelObject.setEnabled(false); });

		// Gear logic is retained to drive transmission shifts; engine force
		// itself is left at zero - Boat.physicsPreStep writes the body
		// velocity directly via goForward() instead.
		const maxGears = 5;
		const gearsMaxSpeeds: Record<string, number> = {
			'R': (this.forwardSpeed / 10) * -4,
			'0': 0,
			'1': (this.forwardSpeed / 10) * 5,
			'2': (this.forwardSpeed / 10) * 9,
			'3': (this.forwardSpeed / 10) * 13,
			'4': (this.forwardSpeed / 10) * 17,
			'5': (this.forwardSpeed / 10) * 22,
		};

		if (this.shiftTimer > 0)
		{
			this.shiftTimer -= timeStep;
			if (this.shiftTimer < 0) this.shiftTimer = 0;
		}
		else if (!this.actions.reverse.isPressed)
		{
			// Clamp gear to [1..maxGears] before lookup - same NaN-
			// propagation guard as Car.ts. gearsMaxSpeeds[String(0)]
			// would index '0' (= 0) which is fine, but [String(-1)] is
			// undefined and divides into NaN.
			const gear = Math.min(maxGears, Math.max(1, this.gear));
			const powerFactor = (gearsMaxSpeeds[String(gear)] - this.speed)
				/ (gearsMaxSpeeds[String(gear)] - gearsMaxSpeeds[String(gear - 1)]);
			if (powerFactor < 0.1 && this.gear < maxGears) this.shiftUp();
			else if (this.gear > 1 && powerFactor > 1.2) this.shiftDown();
		}

		this.steeringSimulator.simulate(timeStep);
		this.setSteeringValue(this.steeringSimulator.position);
		if (this.steeringWheel)
		{
			Utils.setEulerComponent(this.steeringWheel, 'z', -this.steeringSimulator.position * 2);
		}

		if (this.characterWantsToExit
			&& this.controllingCharacter
			&& this.controllingCharacter.charState.canLeaveVehicles)
		{
			this.forceCharacterOut();
		}
	}

	public shiftUp(): void
	{
		this.gear++;
		this.shiftTimer = this.shiftTime;
		this.applyEngineForce(0);
	}

	public shiftDown(): void
	{
		this.gear--;
		this.shiftTimer = this.shiftTime;
		this.applyEngineForce(0);
	}

	// Writes the horizontal components of `velocity` in place.
	private goForward(maxSpeed: number, velocity: Vector3, forward: boolean): void
	{
		// If the chassis is touching ground (boat ran aground), let the
		// raycast vehicle handle physics normally.
		if (this.rayCastVehicle.numWheelsOnGround >= 1) return;

		_worldForward.set(0, 0, forward ? 1 : -1).applyRotationQuaternionInPlace(this.rotationQuaternion);

		let currentSpeed = Vector3.Dot(velocity, _worldForward);
		if (currentSpeed < maxSpeed) currentSpeed += this.accelerationIncrement;

		_worldForward.scaleInPlace(currentSpeed);
		velocity.x = _worldForward.x;
		velocity.z = _worldForward.z;
	}

	public physicsPreStep(body: PhysicsBody, _boat: Boat): void
	{
		const dt = 1 / 60;

		body.getLinearVelocityToRef(_velocity);
		body.getAngularVelocityToRef(_angVel);

		if (this.actions.throttle.isPressed && !this.actions.reverse.isPressed)
		{
			this.goForward(this.forwardSpeed, _velocity, true);
		}
		else if (this.actions.reverse.isPressed && !this.actions.throttle.isPressed)
		{
			this.goForward(this.reverseSpeed, _velocity, false);
		}

		// Hide doors that don't belong to a boat hull.
		this.seats.forEach(seat =>
		{
			if (seat.door)
			{
				seat.door.doorObject.setEnabled(false);
				seat.door.preStepCallback();
			}
		});

		// Steering target with drift-correction smoothing.
		_velocityNorm.copyFrom(_velocity).normalize();
		_forward.copyFrom(_FORWARD_AXIS).applyRotationQuaternionInPlace(this.rotationQuaternion);
		this._speed = Vector3.Dot(_velocity, _forward);
		const driftCorrection = Utils.getSignedAngleBetweenVectors(_velocityNorm, _forward);
		const maxSteerVal = 0.8;
		const speedFactor = Utils.clamp(this.speed * 0.3, 1, Number.MAX_VALUE);
		if (this.actions.right.isPressed)
		{
			const steering = Math.min(-maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = Utils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else if (this.actions.left.isPressed)
		{
			const steering = Math.max(maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = Utils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else
		{
			this.steeringSimulator.target = 0;
		}

		// Yaw-only orientation: rebuild the quaternion from a YXZ Euler with
		// pitch/roll forced to zero, then null the X/Z angular velocity so
		// the solver can't reintroduce them on the next step.
		Utils.eulerFromQuaternion(this.rotationQuaternion, 'YXZ', _euler);
		const yaw = _euler.y + this.steeringSimulator.position * this.turnSpeed * dt * (Math.PI / 180);
		Quaternion.RotationYawPitchRollToRef(yaw, 0, 0, this.rotationQuaternion);
		_angVel.x = 0;
		_angVel.z = 0;

		// Ride the wave: lerp the chassis y toward the sampled wave height
		// at the boat's xz, leaving the solver to handle xz physics.
		const ocean = this.world?.ocean;
		if (ocean)
		{
			const time = ocean.getElapsedTime();
			const sampled = ocean.getWaveHeightAt(this.position.x, this.position.z, time);
			if (sampled !== 'inner-zone')
			{
				const lerpFactor = 0.6;
				this.position.y += (sampled - this.position.y) * lerpFactor;
				_velocity.y = Math.max(_velocity.y, 0);
			}
		}

		body.setLinearVelocity(_velocity);
		body.setAngularVelocity(_angVel);
	}

	public onInputChange(): void
	{
		super.onInputChange();
		const brakeForce = 1000000;

		if (this.actions.exitVehicle.justPressed)
		{
			this.characterWantsToExit = true;
		}
		if (this.actions.exitVehicle.justReleased)
		{
			this.characterWantsToExit = false;
			this.triggerAction('brake', false);
		}
		if (this.actions.throttle.justReleased || this.actions.reverse.justReleased)
		{
			this.applyEngineForce(0);
		}
		if (this.actions.brake.justPressed)
		{
			this.setBrake(brakeForce, 'awd');
		}
		if (this.actions.brake.justReleased)
		{
			this.setBrake(0, 'awd');
		}
		if (this.actions.view.justPressed)
		{
			this.toggleFirstPersonView();
		}
	}

	public inputReceiverInit(): void
	{
		super.inputReceiverInit();
		this.world.updateControls([
			{ keys: ['W', 'S'], desc: t('controls.accelReverse') },
			{ keys: ['A', 'D'], desc: t('controls.steering') },
			...commonVehicleControls(this.seatSwitchAvailable()),
		]);
	}

	public readBoatData(model: LoadedModel): void
	{
		Utils.traverse(model.root, (child) =>
		{
			if (!(child instanceof TransformNode)) return;
			const ud = Utils.userData(child);
			if (ud.data === 'steering_wheel')
			{
				child.setEnabled(false);
				this.steeringWheel = child;
			}
		});
	}
}
