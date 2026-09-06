import { Axis, PhysicsBody, Quaternion, Space, TransformNode, Vector3 } from '@babylonjs/core';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { KeyBinding } from '../core/KeyBinding';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import * as Utils from '../core/FunctionLibrary';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';
import { LoadedModel } from '../core/LoadingManager';

// Module-scoped scratch - see Helicopter.ts for the same pattern.
// physicsPreStep ran ~10 allocs per frame per plane; with these
// reused all the way down it's zero.
const _quat = new Quaternion();
const _right = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const _velocity = new Vector3();
const _angVel = new Vector3();
const _lookVelocity = new Vector3();
const _rotStabVelocity = new Quaternion();
const _rotStabEuler = new Vector3();
const _RIGHT_AXIS = new Vector3(1, 0, 0);
const _UP_AXIS = new Vector3(0, 1, 0);
const _FORWARD_AXIS = new Vector3(0, 0, 1);

export class Airplane extends Vehicle implements IControllable, IWorldEntity
{
	public entityType: EntityType = EntityType.Airplane;
	public rotor: TransformNode;
	public leftAileron: TransformNode;
	public rightAileron: TransformNode;
	public elevators: TransformNode[] = [];
	public rudder: TransformNode;

	private steeringSimulator: SpringSimulator;
	private aileronSimulator: SpringSimulator;
	private elevatorSimulator: SpringSimulator;
	private rudderSimulator: SpringSimulator;

	private enginePower: number = 0;
	private lastDrag: number = 0;
	private currentMass: number = 50;

	constructor(model: LoadedModel)
	{
		super(model, {
			radius: 0.12,
			suspensionStiffness: 150,
			suspensionRestLength: 0.25,
			dampingRelaxation: 5,
			dampingCompression: 5,
			directionLocal: new Vector3(0, -1, 0),
			axleLocal: new Vector3(-1, 0, 0),
			chassisConnectionPointLocal: new Vector3(),
		});

		this.readAirplaneData(model);

		this.actions = {
			'throttle': new KeyBinding('ShiftLeft'),
			'brake': new KeyBinding('Space'),
			'wheelBrake': new KeyBinding('KeyB'),
			'pitchUp': new KeyBinding('KeyS'),
			'pitchDown': new KeyBinding('KeyW'),
			'yawLeft': new KeyBinding('KeyQ'),
			'yawRight': new KeyBinding('KeyE'),
			'rollLeft': new KeyBinding('KeyA'),
			'rollRight': new KeyBinding('KeyD'),
			'exitVehicle': new KeyBinding('KeyF'),
			'seat_switch': new KeyBinding('KeyX'),
			'view': new KeyBinding('KeyV'),
		};

		this.steeringSimulator = new SpringSimulator(60, 10, 0.6);
		this.aileronSimulator = new SpringSimulator(60, 5, 0.6);
		this.elevatorSimulator = new SpringSimulator(60, 7, 0.6);
		this.rudderSimulator = new SpringSimulator(60, 10, 0.6);

		// Slow flight is intentional, so don't flag it as stuck. Flip
		// recovery still helps after a crash-landing on the wing.
		this.recovery.stuckRecoveryEnabled = false;

		this.engineSoundProfile = ENGINE_PROFILES.airplane;
	}

