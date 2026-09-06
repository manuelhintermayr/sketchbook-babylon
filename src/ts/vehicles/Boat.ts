import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { KeyBinding } from '../core/KeyBinding';
import * as Utils from '../core/FunctionLibrary';
import { SpringSimulator } from '../physics/spring_simulation/SpringSimulator';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';

// Ported from Inthenew/Sketchbook (MIT). The boat reuses the cannon
// raycast vehicle base for collision and wheel contacts, but drives
// itself by writing body.velocity directly in physicsPreStep and rides
// the visible waves by overriding body.position.y from
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

	private steeringWheel: THREE.Object3D | null = null;
	private steeringSimulator: SpringSimulator;
	private gear = 1;
	private shiftTime = 0.2;
	private shiftTimer = 0;
	private characterWantsToExit = false;

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
			rollInfluence: 0.8,
		});
		this.readBoatData(gltf);

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

		// The cannon raycast vehicle wants wheels for collision, but a boat
		// has none visually - hide the wheel objects every frame.
		this.wheels.forEach(wheel => { wheel.wheelObject.visible = false; });

		// Gear logic is retained to drive transmission shifts; engine force
		// itself is left at zero - Boat.physicsPreStep writes body.velocity
		// directly via goForward() instead.
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
			this.steeringWheel.rotation.z = -this.steeringSimulator.position * 2;
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

	private goForward(maxSpeed: number, body: CANNON.Body, forward: boolean): void
	{
		// If the chassis is touching ground (boat ran aground), let the
		// raycast vehicle handle physics normally.
		if (this.rayCastVehicle.numWheelsOnGround >= 1) return;

		const localForward = new CANNON.Vec3(0, 0, forward ? 1 : -1);
		const worldForward = body.quaternion.vmult(localForward);

		let currentSpeed = body.velocity.dot(worldForward);
		if (currentSpeed < maxSpeed) currentSpeed += this.accelerationIncrement;

		worldForward.scale(currentSpeed, worldForward);
		body.velocity.x = worldForward.x;
		body.velocity.z = worldForward.z;
	}

	public physicsPreStep(body: CANNON.Body, _boat: Boat): void
	{
		body.angularDamping = 0.9;
		const dt = 1 / 60;

		if (this.actions.throttle.isPressed && !this.actions.reverse.isPressed)
		{
			this.goForward(this.forwardSpeed, body, true);
		}
		else if (this.actions.reverse.isPressed && !this.actions.throttle.isPressed)
		{
			this.goForward(this.reverseSpeed, body, false);
		}

		// Hide doors that don't belong to a boat hull.
		this.seats.forEach(seat =>
		{
			if (seat.door)
			{
				seat.door.doorObject.visible = false;
				seat.door.preStepCallback();
			}
		});

		// Steering target with drift-correction smoothing.
		const velocity = new CANNON.Vec3().copy(body.velocity);
		velocity.normalize();
		const driftCorrection = Utils.getSignedAngleBetweenVectors(
			Utils.threeVector(velocity),
			new THREE.Vector3(0, 0, 1).applyQuaternion(Utils.threeQuat(body.quaternion)),
		);
		const maxSteerVal = 0.8;
		const speedFactor = THREE.MathUtils.clamp(this.speed * 0.3, 1, Number.MAX_VALUE);
		if (this.actions.right.isPressed)
		{
			const steering = Math.min(-maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else if (this.actions.left.isPressed)
		{
			const steering = Math.max(maxSteerVal / speedFactor, -driftCorrection);
			this.steeringSimulator.target = THREE.MathUtils.clamp(steering, -maxSteerVal, maxSteerVal);
		}
		else
		{
			this.steeringSimulator.target = 0;
		}

		// Yaw-only orientation: rebuild the quaternion from a YXZ Euler with
		// pitch/roll forced to zero, then null the X/Z angular velocity so
		// the solver can't reintroduce them on the next step.
		const currentQuat = Utils.threeQuat(body.quaternion);
		const euler = new THREE.Euler().setFromQuaternion(currentQuat, 'YXZ');
		euler.y += this.steeringSimulator.position * this.turnSpeed * dt * (Math.PI / 180);
		euler.x = 0;
		euler.z = 0;
		const newQuat = new THREE.Quaternion().setFromEuler(euler);
		body.quaternion.set(newQuat.x, newQuat.y, newQuat.z, newQuat.w);
		body.angularVelocity.x = 0;
		body.angularVelocity.z = 0;

		// Ride the wave: lerp the chassis y toward the sampled wave height
		// at the boat's xz, leaving the cannon solver to handle xz physics.
		const ocean = this.world?.ocean;
		if (ocean)
		{
			const time = ocean.getElapsedTime();
			const sampled = ocean.getWaveHeightAt(body.position.x, body.position.z, time);
			if (sampled !== 'inner-zone')
			{
				const lerpFactor = 0.6;
				body.position.y += (sampled - body.position.y) * lerpFactor;
				body.velocity.y = Math.max(body.velocity.y, 0);
			}
		}
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

	public readBoatData(gltf: any): void
	{
		gltf.scene.traverse((child: THREE.Object3D) =>
		{
			if (child.userData && child.userData.data === 'steering_wheel')
			{
				child.visible = false;
				this.steeringWheel = child;
			}
		});
	}
}
