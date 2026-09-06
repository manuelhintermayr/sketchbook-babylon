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
import { PhysicsWorld } from '../physics/PhysicsWorld';

// Module-scoped scratch - physicsPreStep runs at 60Hz per car, so
// every `new Vector3` here would cost 12 allocations x frame x
// instance. Reuse these instead. Constants ending in _AXIS are
// immutable seeds that we copy() into a working scratch before applying
// transforms.
const _quat = new Quaternion();
const _right = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const _velocity = new Vector3();
const _velocityNorm = new Vector3();
const _angVel = new Vector3();
const _spinFwd = new Vector3();
const _spinRight = new Vector3();
const _effSpinFwd = new Vector3();
const _effSpinRight = new Vector3();
const _RIGHT_AXIS = new Vector3(1, 0, 0);
const _UP_AXIS = new Vector3(0, 1, 0);
const _FORWARD_AXIS = new Vector3(0, 0, 1);
const _DOWN_AXIS = new Vector3(0, -1, 0);

export class Car extends Vehicle implements IControllable
{
	public entityType: EntityType = EntityType.Car;
	public drive: string = 'awd';
	get speed(): number {
		return this._speed;
	}
	private _speed: number = 0;

	// Engine_Force slider value (default 10 = original feel). Scales the
	// engine thrust and gear ladder linearly. Inthenew called this
	// 'speed2'; renamed for clarity.
	public engineForceFactor: number = 10;

	public updateCarSpeed(speed: number): void
	{
		this.engineForceFactor = speed;
	}

	private steeringWheel: TransformNode;
	private airSpinTimer: number = 0;

	private steeringSimulator: SpringSimulator;
	private gear: number = 1;

	// Transmission
	private shiftTimer: number;
	private timeToShift: number = 0.2;

