import { Axis, PhysicsBody, Quaternion, Space, TransformNode, Vector3 } from '@babylonjs/core';

import * as Utils from '../core/FunctionLibrary';
import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { KeyBinding } from '../core/KeyBinding';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';
import { LoadedModel } from '../core/LoadingManager';

// Module-scoped scratch - physicsPreStep runs at 60Hz per heli, so
// every `new Vector3` here would cost 9 allocations x frame x instance.
// Reuse these instead. Constants ending in _AXIS are immutable seeds
// that we copy() into a working scratch before applying transforms.
const _quat = new Quaternion();
const _right = new Vector3();
const _up = new Vector3();
const _forward = new Vector3();
const _velocity = new Vector3();
const _angVel = new Vector3();
const _vertDamping = new Vector3();
const _vertStab = new Vector3();
const _rotStabVelocity = new Quaternion();
const _rotStabEuler = new Vector3();
const _GLOBAL_UP = new Vector3(0, 1, 0);
const _RIGHT_AXIS = new Vector3(1, 0, 0);
const _UP_AXIS = new Vector3(0, 1, 0);
const _FORWARD_AXIS = new Vector3(0, 0, 1);

export class Helicopter extends Vehicle implements IControllable, IWorldEntity
{
	public entityType: EntityType = EntityType.Helicopter;
	public rotors: TransformNode[] = [];
	private enginePower: number = 0;

	constructor(model: LoadedModel)
	{
		super(model);

		this.readHelicopterData(model);

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
			rotor.rotate(Axis.X, this.enginePower * timeStep * 30, Space.LOCAL);
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

	public physicsPreStep(body: PhysicsBody, heli: Helicopter): void
	{
		_quat.copyFrom(this.rotationQuaternion);
		_right.copyFrom(_RIGHT_AXIS).applyRotationQuaternionInPlace(_quat);
		_up.copyFrom(_UP_AXIS).applyRotationQuaternionInPlace(_quat);
		_forward.copyFrom(_FORWARD_AXIS).applyRotationQuaternionInPlace(_quat);

		body.getLinearVelocityToRef(_velocity);
		body.getAngularVelocityToRef(_angVel);

		// Throttle
		if (heli.actions.ascend.isPressed)
		{
			_velocity.x += _up.x * 0.15 * this.enginePower;
			_velocity.y += _up.y * 0.15 * this.enginePower;
			_velocity.z += _up.z * 0.15 * this.enginePower;
		}
		if (heli.actions.descend.isPressed)
		{
			_velocity.x -= _up.x * 0.15 * this.enginePower;
			_velocity.y -= _up.y * 0.15 * this.enginePower;
			_velocity.z -= _up.z * 0.15 * this.enginePower;
		}

		// Vertical stabilization
		const gravity = heli.world.physicsWorld.gravity;
		let gravityCompensation = Math.sqrt(gravity.x * gravity.x + gravity.y * gravity.y + gravity.z * gravity.z);
		gravityCompensation *= heli.world.physicsFrameTime;
		gravityCompensation *= 0.98;
		const dot = Vector3.Dot(_GLOBAL_UP, _up);
		gravityCompensation *= Math.sqrt(Utils.clamp(dot, 0, 1));

		_vertDamping.set(0, _velocity.y, 0).scaleInPlace(-0.01);
		_vertStab.copyFrom(_up).scaleInPlace(gravityCompensation).addInPlace(_vertDamping).scaleInPlace(heli.enginePower);

		_velocity.x += _vertStab.x;
		_velocity.y += _vertStab.y;
		_velocity.z += _vertStab.z;

		// Positional damping
		_velocity.x *= Utils.lerp(1, 0.995, this.enginePower);
		_velocity.z *= Utils.lerp(1, 0.995, this.enginePower);

		// Rotation stabilization
		if (this.controllingCharacter !== undefined)
		{
			Quaternion.FromUnitVectorsToRef(_up, _GLOBAL_UP, _rotStabVelocity);
			_rotStabVelocity.x *= 0.3;
			_rotStabVelocity.y *= 0.3;
			_rotStabVelocity.z *= 0.3;
			_rotStabVelocity.w *= 0.3;
			Utils.eulerFromQuaternion(_rotStabVelocity, 'XYZ', _rotStabEuler);

			_angVel.x += _rotStabEuler.x * this.enginePower;
			_angVel.y += _rotStabEuler.y * this.enginePower;
			_angVel.z += _rotStabEuler.z * this.enginePower;
		}

		// Pitch
		if (heli.actions.pitchUp.isPressed)
		{
			_angVel.x -= _right.x * 0.07 * this.enginePower;
			_angVel.y -= _right.y * 0.07 * this.enginePower;
			_angVel.z -= _right.z * 0.07 * this.enginePower;
		}
		if (heli.actions.pitchDown.isPressed)
		{
			_angVel.x += _right.x * 0.07 * this.enginePower;
			_angVel.y += _right.y * 0.07 * this.enginePower;
			_angVel.z += _right.z * 0.07 * this.enginePower;
		}

		// Yaw
		if (heli.actions.yawLeft.isPressed)
		{
			_angVel.x += _up.x * 0.07 * this.enginePower;
			_angVel.y += _up.y * 0.07 * this.enginePower;
			_angVel.z += _up.z * 0.07 * this.enginePower;
		}
		if (heli.actions.yawRight.isPressed)
		{
			_angVel.x -= _up.x * 0.07 * this.enginePower;
			_angVel.y -= _up.y * 0.07 * this.enginePower;
			_angVel.z -= _up.z * 0.07 * this.enginePower;
		}

		// Roll
		if (heli.actions.rollLeft.isPressed)
		{
			_angVel.x -= _forward.x * 0.07 * this.enginePower;
			_angVel.y -= _forward.y * 0.07 * this.enginePower;
			_angVel.z -= _forward.z * 0.07 * this.enginePower;
		}
		if (heli.actions.rollRight.isPressed)
		{
			_angVel.x += _forward.x * 0.07 * this.enginePower;
			_angVel.y += _forward.y * 0.07 * this.enginePower;
			_angVel.z += _forward.z * 0.07 * this.enginePower;
		}

		// Angular damping
		_angVel.x *= 0.97;
		_angVel.y *= 0.97;
		_angVel.z *= 0.97;

		body.setLinearVelocity(_velocity);
		body.setAngularVelocity(_angVel);
	}

	public readHelicopterData(model: LoadedModel): void
	{
		Utils.traverse(model.root, (child) => {
			if (!(child instanceof TransformNode)) return;
			const ud = Utils.userData(child);
			if (ud.data === 'rotor')
			{
				this.rotors.push(child);
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
