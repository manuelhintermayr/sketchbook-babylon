import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import * as Utils from '../core/FunctionLibrary';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { KeyBinding } from '../core/KeyBinding';
import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';

// Module-scoped scratch - physicsPreStep runs at 60Hz per heli, so
// every `new Vector3` here would cost 9 allocations × frame × instance.
// Reuse these instead. Constants ending in _AXIS are immutable seeds
// that we copy() into a working scratch before applying transforms.
const _quat = new THREE.Quaternion();
const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _forward = new THREE.Vector3();
const _vertDamping = new THREE.Vector3();
const _vertStab = new THREE.Vector3();
const _rotStabVelocity = new THREE.Quaternion();
const _rotStabEuler = new THREE.Euler();
const _GLOBAL_UP = new THREE.Vector3(0, 1, 0);
const _RIGHT_AXIS = new THREE.Vector3(1, 0, 0);
const _UP_AXIS = new THREE.Vector3(0, 1, 0);
const _FORWARD_AXIS = new THREE.Vector3(0, 0, 1);

export class Helicopter extends Vehicle implements IControllable, IWorldEntity
{
	public entityType: EntityType = EntityType.Helicopter;
	public rotors: THREE.Object3D[] = [];
	private enginePower: number = 0;

	constructor(gltf: any)
	{
		super(gltf);

		this.readHelicopterData(gltf);

		this.actions = {
			'ascend': new KeyBinding('ShiftLeft'),
			'descend': new KeyBinding('Space'),
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

		// Helis hover deliberately, so low-movement is intentional. Flip
		// recovery still helps when one crashes on its side.
		this.recovery.stuckRecoveryEnabled = false;

		this.engineSoundProfile = ENGINE_PROFILES.heli;
	}

	public noDirectionPressed(): boolean
	{
		let result = 
		!this.actions.ascend.isPressed &&
		!this.actions.descend.isPressed;

		return result;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);
		
		// Rotors visuals
		if (this.controllingCharacter !== undefined)
		{
			if (this.enginePower < 1) this.enginePower += timeStep * 0.2;
			if (this.enginePower > 1) this.enginePower = 1;
		}
		else
		{
			if (this.enginePower > 0) this.enginePower -= timeStep * 0.06;
			if (this.enginePower < 0) this.enginePower = 0;
		}

		this.rotors.forEach((rotor) =>
		{
			rotor.rotateX(this.enginePower * timeStep * 30);
		});
	}

	public onInputChange(): void
	{
		super.onInputChange();

		if (this.actions.exitVehicle.justPressed && this.controllingCharacter !== undefined)
		{
			this.forceCharacterOut();
		}
		if (this.actions.view.justPressed)
		{
			this.toggleFirstPersonView();
		}
	}

