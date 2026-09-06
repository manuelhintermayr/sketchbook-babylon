import * as CANNON from 'cannon-es';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { KeyBinding } from '../core/KeyBinding';
import * as THREE from 'three';
import * as Utils from '../core/FunctionLibrary';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';

// Module-scoped scratch - physicsPreStep runs at 60Hz per car, so
// every `new Vector3` / `new Vec3` here would cost 12 allocations ×
// frame × instance. Reuse these instead. Constants ending in _AXIS are
// immutable seeds that we copy() into a working scratch before applying
// transforms.
const _quat = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _velocityNorm = new THREE.Vector3();
const _spinFwd = new CANNON.Vec3();
const _spinRight = new CANNON.Vec3();
const _effSpinFwd = new CANNON.Vec3();
const _effSpinRight = new CANNON.Vec3();
const _RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const _UP_AXIS = new THREE.Vector3(0, 1, 0);
const _FORWARD_AXIS = new THREE.Vector3(0, 0, 1);
const _DOWN_AXIS = new THREE.Vector3(0, -1, 0);

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

	// private wheelsDebug: THREE.Mesh[] = [];
	private steeringWheel: THREE.Object3D;
	private airSpinTimer: number = 0;

	private steeringSimulator: SpringSimulator;
	private gear: number = 1;

	// Transmission
	private shiftTimer: number;
	private timeToShift: number = 0.2;

	private canTiltForwards: boolean = false;
	private characterWantsToExit: boolean = false;

	constructor(gltf: any)
	{
		super(gltf, {
			radius: 0.25,
			suspensionStiffness: 20,
			suspensionRestLength: 0.35,
			maxSuspensionTravel: 1,
			frictionSlip: 0.8,
			dampingRelaxation: 2,
			dampingCompression: 2,
			rollInfluence: 0.8
		});

		this.readCarData(gltf);

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
			// into cannon's body velocity. Same clamp is applied to the
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
		if (this.steeringWheel !== undefined) this.steeringWheel.rotation.z = -this.steeringSimulator.position * 2;

		if (this.rayCastVehicle.numWheelsOnGround < 3 && Math.abs(this.collision.velocity.length()) < 0.5)	
		{	
			this.collision.quaternion.copy(this.collision.initQuaternion);	
		}

		// Getting out
		if (this.characterWantsToExit && this.controllingCharacter !== undefined && this.controllingCharacter.charState.canLeaveVehicles)
		{
			let speed = this.collision.velocity.length();

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

	public physicsPreStep(body: CANNON.Body, car: Car): void
	{
		// Constants
		_quat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		_forward.copy(_FORWARD_AXIS).applyQuaternion(_quat);
		_right.copy(_RIGHT_AXIS).applyQuaternion(_quat);
		_up.copy(_UP_AXIS).applyQuaternion(_quat);

		// Measure speed. Inline the dot product to avoid building a
		// CANNON.Vec3 just to call .dot() on it.
		const v = this.collision.velocity;
		this._speed = v.x * _forward.x + v.y * _forward.y + v.z * _forward.z;

		// Air spin
		// It takes 2 seconds until you have max spin air control since you leave the ground
		let airSpinInfluence = THREE.MathUtils.clamp(this.airSpinTimer / 2, 0, 1);
		airSpinInfluence *= THREE.MathUtils.clamp(this.speed, 0, 1);

		const flipSpeedFactor = THREE.MathUtils.clamp(1 - this.speed, 0, 1);
		const upFactor = (_up.dot(_DOWN_AXIS) / 2) + 0.5;
		const flipOverInfluence = flipSpeedFactor * upFactor * 3;

		const maxAirSpinMagnitude = 2.0;
		const airSpinAcceleration = 0.15;
		const angVel = this.collision.angularVelocity;

		_spinFwd.set(_forward.x, _forward.y, _forward.z);
		_spinRight.set(_right.x, _right.y, _right.z);

		const fwdScale = airSpinAcceleration * (airSpinInfluence + flipOverInfluence);
		const rightScale = airSpinAcceleration * airSpinInfluence;
		_effSpinFwd.set(_forward.x * fwdScale, _forward.y * fwdScale, _forward.z * fwdScale);
		_effSpinRight.set(_right.x * rightScale, _right.y * rightScale, _right.z * rightScale);

		// Right
		if (this.actions.right.isPressed && !this.actions.left.isPressed) {
			if (angVel.dot(_spinFwd) < maxAirSpinMagnitude) {
				angVel.vadd(_effSpinFwd, angVel);
			}
		} else
		// Left
			if (this.actions.left.isPressed && !this.actions.right.isPressed) {
				if (angVel.dot(_spinFwd) > -maxAirSpinMagnitude) {
					angVel.vsub(_effSpinFwd, angVel);
				}
			}

		// Forwards
		if (this.canTiltForwards && this.actions.throttle.isPressed && !this.actions.reverse.isPressed) {
			if (angVel.dot(_spinRight) < maxAirSpinMagnitude) {
				angVel.vadd(_effSpinRight, angVel);
			}
		} else
		// Backwards
			if (this.actions.reverse.isPressed && !this.actions.throttle.isPressed) {
				if (angVel.dot(_spinRight) > -maxAirSpinMagnitude) {
					angVel.vsub(_effSpinRight, angVel);
				}
			}

		// Steering. Normalize velocity into a THREE scratch directly so
		// we don't allocate a CANNON.Vec3 just to copy out of it.
		_velocityNorm.set(v.x, v.y, v.z).normalize();
		let driftCorrection = Utils.getSignedAngleBetweenVectors(_velocityNorm, _forward);

		const maxSteerVal = 0.8;
		let speedFactor = THREE.MathUtils.clamp(this.speed * 0.3, 1, Number.MAX_VALUE);

		if (this.actions.right.isPressed)
		{
			let steering = Math.min(-maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else if (this.actions.left.isPressed)
		{
			let steering = Math.max(maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
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

	public readCarData(gltf: any): void
	{
		gltf.scene.traverse((child: THREE.Object3D) => {
			if (child.hasOwnProperty('userData'))
			{
				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'steering_wheel')
					{
						this.steeringWheel = child;
					}
				}
			}
		});
	}
}