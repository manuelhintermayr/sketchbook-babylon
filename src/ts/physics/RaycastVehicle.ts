import { PhysicsBody, PhysicsRaycastResult, Quaternion, Vector3 } from '@babylonjs/core';

import { PhysicsWorld } from './PhysicsWorld';

// Port of the cannon-es RaycastVehicle (itself a port of Bullet's
// btRaycastVehicle, MIT) on top of Havok bodies. Sketchbook's vehicle
// feel - suspension stiffness 20, frictionSlip 0.8, the 500 N engine
// force ladder, the 1e6 handbrake - was tuned against exactly this
// algorithm, so the math is kept 1:1 and only the body access changes:
//
//   - impulses go through PhysicsBody.applyImpulse at a WORLD point
//     (cannon took a body-relative offset)
//   - velocities are read fresh from the body each time (cannon read
//     body.velocity, which its own applyImpulse mutated in place; Havok
//     applies impulses immediately too, so the semantics match)
//   - the chassis inverse inertia comes from getMassProperties()
//   - the wheel rays exclude the chassis via IRaycastQuery.ignoreBody
//     instead of toggling collisionResponse
//
// The chassis is assumed to be a root-level node (all Sketchbook
// vehicles are), so node.position / rotationQuaternion are its world
// transform without a matrix update.

export interface WheelInfoOptions
{
	chassisConnectionPointLocal?: Vector3;
	directionLocal?: Vector3;
	axleLocal?: Vector3;
	suspensionRestLength?: number;
	suspensionMaxLength?: number;
	radius?: number;
	suspensionStiffness?: number;
	dampingCompression?: number;
	dampingRelaxation?: number;
	frictionSlip?: number;
	forwardAcceleration?: number;
	sideAcceleration?: number;
	rollInfluence?: number;
	maxSuspensionForce?: number;
	isFrontWheel?: boolean;
	maxSuspensionTravel?: number;
	useCustomSlidingRotationalSpeed?: boolean;
	customSlidingRotationalSpeed?: number;
}

export class WheelRaycastResult
{
	public hasHit: boolean = false;
	public hitPointWorld: Vector3 = new Vector3();
	public hitNormalWorld: Vector3 = new Vector3();
	public directionWorld: Vector3 = new Vector3();
	public distance: number = -1;
	public body: PhysicsBody | null = null;

	public reset(): void
	{
		this.hasHit = false;
		this.hitPointWorld.set(0, 0, 0);
		this.hitNormalWorld.set(0, 0, 0);
		this.distance = -1;
		this.body = null;
	}
}

export class WheelTransform
{
	public position: Vector3 = new Vector3();
	public quaternion: Quaternion = new Quaternion();
}

export class WheelInfo
{
	public maxSuspensionTravel: number;
	public customSlidingRotationalSpeed: number;
	public useCustomSlidingRotationalSpeed: boolean;
	public sliding: boolean = false;
	public chassisConnectionPointLocal: Vector3;
	public chassisConnectionPointWorld: Vector3 = new Vector3();
	public directionLocal: Vector3;
	public directionWorld: Vector3 = new Vector3();
	public axleLocal: Vector3;
	public axleWorld: Vector3 = new Vector3();
	public suspensionRestLength: number;
	public suspensionMaxLength: number;
	public radius: number;
	public suspensionStiffness: number;
	public dampingCompression: number;
	public dampingRelaxation: number;
	public frictionSlip: number;
	public forwardAcceleration: number;
	public sideAcceleration: number;
	public steering: number = 0;
	public rotation: number = 0;
	public deltaRotation: number = 0;
	public rollInfluence: number;
	public maxSuspensionForce: number;
	public engineForce: number = 0;
	public brake: number = 0;
	public isFrontWheel: boolean;
	public clippedInvContactDotSuspension: number = 1;
	public suspensionRelativeVelocity: number = 0;
	public suspensionForce: number = 0;
	public slipInfo: number = 0;
	public skidInfo: number = 0;
	public suspensionLength: number = 0;
	public sideImpulse: number = 0;
	public forwardImpulse: number = 0;
	public raycastResult: WheelRaycastResult = new WheelRaycastResult();
	public worldTransform: WheelTransform = new WheelTransform();
	public isInContact: boolean = false;

