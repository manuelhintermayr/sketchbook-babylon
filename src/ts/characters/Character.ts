import {
	AnimationGroup,
	Color3,
	Material,
	Mesh,
	MeshBuilder,
	PhysicsBody,
	PhysicsRaycastResult,
	Quaternion,
	StandardMaterial,
	TransformNode,
	Vector3,
} from '@babylonjs/core';
import * as _ from 'lodash';
import * as Utils from '../core/FunctionLibrary';

import { KeyBinding } from '../core/KeyBinding';
import { VectorSpringSimulator } from '../physics/spring_simulation/VectorSpringSimulator';
import { RelativeSpringSimulator } from '../physics/spring_simulation/RelativeSpringSimulator';
import { Idle } from './character_states/Idle';
import { CharacterSfx } from '../world/audio/CharacterSfx';
import { EnteringVehicle } from './character_states/vehicles/EnteringVehicle';
import { ExitingVehicle } from './character_states/vehicles/ExitingVehicle';
import { OpenVehicleDoor as OpenVehicleDoor } from './character_states/vehicles/OpenVehicleDoor';
import { Driving } from './character_states/vehicles/Driving';
import { ExitingAirplane } from './character_states/vehicles/ExitingAirplane';
import { ICharacterAI } from '../interfaces/ICharacterAI';
import { World } from '../world/World';
import { IControllable } from '../interfaces/IControllable';
import { ICharacterState } from '../interfaces/ICharacterState';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { Vehicle } from '../vehicles/Vehicle';
import { CollisionGroups } from '../enums/CollisionGroups';
import { CapsuleCollider } from '../physics/colliders/CapsuleCollider';
import { VehicleEntryInstance } from './VehicleEntryInstance';
import { SeatType } from '../enums/SeatType';
import { GroundImpactData } from './GroundImpactData';
import { ClosestObjectFinder } from '../core/ClosestObjectFinder';
import { EntityType } from '../enums/EntityType';
import { UpdateOrder } from '../enums/UpdateOrder';
import { commonGlobalControls } from '../core/CommonControls';
import { t } from '../i18n';
import * as PhysicsBridge from './CharacterPhysicsBridge';
import * as InputBridge from './CharacterInputBridge';
import { LoadedModel } from '../core/LoadingManager';
import { PhysicsWorld } from '../physics/PhysicsWorld';

// Module-scoped scratch for springRotation - reused across all
// characters in the scene. Larger physics + raycast scratches moved
// to CharacterPhysicsBridge alongside the physics step functions.
const _Y_AXIS = new Vector3(0, 1, 0);
const _lookTarget = new Vector3();
const _worldPos = new Vector3();