	public noDirectionPressed(): boolean
	{
		let result =
		!this.actions.throttle.isPressed &&
		!this.actions.brake.isPressed &&
		!this.actions.yawLeft.isPressed &&
		!this.actions.yawRight.isPressed &&
		!this.actions.rollLeft.isPressed &&
		!this.actions.rollRight.isPressed;

		return result;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		// Rotors visuals
		if (this.controllingCharacter !== undefined)
		{
			if (this.enginePower < 1) this.enginePower += timeStep * 0.4;
			if (this.enginePower > 1) this.enginePower = 1;
		}
		else
		{
			if (this.enginePower > 0) this.enginePower -= timeStep * 0.12;
			if (this.enginePower < 0) this.enginePower = 0;
		}
		this.rotor.rotate(Axis.X, this.enginePower * timeStep * 60, Space.LOCAL);

		// Steering
		if (this.rayCastVehicle.numWheelsOnGround > 0)
		{
			if ((this.actions.yawLeft.isPressed || this.actions.rollLeft.isPressed)
				&& !this.actions.yawRight.isPressed && !this.actions.rollRight.isPressed)
			{
				this.steeringSimulator.target = 0.8;
			}
			else if ((this.actions.yawRight.isPressed || this.actions.rollRight.isPressed)
				&& !this.actions.yawLeft.isPressed && !this.actions.rollLeft.isPressed)
			{
				this.steeringSimulator.target = -0.8;
			}
			else
			{
				this.steeringSimulator.target = 0;
			}
		}
		else
		{
			this.steeringSimulator.target = 0;
		}
		this.steeringSimulator.simulate(timeStep);
		this.setSteeringValue(this.steeringSimulator.position);

		const partsRotationAmount = 0.7;

		// Ailerons
		if (this.actions.rollLeft.isPressed && !this.actions.rollRight.isPressed)
		{
			this.aileronSimulator.target = partsRotationAmount;
		}
		else if (!this.actions.rollLeft.isPressed && this.actions.rollRight.isPressed)
		{
			this.aileronSimulator.target = -partsRotationAmount;
		}
		else
		{
			this.aileronSimulator.target = 0;
		}

		// Elevators
		if (this.actions.pitchUp.isPressed && !this.actions.pitchDown.isPressed)
		{
			this.elevatorSimulator.target = partsRotationAmount;
		}
		else if (!this.actions.pitchUp.isPressed && this.actions.pitchDown.isPressed)
		{
			this.elevatorSimulator.target = -partsRotationAmount;
		}
		else
		{
			this.elevatorSimulator.target = 0;
		}

		// Rudder
		if (this.actions.yawLeft.isPressed && !this.actions.yawRight.isPressed)
		{
			this.rudderSimulator.target = partsRotationAmount;
		}
		else if (!this.actions.yawLeft.isPressed && this.actions.yawRight.isPressed)
		{
			this.rudderSimulator.target = -partsRotationAmount;
		}
		else
		{
			this.rudderSimulator.target = 0;
		}

		// Run rotation simulators
		this.aileronSimulator.simulate(timeStep);
		this.elevatorSimulator.simulate(timeStep);
		this.rudderSimulator.simulate(timeStep);

		// Rotate parts
		Utils.setEulerComponent(this.leftAileron, 'y', this.aileronSimulator.position);
		Utils.setEulerComponent(this.rightAileron, 'y', -this.aileronSimulator.position);
		this.elevators.forEach((elevator) =>
		{
			Utils.setEulerComponent(elevator, 'y', this.elevatorSimulator.position);
		});
		Utils.setEulerComponent(this.rudder, 'y', this.rudderSimulator.position);
	}

