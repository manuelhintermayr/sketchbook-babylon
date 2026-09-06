import * as CANNON from 'cannon-es';
import * as THREE from 'three';

import { Vehicle } from './Vehicle';
import { IControllable } from '../interfaces/IControllable';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { KeyBinding } from '../core/KeyBinding';
import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';
import { ENGINE_PROFILES } from '../world/audio/EngineSound';
import { commonVehicleControls } from '../core/CommonControls';
import { t } from '../i18n';

// Ported from Inthenew/Sketchbook (MIT). The rocketship reuses the
// vehicle scaffolding (chassis collision shapes, seat, rotors marked in
// the GLB) but isn't pilotable in the conventional sense - there are no
// manual ascend/yaw controls. Pressing 'descend' (Space) triggers an
// automated four-stage liftoff, after which a planet-selection modal
// appears, and the chosen target is reached via a hand-keyed flight
// animation that ends on a soft auto-landing.
//
// The physics behaviour mirrors Inthenew's exact timings, velocities
// and coordinates so the trip to / from the moon plays identically.
// What's cleaned up is shape, not function: nested setIntervals get
// named handles and live on the instance, the planet menu is wired up
// once via addEventListener instead of re-registered every liftoff
// (Inthenew's upstream had a memory leak there), and the state machine
// is named instead of being implicit in three booleans.
type SmokeParticle = {
	particle: THREE.Vector3;
	lifetime: number;
	age: number;
};

type FlightTarget = 'earth' | 'moon';

const SMOKE_PARTICLE_COUNT = 200;

// Apex altitude at which the liftoff sequence stops and the planet
// menu appears. Below 5200 on earth-bound launches; for the return
// trip from the moon Inthenew uses (rocketMaxY * 0.4) + moonHeight.
const ROCKET_MAX_Y = 5200;
const MOON_HEIGHT = 3852.67;

// Hand-authored coordinates for the two landing pads in world.glb.
const EARTH_LANDING = new CANNON.Vec3(15.1903, 16.1283, -491.721);
const MOON_LANDING = new CANNON.Vec3(15.2758, 3852.67, -11696.4);

// Liftoff is four stages of acceleration. Each stage runs 25 ticks of
// 200ms (5s per stage), so a full launch takes 20 seconds.
const LIFTOFF_STAGES = [5, 10, 15, 20];
const LIFTOFF_TICKS_PER_STAGE = 25;
const LIFTOFF_TICK_MS = 200;

// Flight timer cadence - the interval that pushes the chassis toward
// the chosen planet at constant velocity until the threshold is hit.
const FLIGHT_TICK_MS = 200;

export class RocketShip extends Vehicle implements IControllable, IWorldEntity
{
	public entityType: EntityType = EntityType.RocketShip;
	public rotors: THREE.Object3D[] = [];

	protected enginePower = 0;
	protected smokeSystem!: THREE.Points;
	private smokeParticles: SmokeParticle[] = [];

	// Flight state. justBlasted is true from the moment the player
	// presses Space until the auto-landing finishes. balancing kicks in
	// at apex while the planet menu is open. landing kicks in once the
	// chosen target's xz is reached and the rocket is dropping vertically.
	private justBlasted = false;
	private balancing = false;
	private landing = false;
	private goingTo: FlightTarget | null = null;

	// Interval handles, kept on the instance so we can cancel cleanly if
	// the player exits the rocket mid-sequence (Inthenew leaked these).
	private liftoffTimer: ReturnType<typeof setInterval> | undefined;
	private travelTimer: ReturnType<typeof setInterval> | undefined;
	private dropTimer: ReturnType<typeof setInterval> | undefined;
	private liftoffCheckTimer: ReturnType<typeof setInterval> | undefined;
	private travelCheckTimer: ReturnType<typeof setInterval> | undefined;
	private dropCheckTimer: ReturnType<typeof setInterval> | undefined;

	private menuClickHandlersBound = false;