export class Character extends TransformNode implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.CharacterPhysics;
	public entityType: EntityType = EntityType.Character;

	public height: number = 0;
	public tiltContainer: TransformNode;
	public modelContainer: TransformNode;
	public materials: Material[] = [];
	public animationGroups: AnimationGroup[] = [];
	public model: LoadedModel;

	// Movement
	public acceleration: Vector3 = new Vector3();
	public velocity: Vector3 = new Vector3();
	public arcadeVelocityInfluence: Vector3 = new Vector3();
	public velocityTarget: Vector3 = new Vector3();
	public arcadeVelocityIsAdditive: boolean = false;

	public defaultVelocitySimulatorDamping: number = 0.8;
	public defaultVelocitySimulatorMass: number = 50;
	public velocitySimulator: VectorSpringSimulator;
	public moveSpeed: number = 4;
	public angularVelocity: number = 0;
	public orientation: Vector3 = new Vector3(0, 0, 1);
	public orientationTarget: Vector3 = new Vector3(0, 0, 1);
	public defaultRotationSimulatorDamping: number = 0.5;
	public defaultRotationSimulatorMass: number = 10;
	public rotationSimulator: RelativeSpringSimulator;
	public viewVector: Vector3;
	public actions: { [action: string]: KeyBinding };
	public characterCapsule: CapsuleCollider;

	// Ray casting
	public rayResult: PhysicsRaycastResult = new PhysicsRaycastResult();
	public rayHasHit: boolean = false;
	public rayCastLength: number = 0.57;
	public raySafeOffset: number = 0.03;
	public wantsToJump: boolean = false;
	public initJumpSpeed: number = -1;
	public groundImpactData: GroundImpactData = new GroundImpactData();
	public raycastBox: Mesh;

	public world: World;
	public charState: ICharacterState;
	public behaviour: ICharacterAI;
	// Per-character positional audio for footsteps / jump / land / door.
	// Same role EngineSound has for vehicles. Initialised in addToWorld
	// once world is set; disposed in removeFromWorld.
	public sfx: CharacterSfx | undefined;

	// True while a DialogBox is open with this character as a participant
	// (player AND the NPC they're talking to). Movement / behaviour /
	// input handlers all early-return - the world keeps simulating, but
	// these characters stand still until DialogBox.close() flips it back.
	public dialogFreeze: boolean = false;

	// Set to true on the human-controlled character. Used by per-frame
	// systems that need to find the player without depending on the
	// fragile `world.characters[0]` order, which depends on async GLB
	// load order and can land an NPC there if the boxman.glb finishes
	// loading for an NPC spawn before the player one.
	public isPlayer: boolean = false;

	// Vehicles
	public controlledObject: IControllable;
	public occupyingSeat: VehicleSeat = null;
	public vehicleEntryInstance: VehicleEntryInstance = null;

	private physicsEnabled: boolean = true;
	private currentAnimation: AnimationGroup | null = null;

	constructor(model: LoadedModel)
	{
		super('character', model.scene);
		this.rotationQuaternion = Quaternion.Identity();

		this.model = model;
		this.readCharacterData(model);
		this.setAnimations(model.animationGroups);

		// The visuals group is centered for easy character tilting
		this.tiltContainer = new TransformNode('tiltContainer', model.scene);
		this.tiltContainer.parent = this;

		// Model container is used to reliably ground the character, as animation can alter the position of the model itself
		this.modelContainer = new TransformNode('modelContainer', model.scene);
		this.modelContainer.position.y = -0.57;
		this.modelContainer.parent = this.tiltContainer;
		model.root.parent = this.modelContainer;

		this.velocitySimulator = new VectorSpringSimulator(60, this.defaultVelocitySimulatorMass, this.defaultVelocitySimulatorDamping);
		this.rotationSimulator = new RelativeSpringSimulator(60, this.defaultRotationSimulatorMass, this.defaultRotationSimulatorDamping);

		this.viewVector = new Vector3();

		// Actions
		this.actions = {
			'up': new KeyBinding('KeyW'),
			'down': new KeyBinding('KeyS'),
			'left': new KeyBinding('KeyA'),
			'right': new KeyBinding('KeyD'),
			'run': new KeyBinding('ShiftLeft'),
			'jump': new KeyBinding('Space'),
			'use': new KeyBinding('KeyE'),
			'enter': new KeyBinding('KeyF'),
			'enter_passenger': new KeyBinding('KeyG'),
			'seat_switch': new KeyBinding('KeyX'),
			'primary': new KeyBinding('Mouse0'),
			'secondary': new KeyBinding('Mouse1'),
		};

		// Physics
		// Player Capsule. Lives in its own collision group so the feet
		// raycast can skip it, and ignores the vehicles' sphere shapes
		// (TrimeshColliders group) the same way the cannon version did.
		this.characterCapsule = new CapsuleCollider(model.scene, {
			mass: 1,
			position: new Vector3(),
			height: 0.5,
			radius: 0.25,
			segments: 8,
			friction: 0.0,
			collisionFilterGroup: CollisionGroups.Characters,
			collisionFilterMask: ~CollisionGroups.TrimeshColliders,
			allowSleep: false,
		});

		// Ray cast debug
		this.raycastBox = MeshBuilder.CreateBox('raycastBox', { size: 0.1 }, model.scene);
		const boxMat = new StandardMaterial('raycastBoxMaterial', model.scene);
		boxMat.diffuseColor = Color3.Red();
		boxMat.emissiveColor = Color3.Red();
		this.raycastBox.material = boxMat;
		this.raycastBox.isPickable = false;
		this.raycastBox.setEnabled(false);

		// States
		this.setState(new Idle(this));
	}

	public setAnimations(animationGroups: AnimationGroup[]): void
	{
		this.animationGroups = animationGroups;
	}

	public setArcadeVelocityInfluence(x: number, y: number = x, z: number = x): void
	{
		this.arcadeVelocityInfluence.set(x, y, z);
	}

	public setViewVector(vector: Vector3): void
	{
		this.viewVector.copyFrom(vector).normalize();
	}

	/**
	 * Set state to the player. Pass state class (function) name.
	 * @param {function} State
	 */
	public setState(state: ICharacterState): void
	{
		this.charState = state;
		this.charState.onInputChange();
	}

	public setPosition(x: number, y: number, z: number): void
	{
		if (this.physicsEnabled)
		{
			this.characterCapsule.node.position.set(x, y, z);
		}
		else
		{
			this.position.x = x;
			this.position.y = y;
			this.position.z = z;
		}
	}

	public resetVelocity(): void
	{
		this.velocity.x = 0;
		this.velocity.y = 0;
		this.velocity.z = 0;

		PhysicsWorld.zeroVelocity(this.characterCapsule.body);

		this.velocitySimulator.init();
	}

	public setArcadeVelocityTarget(velZ: number, velX: number = 0, velY: number = 0): void
	{
		this.velocityTarget.z = velZ;
		this.velocityTarget.x = velX;
		this.velocityTarget.y = velY;
	}

	public setOrientation(vector: Vector3, instantly: boolean = false): void
	{
		let lookVector = new Vector3(vector.x, 0, vector.z).normalize();
		this.orientationTarget.copyFrom(lookVector);

		if (instantly)
		{
			this.orientation.copyFrom(lookVector);
		}
	}

	public resetOrientation(): void
	{
		const forward = Utils.getForward(this);
		this.setOrientation(forward, true);
	}

	private applyNearbyPlayerLookAt(): void
	{
		if (this.dialogFreeze) return;
		// Walking NPCs (FollowPath etc.) own their own orientation each
		// tick - overriding here would yank them off-path the moment the
		// player passed by. Only stationary NPCs (no behaviour) react.
		if (this.behaviour !== undefined && this.behaviour !== null) return;
		if (this.world === undefined) return;
		const player = this.world.characters.find((c) => c.isPlayer);
		if (player === undefined || player === this) return;

		const dx = player.position.x - this.position.x;
		const dz = player.position.z - this.position.z;
		const distSq = dx * dx + dz * dz;
		if (distSq > 1) return;        // outside 1 m radius
		if (distSq < 1e-4) return;     // overlapping -> no meaningful direction

		this.setOrientation(new Vector3(dx, 0, dz));
	}

	public setBehaviour(behaviour: ICharacterAI): void
	{
		behaviour.character = this;
		this.behaviour = behaviour;
	}

	// The capsule body is never removed from the Havok world; while the
	// character sits in a vehicle it is parked (no collisions, no
	// gravity) and follows the vehicle-parented character node instead.
	public setPhysicsEnabled(value: boolean): void {
		this.physicsEnabled = value;
		this.characterCapsule.setEnabled(value);
	}

	public readCharacterData(model: LoadedModel): void
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
		});
	}

	public handleKeyboardEvent(event: KeyboardEvent, code: string, pressed: boolean): void
	{
		InputBridge.handleKeyboardEvent(this, event, code, pressed);
	}

	public handleMouseButton(event: MouseEvent, code: string, pressed: boolean): void
	{
		InputBridge.handleMouseButton(this, event, code, pressed);
	}

	public handleMouseMove(event: MouseEvent, deltaX: number, deltaY: number): void
	{
		InputBridge.handleMouseMove(this, event, deltaX, deltaY);
	}

	public handleMouseWheel(event: WheelEvent, value: number): void
	{
		InputBridge.handleMouseWheel(this, event, value);
	}

	public triggerAction(actionName: string, value: boolean): void
	{
		InputBridge.triggerAction(this, actionName, value);
	}

	public takeControl(): void
	{
		if (this.world !== undefined)
		{
			this.world.inputManager.setInputReceiver(this);
		}
		else
		{
			console.warn('Attempting to take control of a character that doesn\'t belong to a world.');
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

	public update(timeStep: number): void
	{
		// Skip behaviour ticks while frozen - DialogBox.open() already
		// called resetControls() so actions are cleared and the state
		// machine has flipped to Idle. We just stop AI from re-issuing
		// triggerAction calls until close().
		if (!this.dialogFreeze)
		{
			this.behaviour?.update(timeStep);
		}
		this.vehicleEntryInstance?.update(timeStep);
		this.charState?.update(timeStep);

		// Idle NPCs face the player when they get close. Skips walking
		// NPCs (FollowPath sets behaviour and would fight us each tick),
		// the player itself, and frozen-in-dialog characters (DialogBox
		// already oriented them in open()). springRotation interpolates
		// to the new target so the turn looks natural.
		this.applyNearbyPlayerLookAt();

		if (this.physicsEnabled) this.springMovement(timeStep);
		if (this.physicsEnabled) this.springRotation(timeStep);
		if (this.physicsEnabled) this.rotateModel();

		// Skeletal animationGroups advance inside scene.render() - see
		// World.update for the animationTimeScale sync.

		// Sync physics/graphics
		if (this.physicsEnabled)
		{
			this.position.copyFrom(this.characterCapsule.node.position);
		}
		else {
			Utils.getWorldPosition(this, _worldPos);
			this.characterCapsule.node.position.copyFrom(_worldPos);
		}

		this.computeWorldMatrix(true);
	}

	public inputReceiverInit(): void
	{
		if (this.controlledObject !== undefined)
		{
			this.controlledObject.inputReceiverInit();
			return;
		}

		this.world.cameraOperator.setRadius(1.6, true);
		this.world.cameraOperator.followMode = false;

		this.displayControls();
	}

	public displayControls(): void
	{
		this.world.updateControls([
			{ keys: ['W', 'A', 'S', 'D'],   desc: t('controls.movement') },
			{ keys: ['Shift'],              desc: t('controls.sprint') },
			{ keys: ['Space'],              desc: t('controls.jump') },
			{ keys: ['F', 'or', 'G'],       desc: t('controls.enterVehicle') },
			{ keys: ['V'],                  desc: t('controls.viewDistance') },
			...commonGlobalControls(),
		]);
	}

	public inputReceiverUpdate(timeStep: number): void
	{
		if (this.controlledObject !== undefined)
		{
			this.controlledObject.inputReceiverUpdate(timeStep);
		}
		else
		{
			// Look in camera's direction. viewVector is read by other
			// systems each frame; we copy into the field-bound vector
			// instead of replacing the reference + allocating.
			if (this.viewVector === undefined) this.viewVector = new Vector3();
			this.viewVector.copyFrom(this.position).subtractInPlace(this.world.camera.position);
			Utils.getWorldPosition(this, this.world.cameraOperator.target);
		}
	}

	// Plays a glTF animation group by name with a short blend-in.
	// Babylon blends from the current pose when an animation starts
	// (enableBlending), so stopping the previous group and starting the
	// new one gives the same cross-fade feel three's fadeIn had.
	// Returns the clip duration in seconds.
	public setAnimation(clipName: string, fadeIn: number): number
	{
		const group = this.animationGroups.find((g) => g.name === clipName);
		if (group === undefined)
		{
			console.error(`Animation ${clipName} not found!`);
			return 0;
		}

		for (const other of this.animationGroups)
		{
			if (other !== group && other.isStarted) other.stop();
		}

		group.enableBlending = true;
		group.blendingSpeed = fadeIn > 0 ? Math.min(1, 1 / (fadeIn * 60)) : 1;
		if (group.isStarted) group.stop();
		group.start(true);
		this.currentAnimation = group;

		return this.getClipDuration(group);
	}

	private getClipDuration(group: AnimationGroup): number
	{
		const first = group.targetedAnimations[0];
		const fps = first !== undefined ? first.animation.framePerSecond : 60;
		return (group.to - group.from) / fps;
	}

	public springMovement(timeStep: number): void
	{
		// Simulator
		this.velocitySimulator.target.copyFrom(this.velocityTarget);
		this.velocitySimulator.simulate(timeStep);

		// Update values
		this.velocity.copyFrom(this.velocitySimulator.position);
		this.acceleration.copyFrom(this.velocitySimulator.velocity);
	}

	public springRotation(timeStep: number): void
	{
		// Spring rotation
		// Figure out angle between current and target orientation
		let angle = Utils.getSignedAngleBetweenVectors(this.orientation, this.orientationTarget);

		// Simulator
		this.rotationSimulator.target = angle;
		this.rotationSimulator.simulate(timeStep);
		let rot = this.rotationSimulator.position;

		// Updating values
		Utils.applyAxisAngle(this.orientation, _Y_AXIS, rot);
		this.angularVelocity = this.rotationSimulator.velocity;
	}

	public getLocalMovementDirection(): Vector3
	{
		const positiveX = this.actions.right.isPressed ? -1 : 0;
		const negativeX = this.actions.left.isPressed ? 1 : 0;
		const positiveZ = this.actions.up.isPressed ? 1 : 0;
		const negativeZ = this.actions.down.isPressed ? -1 : 0;

		return new Vector3(positiveX + negativeX, 0, positiveZ + negativeZ).normalize();
	}

	public getCameraRelativeMovementVector(): Vector3
	{
		const localDirection = this.getLocalMovementDirection();
		const flatViewVector = new Vector3(this.viewVector.x, 0, this.viewVector.z).normalize();

		return Utils.appplyVectorMatrixXZ(flatViewVector, localDirection);
	}

	public setCameraRelativeOrientationTarget(): void
	{
		// Movement states (Walk / Sprint / StartWalk / etc.) call this
		// every tick to keep the character facing where they move.
		// While frozen in a dialog we keep the orientation set by
		// DialogBox.open() - otherwise the few frames it takes to
		// transition out of Walk would yank the NPC back toward their
		// path direction.
		if (this.dialogFreeze) return;
		if (this.vehicleEntryInstance === null)
		{
			const moveVector = this.getCameraRelativeMovementVector();

			// Epsilon compare instead of `=== 0` - exact zero would be
			// the typical idle path, but transient camera-rotated
			// vectors can settle to ~1e-17 floats and the strict check
			// would push the character into a setOrientation(near-zero)
			// branch that yanks the facing.
			if (moveVector.lengthSquared() < 1e-6)
			{
				this.setOrientation(this.orientation);
			}
			else
			{
				this.setOrientation(moveVector);
			}
		}
	}

	public rotateModel(): void
	{
		_lookTarget.set(this.position.x + this.orientation.x, this.position.y + this.orientation.y, this.position.z + this.orientation.z);
		Utils.lookAtWorld(this, _lookTarget);
		this.tiltContainer.rotation.z = (-this.angularVelocity * 2.3 * this.velocity.length());
		this.tiltContainer.position.y = (Math.cos(Math.abs(this.angularVelocity * 2.3 * this.velocity.length())) / 2) - 0.5;
	}

	public jump(initJumpSpeed: number = -1): void
	{
		this.wantsToJump = true;
		this.initJumpSpeed = initJumpSpeed;
	}

	public findVehicleToEnter(wantsToDrive: boolean): void
	{
		// reusable world position variable
		let worldPos = new Vector3();

		// Find best vehicle
		let vehicleFinder = new ClosestObjectFinder<Vehicle>(this.position, 10);
		this.world.vehicles.forEach((vehicle) =>
		{
			vehicleFinder.consider(vehicle, vehicle.position);
		});

		if (vehicleFinder.closestObject !== undefined)
		{
			let vehicle = vehicleFinder.closestObject;
			let vehicleEntryInstance = new VehicleEntryInstance(this);
			vehicleEntryInstance.wantsToDrive = wantsToDrive;

			// Find best seat
			let seatFinder = new ClosestObjectFinder<VehicleSeat>(this.position);
			for (const seat of vehicle.seats)
			{
				if (wantsToDrive)
				{
					// Consider driver seats
					if (seat.type === SeatType.Driver)
					{
						Utils.getWorldPosition(seat.seatPointObject, worldPos);
						seatFinder.consider(seat, worldPos);
					}
					// Consider passenger seats connected to driver seats
					else if (seat.type === SeatType.Passenger)
					{
						for (const connSeat of seat.connectedSeats)
						{
							if (connSeat.type === SeatType.Driver)
							{
								Utils.getWorldPosition(seat.seatPointObject, worldPos);
								seatFinder.consider(seat, worldPos);
								break;
							}
						}
					}
				}
				else
				{
					// Consider passenger seats
					if (seat.type === SeatType.Passenger)
					{
						Utils.getWorldPosition(seat.seatPointObject, worldPos);
						seatFinder.consider(seat, worldPos);
					}
				}
			}

			if (seatFinder.closestObject !== undefined)
			{
				let targetSeat = seatFinder.closestObject;
				vehicleEntryInstance.targetSeat = targetSeat;

				let entryPointFinder = new ClosestObjectFinder<TransformNode>(this.position);

				for (const point of targetSeat.entryPoints) {
					Utils.getWorldPosition(point, worldPos);
					entryPointFinder.consider(point, worldPos);
				}

				if (entryPointFinder.closestObject !== undefined)
				{
					vehicleEntryInstance.entryPoint = entryPointFinder.closestObject;
					this.triggerAction('up', true);
					this.vehicleEntryInstance = vehicleEntryInstance;
				}
			}
		}
	}

	public enterVehicle(seat: VehicleSeat, entryPoint: TransformNode): void
	{
		this.resetControls();

		// Boats and rockets have no door animation, so don't try to play one.
		const skipDoor = seat.vehicle.entityType === EntityType.Boat
			|| seat.vehicle.entityType === EntityType.RocketShip;
		if (seat.door?.rotation < 0.5 && !skipDoor)
		{
			this.setState(new OpenVehicleDoor(this, seat, entryPoint));
		}
		else
		{
			this.setState(new EnteringVehicle(this, seat, entryPoint));
		}
	}

	public teleportToVehicle(vehicle: Vehicle, seat: VehicleSeat): void
	{
		this.resetVelocity();
		this.rotateModel();
		this.setPhysicsEnabled(false);
		this.setParent(vehicle);

		this.setPosition(seat.seatPointObject.position.x, seat.seatPointObject.position.y + 0.6, seat.seatPointObject.position.z);
		Utils.setQuaternion(this, Utils.getQuaternion(seat.seatPointObject));

		this.occupySeat(seat);
		this.setState(new Driving(this, seat));

		this.startControllingVehicle(vehicle, seat);
	}

	public startControllingVehicle(vehicle: IControllable, seat: VehicleSeat): void
	{
		if (this.controlledObject !== vehicle)
		{
			this.transferControls(vehicle);
			this.resetControls();

			this.controlledObject = vehicle;
			this.controlledObject.allowSleep(false);

			// Only refresh the HUD controls list if this character is the
			// active input receiver. Otherwise - e.g. an AI driver being
			// teleported into a vehicle by VehicleSpawnPoint - running
			// vehicle.inputReceiverInit() would overwrite the player's
			// WASD list with the AI's vehicle list at scenario start, so
			// the player would see car/heli controls before having
			// touched anything.
			if (this.world.inputManager.inputReceiver === this)
			{
				vehicle.inputReceiverInit();
			}

			vehicle.controllingCharacter = this;
		}
	}

	public transferControls(entity: IControllable): void
	{
		// Currently running through all actions of this character and the vehicle,
		// comparing keycodes of actions and based on that triggering vehicle's actions
		// Maybe we should ask input manager what's the current state of the keyboard
		// and read those values... TODO
		for (const action1 in this.actions) {
			if (this.actions.hasOwnProperty(action1)) {
				for (const action2 in entity.actions) {
					if (entity.actions.hasOwnProperty(action2)) {

						let a1 = this.actions[action1];
						let a2 = entity.actions[action2];

						a1.eventCodes.forEach((code1) => {
							a2.eventCodes.forEach((code2) => {
								if (code1 === code2)
								{
									entity.triggerAction(action2, a1.isPressed);
								}
							});
						});
					}
				}
			}
		}
	}

	public stopControllingVehicle(): void
	{
		if (this.controlledObject?.controllingCharacter === this)
		{
			this.controlledObject.allowSleep(true);
			this.controlledObject.controllingCharacter = undefined;
			this.controlledObject.resetControls();
			this.controlledObject = undefined;
			this.inputReceiverInit();
		}
	}

	public exitVehicle(): void
	{
		if (this.occupyingSeat !== null)
		{
			if (this.occupyingSeat.vehicle.entityType === EntityType.Airplane)
			{
				this.setState(new ExitingAirplane(this, this.occupyingSeat));
			}
			else
			{
				this.setState(new ExitingVehicle(this, this.occupyingSeat));
			}

			this.stopControllingVehicle();
		}
	}

	public occupySeat(seat: VehicleSeat): void
	{
		this.occupyingSeat = seat;
		seat.occupiedBy = this;
	}

	public leaveSeat(): void
	{
		if (this.occupyingSeat !== null)
		{
			this.occupyingSeat.occupiedBy = null;
			this.occupyingSeat = null;
		}
	}

	public physicsPreStep(body: PhysicsBody, character: Character): void
	{
		PhysicsBridge.physicsPreStep(body, character);
	}

	public feetRaycast(): void
	{
		PhysicsBridge.feetRaycast(this);
	}

	public physicsPostStep(body: PhysicsBody, character: Character): void
	{
		PhysicsBridge.physicsPostStep(body, character);
	}

	public addToWorld(world: World): void
	{
		if (_.includes(world.characters, this))
		{
			console.warn('Adding character to a world in which it already exists.');
		}
		else
		{
			// Set world
			this.world = world;

			// Register character
			world.characters.push(this);

			// Per-character positional SFX (footsteps / jump / land /
			// door). Lazy nodes inside, so this is just attaching the
			// listener parent.
			this.sfx = new CharacterSfx(this, world);

			// The capsule body has been live in the physics world since
			// construction; nothing to register here.

			// Add to the scene graph
			world.addNode(this);
			world.addNode(this.raycastBox);

			// Shadow cascades
			world.sky.registerShadowCaster(this);
		}
	}

	public removeFromWorld(world: World): void
	{
		if (!_.includes(world.characters, this))
		{
			console.warn('Removing character from a world in which it isn\'t present.');
		}
		else
		{
			if (world.inputManager.inputReceiver === this)
			{
				world.inputManager.inputReceiver = undefined;
			}

			if (this.sfx !== undefined)
			{
				this.sfx.dispose();
				this.sfx = undefined;
			}

			this.world = undefined;

			// Remove from characters
			_.pull(world.characters, this);

			// Remove physics
			this.characterCapsule.dispose();

			// Remove visuals. Animation groups are scene-level objects and
			// would keep driving the disposed skeleton otherwise.
			for (const group of this.animationGroups) group.dispose();
			world.sky.unregisterShadowCaster(this);
			world.removeNode(this);
			world.removeNode(this.raycastBox);
		}
	}
}