	public physicsPreStep(body: PhysicsBody, plane: Airplane): void
	{
		_quat.copyFrom(this.rotationQuaternion);
		_right.copyFrom(_RIGHT_AXIS).applyRotationQuaternionInPlace(_quat);
		_up.copyFrom(_UP_AXIS).applyRotationQuaternionInPlace(_quat);
		_forward.copyFrom(_FORWARD_AXIS).applyRotationQuaternionInPlace(_quat);

		body.getLinearVelocityToRef(_velocity);
		body.getAngularVelocityToRef(_angVel);
		const velLength1 = _velocity.length();
		const currentSpeed = Vector3.Dot(_velocity, _forward);

		// Rotation controls influence
		let flightModeInfluence = currentSpeed / 10;
		flightModeInfluence = Utils.clamp(flightModeInfluence, 0, 1);

		let lowerMassInfluence = currentSpeed / 10;
		lowerMassInfluence = Utils.clamp(lowerMassInfluence, 0, 1);
		// Lighter at speed. Havok recomputes inertia for the new mass;
		// only write when the value actually moved to spare the WASM call.
		const targetMass = 50 * (1 - (lowerMassInfluence * 0.6));
		if (Math.abs(targetMass - this.currentMass) > 0.01)
		{
			this.currentMass = targetMass;
			body.setMassProperties({ mass: targetMass, centerOfMass: Vector3.Zero() });
		}

		// Rotation stabilization. _lookVelocity is the velocity
		// normalised; the quaternion between forward and it, scaled to
		// 0.3, becomes a small corrective angular velocity.
		_lookVelocity.copyFrom(_velocity).normalize();
		Quaternion.FromUnitVectorsToRef(_forward, _lookVelocity, _rotStabVelocity);
		_rotStabVelocity.x *= 0.3;
		_rotStabVelocity.y *= 0.3;
		_rotStabVelocity.z *= 0.3;
		_rotStabVelocity.w *= 0.3;
		Utils.eulerFromQuaternion(_rotStabVelocity, 'XYZ', _rotStabEuler);

		let rotStabInfluence = Utils.clamp(velLength1 - 1, 0, 0.1);  // Only with speed greater than 1 UPS
		rotStabInfluence *= (this.rayCastVehicle.numWheelsOnGround > 0 && currentSpeed < 0 ? 0 : 1);    // Reverse fix
		const loopFix = (this.actions.throttle.isPressed && currentSpeed > 0 ? 0 : 1);

		_angVel.x += _rotStabEuler.x * rotStabInfluence * loopFix;
		_angVel.y += _rotStabEuler.y * rotStabInfluence;
		_angVel.z += _rotStabEuler.z * rotStabInfluence * loopFix;

		// Pitch
		if (plane.actions.pitchUp.isPressed)
		{
			_angVel.x -= _right.x * 0.04 * flightModeInfluence * this.enginePower;
			_angVel.y -= _right.y * 0.04 * flightModeInfluence * this.enginePower;
			_angVel.z -= _right.z * 0.04 * flightModeInfluence * this.enginePower;
		}
		if (plane.actions.pitchDown.isPressed)
		{
			_angVel.x += _right.x * 0.04 * flightModeInfluence * this.enginePower;
			_angVel.y += _right.y * 0.04 * flightModeInfluence * this.enginePower;
			_angVel.z += _right.z * 0.04 * flightModeInfluence * this.enginePower;
		}

		// Yaw
		if (plane.actions.yawLeft.isPressed)
		{
			_angVel.x += _up.x * 0.02 * flightModeInfluence * this.enginePower;
			_angVel.y += _up.y * 0.02 * flightModeInfluence * this.enginePower;
			_angVel.z += _up.z * 0.02 * flightModeInfluence * this.enginePower;
		}
		if (plane.actions.yawRight.isPressed)
		{
			_angVel.x -= _up.x * 0.02 * flightModeInfluence * this.enginePower;
			_angVel.y -= _up.y * 0.02 * flightModeInfluence * this.enginePower;
			_angVel.z -= _up.z * 0.02 * flightModeInfluence * this.enginePower;
		}

		// Roll
		if (plane.actions.rollLeft.isPressed)
		{
			_angVel.x -= _forward.x * 0.055 * flightModeInfluence * this.enginePower;
			_angVel.y -= _forward.y * 0.055 * flightModeInfluence * this.enginePower;
			_angVel.z -= _forward.z * 0.055 * flightModeInfluence * this.enginePower;
		}
		if (plane.actions.rollRight.isPressed)
		{
			_angVel.x += _forward.x * 0.055 * flightModeInfluence * this.enginePower;
			_angVel.y += _forward.y * 0.055 * flightModeInfluence * this.enginePower;
			_angVel.z += _forward.z * 0.055 * flightModeInfluence * this.enginePower;
		}

		// Thrust
		let speedModifier = 0.02;
		if (plane.actions.throttle.isPressed && !plane.actions.brake.isPressed)
		{
			speedModifier = 0.06;
		}
		else if (!plane.actions.throttle.isPressed && plane.actions.brake.isPressed)
		{
			speedModifier = -0.05;
		}
		else if (this.rayCastVehicle.numWheelsOnGround > 0)
		{
			speedModifier = 0;
		}

		_velocity.x += (velLength1 * this.lastDrag + speedModifier) * _forward.x * this.enginePower;
		_velocity.y += (velLength1 * this.lastDrag + speedModifier) * _forward.y * this.enginePower;
		_velocity.z += (velLength1 * this.lastDrag + speedModifier) * _forward.z * this.enginePower;

		// Drag
		let velLength2 = _velocity.length();
		const drag = Math.pow(velLength2, 1) * 0.003 * this.enginePower;
		_velocity.x -= _velocity.x * drag;
		_velocity.y -= _velocity.y * drag;
		_velocity.z -= _velocity.z * drag;
		this.lastDrag = drag;

		// Lift
		let lift = Math.pow(velLength2, 1) * 0.005 * this.enginePower;
		lift = Utils.clamp(lift, 0, 0.05);
		_velocity.x += _up.x * lift;
		_velocity.y += _up.y * lift;
		_velocity.z += _up.z * lift;

		// Angular damping
		_angVel.x = Utils.lerp(_angVel.x, _angVel.x * 0.98, flightModeInfluence);
		_angVel.y = Utils.lerp(_angVel.y, _angVel.y * 0.98, flightModeInfluence);
		_angVel.z = Utils.lerp(_angVel.z, _angVel.z * 0.98, flightModeInfluence);

		body.setLinearVelocity(_velocity);
		body.setAngularVelocity(_angVel);
	}