	constructor(gltf: any)
	{
		super(gltf);

		this.readRocketShipData(gltf);
		this.initSmoke();

		this.actions = {
			ascend: new KeyBinding('ShiftLeft'),
			descend: new KeyBinding('Space'),
			exitVehicle: new KeyBinding('KeyF'),
			seat_switch: new KeyBinding('KeyX'),
			view: new KeyBinding('KeyV'),
		};

		// Rocket has its own auto-flight + KINEMATIC-pin landing - base
		// stuck/flip recovery would fight with it.
		this.recovery.stuckRecoveryEnabled = false;
		this.recovery.flipRecoveryEnabled = false;

		this.engineSoundProfile = ENGINE_PROFILES.rocket;
	}

	public noDirectionPressed(): boolean
	{
		return !this.actions.ascend.isPressed && !this.actions.descend.isPressed;
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		// Engine power ramps up while a character is in the seat, decays
		// when they exit. Drives the rotor visuals and the liftoff thrust.
		if (this.controllingCharacter !== undefined)
		{
			this.enginePower = Math.min(1, this.enginePower + timeStep * 0.2);
		}
		else
		{
			this.enginePower = Math.max(0, this.enginePower - timeStep * 0.06);
		}

		// Spin the rotors at a rate proportional to engine power.
		for (const rotor of this.rotors)
		{
			rotor.rotateX(this.enginePower * timeStep * 30);
		}

		// Smoke is only visible while the engines are firing during
		// liftoff. Inthenew's heuristic: justBlasted true and the cabin
		// not yet stable / landed.
		const burning = this.justBlasted && !this.balancing && !this.landing;
		this.smokeSystem.visible = burning;
		if (burning) this.updateSmoke(timeStep);
	}

	public physicsPreStep(body: CANNON.Body, _rocket: RocketShip): void
	{
		// Trigger: Space pressed and we're not already mid-flight.
		if (this.actions.descend.isPressed && !this.justBlasted)
		{
			this.bindPlanetMenuHandlers();
			this.startLiftoff(body);
		}

		if (this.balancing)
		{
			this.applyVerticalStabilization(body);
		}

		// Positional damping (xz only, vertical handled by stabilization).
		body.velocity.x *= THREE.MathUtils.lerp(1, 0.995, this.enginePower);
		body.velocity.z *= THREE.MathUtils.lerp(1, 0.995, this.enginePower);
		body.angularDamping = 1;
	}

	// --- Liftoff -----------------------------------------------------

	private startLiftoff(body: CANNON.Body): void
	{
		this.justBlasted = true;
		if (this.world !== undefined) this.world.sfxBus.playRocketBoom();
		const localUp = new THREE.Vector3(0, 1, 0);

		let stage = 0;
		let ticksThisStage = 0;
		this.liftoffTimer = setInterval(() =>
		{
			// targetY normally cuts off the loop before stage runs out,
			// but if the player drops enginePower the climb slows down
			// enough that stage hits 4. Without this guard LIFTOFF_STAGES[4]
			// is undefined, undefined * enginePower = NaN, NaN seeps into
			// body.velocity and EngineSound throws on the next AudioParam
			// write. Hold the last stage's thrust instead.
			const safeStage = Math.min(stage, LIFTOFF_STAGES.length - 1);

			const quat = new THREE.Quaternion(
				body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
			);
			const up = localUp.clone().applyQuaternion(quat);
			const thrust = LIFTOFF_STAGES[safeStage] * this.enginePower;
			body.velocity.x += up.x * thrust;
			body.velocity.y += up.y * thrust;
			body.velocity.z += up.z * thrust;

			ticksThisStage++;
			if (ticksThisStage >= LIFTOFF_TICKS_PER_STAGE)
			{
				stage++;
				ticksThisStage = 0;
			}

			const targetY = (this.goingTo === 'earth' || this.goingTo === null)
				? ROCKET_MAX_Y
				: ROCKET_MAX_Y * 0.4 + MOON_HEIGHT;

			if (body.position.y >= targetY)
			{
				this.stopLiftoff();
				this.balancing = true;
				if (this.controllingCharacter !== undefined)
				{
					this.showPlanetMenu();
				}
				else
				{
					// Auto-land if no driver - same fallback as upstream.
					this.landing = true;
				}
			}
		}, LIFTOFF_TICK_MS);
	}

