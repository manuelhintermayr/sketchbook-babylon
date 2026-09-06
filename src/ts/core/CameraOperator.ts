import { Matrix, PhysicsBody, Quaternion, TargetCamera, Vector2, Vector3 } from '@babylonjs/core';
import * as _ from 'lodash';

import * as Utils from './FunctionLibrary';
import { World } from '../world/World';
import { IInputReceiver } from '../interfaces/IInputReceiver';
import { KeyBinding } from './KeyBinding';
import { Character } from '../characters/Character';
import { IUpdatable } from '../interfaces/IUpdatable';
import { EntityType } from '../enums/EntityType';
import { UpdateOrder } from '../enums/UpdateOrder';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { t } from '../i18n';

// Scratch for the per-frame vector math - the free-cam integration and
// the first-person auto-return run every frame.
const _dir = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _forward = new Vector3();
const _lookDir = new Vector3();
const _targetPos = new Vector3();
const _lookAt = new Matrix();
const _desired = new Quaternion();
const _LOCAL_UP = new Vector3(0, 1, 0);
const _LOCAL_RIGHT = new Vector3(1, 0, 0);
// Cameras look down their local -Z in a right-handed scene.
const _LOCAL_FORWARD = new Vector3(0, 0, -1);
const _FORWARD_AXIS = new Vector3(0, 0, 1);

export class CameraOperator implements IInputReceiver, IUpdatable
{
	public updateOrder: number = UpdateOrder.Camera;

	public world: World;
	public camera: TargetCamera;
	public target: Vector3;
	public sensitivity: Vector2;
	public radius: number = 1;
	public theta: number;
	public phi: number;
	public onMouseDownPosition: Vector2;
	public onMouseDownTheta: any;
	public onMouseDownPhi: any;
	public targetRadius: number = 1;

	public movementSpeed: number;
	public actions: { [action: string]: KeyBinding };

	public upVelocity: number = 0;
	public forwardVelocity: number = 0;
	public rightVelocity: number = 0;

	public followMode: boolean = false;

	public characterCaller: Character;

	// 'Look around' tracking: when in first-person inside a vehicle and
	// the player stops moving the mouse for autoRotateDelay ms, the
	// camera slerps back to point along the vehicle's forward axis.
	// Ported from Inthenew/Sketchbook.
	private lastMouseMoveTime: number = performance.now();
	private autoRotateDelay: number = 400;
	private autoRotateLerpFactor: number = 0.1;