	public onInputChange(): void
	{
		super.onInputChange();

		const brakeForce = 100;

		if (this.actions.exitVehicle.justPressed && this.controllingCharacter !== undefined)
		{
			this.forceCharacterOut();
		}
		if (this.actions.wheelBrake.justPressed)
		{
			this.setBrake(brakeForce);
		}
		if (this.actions.wheelBrake.justReleased)
		{
			this.setBrake(0);
		}
		if (this.actions.view.justPressed)
		{
			this.toggleFirstPersonView();
		}
	}

	public readAirplaneData(model: LoadedModel): void
	{
		Utils.traverse(model.root, (child) => {
			if (!(child instanceof TransformNode)) return;
			const ud = Utils.userData(child);
			if (ud.hasOwnProperty('data'))
			{
				if (ud.data === 'rotor')
				{
					this.rotor = child;
				}
				if (ud.data === 'rudder')
				{
					this.rudder = child;
				}
				if (ud.data === 'elevator')
				{
					this.elevators.push(child);
				}
				if (ud.data === 'aileron')
				{
					if (ud.hasOwnProperty('side'))
					{
						if (ud.side === 'left')
						{
							this.leftAileron = child;
						}
						else if (ud.side === 'right')
						{
							this.rightAileron = child;
						}
					}
				}
			}
		});
	}

	public inputReceiverInit(): void
	{
		super.inputReceiverInit();

		this.world.updateControls([
			{ keys: ['Shift'],   desc: t('controls.accelerate') },
			{ keys: ['Space'],   desc: t('controls.decelerate') },
			{ keys: ['W', 'S'],  desc: t('controls.elevators') },
			{ keys: ['A', 'D'],  desc: t('controls.ailerons') },
			{ keys: ['Q', 'E'],  desc: t('controls.rudderSteering') },
			{ keys: ['B'],       desc: t('controls.brake') },
			...commonVehicleControls(this.seatSwitchAvailable()),
		]);
	}
}
