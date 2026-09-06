import { PhysicsMotionType, PhysicsShapeCapsule, Scene, Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { ColliderBase, ColliderOptions, applyCollisionFilter } from './ColliderBase';
import { PhysicsWorld } from '../PhysicsWorld';

export interface CapsuleColliderOptions extends ColliderOptions
{
	height?: number;
	radius?: number;
	segments?: number;
}

// Character capsule. cannon stacked three spheres because it had no
// capsule primitive; Havok has a real one with the same dimensions
// (height = distance between the two sphere centres, radius = sphere
// radius). Rotation is locked by zeroing the inertia, the Havok
// equivalent of cannon's fixedRotation.
export class CapsuleCollider extends ColliderBase
{
	private enabled: boolean = true;

	constructor(scene: Scene, options: CapsuleColliderOptions)
	{
		super();

		const defaults: CapsuleColliderOptions = {
			mass: 0,
			position: new Vector3(),
			height: 0.5,
			radius: 0.3,
			segments: 8,
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults) as CapsuleColliderOptions;

		const halfHeight = options.height / 2;
		const shape = new PhysicsShapeCapsule(
			new Vector3(0, -halfHeight, 0),
			new Vector3(0, halfHeight, 0),
			options.radius,
			scene,
		);

		this.init(scene, 'capsuleCollider', shape, options);

		if (options.mass > 0)
		{
			this.lockRotation();
		}
	}

	private lockRotation(): void
	{
		this.body.setMassProperties({ mass: this.options.mass, inertia: new Vector3(0, 0, 0) });
	}

	// Sketchbook parks the capsule while the character rides a vehicle
	// (cannon: removeBody). The Havok body stays registered but stops
	// colliding and simulating: filter membership 0 so nothing touches
	// it, ANIMATED motion so gravity leaves it alone, and the node sync
	// keeps it tagging along with the (vehicle-parented) character.
	public setEnabled(value: boolean): void
	{
		if (this.enabled === value) return;
		this.enabled = value;

		if (value)
		{
			applyCollisionFilter(this.shape, this.options.collisionFilterGroup, this.options.collisionFilterMask);
			this.body.setMotionType(PhysicsMotionType.DYNAMIC);
			this.lockRotation();
			PhysicsWorld.zeroVelocity(this.body);
			PhysicsWorld.enableNodeSync(this.body);
			PhysicsWorld.setAllowSleep(this.body, false);
		}
		else
		{
			PhysicsWorld.zeroVelocity(this.body);
			applyCollisionFilter(this.shape, 0, 0);
			this.body.setMotionType(PhysicsMotionType.ANIMATED);
		}
	}

	public get isEnabled(): boolean
	{
		return this.enabled;
	}
}