	constructor(world: World, camera: TargetCamera, sensitivityX: number = 1, sensitivityY: number = sensitivityX * 0.8)
	{
		this.world = world;
		this.camera = camera;
		this.target = new Vector3();
		this.sensitivity = new Vector2(sensitivityX, sensitivityY);

		this.movementSpeed = 0.06;
		this.radius = 3;
		this.theta = 0;
		this.phi = 0;

		this.onMouseDownPosition = new Vector2();
		this.onMouseDownTheta = this.theta;
		this.onMouseDownPhi = this.phi;

		this.actions = {
			'forward': new KeyBinding('KeyW'),
			'back': new KeyBinding('KeyS'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'up': new KeyBinding('KeyE'),
			'down': new KeyBinding('KeyQ'),
			'fast': new KeyBinding('ShiftLeft'),
		};

		world.registerUpdatable(this);
	}

	public setSensitivity(sensitivityX: number, sensitivityY: number = sensitivityX): void
	{
		this.sensitivity = new Vector2(sensitivityX, sensitivityY);
	}

	public setRadius(value: number, instantly: boolean = false): void
	{
		this.targetRadius = Math.max(0.001, value);
		if (instantly === true)
		{
			this.radius = value;
		}
	}

	public move(deltaX: number, deltaY: number): void
	{
		this.theta -= deltaX * (this.sensitivity.x / 2);
		this.theta %= 360;
		this.phi += deltaY * (this.sensitivity.y / 2);
		this.phi = Math.min(85, Math.max(-85, this.phi));
		this.lastMouseMoveTime = performance.now();
	}

	// Convert the camera's quaternion back into the theta/phi spherical
	// coordinates the controller uses, so the auto-rotate slerp leaves
	// the angles consistent for the next mouse-driven move.
	private quaternionToThetaPhi(q: Quaternion): { theta: number; phi: number }
	{
		const theta = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
		const sinPhi = 2 * (q.w * q.x - q.y * q.z);
		const phi = Math.abs(sinPhi) >= 1
			? Math.sign(sinPhi) * (Math.PI / 2)
			: Math.asin(sinPhi);
		return {
			theta: theta * 180 / Math.PI,
			phi: -phi * 180 / Math.PI,
		};
	}

	private lookAt(target: Vector3): void
	{
		this.camera.upVector.set(0, 1, 0);
		this.camera.setTarget(target);
	}

	public update(timeScale: number): void
	{
		if (this.followMode === true)
		{
			this.camera.position.y = Utils.clamp(this.camera.position.y, this.target.y, Number.POSITIVE_INFINITY);
			this.lookAt(this.target);
			this.camera.position.subtractToRef(this.target, _dir);
			_dir.normalize().scaleInPlace(this.targetRadius);
			this.camera.position.copyFrom(this.target).addInPlace(_dir);
		}
		else
		{
			this.radius = Utils.lerp(this.radius, this.targetRadius, 0.1);

			this.camera.position.x = this.target.x + this.radius * Math.sin(this.theta * Math.PI / 180) * Math.cos(this.phi * Math.PI / 180);
			this.camera.position.y = this.target.y + this.radius * Math.sin(this.phi * Math.PI / 180);
			this.camera.position.z = this.target.z + this.radius * Math.cos(this.theta * Math.PI / 180) * Math.cos(this.phi * Math.PI / 180);
			// Floor clamp: phi can swing to -85° which would otherwise put
			// the camera ~1.6m below the player's standing plane and clip
			// straight through the ground. Cap the orbital y at slightly
			// below the target's feet so steep-down looks pivot in place
			// instead of sinking the cam.
			const minY = this.target.y - 0.3;
			if (this.camera.position.y < minY) this.camera.position.y = minY;

			// 'Look around' auto-return: in first-person inside a non-rocket
			// vehicle, after autoRotateDelay ms of no mouse movement, slerp
			// the camera quaternion back toward the vehicle's forward axis.
			// The rocket is excluded because Inthenew leaves it untouched
			// during the auto-flight sequence.
			const vehicle = this.characterCaller?.controlledObject as { firstPerson?: boolean; rotationQuaternion?: Quaternion; entityType?: EntityType } | undefined;
			const isInFirstPersonVehicle = vehicle?.firstPerson === true
				&& vehicle?.entityType !== undefined
				&& vehicle.entityType !== EntityType.RocketShip;
			if (isInFirstPersonVehicle && vehicle?.rotationQuaternion)
			{
				_lookDir.copyFrom(_FORWARD_AXIS).applyRotationQuaternionInPlace(vehicle.rotationQuaternion);
				this.target.addToRef(_lookDir, _targetPos);
				const since = performance.now() - this.lastMouseMoveTime;
				if (since > this.autoRotateDelay)
				{
					// Orientation of a camera at our position looking along
					// the vehicle's forward axis - same construction
					// TargetCamera.setTarget uses, without moving the camera.
					Matrix.LookAtRHToRef(this.camera.position, _targetPos, _LOCAL_UP, _lookAt);
					_lookAt.invert();
					Quaternion.FromRotationMatrixToRef(_lookAt, _desired);

					const current = this.camera.rotationQuaternion;
					const factor = Quaternion.Dot(current, _desired) > Math.cos(0.025)
						? 0.025
						: this.autoRotateLerpFactor;
					Quaternion.SlerpToRef(current, _desired, factor, current);
					current.toEulerAnglesToRef(this.camera.rotation);
					this.camera.upVector.set(0, 1, 0);
					const angles = this.quaternionToThetaPhi(current);
					this.theta = angles.theta;
					this.phi = angles.phi;
				}
				else
				{
					this.lookAt(this.target);
				}
			}
			else
			{
				this.lookAt(this.target);
			}
		}
	}

	public handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void
	{
		// Free camera
		if (code === 'KeyC' && pressed === true && event.shiftKey === true)
		{
			if (this.characterCaller !== undefined)
			{
				this.world.inputManager.setInputReceiver(this.characterCaller);
				this.characterCaller = undefined;
			}
		}
		// Teleport: drop the character (or whatever they're driving) to
		// the free-camera's current target. Ported from Inthenew.
		else if (code === 'KeyT' && pressed === true && this.characterCaller !== undefined)
		{
			const t = this.target;
			const controlled = this.characterCaller.controlledObject as { collision?: PhysicsBody } | undefined;
			if (controlled?.collision)
			{
				const body = controlled.collision;
				PhysicsWorld.teleport(body, t);
				PhysicsWorld.zeroVelocity(body);
			}
			else
			{
				const capsule = this.characterCaller.characterCapsule;
				capsule.node.position.copyFrom(t);
				PhysicsWorld.zeroVelocity(capsule.body);
			}
		}
		else
		{
			for (const action in this.actions) {
				if (this.actions.hasOwnProperty(action)) {
					const binding = this.actions[action];

					if (_.includes(binding.eventCodes, code))
					{
						binding.isPressed = pressed;
					}
				}
			}
		}
	}

	public handleMouseWheel(event: WheelEvent, value: number): void
	{
		this.world.scrollTheTimeScale(value);
	}

	public handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void
	{
		for (const action in this.actions) {
			if (this.actions.hasOwnProperty(action)) {
				const binding = this.actions[action];

				if (_.includes(binding.eventCodes, code))
				{
					binding.isPressed = pressed;
				}
			}
		}
	}

	public handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void
	{
		this.move(deltaX, deltaY);
	}

	public inputReceiverInit(): void
	{
		this.target.copyFrom(this.camera.position);
		this.setRadius(0, true);

		this.world.updateControls([
			{ keys: ['W', 'S', 'A', 'D'], desc: t('controls.moveAround') },
			{ keys: ['E', 'Q'],           desc: t('controls.moveUpDown') },
			{ keys: ['Shift'],            desc: t('controls.speedUp') },
			{ keys: ['Shift', '+', 'C'],  desc: t('controls.freeCameraExit') },
		]);
	}

	public inputReceiverUpdate(timeStep: number): void
	{
		// Set fly speed
		let speed = this.movementSpeed * (this.actions.fast.isPressed ? timeStep * 600 : timeStep * 60);

		this.camera.getDirectionToRef(_LOCAL_UP, _up);
		this.camera.getDirectionToRef(_LOCAL_RIGHT, _right);
		this.camera.getDirectionToRef(_LOCAL_FORWARD, _forward);

		this.upVelocity = Utils.lerp(this.upVelocity, +this.actions.up.isPressed - +this.actions.down.isPressed, 0.3);
		this.forwardVelocity = Utils.lerp(this.forwardVelocity, +this.actions.forward.isPressed - +this.actions.back.isPressed, 0.3);
		this.rightVelocity = Utils.lerp(this.rightVelocity, +this.actions.right.isPressed - +this.actions.left.isPressed, 0.3);

		this.target.addInPlace(_up.scaleInPlace(speed * this.upVelocity));
		this.target.addInPlace(_forward.scaleInPlace(speed * this.forwardVelocity));
		this.target.addInPlace(_right.scaleInPlace(speed * this.rightVelocity));
	}
}