	constructor(options: WheelInfoOptions = {})
	{
		this.chassisConnectionPointLocal = (options.chassisConnectionPointLocal ?? new Vector3()).clone();
		this.directionLocal = (options.directionLocal ?? new Vector3()).clone();
		this.axleLocal = (options.axleLocal ?? new Vector3()).clone();
		this.suspensionRestLength = options.suspensionRestLength ?? 1;
		this.suspensionMaxLength = options.suspensionMaxLength ?? 2;
		this.radius = options.radius ?? 1;
		this.suspensionStiffness = options.suspensionStiffness ?? 100;
		this.dampingCompression = options.dampingCompression ?? 10;
		this.dampingRelaxation = options.dampingRelaxation ?? 10;
		this.frictionSlip = options.frictionSlip ?? 10.5;
		this.forwardAcceleration = options.forwardAcceleration ?? 1;
		this.sideAcceleration = options.sideAcceleration ?? 1;
		this.rollInfluence = options.rollInfluence ?? 0.01;
		this.maxSuspensionForce = options.maxSuspensionForce ?? Number.MAX_VALUE;
		this.isFrontWheel = options.isFrontWheel ?? true;
		this.maxSuspensionTravel = options.maxSuspensionTravel ?? 1;
		this.useCustomSlidingRotationalSpeed = options.useCustomSlidingRotationalSpeed ?? false;
		this.customSlidingRotationalSpeed = options.customSlidingRotationalSpeed ?? -0.1;
	}
}

export interface RaycastVehicleOptions
{
	chassisBody: PhysicsBody;
	indexRightAxis?: number;
	indexForwardAxis?: number;
	indexUpAxis?: number;
}

const _directions = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const _forwardWorld = new Vector3();
const _impulse = new Vector3();
const _vel = new Vector3();
const _fwd = new Vector3();
const _hitNormalScaled = new Vector3();
const _rayVector = new Vector3();
const _rayTarget = new Vector3();
const _contactVel = new Vector3();
const _up = new Vector3();
const _right = new Vector3();
const _wheelFwd = new Vector3();
const _steeringOrn = new Quaternion();
const _rotatingOrn = new Quaternion();
const _surfNormalScaled = new Vector3();
const _relPos = new Vector3();
const _sideImp = new Vector3();
const _rollPoint = new Vector3();
const _qInv = new Quaternion();
const _inertiaQuat = new Quaternion();
const _inertiaQuatInv = new Quaternion();
const _r0 = new Vector3();
const _c0 = new Vector3();
const _m = new Vector3();
const _vec = new Vector3();
const _vel1 = new Vector3();
const _vel2 = new Vector3();
const _velDiff = new Vector3();
const _rayResult = new PhysicsRaycastResult();

interface ChassisMass
{
	invMass: number;
	inertia: Vector3;
	inertiaOrientation: Quaternion;
}

const sideFrictionStiffness2 = 1;

export class RaycastVehicle
{
	public chassisBody: PhysicsBody;
	public wheelInfos: WheelInfo[] = [];
	public sliding: boolean = false;
	public world: PhysicsWorld | null = null;
	public indexRightAxis: number;
	public indexForwardAxis: number;
	public indexUpAxis: number;
	public currentVehicleSpeedKmHour: number = 0;
	public numWheelsOnGround: number = 0;

	private preStepCallback: (dt: number) => void;
	private forwardWS: Vector3[] = [];
	private axle: Vector3[] = [];
	private chassisMass: ChassisMass = { invMass: 0, inertia: new Vector3(1, 1, 1), inertiaOrientation: Quaternion.Identity() };

	constructor(options: RaycastVehicleOptions)
	{
		this.chassisBody = options.chassisBody;
		this.indexRightAxis = options.indexRightAxis ?? 2;
		this.indexForwardAxis = options.indexForwardAxis ?? 0;
		this.indexUpAxis = options.indexUpAxis ?? 1;
		this.preStepCallback = (dt: number) => this.updateVehicle(dt);
	}

	public addWheel(options: WheelInfoOptions = {}): number
	{
		const info = new WheelInfo(options);
		const index = this.wheelInfos.length;
		this.wheelInfos.push(info);
		this.forwardWS.push(new Vector3());
		this.axle.push(new Vector3());
		return index;
	}