	public physicsPreStep(body: CANNON.Body, heli: Helicopter): void
	{
		_quat.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
		_right.copy(_RIGHT_AXIS).applyQuaternion(_quat);
		_up.copy(_UP_AXIS).applyQuaternion(_quat);
		_forward.copy(_FORWARD_AXIS).applyQuaternion(_quat);

		// Throttle
		if (heli.actions.ascend.isPressed)
		{
			body.velocity.x += _up.x * 0.15 * this.enginePower;
			body.velocity.y += _up.y * 0.15 * this.enginePower;
			body.velocity.z += _up.z * 0.15 * this.enginePower;
		}
		if (heli.actions.descend.isPressed)
		{
			body.velocity.x -= _up.x * 0.15 * this.enginePower;
			body.velocity.y -= _up.y * 0.15 * this.enginePower;
			body.velocity.z -= _up.z * 0.15 * this.enginePower;
		}

		// Vertical stabilization. Inline the gravity-vector length math
		// instead of allocating a CANNON.Vec3 to call .length() on.
		const gravity = heli.world.physicsWorld.gravity;
		let gravityCompensation = Math.sqrt(gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z);
		gravityCompensation *= heli.world.physicsFrameTime;
		gravityCompensation *= 0.98;
		const dot = _GLOBAL_UP.dot(_up);
		gravityCompensation *= Math.sqrt(THREE.MathUtils.clamp(dot, 0, 1));

		_vertDamping.set(0, body.velocity.y, 0).multiplyScalar(-0.01);
		_vertStab.copy(_up).multiplyScalar(gravityCompensation).add(_vertDamping).multiplyScalar(heli.enginePower);

		body.velocity.x += _vertStab.x;
		body.velocity.y += _vertStab.y;
		body.velocity.z += _vertStab.z;

		// Positional damping
		body.velocity.x *= THREE.MathUtils.lerp(1, 0.995, this.enginePower);
		body.velocity.z *= THREE.MathUtils.lerp(1, 0.995, this.enginePower);

		// Rotation stabilization
		if (this.controllingCharacter !== undefined)
		{
			_rotStabVelocity.setFromUnitVectors(_up, _GLOBAL_UP);
			_rotStabVelocity.x *= 0.3;
			_rotStabVelocity.y *= 0.3;
			_rotStabVelocity.z *= 0.3;
			_rotStabVelocity.w *= 0.3;
			_rotStabEuler.setFromQuaternion(_rotStabVelocity);

			body.angularVelocity.x += _rotStabEuler.x * this.enginePower;
			body.angularVelocity.y += _rotStabEuler.y * this.enginePower;
			body.angularVelocity.z += _rotStabEuler.z * this.enginePower;
		}

		// Pitch
		if (heli.actions.pitchUp.isPressed)
		{
			body.angularVelocity.x -= _right.x * 0.07 * this.enginePower;
			body.angularVelocity.y -= _right.y * 0.07 * this.enginePower;
			body.angularVelocity.z -= _right.z * 0.07 * this.enginePower;
		}
		if (heli.actions.pitchDown.isPressed)
		{
			body.angularVelocity.x += _right.x * 0.07 * this.enginePower;
			body.angularVelocity.y += _right.y * 0.07 * this.enginePower;
			body.angularVelocity.z += _right.z * 0.07 * this.enginePower;
		}

		// Yaw
		if (heli.actions.yawLeft.isPressed)
		{
			body.angularVelocity.x += _up.x * 0.07 * this.enginePower;
			body.angularVelocity.y += _up.y * 0.07 * this.enginePower;
			body.angularVelocity.z += _up.z * 0.07 * this.enginePower;
		}
		if (heli.actions.yawRight.isPressed)
		{
			body.angularVelocity.x -= _up.x * 0.07 * this.enginePower;
			body.angularVelocity.y -= _up.y * 0.07 * this.enginePower;
			body.angularVelocity.z -= _up.z * 0.07 * this.enginePower;
		}

		// Roll
		if (heli.actions.rollLeft.isPressed)
		{
			body.angularVelocity.x -= _forward.x * 0.07 * this.enginePower;
			body.angularVelocity.y -= _forward.y * 0.07 * this.enginePower;
			body.angularVelocity.z -= _forward.z * 0.07 * this.enginePower;
		}
		if (heli.actions.rollRight.isPressed)
		{
			body.angularVelocity.x += _forward.x * 0.07 * this.enginePower;
			body.angularVelocity.y += _forward.y * 0.07 * this.enginePower;
			body.angularVelocity.z += _forward.z * 0.07 * this.enginePower;
		}

		// Angular damping
		body.angularVelocity.x *= 0.97;
		body.angularVelocity.y *= 0.97;
		body.angularVelocity.z *= 0.97;
	}

	public readHelicopterData(gltf: any): void
	{
		gltf.scene.traverse((child) => {
			if (child.hasOwnProperty('userData'))
			{
				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'rotor')
					{
						this.rotors.push(child);
					}
				}
			}
		});
	}

	public inputReceiverInit(): void
	{
		super.inputReceiverInit();

		this.world.updateControls([
			{ keys: ['Shift'],   desc: t('controls.ascend') },
			{ keys: ['Space'],   desc: t('controls.descend') },
			{ keys: ['W', 'S'],  desc: t('controls.pitch') },
			{ keys: ['Q', 'E'],  desc: t('controls.yaw') },
			{ keys: ['A', 'D'],  desc: t('controls.roll') },
			...commonVehicleControls(this.seatSwitchAvailable()),
		]);
	}
}