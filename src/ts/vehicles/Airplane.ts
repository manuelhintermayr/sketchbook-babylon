import * as THREE from 'three';
import * as CANNON from 'cannon-es';

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

// Module-scoped scratch - see Helicopter.ts for the same pattern.
// physicsPreStep ran ~10 allocs per frame per plane; with these
// reused all the way down it's zero.
const _quat = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _forwardCannon = new CANNON.Vec3();
const _lookVelocity = new THREE.Vector3();
const _rotStabVelocity = new THREE.Quaternion();
const _rotStabEuler = new THREE.Euler();
const _RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const _UP_AXIS = new THREE.Vector3(0, 1, 0);
const _FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

export class Airplane extends Vehicle implements IControllable, IWorldEntity
{
	public entityType: EntityType = EntityType.Airplane;
	public rotor: THREE.Object3D;
	public leftAileron: THREE.Object3D;
	public rightAileron: THREE.Object3D;
	public elevators: THREE.Object3D[] = [];
	public rudder: THREE.Object3D;

	private steeringSimulator: SpringSimulator; 
	private aileronSimulator: SpringSimulator;
	private elevatorSimulator: SpringSimulator;
	private rudderSimulator: SpringSimulator;

	private enginePower: number = 0;
	private lastDrag: number = 0;

	constructor(gltf: any)
	{
		super(gltf, {
			radius: 0.12,
			suspensionStiffness: 150,
			suspensionRestLength: 0.25,
			dampingRelaxation: 5,
			dampingCompression: 5,
			directionLocal: new CANNON.Vec3(0, -1, 0),
			axleLocal: new CANNON.Vec3(-1, 0, 0),
			chassisConnectionPointLocal: new CANNON.Vec3(),
		});

		this.readAirplaneData(gltf);

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
		this.rotor.rotateX(this.enginePower * timeStep * 60);

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
		this.leftAileron.rotation.y = this.aileronSimulator.position;
		this.rightAileron.rotation.y = -this.aileronSimulator.position;
		this.elevators.forEach((elevator) =>
		{
			elevator.rotation.y = this.elevatorSimulator.position;
		});
		this.rudder.rotation.y = this.rudderSimulator.position;
	}