	private stopLiftoff(): void
	{
		if (this.liftoffTimer !== undefined)
		{
			clearInterval(this.liftoffTimer);
			this.liftoffTimer = undefined;
		}
	}

	// --- Vertical stabilization (Inthenew's gravityCompensation) ----

	private applyVerticalStabilization(body: CANNON.Body): void
	{
		const quat = new THREE.Quaternion(
			body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w,
		);
		const up = new THREE.Vector3(0, 1, 0).applyQuaternion(quat);
		const globalUp = new THREE.Vector3(0, 1, 0);

		const gravity = this.world.physicsWorld.gravity;
		let gravityCompensation = new CANNON.Vec3(-gravity.x, -gravity.y, -gravity.z).length();
		gravityCompensation *= this.world.physicsFrameTime;
		gravityCompensation *= 0.98;
		const dot = globalUp.dot(up);
		gravityCompensation *= Math.sqrt(THREE.MathUtils.clamp(dot, 0, 1));

		const vertDamping = new THREE.Vector3(0, body.velocity.y, 0).multiplyScalar(-0.01);
		const vertStab = up.clone().multiplyScalar(gravityCompensation).add(vertDamping);
		vertStab.multiplyScalar(this.enginePower);

		body.velocity.x += vertStab.x;
		// Landing nudges the body downward at different rates per planet.
		body.velocity.y += !this.landing
			? vertStab.y
			: vertStab.y - (this.goingTo === 'earth' ? 5 : 0.1);
		body.velocity.z += vertStab.z;

		// Touchdown checks - once vertical position dips below the pad
		// height we consider the landing complete and reset state so
		// another launch is possible.
		//
		// The `this.landing` guard is critical: without it, the body
		// would trigger completeLanding while passing y=3755 mid-flight
		// from moon to earth (goingTo is still 'moon' until dropCheckTimer
		// fires), wedging the state machine and leaving dropTimer pushing
		// velocity through the floor.
		if (this.landing && body.position.y <= 16.1283 && this.goingTo === 'earth')
		{
			this.completeLanding();
		}
		else if (this.landing && body.position.y <= MOON_HEIGHT - 97 && this.goingTo === 'moon')
		{
			this.completeLanding();
		}
	}

	private completeLanding(): void
	{
		this.landing = false;
		this.balancing = false;
		this.collision.velocity.set(0, 0, 0);
		this.collision.angularVelocity.set(0, 0, 0);

		// Cannon's solver keeps trying to resolve the rocket vs trimesh
		// contact every step, and any tiny penetration produces an
		// upward push that re-introduces velocity, so the body never
		// truly settles on the pad. Pin it kinematic for the 1-second
		// settle window - it stops responding to forces, gravity and
		// collisions, then reverts to DYNAMIC so a fresh liftoff works.
		const previousType = this.collision.type;
		this.collision.type = CANNON.Body.KINEMATIC;
		setTimeout(() =>
		{
			this.collision.type = previousType;
			this.justBlasted = false;
		}, 1000);
	}

	// --- Planet menu -------------------------------------------------

	private bindPlanetMenuHandlers(): void
	{
		if (this.menuClickHandlersBound) return;
		this.menuClickHandlersBound = true;

		document.getElementById('earth')?.addEventListener('click', () => this.flyTo('earth'));
		document.getElementById('moon')?.addEventListener('click', () => this.flyTo('moon'));
	}

	private showPlanetMenu(): void
	{
		const menu = document.getElementById('planet-menu');
		if (menu) menu.classList.remove('planet-menu-hidden');
	}

	private hidePlanetMenu(): void
	{
		const menu = document.getElementById('planet-menu');
		if (menu) menu.classList.add('planet-menu-hidden');
	}

