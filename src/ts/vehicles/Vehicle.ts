import {
	Material,
	PhysicsBody,
	PhysicsMotionType,
	PhysicsShape,
	PhysicsShapeBox,
	PhysicsShapeContainer,
	PhysicsShapeSphere,
	Quaternion,
	TransformNode,
	Vector3,
} from '@babylonjs/core';
import * as _ from 'lodash';

import { Character } from '../characters/Character';
import { World } from '../world/World';
import { KeyBinding } from '../core/KeyBinding';
import { VehicleSeat } from './VehicleSeat';
import { Wheel } from './Wheel';
import { VehicleDoor } from './VehicleDoor';
import * as Utils from '../core/FunctionLibrary';
import { CollisionGroups } from '../enums/CollisionGroups';
import { SwitchingSeats } from '../characters/character_states/vehicles/SwitchingSeats';
import { EntityType } from '../enums/EntityType';
import { UpdateOrder } from '../enums/UpdateOrder';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { CameraShake } from '../core/CameraShake';
import { EngineProfile } from '../world/audio/EngineSound';
import { StuckRecovery } from './StuckRecovery';
import { VehicleAudioBridge } from './VehicleAudioBridge';
import { syncWheelTransforms, updateWheelProps } from './WheelManager';
import { RaycastVehicle, WheelInfoOptions } from '../physics/RaycastVehicle';
import { PhysicsWorld } from '../physics/PhysicsWorld';
import { LoadedModel } from '../core/LoadingManager';
import { applyCollisionFilter } from '../physics/colliders/ColliderBase';

const _velocity = new Vector3();
const _cameraTarget = new Vector3();

