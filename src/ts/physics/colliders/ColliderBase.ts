import {
	PhysicsBody,
	PhysicsMotionType,
	PhysicsShape,
	Quaternion,
	Scene,
	TransformNode,
	Vector3,
} from '@babylonjs/core';

import { ICollider } from '../../interfaces/ICollider';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { PhysicsWorld } from '../PhysicsWorld';

export interface ColliderOptions
{
	mass?: number;
	position?: Vector3;
	rotation?: Quaternion;
	friction?: number;
	restitution?: number;
	collisionFilterGroup?: number;
	collisionFilterMask?: number;
	// Attach the body to an existing node (the visual mesh, a GLB marker)
	// instead of creating a standalone one. The node's current world
	// transform becomes the body's start pose.
	node?: TransformNode;
	allowSleep?: boolean;
}

// Havok expects unsigned 32-bit filter masks; JS bitwise NOT yields a
// negative number, so normalise every mask through here.
export function toMask(value: number): number
{
	return value >>> 0;
}

export function applyCollisionFilter(shape: PhysicsShape, group: number, mask: number): void
{
	shape.filterMembershipMask = toMask(group);
	shape.filterCollideMask = toMask(mask);
}

// Shared body construction for the thin collider wrappers. Each collider
// owns a shape + a body on a TransformNode; static bodies (mass 0) stay
// where they're built, dynamic ones sync node <-> body every step.
export abstract class ColliderBase implements ICollider
{
	public options: any;
	public node: TransformNode;
	public shape: PhysicsShape;
	public body: PhysicsBody;

	protected init(scene: Scene, name: string, shape: PhysicsShape, options: ColliderOptions): void
	{
		this.options = options;
		this.shape = shape;

		const mass = options.mass ?? 0;
		shape.material = {
			friction: options.friction ?? 0.3,
			restitution: options.restitution ?? 0,
		};
		applyCollisionFilter(
			shape,
			options.collisionFilterGroup ?? CollisionGroups.Default,
			options.collisionFilterMask ?? ~0,
		);

		if (options.node !== undefined)
		{
			this.node = options.node;
			if (this.node.rotationQuaternion === null)
			{
				this.node.rotationQuaternion = Quaternion.FromEulerVector(this.node.rotation);
			}
		}
		else
		{
			this.node = new TransformNode(name, scene);
			this.node.rotationQuaternion = Quaternion.Identity();
			if (options.position !== undefined) this.node.position.copyFrom(options.position);
			if (options.rotation !== undefined) this.node.rotationQuaternion.copyFrom(options.rotation);
		}
		this.node.computeWorldMatrix(true);

		const motionType = mass > 0 ? PhysicsMotionType.DYNAMIC : PhysicsMotionType.STATIC;
		this.body = new PhysicsBody(this.node, motionType, false, scene);
		this.body.shape = shape;
		if (mass > 0)
		{
			this.body.setMassProperties({ mass });
			PhysicsWorld.enableNodeSync(this.body);
			if (options.allowSleep === false) PhysicsWorld.setAllowSleep(this.body, false);
		}
	}

	public get position(): Vector3
	{
		return this.node.position;
	}

	public dispose(): void
	{
		if (!this.body.isDisposed) this.body.dispose();
		this.shape.dispose();
		if (this.options.node === undefined) this.node.dispose();
	}
}
