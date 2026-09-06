import {
	HavokPlugin,
	PhysicsActivationControl,
	PhysicsBody,
	PhysicsEngineV2,
	PhysicsMotionType,
	PhysicsPrestepType,
	PhysicsRaycastResult,
	Quaternion,
	Scene,
	TransformNode,
	Vector3,
} from '@babylonjs/core';
import type { IRaycastQuery } from '@babylonjs/core';

import { getHavok } from './PhysicsBoot';

export type PhysicsStepListener = (dt: number) => void;

// Thin facade over Babylon's Physics V2 engine + the Havok plugin. Mirrors
// the handful of things Sketchbook used from CANNON.World: gravity,
// manual stepping, pre/post-step listeners (the raycast vehicles hook in
// here) and closest-hit raycasts with collision-group filtering.
//
// Stepping is manual: scene.physicsEnabled is switched off so Babylon's
// render loop doesn't advance the simulation on its own. World.update
// calls step(timeStep) once per frame with the Time_Scale-scaled delta
// and the accumulator turns that into fixed 1/60 s substeps exactly like
// cannon's World.step(dt, timeSinceLastCalled) did - the raycast
// vehicle's tyre model (per-step damping constants, dt-scaled impulse
// clamps) only behaves the same at every frame rate when the step size
// is fixed. Pre/post listeners run per substep, matching cannon's
// preStep / postStep world events.

const _lin = new Vector3();
const _ang = new Vector3();
const _rel = new Vector3();

export class PhysicsWorld
{
	public scene: Scene;
	public plugin: HavokPlugin;
	public engine: PhysicsEngineV2;
	public dt: number = 1 / 60;
	public gravity: Vector3 = new Vector3(0, -9.81, 0);
	// Fixed substep size and cannon's default cap of 10 substeps per call.
	public fixedStep: number = 1 / 60;
	public maxSubSteps: number = 10;
	private accumulator: number = 0;

	private preStepListeners: PhysicsStepListener[] = [];
	private postStepListeners: PhysicsStepListener[] = [];

	constructor(scene: Scene)
	{
		this.scene = scene;
		this.plugin = new HavokPlugin(true, getHavok());
		scene.enablePhysics(this.gravity.clone(), this.plugin);
		scene.physicsEnabled = false;
		this.engine = scene.getPhysicsEngine() as PhysicsEngineV2;
	}

	public setGravity(x: number, y: number, z: number): void
	{
		this.gravity.set(x, y, z);
		this.engine.setGravity(this.gravity);
	}

	public addEventListener(type: 'preStep' | 'postStep', listener: PhysicsStepListener): void
	{
		(type === 'preStep' ? this.preStepListeners : this.postStepListeners).push(listener);
	}

	public removeEventListener(type: 'preStep' | 'postStep', listener: PhysicsStepListener): void
	{
		const list = type === 'preStep' ? this.preStepListeners : this.postStepListeners;
		const index = list.indexOf(listener);
		if (index !== -1) list.splice(index, 1);
	}

	// Advances the simulation by dt seconds. Skips entirely when the
	// world is paused (Time_Scale 0) - PhysicsEngine._step would otherwise
	// substitute a 1/60 s step for a zero delta.
	public step(dt: number): void
	{
		if (dt <= 1e-6) return;

		this.accumulator += dt;
		const started = performance.now();
		let substeps = 0;
		while (this.accumulator >= this.fixedStep && substeps < this.maxSubSteps)
		{
			for (const listener of this.preStepListeners) listener(this.fixedStep);
			this.engine._step(this.fixedStep);
			for (const listener of this.postStepListeners) listener(this.fixedStep);
			this.accumulator -= this.fixedStep;
			substeps++;

			// Same guard cannon had: never let the catch-up loop itself eat
			// more wall-clock time than one step.
			if (performance.now() - started > this.fixedStep * 1000) break;
		}
		this.accumulator = this.accumulator % this.fixedStep;
	}