export abstract class Vehicle extends TransformNode implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.VehiclePhysics;
	public abstract entityType: EntityType;

	public controllingCharacter: Character;
	public actions: { [action: string]: KeyBinding; } = {};
	public rayCastVehicle: RaycastVehicle;
	public seats: VehicleSeat[] = [];
	public wheels: Wheel[] = [];
	public drive: string;
	public camera: TransformNode;
	public world: World;
	// The chassis body. This node is its transform node, so
	// this.position / rotationQuaternion ARE the chassis pose.
	public collision: PhysicsBody;
	public collisionShape: PhysicsShapeContainer;
	public materials: Material[] = [];
	public spawnPoint: TransformNode;
	public model: LoadedModel;
	// Orientation the chassis resets to when a car ends up on its roof
	// or an AI driver gets stuck (cannon exposed this as initQuaternion).
	public initQuaternion: Quaternion = Quaternion.Identity();
	private modelContainer: TransformNode;

	public firstPerson: boolean = false;

	// Camera tweaks read from the GLB camera-empty's userData (Inthenew):
	// viewBack adds units to the third-person chase distance, centerHere
	// shifts the chase target up to the camera-empty's Y so the camera
	// looks at the middle of tall vehicles instead of the wheels.
	public viewBack: number = 0;
	public centerHere: boolean = false;

	// Hard-landing tracker. Watches the chassis's Y velocity each step;
	// a sharp transition from fast-falling (< -6) to grounded (> -1)
	// fires a 'land' camera shake scaled by impact strength. Same
	// heuristic as portfolio's Vehicle.tsx - it's the simplest signal
	// that catches both a roof-jump landing and a long fall.
	private prevLinvelY: number = 0;

	// Stuck / flip auto-recovery. Subclasses opt out of either gate by
	// flipping `this.recovery.stuckRecoveryEnabled` /
	// `flipRecoveryEnabled` to false in their constructor - boats sit
	// still on water (stuck check would teleport them), rockets have
	// their own auto-flight state machine, and air vehicles deliberately
	// hover (no stuck-sampling) but still benefit from flip-recovery if
	// they crash on their side.
	protected recovery: StuckRecovery;

	// Procedural engine sound. Subclasses pick a profile from
	// ENGINE_PROFILES in their constructor; null = silent. The actual
	// EngineSound instance + the crash-audio collide listener live on
	// the audio bridge, attached in addToWorld.
	protected engineSoundProfile: EngineProfile | null = null;
	private audioBridge: VehicleAudioBridge | null = null;

	constructor(model: LoadedModel, handlingSetup?: WheelInfoOptions)
	{
		super('vehicle', model.scene);
		this.rotationQuaternion = Quaternion.Identity();
		this.model = model;

		if (handlingSetup === undefined) handlingSetup = {};
		handlingSetup.chassisConnectionPointLocal = new Vector3(),
		handlingSetup.axleLocal = new Vector3(-1, 0, 0);
		handlingSetup.directionLocal = new Vector3(0, -1, 0);

		// Collision shape - a compound of the GLB's box / sphere markers.
		this.collisionShape = new PhysicsShapeContainer(model.scene);
		this.collisionShape.material = { friction: 0.01, restitution: 0 };

		// Read GLTF
		this.readVehicleData(model);

		this.modelContainer = new TransformNode('modelContainer', model.scene);
		this.modelContainer.parent = this;
		model.root.parent = this.modelContainer;

		// Collision body. Mass 50 like the cannon chassis; the centre of
		// mass is pinned to the node origin because cannon applied
		// forces around the body origin regardless of shape offsets, and
		// the vehicle tuning grew up on that.
		this.collision = new PhysicsBody(this, PhysicsMotionType.DYNAMIC, false, model.scene);
		this.collision.shape = this.collisionShape;
		this.collision.setMassProperties({ mass: 50, centerOfMass: new Vector3(0, 0, 0) });
		PhysicsWorld.enableNodeSync(this.collision);

		// Raycast vehicle component
		this.rayCastVehicle = new RaycastVehicle({
			chassisBody: this.collision,
			indexUpAxis: 1,
			indexRightAxis: 0,
			indexForwardAxis: 2
		});

		this.wheels.forEach((wheel) =>
		{
			handlingSetup.chassisConnectionPointLocal.set(wheel.position.x, wheel.position.y + 0.2, wheel.position.z);
			const index = this.rayCastVehicle.addWheel(handlingSetup);
			wheel.rayCastWheelInfoIndex = index;
		});

		this.recovery = new StuckRecovery(this.collision, () => this.noDirectionPressed());
	}

	// Vehicle-tuning hooks for the World GUI's Vehicles folder. Subclasses
	// override updateCarSpeed when they want their gear ladder rescaled
	// against an Engine_Force slider; updateWheelProps stays generic so
	// Friction_Slip / Suspension_Stiffness / Damping_* / Max_Suspension
	// flow into the raycast wheel infos for every vehicle that has wheels.
	public updateWheelProps(property: string, value: number): void
	{
		updateWheelProps(this.rayCastVehicle, property, value);
	}

	public updateCarSpeed(_speed: number): void
	{
		// override in Car
	}

	public noDirectionPressed(): boolean
	{
		return true;
	}

	// Whether this vehicle has any seat that's wired to a connected seat
	// in the GLB. Drives whether the on-screen controls overlay shows X
	// (Switch seats) - onInputChange already routes the X press; this
	// just makes the HUD honest about the option.
	public seatSwitchAvailable(): boolean
	{
		return this.seats.some(seat => seat.connectedSeats.length > 0);
	}

	public update(timeStep: number): void
	{
		// Havok writes the chassis pose straight into this node after
		// every step, so there is no position/quaternion copy here.

		// Hard-landing detection - only when the player is actually in
		// the seat, otherwise an empty parked car wobbling on respawn
		// would shake the camera too.
		if (this.controllingCharacter !== undefined)
		{
			this.collision.getLinearVelocityToRef(_velocity);
			const curY = _velocity.y;
			if (this.prevLinvelY < -6 && curY > -1)
			{
				const impact = Math.min(Math.abs(this.prevLinvelY) / 15, 2);
				CameraShake.trigger('land', impact);
			}
			this.prevLinvelY = curY;

			this.recovery.update(timeStep);
		}
		else
		{
			this.prevLinvelY = 0;
			this.recovery.reset();
		}

		this.seats.forEach((seat: VehicleSeat) => {
			seat.update(timeStep);
		});

		syncWheelTransforms(this.rayCastVehicle, this.wheels);

		this.computeWorldMatrix(true);
	}

	public forceCharacterOut(): void
	{
		this.controllingCharacter.modelContainer.setEnabled(true);
		this.controllingCharacter.exitVehicle();
	}

	public onInputChange(): void
	{
		if (this.actions.seat_switch.justPressed && this.controllingCharacter?.occupyingSeat?.connectedSeats.length > 0)
		{
			this.controllingCharacter.modelContainer.setEnabled(true);
			this.controllingCharacter.setState(
				new SwitchingSeats(
					this.controllingCharacter,
					this.controllingCharacter.occupyingSeat,
					this.controllingCharacter.occupyingSeat.connectedSeats[0]
				)
			);
			this.controllingCharacter.stopControllingVehicle();
		}
	}

	public resetControls(): void
	{
		for (const action in this.actions) {
			if (this.actions.hasOwnProperty(action)) {
				this.triggerAction(action, false);
			}
		}
	}

	public allowSleep(value: boolean): void
	{
		PhysicsWorld.setAllowSleep(this.collision, value);

		if (value === false)
		{
			PhysicsWorld.wakeUp(this.collision);
		}
	}

	public handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void
	{
		// Free camera
		if (code === 'KeyC' && pressed === true && event.shiftKey === true)
		{
			this.resetControls();
			this.world.cameraOperator.characterCaller = this.controllingCharacter;
			this.world.inputManager.setInputReceiver(this.world.cameraOperator);
		}
		else if (code === 'KeyR' && pressed === true && event.shiftKey === true)
		{
			this.world.restartScenario();
		}
		else
		{
			for (const action in this.actions) {
				if (this.actions.hasOwnProperty(action)) {
					const binding = this.actions[action];

					if (_.includes(binding.eventCodes, code))
					{
						this.triggerAction(action, pressed);
					}
				}
			}
		}
	}

	public setFirstPersonView(value: boolean): void
	{
		this.firstPerson = value;
		if (this.controllingCharacter !== undefined) this.controllingCharacter.modelContainer.setEnabled(!value);

		if (value)
		{
			this.world.cameraOperator.setRadius(0, true);
		}
		else
		{
			// Inthenew's viewBack lets a tall vehicle's GLB add to the
			// 3-unit default; e.g. rocketship.glb sets viewBack="1".
			this.world.cameraOperator.setRadius(3 + this.viewBack, true);
		}
	}

	public toggleFirstPersonView(): void
	{
		this.setFirstPersonView(!this.firstPerson);
	}

	public triggerAction(actionName: string, value: boolean): void
	{
		// Get action and set it's parameters
		let action = this.actions[actionName];

		if (action.isPressed !== value)
		{
			// Set value
			action.isPressed = value;

			// Reset the 'just' attributes
			action.justPressed = false;
			action.justReleased = false;

			// Set the 'just' attributes
			if (value) action.justPressed = true;
			else action.justReleased = true;

			this.onInputChange();

			// Reset the 'just' attributes
			action.justPressed = false;
			action.justReleased = false;
		}
	}

	public handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void
	{
		return;
	}

	public handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void
	{
		this.world.cameraOperator.move(deltaX, deltaY);
	}

	public handleMouseWheel(event: WheelEvent, value: number): void
	{
		this.world.scrollTheTimeScale(value);
	}

	public inputReceiverInit(): void
	{
		PhysicsWorld.setAllowSleep(this.collision, false);
		this.setFirstPersonView(false);
	}

	public inputReceiverUpdate(timeStep: number): void
	{
		if (this.firstPerson)
		{
			_cameraTarget.copyFrom(this.camera.position);
			_cameraTarget.applyRotationQuaternionInPlace(this.rotationQuaternion);
			const target = _cameraTarget.addInPlace(this.position);
			// Inthenew's centerHere keeps the look-at point at the
			// camera-empty's authored Y in world space, so the FP camera
			// doesn't drift vertically as the chassis pitches.
			if (this.centerHere) target.y = this.position.y + this.camera.position.y;
			this.world.cameraOperator.target.copyFrom(target);
		}
		else
		{
			// Position camera. centerHere shifts the chase target up to
			// the camera-empty's Y so a tall vehicle (e.g. rocketship)
			// frames around its middle instead of its wheels.
			const targetY = this.centerHere
				? this.position.y + this.camera.position.y
				: this.position.y + 0.5;
			this.world.cameraOperator.target.set(this.position.x, targetY, this.position.z);
		}
	}

	public setPosition(x: number, y: number, z: number): void
	{
		this.position.set(x, y, z);
	}

	public setSteeringValue(val: number): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (wheel.steering) this.rayCastVehicle.setSteeringValue(val, wheel.rayCastWheelInfoIndex);
		});
	}

	public applyEngineForce(force: number): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (this.drive === wheel.drive || this.drive === 'awd')
			{
				this.rayCastVehicle.applyEngineForce(force, wheel.rayCastWheelInfoIndex);
			}
		});
	}

	public setBrake(brakeForce: number, driveFilter?: string): void
	{
		this.wheels.forEach((wheel) =>
		{
			if (driveFilter === undefined || driveFilter === wheel.drive)
			{
				this.rayCastVehicle.setBrake(brakeForce, wheel.rayCastWheelInfoIndex);
			}
		});
	}

	public addToWorld(world: World): void
	{
		if (_.includes(world.vehicles, this))
		{
			console.warn('Adding character to a world in which it already exists.');
		}
		else if (this.rayCastVehicle === undefined)
		{
			console.error('Trying to create vehicle without raycastVehicleComponent');
		}
		else
		{
			this.world = world;
			world.vehicles.push(this);
			world.addNode(this);
			this.rayCastVehicle.addToWorld(world.physicsWorld);

			this.wheels.forEach((wheel) =>
			{
				world.attachNode(wheel.wheelObject);
			});

			world.sky.registerShadowCaster(this);
			this.wheels.forEach((wheel) => world.sky.registerShadowCaster(wheel.wheelObject));

			this.audioBridge = new VehicleAudioBridge(this.collision);
			this.audioBridge.attach(world, this, this.engineSoundProfile);
		}
	}

	public removeFromWorld(world: World): void
	{
		if (!_.includes(world.vehicles, this))
		{
			console.warn('Removing character from a world in which it isn\'t present.');
		}
		else
		{
			this.world = undefined;
			_.pull(world.vehicles, this);
			this.rayCastVehicle.removeFromWorld(world.physicsWorld);

			if (this.audioBridge !== null)
			{
				this.audioBridge.detach(world);
				this.audioBridge = null;
			}

			this.wheels.forEach((wheel) =>
			{
				world.sky.unregisterShadowCaster(wheel.wheelObject);
				world.removeNode(wheel.wheelObject);
			});

			world.sky.unregisterShadowCaster(this);
			this.collision.dispose();
			this.collisionShape.dispose();
			world.removeNode(this);
		}
	}

	public readVehicleData(model: LoadedModel): void
	{
		Utils.traverse(model.root, (child) => {

			if (Utils.isRenderableMesh(child))
			{
				Utils.setupMeshProperties(child);

				if (child.material !== null)
				{
					this.materials.push(child.material);
				}
			}

			if (!(child instanceof TransformNode)) return;
			const ud = Utils.userData(child);
			if (ud.hasOwnProperty('data'))
			{
				if (ud.data === 'seat')
				{
					this.seats.push(new VehicleSeat(this, child, model));
				}
				if (ud.data === 'camera')
				{
					this.camera = child;
					const vb = Number(ud.viewBack);
					if (!isNaN(vb)) this.viewBack = vb;
					if (ud.centerHere === 'true') this.centerHere = true;
				}
				if (ud.data === 'wheel')
				{
					this.wheels.push(new Wheel(child));
				}
				if (ud.data === 'collision')
				{
					// Some Inthenew GLBs (e.g. rocketship.glb) tag boxes as
					// userData.type='box' rather than userData.shape='box',
					// presumably because they were re-exported under a
					// different Blender plugin. Accept either spelling so
					// the rocket actually has a chassis to stand on.
					const shape = ud.shape ?? ud.type;
					if (shape === 'box')
					{
						child.setEnabled(false);

						// Marker scale = half extents, Havok wants full extents.
						const phys = new PhysicsShapeBox(Vector3.Zero(), Quaternion.Identity(), child.scaling.scale(2), model.scene);
						applyCollisionFilter(phys, CollisionGroups.Default, ~CollisionGroups.TrimeshColliders);
						this.addCollisionShape(phys, child.position);
					}
					else if (shape === 'sphere')
					{
						child.setEnabled(false);

						const phys = new PhysicsShapeSphere(Vector3.Zero(), child.scaling.x, model.scene);
						applyCollisionFilter(phys, CollisionGroups.TrimeshColliders, ~0);
						this.addCollisionShape(phys, child.position);
					}
				}
				if (ud.data === 'navmesh')
				{
					child.setEnabled(false);
				}
			}
		});

		if (this.collisionShape.getNumChildren() === 0)
		{
			console.warn('Vehicle ' + typeof(this) + ' has no collision data.');
		}
		if (this.seats.length === 0)
		{
			console.warn('Vehicle ' + typeof(this) + ' has no seats.');
		}
		else
		{
			this.connectSeats();
		}
	}

	private addCollisionShape(shape: PhysicsShape, offset: Vector3): void
	{
		shape.material = { friction: 0.01, restitution: 0 };
		this.collisionShape.addChild(shape, offset.clone(), Quaternion.Identity());
	}

	private connectSeats(): void
	{
		for (const firstSeat of this.seats)
		{
			if (firstSeat.connectedSeatsString !== undefined)
			{
				// Get list of connected seat names
				let conn_seat_names = firstSeat.connectedSeatsString.split(';');
				for (const conn_seat_name of conn_seat_names)
				{
					// If name not empty
					if (conn_seat_name.length > 0)
					{
						// Run through seat list and connect seats to this seat,
						// based on this seat's connected seats list
						for (const secondSeat of this.seats)
						{
							if (secondSeat.seatPointObject.name === conn_seat_name)
							{
								firstSeat.connectedSeats.push(secondSeat);
							}
						}
					}
				}
			}
		}
	}
}