	// --- Earth/Moon flight -------------------------------------------

	private flyTo(target: FlightTarget): void
	{
		// Ignore stray clicks if the menu is closed (e.g. before liftoff).
		if (!this.balancing) return;
		// Ignore clicks fired by listeners pointing at a rocket that's
		// already been removed (scenario switch while the menu was open).
		if (!this.world || this.world.vehicles.indexOf(this) === -1) return;

		this.hidePlanetMenu();
		this.cancelTravelTimers();

		// Commit the target up-front so applyVerticalStabilization and
		// Sky.update see the new state immediately. Otherwise, if the
		// dropCheckTimer (200 ms tick) misses the brief window where the
		// body is below the pad threshold (cannon's collision response
		// can bounce the body back up between ticks), goingTo and
		// world.onMoon would never get reset and the sky would stay
		// black on Earth after a moon round-trip.
		this.goingTo = target;
		this.world.onMoon = target === 'moon';
		this.landing = false;

		const body = this.collision;
		const fromMoon = body.position.z < -10000;
		const toEarth = target === 'earth';

		// Smooth long-distance travel only fires when the player is on
		// the opposite planet. Otherwise (already-near-target click) we
		// just snap to the landing pad and start descending.
		if (toEarth && fromMoon)
		{
			this.smoothTravel(body, 'earth', new CANNON.Vec3(0, 0, 1000), -491.721, 'z',
				(b) => b.position.z >= -491.721,
				new CANNON.Vec3(15.1903, 6000, -491.721));
		}
		else if (!toEarth && !fromMoon)
		{
			this.smoothTravel(body, 'moon', new CANNON.Vec3(0, 0, -1000), -11696.4, 'z',
				(b) => b.position.z <= -11696.4,
				new CANNON.Vec3(15.2758, 6852.67, -11696.4));
		}
		else
		{
			// Already on or near the chosen planet - snap to the landing
			// pad and let stabilization drop us down.
			const pad = toEarth ? EARTH_LANDING : MOON_LANDING;
			body.position.set(pad.x, pad.y, pad.z);
			body.velocity.y = 0;
			this.goingTo = target;
			this.landing = true;
			if (target === 'moon') this.world.onMoon = true;
			else this.world.onMoon = false;
		}
	}

	private smoothTravel(
		body: CANNON.Body,
		target: FlightTarget,
		velocity: CANNON.Vec3,
		_thresholdValue: number,
		_axis: 'z',
		thresholdReached: (body: CANNON.Body) => boolean,
		afterPosition: CANNON.Vec3,
	): void
	{
		body.angularDamping = 0.5;
		// Inthenew rotates the rocket sideways for the trip; the axis
		// flips depending on direction so the nose points at the target.
		const axis = new CANNON.Vec3(target === 'earth' ? 1 : -1, 0, 0);
		const tilt = new CANNON.Quaternion();
		tilt.setFromAxisAngle(axis, Math.PI / 2);
		body.quaternion.copy(tilt);

		// Constant velocity push toward the target.
		this.travelTimer = setInterval(() => { body.velocity.copy(velocity); }, FLIGHT_TICK_MS);

		// Threshold check - when we cross over the target's xz, snap up
		// to a high altitude and start the descent.
		this.travelCheckTimer = setInterval(() =>
		{
			if (thresholdReached(body))
			{
				this.cancelTravelTimers();
				body.velocity.set(0, 0, 0);
				body.position.copy(afterPosition);
				body.angularDamping = 1;
				body.quaternion.set(0, 0, 0, 1);

				// Start descent: constant downward velocity until the pad.
				const descent = new CANNON.Vec3(0, -500, 0);
				this.dropTimer = setInterval(() => { body.velocity.copy(descent); }, FLIGHT_TICK_MS);

				const padY = target === 'earth' ? 16.1283 : MOON_HEIGHT;
				const finalPad = target === 'earth' ? EARTH_LANDING : MOON_LANDING;
				this.dropCheckTimer = setInterval(() =>
				{
					if (body.position.y <= padY)
					{
						this.cancelDropTimers();
						body.velocity.set(0, 0, 0);
						body.position.copy(finalPad);
						this.goingTo = target;
						this.landing = true;
						this.world.onMoon = target === 'moon';
					}
				}, FLIGHT_TICK_MS);
			}
		}, FLIGHT_TICK_MS);
	}