	public raycastClosest(from: Vector3, to: Vector3, query: IRaycastQuery | undefined, result: PhysicsRaycastResult): boolean
	{
		this.engine.raycastToRef(from, to, result, query);
		if (result.hasHit) result.calculateHitDistance();
		return result.hasHit;
	}

	public removeBody(body: PhysicsBody | null | undefined): void
	{
		if (body === null || body === undefined || body.isDisposed) return;
		body.dispose();
	}

	public dispose(): void
	{
		this.preStepListeners.length = 0;
		this.postStepListeners.length = 0;
	}

	//#region Body helpers

	public static isDynamic(body: PhysicsBody | undefined | null): boolean
	{
		return body !== undefined && body !== null && !body.isDisposed && body.getMotionType() === PhysicsMotionType.DYNAMIC;
	}

	public static getMass(body: PhysicsBody): number
	{
		if (!PhysicsWorld.isDynamic(body)) return 0;
		return body.getMassProperties().mass ?? 0;
	}

	// Velocity of a world-space point on a body: linear + angular x r.
	// Static and animated bodies report their (zero or kinematic) linear
	// velocity, the same contract cannon had for getVelocityAtWorldPoint.
	public static velocityAtWorldPoint(body: PhysicsBody | undefined | null, point: Vector3, out: Vector3): Vector3
	{
		if (body === undefined || body === null || body.isDisposed || body.getMotionType() === PhysicsMotionType.STATIC)
		{
			return out.set(0, 0, 0);
		}
		body.getLinearVelocityToRef(_lin);
		body.getAngularVelocityToRef(_ang);
		body.getObjectCenterWorldToRef(_rel);
		point.subtractToRef(_rel, _rel);
		Vector3.CrossToRef(_ang, _rel, out);
		return out.addInPlace(_lin);
	}

	public static linearSpeed(body: PhysicsBody | undefined | null): number
	{
		if (body === undefined || body === null || body.isDisposed) return 0;
		body.getLinearVelocityToRef(_lin);
		return _lin.length();
	}

	public static setAllowSleep(body: PhysicsBody, allow: boolean): void
	{
		const plugin = body.transformNode.getScene().getPhysicsEngine()?.getPhysicsPlugin() as HavokPlugin | undefined;
		if (plugin === undefined || body.isDisposed) return;
		plugin.setActivationControl(body, allow ? PhysicsActivationControl.SIMULATION_CONTROLLED : PhysicsActivationControl.ALWAYS_ACTIVE);
	}

	// Writing the current velocity back wakes a sleeping Havok body
	// without changing its motion.
	public static wakeUp(body: PhysicsBody): void
	{
		body.getLinearVelocityToRef(_lin);
		body.setLinearVelocity(_lin);
	}

	public static zeroVelocity(body: PhysicsBody): void
	{
		_lin.set(0, 0, 0);
		body.setLinearVelocity(_lin);
		body.setAngularVelocity(_lin);
	}

	// Moves a body (and its node) instantly. The node is the source of
	// truth: dynamic bodies run with TELEPORT prestep so Havok picks the
	// new transform up before the next step, and the after-step sync
	// writes the same values back.
	public static teleport(body: PhysicsBody, position?: Vector3, rotation?: Quaternion): void
	{
		const node = body.transformNode;
		if (position !== undefined) node.position.copyFrom(position);
		if (rotation !== undefined) PhysicsWorld.setNodeRotation(node, rotation);
		node.computeWorldMatrix(true);
	}

	public static setNodeRotation(node: TransformNode, rotation: Quaternion): void
	{
		if (node.rotationQuaternion === null) node.rotationQuaternion = rotation.clone();
		else node.rotationQuaternion.copyFrom(rotation);
	}

	// Bodies Sketchbook moves by hand (characters, vehicles, spawned
	// shapes) need the node -> body sync before every step; static level
	// geometry keeps Babylon's default (disabled).
	public static enableNodeSync(body: PhysicsBody): void
	{
		body.setPrestepType(PhysicsPrestepType.TELEPORT);
	}

	//#endregion
}
