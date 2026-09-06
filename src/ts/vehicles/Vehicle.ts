import { Character } from '../characters/Character';
import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import { World } from '../world/World';
import * as _ from 'lodash';
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

export abstract class Vehicle extends THREE.Object3D implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.VehiclePhysics;
	public abstract entityType: EntityType;
	
	public controllingCharacter: Character;
	public actions: { [action: string]: KeyBinding; } = {};
	public rayCastVehicle: CANNON.RaycastVehicle;
	public seats: VehicleSeat[] = [];
	public wheels: Wheel[] = [];
	public drive: string;
	public camera: any;
	public world: World;
	public help: THREE.AxesHelper;
	public collision: CANNON.Body;
	public materials: THREE.Material[] = [];
	public spawnPoint: THREE.Object3D;
	private modelContainer: THREE.Group;

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

	constructor(gltf: any, handlingSetup?: any)
	{
		super();

		if (handlingSetup === undefined) handlingSetup = {};
		handlingSetup.chassisConnectionPointLocal = new CANNON.Vec3(),
		handlingSetup.axleLocal = new CANNON.Vec3(-1, 0, 0);
		handlingSetup.directionLocal = new CANNON.Vec3(0, -1, 0);

		// Physics mat
		let mat = new CANNON.Material('Mat');
		mat.friction = 0.01;

		// Collision body
		this.collision = new CANNON.Body({ mass: 50 });
		this.collision.material = mat;

		// Read GLTF
		this.readVehicleData(gltf);

		this.modelContainer = new THREE.Group();
		this.add(this.modelContainer);
		this.modelContainer.add(gltf.scene);

		// Raycast vehicle component
		this.rayCastVehicle = new CANNON.RaycastVehicle({
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

		this.help = new THREE.AxesHelper(2);

		this.recovery = new StuckRecovery(this.collision, () => this.noDirectionPressed());
	}

	// Vehicle-tuning hooks for the World GUI's Vehicles folder. Subclasses
	// override updateCarSpeed when they want their gear ladder rescaled
	// against an Engine_Force slider; updateWheelProps stays generic so
	// Friction_Slip / Suspension_Stiffness / Damping_* / Max_Suspension
	// flow into the cannon raycast wheel infos for every vehicle that
	// has wheels.
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
		this.position.set(
			this.collision.interpolatedPosition.x,
			this.collision.interpolatedPosition.y,
			this.collision.interpolatedPosition.z
		);

		this.quaternion.set(
			this.collision.interpolatedQuaternion.x,
			this.collision.interpolatedQuaternion.y,
			this.collision.interpolatedQuaternion.z,
			this.collision.interpolatedQuaternion.w
		);

		// Hard-landing detection - only when the player is actually in
		// the seat, otherwise an empty parked car wobbling on respawn
		// would shake the camera too.
		if (this.controllingCharacter !== undefined)
		{
			const curY = this.collision.velocity.y;
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

		syncWheelTransforms(this.rayCastVehicle, this.wheels, this.collision);

		this.updateMatrixWorld();
	}

	public forceCharacterOut(): void
	{
		this.controllingCharacter.modelContainer.visible = true;
		this.controllingCharacter.exitVehicle();
	}

	public onInputChange(): void
	{
		if (this.actions.seat_switch.justPressed && this.controllingCharacter?.occupyingSeat?.connectedSeats.length > 0)
		{
			this.controllingCharacter.modelContainer.visible = true;
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
		this.collision.allowSleep = value;

		if (value === false)
		{
			this.collision.wakeUp();
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
		if (this.controllingCharacter !== undefined) this.controllingCharacter.modelContainer.visible = !value;

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
		this.collision.allowSleep = false;
		this.setFirstPersonView(false);
	}

	public inputReceiverUpdate(timeStep: number): void
	{
		if (this.firstPerson)
		{
			let temp = new THREE.Vector3().copy(this.camera.position);
			temp.applyQuaternion(this.quaternion);
			const target = temp.add(this.position);
			// Inthenew's centerHere keeps the look-at point at the
			// camera-empty's authored Y in world space, so the FP camera
			// doesn't drift vertically as the chassis pitches.
			if (this.centerHere) target.y = this.position.y + this.camera.position.y;
			this.world.cameraOperator.target.copy(target);
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
		this.collision.position.x = x;
		this.collision.position.y = y;
		this.collision.position.z = z;
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
			world.graphicsWorld.add(this);
			this.rayCastVehicle.addToWorld(world.physicsWorld);

			this.wheels.forEach((wheel) =>
			{
				world.graphicsWorld.attach(wheel.wheelObject);
			});

			this.materials.forEach((mat) =>
			{
				world.sky.csm.setupMaterial(mat);
			});

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
			world.graphicsWorld.remove(this);
			this.rayCastVehicle.removeFromWorld(world.physicsWorld);

			this.wheels.forEach((wheel) =>
			{
				world.graphicsWorld.remove(wheel.wheelObject);
			});

			if (this.audioBridge !== null)
			{
				this.audioBridge.detach(world);
				this.audioBridge = null;
			}
		}
	}

	public readVehicleData(gltf: any): void
	{
		gltf.scene.traverse((child) => {

			if (child.isMesh)
			{
				Utils.setupMeshProperties(child);

				if (child.material !== undefined)
				{
					this.materials.push(child.material);
				}
			}

			if (child.hasOwnProperty('userData'))
			{
				if (child.userData.hasOwnProperty('data'))
				{
					if (child.userData.data === 'seat')
					{
						this.seats.push(new VehicleSeat(this, child, gltf));
					}
					if (child.userData.data === 'camera')
					{
						this.camera = child;
						const vb = Number(child.userData.viewBack);
						if (!isNaN(vb)) this.viewBack = vb;
						if (child.userData.centerHere === 'true') this.centerHere = true;
					}
					if (child.userData.data === 'wheel')
					{
						this.wheels.push(new Wheel(child));
					}
					if (child.userData.data === 'collision')
					{
						// Some Inthenew GLBs (e.g. rocketship.glb) tag boxes as
						// userData.type='box' rather than userData.shape='box',
						// presumably because they were re-exported under a
						// different Blender plugin. Accept either spelling so
						// the rocket actually has a chassis to stand on.
						const shape = child.userData.shape ?? child.userData.type;
						if (shape === 'box')
						{
							child.visible = false;

							let phys = new CANNON.Box(new CANNON.Vec3(child.scale.x, child.scale.y, child.scale.z));
							phys.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
							this.collision.addShape(phys, new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
						}
						else if (shape === 'sphere')
						{
							child.visible = false;

							let phys = new CANNON.Sphere(child.scale.x);
							phys.collisionFilterGroup = CollisionGroups.TrimeshColliders;
							this.collision.addShape(phys, new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
						}
					}
					if (child.userData.data === 'navmesh')
					{
						child.visible = false;
					}
				}
			}
		});

		if (this.collision.shapes.length === 0)
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