	public setSteeringValue(value: number, wheelIndex: number): void
	{
		this.wheelInfos[wheelIndex].steering = value;
	}

	public applyEngineForce(value: number, wheelIndex: number): void
	{
		this.wheelInfos[wheelIndex].engineForce = value;
	}

	public setBrake(brake: number, wheelIndex: number): void
	{
		this.wheelInfos[wheelIndex].brake = brake;
	}

	public addToWorld(world: PhysicsWorld): void
	{
		world.addEventListener('preStep', this.preStepCallback);
		this.world = world;
	}

	public removeFromWorld(world: PhysicsWorld): void
	{
		world.removeEventListener('preStep', this.preStepCallback);
		this.world = null;
	}

	//#region Chassis frame helpers

	private get chassisPosition(): Vector3
	{
		return this.chassisBody.transformNode.position;
	}

	private get chassisQuaternion(): Quaternion
	{
		return this.chassisBody.transformNode.rotationQuaternion;
	}

	private pointToWorldFrame(local: Vector3, out: Vector3): Vector3
	{
		return out.copyFrom(local).applyRotationQuaternionInPlace(this.chassisQuaternion).addInPlace(this.chassisPosition);
	}

	private vectorToWorldFrame(local: Vector3, out: Vector3): Vector3
	{
		return out.copyFrom(local).applyRotationQuaternionInPlace(this.chassisQuaternion);
	}

	private vectorToLocalFrame(world: Vector3, out: Vector3): Vector3
	{
		_qInv.copyFrom(this.chassisQuaternion).conjugateInPlace();
		return out.copyFrom(world).applyRotationQuaternionInPlace(_qInv);
	}

	public getVehicleAxisWorld(axisIndex: number, result: Vector3): void
	{
		result.set(axisIndex === 0 ? 1 : 0, axisIndex === 1 ? 1 : 0, axisIndex === 2 ? 1 : 0);
		this.vectorToWorldFrame(result, result);
	}

	private refreshChassisMass(): void
	{
		const props = this.chassisBody.getMassProperties();
		const mass = props.mass ?? 0;
		this.chassisMass.invMass = mass > 0 ? 1 / mass : 0;
		if (props.inertia !== undefined) this.chassisMass.inertia.copyFrom(props.inertia);
		if (props.inertiaOrientation !== undefined) this.chassisMass.inertiaOrientation.copyFrom(props.inertiaOrientation);
	}

	// invInertiaWorld * v for the chassis: rotate into the inertia frame,
	// divide by the principal moments, rotate back.
	private applyChassisInvInertia(v: Vector3, out: Vector3): Vector3
	{
		this.chassisQuaternion.multiplyToRef(this.chassisMass.inertiaOrientation, _inertiaQuat);
		_inertiaQuatInv.copyFrom(_inertiaQuat).conjugateInPlace();
		out.copyFrom(v).applyRotationQuaternionInPlace(_inertiaQuatInv);
		const inertia = this.chassisMass.inertia;
		out.x = inertia.x > 0 ? out.x / inertia.x : 0;
		out.y = inertia.y > 0 ? out.y / inertia.y : 0;
		out.z = inertia.z > 0 ? out.z / inertia.z : 0;
		return out.applyRotationQuaternionInPlace(_inertiaQuat);
	}

	//#endregion

