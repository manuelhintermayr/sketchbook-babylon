import { Mesh, Vector3 } from '@babylonjs/core';

import { World } from '../World';
import { IWorldEntity } from '../../interfaces/IWorldEntity';
import { EntityType } from '../../enums/EntityType';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { BoxCollider } from '../../physics/colliders/BoxCollider';
import { SphereCollider } from '../../physics/colliders/SphereCollider';
import * as Utils from '../../core/FunctionLibrary';

// Dynamic physics primitive driven by a Havok body. Combines
// socketControl's ShapeEntityBase + BoxShapeEntity + SphereShapeEntity
// into a single class - single-player Sketchbook doesn't need the
// per-entity Out()/Set() snapshots that justified the inheritance there.
//
// Spawned by ShapeSpawnPoint when a scenario marker is tagged
// userData.subtype='box' or 'sphere'. The visual representation is the
// scenario marker's mesh itself, which doubles as the body's transform
// node - Havok writes position + rotation back into it after every step.
export class ShapeEntity implements IWorldEntity
{
	public entityType: EntityType = EntityType.Shape;
	public updateOrder: number = UpdateOrder.Environment;

	public obj: Mesh;
	public phys: BoxCollider | SphereCollider;

	constructor(obj: Mesh, subtype: 'box' | 'sphere')
	{
		this.obj = obj;
		const ud = Utils.userData(obj);
		const mass = (ud.mass !== undefined) ? Number(ud.mass) : 0;
		const scene = obj.getScene();

		if (subtype === 'box')
		{
			this.phys = new BoxCollider(scene, {
				size: new Vector3(obj.scaling.x / 2, obj.scaling.y / 2, obj.scaling.z / 2),
				mass,
				node: obj,
				collisionFilterMask: ~CollisionGroups.TrimeshColliders,
			});
		}
		else
		{
			const radius = (ud.radius !== undefined) ? Number(ud.radius) : obj.scaling.x;
			this.phys = new SphereCollider(scene, {
				radius,
				mass,
				node: obj,
				collisionFilterMask: ~CollisionGroups.TrimeshColliders,
			});
		}
	}

	public addToWorld(world: World): void
	{
		world.addNode(this.obj);
		world.sky.registerShadowCaster(this.obj);
	}

	public removeFromWorld(world: World): void
	{
		this.phys.dispose();
		world.removeNode(this.obj);
	}

	// Havok syncs the body transform straight into the mesh node, so
	// there's nothing to copy per frame.
	public update(_timeStep: number): void { }
}
