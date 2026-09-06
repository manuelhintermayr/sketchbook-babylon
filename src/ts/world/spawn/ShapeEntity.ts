import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { World } from '../World';
import { IWorldEntity } from '../../interfaces/IWorldEntity';
import { EntityType } from '../../enums/EntityType';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { BoxCollider } from '../../physics/colliders/BoxCollider';
import { SphereCollider } from '../../physics/colliders/SphereCollider';

// Dynamic physics primitive driven by a CANNON shape. Combines
// socketControl's ShapeEntityBase + BoxShapeEntity + SphereShapeEntity
// into a single class - single-player Sketchbook doesn't need the
// per-entity Out()/Set() snapshots that justified the inheritance there.
//
// Spawned by ShapeSpawnPoint when a scenario marker is tagged
// userData.subtype='box' or 'sphere'. The visual representation is the
// scenario marker's mesh itself; the body's position/quaternion are
// pushed back onto the mesh each frame.
export class ShapeEntity implements IWorldEntity
{
	public entityType: EntityType = EntityType.Shape;
	public updateOrder: number = UpdateOrder.Environment;

	public obj: THREE.Object3D;
	public phys: BoxCollider | SphereCollider;

	constructor(obj: THREE.Object3D, subtype: 'box' | 'sphere')
	{
		this.obj = obj;
		const mass = (obj.userData.mass !== undefined) ? Number(obj.userData.mass) : 0;

		if (subtype === 'box')
		{
			this.phys = new BoxCollider({
				size: new THREE.Vector3(obj.scale.x / 2, obj.scale.y / 2, obj.scale.z / 2),
				mass,
			});
		}
		else
		{
			const radius = (obj.userData.radius !== undefined) ? Number(obj.userData.radius) : obj.scale.x;
			this.phys = new SphereCollider({ radius, mass });
		}

		this.phys.body.position.copy(new CANNON.Vec3(obj.position.x, obj.position.y, obj.position.z));
		this.phys.body.quaternion.copy(new CANNON.Quaternion(obj.quaternion.x, obj.quaternion.y, obj.quaternion.z, obj.quaternion.w));
		this.phys.body.updateAABB();
		this.phys.body.shapes.forEach((shape) =>
		{
			shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
		});
	}

	public addToWorld(world: World): void
	{
		world.graphicsWorld.add(this.obj);
		world.physicsWorld.addBody(this.phys.body);
	}

	public removeFromWorld(world: World): void
	{
		world.graphicsWorld.remove(this.obj);
		world.physicsWorld.removeBody(this.phys.body);
	}

	public update(_timeStep: number): void
	{
		const ip = this.phys.body.interpolatedPosition;
		const iq = this.phys.body.interpolatedQuaternion;
		this.obj.position.set(ip.x, ip.y, ip.z);
		this.obj.quaternion.set(iq.x, iq.y, iq.z, iq.w);
	}
}