	public updateVehicle(timeStep: number): void
	{
		const wheelInfos = this.wheelInfos;
		const numWheels = wheelInfos.length;
		const chassisBody = this.chassisBody;
		if (chassisBody.isDisposed) return;

		this.refreshChassisMass();

		for (let i = 0; i < numWheels; i++)
		{
			this.updateWheelTransform(i);
		}

		chassisBody.getLinearVelocityToRef(_vel);
		this.currentVehicleSpeedKmHour = 3.6 * _vel.length();
		this.getVehicleAxisWorld(this.indexForwardAxis, _forwardWorld);
		if (Vector3.Dot(_forwardWorld, _vel) < 0)
		{
			this.currentVehicleSpeedKmHour *= -1;
		}

		// simulate suspension
		for (let i = 0; i < numWheels; i++)
		{
			this.castRay(wheelInfos[i]);
		}

		this.updateSuspension(timeStep);

		for (let i = 0; i < numWheels; i++)
		{
			// apply suspension force
			const wheel = wheelInfos[i];
			let suspensionForce = wheel.suspensionForce;
			if (suspensionForce > wheel.maxSuspensionForce)
			{
				suspensionForce = wheel.maxSuspensionForce;
			}
			wheel.raycastResult.hitNormalWorld.scaleToRef(suspensionForce * timeStep, _impulse);
			if (suspensionForce !== 0) chassisBody.applyImpulse(_impulse, wheel.raycastResult.hitPointWorld);
		}

		this.updateFriction(timeStep);

		for (let i = 0; i < numWheels; i++)
		{
			const wheel = wheelInfos[i];
			PhysicsWorld.velocityAtWorldPoint(chassisBody, wheel.chassisConnectionPointWorld, _vel);

			// Hack to get the rotation in the correct direction
			let m = 1;
			switch (this.indexUpAxis)
			{
				case 1:
					m = -1;
					break;
			}

			if (wheel.isInContact)
			{
				this.getVehicleAxisWorld(this.indexForwardAxis, _fwd);
				const proj = Vector3.Dot(_fwd, wheel.raycastResult.hitNormalWorld);
				wheel.raycastResult.hitNormalWorld.scaleToRef(proj, _hitNormalScaled);
				_fwd.subtractInPlace(_hitNormalScaled);
				const proj2 = Vector3.Dot(_fwd, _vel);
				wheel.deltaRotation = m * proj2 * timeStep / wheel.radius;
			}

			if ((wheel.sliding || !wheel.isInContact) && wheel.engineForce !== 0 && wheel.useCustomSlidingRotationalSpeed)
			{
				// Apply custom rotation when accelerating and sliding
				wheel.deltaRotation = (wheel.engineForce > 0 ? 1 : -1) * wheel.customSlidingRotationalSpeed * timeStep;
			}

			// Lock wheels
			if (Math.abs(wheel.brake) > Math.abs(wheel.engineForce))
			{
				wheel.deltaRotation = 0;
			}

			wheel.rotation += wheel.deltaRotation; // Use the old value
			wheel.deltaRotation *= 0.99; // damping of rotation when not in contact
		}
	}

	public updateSuspension(deltaTime: number): void
	{
		const chassisMass = this.chassisMass.invMass > 0 ? 1 / this.chassisMass.invMass : 0;
		const wheelInfos = this.wheelInfos;
		const numWheels = wheelInfos.length;

		for (let w_it = 0; w_it < numWheels; w_it++)
		{
			const wheel = wheelInfos[w_it];

			if (wheel.isInContact)
			{
				let force: number;

				// Spring
				const susp_length = wheel.suspensionRestLength;
				const current_length = wheel.suspensionLength;
				const length_diff = susp_length - current_length;
				force = wheel.suspensionStiffness * length_diff * wheel.clippedInvContactDotSuspension;

				// Damper
				const projected_rel_vel = wheel.suspensionRelativeVelocity;
				let susp_damping: number;
				if (projected_rel_vel < 0)
				{
					susp_damping = wheel.dampingCompression;
				}
				else
				{
					susp_damping = wheel.dampingRelaxation;
				}
				force -= susp_damping * projected_rel_vel;

				wheel.suspensionForce = force * chassisMass;
				if (wheel.suspensionForce < 0)
				{
					wheel.suspensionForce = 0;
				}
			}
			else
			{
				wheel.suspensionForce = 0;
			}
		}
	}