	private cancelTravelTimers(): void
	{
		if (this.travelTimer !== undefined)
		{
			clearInterval(this.travelTimer);
			this.travelTimer = undefined;
		}
		if (this.travelCheckTimer !== undefined)
		{
			clearInterval(this.travelCheckTimer);
			this.travelCheckTimer = undefined;
		}
	}

	private cancelDropTimers(): void
	{
		if (this.dropTimer !== undefined)
		{
			clearInterval(this.dropTimer);
			this.dropTimer = undefined;
		}
		if (this.dropCheckTimer !== undefined)
		{
			clearInterval(this.dropCheckTimer);
			this.dropCheckTimer = undefined;
		}
	}

	// Cancel every flight timer on world removal. Without this a
	// scenario switch mid-liftoff or mid-flight leaves the setInterval
	// callbacks ticking against a detached cannon body - they keep
	// writing into body.velocity / body.position long after the rocket
	// is gone. Hide the planet menu too so a stale "click moon" event
	// from a stranded listener can't fire on a freshly-spawned rocket.
	public removeFromWorld(world: World): void
	{
		super.removeFromWorld(world);
		this.stopLiftoff();
		this.cancelTravelTimers();
		this.cancelDropTimers();
		this.hidePlanetMenu();
	}

	// --- Input / housekeeping ---------------------------------------

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

	public inputReceiverInit(): void
	{
		super.inputReceiverInit();
		this.world.updateControls([
			{ keys: ['Space'], desc: t('controls.blastOff') },
			...commonVehicleControls(this.seatSwitchAvailable()),
		]);
	}

	public readRocketShipData(gltf: any): void
	{
		gltf.scene.traverse((child: THREE.Object3D) =>
		{
			if (child.userData?.data === 'rotor')
			{
				this.rotors.push(child);
			}
		});
	}

	// --- Smoke particle system --------------------------------------

	private initSmoke(): void
	{
		const texture = new THREE.TextureLoader().load('src/img/smoke.png');
		const material = new THREE.PointsMaterial({
			map: texture,
			blending: THREE.AdditiveBlending,
			transparent: true,
			depthWrite: false,
			size: 0.5,
		});

		const positions = new Float32Array(SMOKE_PARTICLE_COUNT * 3);
		for (let i = 0; i < positions.length; i++)
		{
			positions[i] = (Math.random() - 0.5) * 10;
		}
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));

		this.smokeSystem = new THREE.Points(geometry, material);
		this.smokeSystem.frustumCulled = false;
		this.smokeSystem.visible = false;
		super.add(this.smokeSystem);

		this.smokeParticles = Array.from({ length: SMOKE_PARTICLE_COUNT }, () => this.createParticle());
	}

	private createParticle(): SmokeParticle
	{
		return {
			particle: new THREE.Vector3(
				Math.random() - 0.5,
				(Math.random() - 0.5) * 2 - 1,
				Math.random() - 0.5,
			),
			lifetime: Math.random() + 1,
			age: 0,
		};
	}

	protected updateSmoke(delta: number): void
	{
		const positionAttribute = this.smokeSystem.geometry.getAttribute('position') as THREE.BufferAttribute;
		this.smokeParticles.forEach((data, i) =>
		{
			data.age += delta;
			if (data.age > data.lifetime)
			{
				Object.assign(data, this.createParticle());
			}
			const progress = data.age / data.lifetime;
			data.particle.y -= delta * 5 * (1 - progress);
			positionAttribute.setXYZ(i, data.particle.x, data.particle.y, data.particle.z);
		});
		positionAttribute.needsUpdate = true;
	}
}