	public physicsPreStep(body: CANNON.Body, plane: Airplane): void
	{
		_quat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		_right.copy(_RIGHT_AXIS).applyQuaternion(_quat);
		_up.copy(_UP_AXIS).applyQuaternion(_quat);
		_forward.copy(_FORWARD_AXIS).applyQuaternion(_quat);

		// Forward speed via dot product - copy _forward into a CANNON
		// scratch so we can use the body.velocity.dot() native call
		// without allocating a temp Vec3 each frame.
		_forwardCannon.set(_forward.x, _forward.y, _forward.z);
		const velLength1 = body.velocity.length();
		const currentSpeed = body.velocity.dot(_forwardCannon);

		// Rotation controls influence
		let flightModeInfluence = currentSpeed / 10;
		flightModeInfluence = THREE.MathUtils.clamp(flightModeInfluence, 0, 1);

		let lowerMassInfluence = currentSpeed / 10;
		lowerMassInfluence = THREE.MathUtils.clamp(lowerMassInfluence, 0, 1);
		this.collision.mass = 50 * (1 - (lowerMassInfluence * 0.6));

		// Rotation stabilization. _lookVelocity is body.velocity copied
		// into a THREE.Vector3 (so we can call setFromUnitVectors which
		// only takes THREE types) and normalised.
		_lookVelocity.set(body.velocity.x, body.velocity.y, body.velocity.z).normalize();
		_rotStabVelocity.setFromUnitVectors(_forward, _lookVelocity);
		_rotStabVelocity.x *= 0.3;
		_rotStabVelocity.y *= 0.3;
		_rotStabVelocity.z *= 0.3;
		_rotStabVelocity.w *= 0.3;
		_rotStabEuler.setFromQuaternion(_rotStabVelocity);

		let rotStabInfluence = THREE.MathUtils.clamp(velLength1 - 1, 0, 0.1);  // Only with speed greater than 1 UPS
		rotStabInfluence *= (this.rayCastVehicle.numWheelsOnGround > 0 && currentSpeed < 0 ? 0 : 1);    // Reverse fix
		const loopFix = (this.actions.throttle.isPressed && currentSpeed > 0 ? 0 : 1);

		body.angularVelocity.x += _rotStabEuler.x * rotStabInfluence * loopFix;
		body.angularVelocity.y += _rotStabEuler.y * rotStabInfluence;
		body.angularVelocity.z += _rotStabEuler.z * rotStabInfluence * loopFix;

		// Pitch
		if (plane.actions.pitchUp.isPressed)
		{
			body.angularVelocity.x -= _right.x * 0.04 * flightModeInfluence * this.enginePower;
			body.angularVelocity.y -= _right.y * 0.04 * flightModeInfluence * this.enginePower;
			body.angularVelocity.z -= _right.z * 0.04 * flightModeInfluence * this.enginePower;
		}
		if (plane.actions.pitchDown.isPressed)
		{
			body.angularVelocity.x += _right.x * 0.04 * flightModeInfluence * this.enginePower;
			body.angularVelocity.y += _right.y * 0.04 * flightModeInfluence * this.enginePower;
			body.angularVelocity.z += _right.z * 0.04 * flightModeInfluence * this.enginePower;
		}

		// Yaw
		if (plane.actions.yawLeft.isPressed)
		{
			body.angularVelocity.x += _up.x * 0.02 * flightModeInfluence * this.enginePower;
			body.angularVelocity.y += _up.y * 0.02 * flightModeInfluence * this.enginePower;
			body.angularVelocity.z += _up.z * 0.02 * flightModeInfluence * this.enginePower;
		}
		if (plane.actions.yawRight.isPressed)
		{
			body.angularVelocity.x -= _up.x * 0.02 * flightModeInfluence * this.enginePower;
			body.angularVelocity.y -= _up.y * 0.02 * flightModeInfluence * this.enginePower;
			body.angularVelocity.z -= _up.z * 0.02 * flightModeInfluence * this.enginePower;
		}

		// Roll
		if (plane.actions.rollLeft.isPressed)
		{
			body.angularVelocity.x -= _forward.x * 0.055 * flightModeInfluence * this.enginePower;
			body.angularVelocity.y -= _forward.y * 0.055 * flightModeInfluence * this.enginePower;
			body.angularVelocity.z -= _forward.z * 0.055 * flightModeInfluence * this.enginePower;
		}
		if (plane.actions.rollRight.isPressed)
		{
			body.angularVelocity.x += _forward.x * 0.055 * flightModeInfluence * this.enginePower;
			body.angularVelocity.y += _forward.y * 0.055 * flightModeInfluence * this.enginePower;
			body.angularVelocity.z += _forward.z * 0.055 * flightModeInfluence * this.enginePower;
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

		body.velocity.x += (velLength1 * this.lastDrag + speedModifier) * _forward.x * this.enginePower;
		body.velocity.y += (velLength1 * this.lastDrag + speedModifier) * _forward.y * this.enginePower;
		body.velocity.z += (velLength1 * this.lastDrag + speedModifier) * _forward.z * this.enginePower;

		// Drag
		let velLength2 = body.velocity.length();
		const drag = Math.pow(velLength2, 1) * 0.003 * this.enginePower;
		body.velocity.x -= body.velocity.x * drag;
		body.velocity.y -= body.velocity.y * drag;
		body.velocity.z -= body.velocity.z * drag;
		this.lastDrag = drag;

		// Lift
		let lift = Math.pow(velLength2, 1) * 0.005 * this.enginePower;
		lift = THREE.MathUtils.clamp(lift, 0, 0.05);
		body.velocity.x += _up.x * lift;
		body.velocity.y += _up.y * lift;
		body.velocity.z += _up.z * lift;

		// Angular damping
		body.angularVelocity.x = THREE.MathUtils.lerp(body.angularVelocity.x, body.angularVelocity.x * 0.98, flightModeInfluence);
		body.angularVelocity.y = THREE.MathUtils.lerp(body.angularVelocity.y, body.angularVelocity.y * 0.98, flightModeInfluence);
		body.angularVelocity.z = THREE.MathUtils.lerp(body.angularVelocity.z, body.angularVelocity.z * 0.98, flightModeInfluence);
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

	public readAirplaneData(gltf: any): void
	{
		gltf.scene.traverse((child) => {
			if (child.hasOwnProperty('userData'))
			{
				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'rotor')
					{
						this.rotor = child;
					}
					if (child.userData.data === 'rudder')
					{
						this.rudder = child;
					}
					if (child.userData.data === 'elevator')
					{
						this.elevators.push(child);
					}
					if (child.userData.data === 'aileron')
					{
						if (child.userData.hasOwnProperty('side')) 
						{
							if (child.userData.side === 'left')
							{
								this.leftAileron = child;
							}
							else if (child.userData.side === 'right')
							{
								this.rightAileron = child;
							}
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