	public castRay(wheel: WheelInfo): number
	{
		this.updateWheelTransformWorld(wheel);
		const chassisBody = this.chassisBody;
		let depth = -1;
		const raylen = wheel.suspensionRestLength + wheel.radius;

		wheel.directionWorld.scaleToRef(raylen, _rayVector);
		const source = wheel.chassisConnectionPointWorld;
		source.addToRef(_rayVector, _rayTarget);
		const raycastResult = wheel.raycastResult;
		raycastResult.reset();
		raycastResult.directionWorld.copyFrom(wheel.directionWorld);

		// Cast ray against world, skipping the chassis itself
		const hit = this.world !== null && this.world.raycastClosest(source, _rayTarget, { ignoreBody: chassisBody }, _rayResult);

		if (hit && _rayResult.body !== undefined)
		{
			raycastResult.hasHit = true;
			raycastResult.body = _rayResult.body;
			raycastResult.hitPointWorld.copyFrom(_rayResult.hitPointWorld);
			raycastResult.hitNormalWorld.copyFrom(_rayResult.hitNormalWorld);
			raycastResult.distance = _rayResult.hitDistance;
			depth = raycastResult.distance;

			wheel.isInContact = true;

			const hitDistance = raycastResult.distance;
			wheel.suspensionLength = hitDistance - wheel.radius;

			// clamp on max suspension travel
			const minSuspensionLength = wheel.suspensionRestLength - wheel.maxSuspensionTravel;
			const maxSuspensionLength = wheel.suspensionRestLength + wheel.maxSuspensionTravel;
			if (wheel.suspensionLength < minSuspensionLength)
			{
				wheel.suspensionLength = minSuspensionLength;
			}
			if (wheel.suspensionLength > maxSuspensionLength)
			{
				wheel.suspensionLength = maxSuspensionLength;
				wheel.raycastResult.reset();
			}

			const denominator = Vector3.Dot(wheel.raycastResult.hitNormalWorld, wheel.directionWorld);
			PhysicsWorld.velocityAtWorldPoint(chassisBody, wheel.raycastResult.hitPointWorld, _contactVel);
			const projVel = Vector3.Dot(wheel.raycastResult.hitNormalWorld, _contactVel);

			if (denominator >= -0.1)
			{
				wheel.suspensionRelativeVelocity = 0;
				wheel.clippedInvContactDotSuspension = 1 / 0.1;
			}
			else
			{
				const inv = -1 / denominator;
				wheel.suspensionRelativeVelocity = projVel * inv;
				wheel.clippedInvContactDotSuspension = inv;
			}
		}
		else
		{
			// put wheel info as in rest position
			wheel.suspensionLength = wheel.suspensionRestLength + 0 * wheel.maxSuspensionTravel;
			wheel.suspensionRelativeVelocity = 0.0;
			wheel.directionWorld.scaleToRef(-1, wheel.raycastResult.hitNormalWorld);
			wheel.clippedInvContactDotSuspension = 1.0;
		}

		return depth;
	}

	public updateWheelTransformWorld(wheel: WheelInfo): void
	{
		wheel.isInContact = false;
		this.pointToWorldFrame(wheel.chassisConnectionPointLocal, wheel.chassisConnectionPointWorld);
		this.vectorToWorldFrame(wheel.directionLocal, wheel.directionWorld);
		this.vectorToWorldFrame(wheel.axleLocal, wheel.axleWorld);
	}

	/**
	 * Update one of the wheel transform.
	 * Note when rendering wheels: during each step, wheel transforms are updated BEFORE the chassis; ie. their position becomes invalid after the step. Thus when you render wheels, you must update wheel transforms before rendering them.
	 * @param wheelIndex The wheel index to update.
	 */
	public updateWheelTransform(wheelIndex: number): void
	{
		const wheel = this.wheelInfos[wheelIndex];
		this.updateWheelTransformWorld(wheel);

		wheel.directionLocal.scaleToRef(-1, _up);
		_right.copyFrom(wheel.axleLocal);
		Vector3.CrossToRef(_up, _right, _wheelFwd);
		_wheelFwd.normalize();
		_right.normalize();

		// Rotate around steering over the wheelAxle
		Quaternion.RotationAxisToRef(_up, wheel.steering, _steeringOrn);
		Quaternion.RotationAxisToRef(_right, wheel.rotation, _rotatingOrn);

		// World rotation of the wheel
		const q = wheel.worldTransform.quaternion;
		this.chassisQuaternion.multiplyToRef(_steeringOrn, q);
		q.multiplyToRef(_rotatingOrn, q);
		q.normalize();

		// world position of the wheel
		const p = wheel.worldTransform.position;
		p.copyFrom(wheel.directionWorld);
		p.scaleInPlace(wheel.suspensionLength);
		p.addInPlace(wheel.chassisConnectionPointWorld);
	}

	public getWheelTransformWorld(wheelIndex: number): WheelTransform
	{
		return this.wheelInfos[wheelIndex].worldTransform;
	}