	private canTiltForwards: boolean = false;
	private characterWantsToExit: boolean = false;

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
			rollInfluence: 0.8
		});

		this.readCarData(model);

		this.actions = {
			'throttle': new KeyBinding('KeyW'),
			'reverse': new KeyBinding('KeyS'),
			'brake': new KeyBinding('Space'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'exitVehicle': new KeyBinding('KeyF'),
			'seat_switch': new KeyBinding('KeyX'),
			'view': new KeyBinding('KeyV'),
		};

		this.steeringSimulator = new SpringSimulator(60, 10, 0.6);

		this.engineSoundProfile = ENGINE_PROFILES.car;
	}

	public noDirectionPressed(): boolean
	{
		let result =
		!this.actions.throttle.isPressed &&
		!this.actions.reverse.isPressed &&
		!this.actions.left.isPressed &&
		!this.actions.right.isPressed;

		return result;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		const tiresHaveContact = this.rayCastVehicle.numWheelsOnGround > 0;

		// Air spin
		if (!tiresHaveContact)
		{
			// Timer grows when car is off ground, resets once you touch the ground again
			this.airSpinTimer += timeStep;
			if (!this.actions.throttle.isPressed) this.canTiltForwards = true;
		}
		else
		{
			this.canTiltForwards = false;
			this.airSpinTimer = 0;
		}

		// Engine. Force and gear-ladder values scale linearly with
		// engineForceFactor (Engine_Force slider, default 10) so the
		// world GUI can retune the car without rebuilding.
		const factor = this.engineForceFactor / 10;
		const engineForce = 500 * factor;
		const maxGears = 5;
		const gearsMaxSpeeds = {
			'R': -4 * factor,
			'0': 0,
			'1': 5 * factor,
			'2': 9 * factor,
			'3': 13 * factor,
			'4': 17 * factor,
			'5': 22 * factor,
		};

		if (this.shiftTimer > 0)
		{
			this.shiftTimer -= timeStep;
			if (this.shiftTimer < 0) this.shiftTimer = 0;
		}
		else
		{
			// Transmission. Clamp gear to [1..maxGears] before indexing
			// gearsMaxSpeeds - if gear ever drifts to 0 or above maxGears
			// the lookup returns undefined, the (cur - prev) divisor
			// becomes NaN, and the engine force write propagates NaN
			// into the body velocity. Same clamp is applied to the
			// gear divisor below so we don't divide by 0.
			const gear = Math.min(maxGears, Math.max(1, this.gear));
			if (this.actions.reverse.isPressed)
			{
				const powerFactor = (gearsMaxSpeeds['R'] - this.speed) / Math.abs(gearsMaxSpeeds['R']);
				const force = (engineForce / gear) * (Math.abs(powerFactor) ** 1);

				this.applyEngineForce(force);
			}
			else
			{
				const powerFactor = (gearsMaxSpeeds[gear] - this.speed) / (gearsMaxSpeeds[gear] - gearsMaxSpeeds[gear - 1]);

				if (powerFactor < 0.1 && this.gear < maxGears) this.shiftUp();
				else if (this.gear > 1 && powerFactor > 1.2) this.shiftDown();
				else if (this.actions.throttle.isPressed)
				{
					const force = (engineForce / gear) * (powerFactor ** 1);
					this.applyEngineForce(-force);
				}
			}
		}

		// Steering
		this.steeringSimulator.simulate(timeStep);
		this.setSteeringValue(this.steeringSimulator.position);
		if (this.steeringWheel !== undefined) Utils.setEulerComponent(this.steeringWheel, 'z', -this.steeringSimulator.position * 2);

		if (this.rayCastVehicle.numWheelsOnGround < 3 && Math.abs(PhysicsWorld.linearSpeed(this.collision)) < 0.5)
		{
			PhysicsWorld.setNodeRotation(this, this.initQuaternion);
		}

		// Getting out
		if (this.characterWantsToExit && this.controllingCharacter !== undefined && this.controllingCharacter.charState.canLeaveVehicles)
		{
			let speed = PhysicsWorld.linearSpeed(this.collision);

			if (speed > 0.1 && speed < 4)
			{
				this.triggerAction('brake', true);
			}
			else
			{
				this.forceCharacterOut();
			}
		}
	}

	public shiftUp(): void
	{
		this.gear++;
		this.shiftTimer = this.timeToShift;

		this.applyEngineForce(0);
	}

	public shiftDown(): void
	{
		this.gear--;
		this.shiftTimer = this.timeToShift;

		this.applyEngineForce(0);
	}

	public physicsPreStep(body: PhysicsBody, car: Car): void
	{
		// Constants
		_quat.copyFrom(this.rotationQuaternion);
		_forward.copyFrom(_FORWARD_AXIS).applyRotationQuaternionInPlace(_quat);
		_right.copyFrom(_RIGHT_AXIS).applyRotationQuaternionInPlace(_quat);
		_up.copyFrom(_UP_AXIS).applyRotationQuaternionInPlace(_quat);

		// Measure speed
		body.getLinearVelocityToRef(_velocity);
		const v = _velocity;
		this._speed = v.x * _forward.x + v.y * _forward.y + v.z * _forward.z;

		// Air spin
		// It takes 2 seconds until you have max spin air control since you leave the ground
		let airSpinInfluence = Utils.clamp(this.airSpinTimer / 2, 0, 1);
		airSpinInfluence *= Utils.clamp(this.speed, 0, 1);

		const flipSpeedFactor = Utils.clamp(1 - this.speed, 0, 1);
		const upFactor = (Vector3.Dot(_up, _DOWN_AXIS) / 2) + 0.5;
		const flipOverInfluence = flipSpeedFactor * upFactor * 3;

		const maxAirSpinMagnitude = 2.0;
		const airSpinAcceleration = 0.15;
		body.getAngularVelocityToRef(_angVel);
		const angVel = _angVel;
		let angVelChanged = false;

		_spinFwd.copyFrom(_forward);
		_spinRight.copyFrom(_right);

		const fwdScale = airSpinAcceleration * (airSpinInfluence + flipOverInfluence);
		const rightScale = airSpinAcceleration * airSpinInfluence;
		_effSpinFwd.set(_forward.x * fwdScale, _forward.y * fwdScale, _forward.z * fwdScale);
		_effSpinRight.set(_right.x * rightScale, _right.y * rightScale, _right.z * rightScale);

		// Right
		if (this.actions.right.isPressed && !this.actions.left.isPressed) {
			if (Vector3.Dot(angVel, _spinFwd) < maxAirSpinMagnitude) {
				angVel.addInPlace(_effSpinFwd);
				angVelChanged = true;
			}
		} else
		// Left
			if (this.actions.left.isPressed && !this.actions.right.isPressed) {
				if (Vector3.Dot(angVel, _spinFwd) > -maxAirSpinMagnitude) {
					angVel.subtractInPlace(_effSpinFwd);
					angVelChanged = true;
				}
			}

		// Forwards
		if (this.canTiltForwards && this.actions.throttle.isPressed && !this.actions.reverse.isPressed) {
			if (Vector3.Dot(angVel, _spinRight) < maxAirSpinMagnitude) {
				angVel.addInPlace(_effSpinRight);
				angVelChanged = true;
			}
		} else
		// Backwards
			if (this.actions.reverse.isPressed && !this.actions.throttle.isPressed) {
				if (Vector3.Dot(angVel, _spinRight) > -maxAirSpinMagnitude) {
					angVel.subtractInPlace(_effSpinRight);
					angVelChanged = true;
				}
			}

		if (angVelChanged) body.setAngularVelocity(angVel);

		// Steering. Normalize velocity into a scratch directly.
		_velocityNorm.copyFrom(v).normalize();
		let driftCorrection = Utils.getSignedAngleBetweenVectors(_velocityNorm, _forward);

		const maxSteerVal = 0.8;
		let speedFactor = Utils.clamp(this.speed * 0.3, 1, Number.MAX_VALUE);

		if (this.actions.right.isPressed)
		{
			let steering = Math.min(-maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = Utils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else if (this.actions.left.isPressed)
		{
			let steering = Math.max(maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = Utils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else this.steeringSimulator.target = 0;

		// Update doors
		this.seats.forEach((seat) => {
			seat.door?.preStepCallback();
		});
	}

	public onInputChange(): void {
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
			this.setBrake(brakeForce, 'rwd');
		}
		if (this.actions.brake.justReleased)
		{
			this.setBrake(0, 'rwd');
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
			{ keys: ['W', 'S'],   desc: t('controls.accelBrake') },
			{ keys: ['A', 'D'],   desc: t('controls.steering') },
			{ keys: ['Space'],    desc: t('controls.handbrake') },
			...commonVehicleControls(this.seatSwitchAvailable()),
		]);
	}

	public readCarData(model: LoadedModel): void
	{
		Utils.traverse(model.root, (child) => {
			if (!(child instanceof TransformNode)) return;
			const ud = Utils.userData(child);
			if (ud.data === 'steering_wheel')
			{
				this.steeringWheel = child;
			}
		});
	}
}