	public updateFriction(timeStep: number): void
	{
		// calculate the impulse, so that the wheels don't move sidewards
		const wheelInfos = this.wheelInfos;
		const numWheels = wheelInfos.length;
		const chassisBody = this.chassisBody;
		const forwardWS = this.forwardWS;
		const axle = this.axle;
		this.numWheelsOnGround = 0;

		for (let i = 0; i < numWheels; i++)
		{
			const wheel = wheelInfos[i];
			if (wheel.raycastResult.body !== null)
			{
				this.numWheelsOnGround++;
			}
			wheel.sideImpulse = 0;
			wheel.forwardImpulse = 0;
		}

		for (let i = 0; i < numWheels; i++)
		{
			const wheel = wheelInfos[i];
			const groundObject = wheel.raycastResult.body;

			if (groundObject !== null)
			{
				const axlei = axle[i];
				const wheelTrans = this.getWheelTransformWorld(i);

				// Get world axle
				axlei.copyFrom(_directions[this.indexRightAxis]).applyRotationQuaternionInPlace(wheelTrans.quaternion);

				const surfNormalWS = wheel.raycastResult.hitNormalWorld;
				const proj = Vector3.Dot(axlei, surfNormalWS);
				surfNormalWS.scaleToRef(proj, _surfNormalScaled);
				axlei.subtractInPlace(_surfNormalScaled);
				axlei.normalize();

				Vector3.CrossToRef(surfNormalWS, axlei, forwardWS[i]);
				forwardWS[i].normalize();

				wheel.sideImpulse = this.resolveSingleBilateral(chassisBody, wheel.raycastResult.hitPointWorld, groundObject, wheel.raycastResult.hitPointWorld, axlei);
				wheel.sideImpulse *= sideFrictionStiffness2;
			}
		}

		const sideFactor = 1;
		const fwdFactor = 0.5;
		this.sliding = false;

		for (let i = 0; i < numWheels; i++)
		{
			const wheel = wheelInfos[i];
			const groundObject = wheel.raycastResult.body;
			let rollingFriction = 0;
			wheel.slipInfo = 1;

			if (groundObject !== null)
			{
				const defaultRollingFrictionImpulse = 0;
				const maxImpulse = wheel.brake ? wheel.brake : defaultRollingFrictionImpulse;

				rollingFriction = this.calcRollingFriction(chassisBody, groundObject, wheel.raycastResult.hitPointWorld, forwardWS[i], maxImpulse);
				rollingFriction += wheel.engineForce * timeStep;

				const factor = maxImpulse / rollingFriction;
				wheel.slipInfo *= factor;
			}

			// switch between active rolling (throttle), braking and non-active rolling friction (nthrottle/break)
			wheel.forwardImpulse = 0;
			wheel.skidInfo = 1;

			if (groundObject !== null)
			{
				wheel.skidInfo = 1;
				const maximp = wheel.suspensionForce * timeStep * wheel.frictionSlip;
				const maximpSide = maximp;
				const maximpSquared = maximp * maximpSide;

				wheel.forwardImpulse = rollingFriction;

				const x = wheel.forwardImpulse * fwdFactor / wheel.forwardAcceleration;
				const y = wheel.sideImpulse * sideFactor / wheel.sideAcceleration;
				const impulseSquared = x * x + y * y;
				wheel.sliding = false;

				if (impulseSquared > maximpSquared)
				{
					this.sliding = true;
					wheel.sliding = true;
					const factor = maximp / Math.sqrt(impulseSquared);
					wheel.skidInfo *= factor;
				}
			}
		}

		if (this.sliding)
		{
			for (let i = 0; i < numWheels; i++)
			{
				const wheel = wheelInfos[i];
				if (wheel.sideImpulse !== 0)
				{
					if (wheel.skidInfo < 1)
					{
						wheel.forwardImpulse *= wheel.skidInfo;
						wheel.sideImpulse *= wheel.skidInfo;
					}
				}
			}
		}

		// apply the impulses
		for (let i = 0; i < numWheels; i++)
		{
			const wheel = wheelInfos[i];

			if (wheel.forwardImpulse !== 0)
			{
				forwardWS[i].scaleToRef(wheel.forwardImpulse, _impulse);
				chassisBody.applyImpulse(_impulse, wheel.raycastResult.hitPointWorld);
			}

			if (wheel.sideImpulse !== 0)
			{
				const groundObject = wheel.raycastResult.body;
				axle[i].scaleToRef(wheel.sideImpulse, _sideImp);

				// Scale the relative position in the up direction with rollInfluence.
				// If rollInfluence is 1, the impulse will be applied on the hitPoint (easy to roll over), if it is zero it will be applied in the same plane as the center of mass (not easy to roll over).
				wheel.raycastResult.hitPointWorld.subtractToRef(this.chassisPosition, _relPos);
				this.vectorToLocalFrame(_relPos, _relPos);
				if (this.indexUpAxis === 0) _relPos.x *= wheel.rollInfluence;
				else if (this.indexUpAxis === 1) _relPos.y *= wheel.rollInfluence;
				else _relPos.z *= wheel.rollInfluence;
				this.vectorToWorldFrame(_relPos, _relPos);
				_rollPoint.copyFrom(this.chassisPosition).addInPlace(_relPos);
				chassisBody.applyImpulse(_sideImp, _rollPoint);

				// apply friction impulse on the ground
				if (groundObject !== null && PhysicsWorld.isDynamic(groundObject))
				{
					_sideImp.scaleInPlace(-1);
					groundObject.applyImpulse(_sideImp, wheel.raycastResult.hitPointWorld);
				}
			}
		}
	}

	private computeImpulseDenominator(body: PhysicsBody, pos: Vector3, normal: Vector3): number
	{
		if (body !== this.chassisBody)
		{
			// Ground objects: static -> infinite mass, dynamic -> mass only.
			// cannon used the full inertia tensor here; at the precision the
			// tyre model works at the contact is dominated by the chassis
			// term, so dynamic props/balls only contribute their mass.
			const mass = PhysicsWorld.getMass(body);
			return mass > 0 ? 1 / mass : 0;
		}

		pos.subtractToRef(this.chassisPosition, _r0);
		Vector3.CrossToRef(_r0, normal, _c0);
		this.applyChassisInvInertia(_c0, _m);
		Vector3.CrossToRef(_m, _r0, _vec);
		return this.chassisMass.invMass + Vector3.Dot(normal, _vec);
	}

	private calcRollingFriction(body0: PhysicsBody, body1: PhysicsBody, frictionPosWorld: Vector3, frictionDirectionWorld: Vector3, maxImpulse: number): number
	{
		let j1: number;
		const contactPosWorld = frictionPosWorld;

		PhysicsWorld.velocityAtWorldPoint(body0, contactPosWorld, _vel1);
		PhysicsWorld.velocityAtWorldPoint(body1, contactPosWorld, _vel2);
		_vel1.subtractToRef(_vel2, _velDiff);

		const vrel = Vector3.Dot(frictionDirectionWorld, _velDiff);

		const denom0 = this.computeImpulseDenominator(body0, frictionPosWorld, frictionDirectionWorld);
		const denom1 = this.computeImpulseDenominator(body1, frictionPosWorld, frictionDirectionWorld);
		const relaxation = 1;
		const jacDiagABInv = relaxation / (denom0 + denom1);

		// calculate j that moves us to zero relative velocity
		j1 = -vrel * jacDiagABInv;

		if (maxImpulse < j1)
		{
			j1 = maxImpulse;
		}
		if (j1 < -maxImpulse)
		{
			j1 = -maxImpulse;
		}

		return j1;
	}

	// bilateral constraint between two dynamic objects
	private resolveSingleBilateral(body1: PhysicsBody, pos1: Vector3, body2: PhysicsBody, pos2: Vector3, normal: Vector3): number
	{
		const normalLenSqr = normal.lengthSquared();
		if (normalLenSqr > 1.1)
		{
			return 0; // no impulse
		}

		PhysicsWorld.velocityAtWorldPoint(body1, pos1, _vel1);
		PhysicsWorld.velocityAtWorldPoint(body2, pos2, _vel2);
		_vel1.subtractToRef(_vel2, _velDiff);

		const rel_vel = Vector3.Dot(normal, _velDiff);

		const contactDamping = 0.2;
		const invMass1 = this.chassisMass.invMass;
		const mass2 = PhysicsWorld.getMass(body2);
		const invMass2 = mass2 > 0 ? 1 / mass2 : 0;
		const massTerm = 1 / (invMass1 + invMass2);
		const impulse = -contactDamping * rel_vel * massTerm;
		return impulse;
	}
}
