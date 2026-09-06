import { PhysicsShapeSphere, Scene, Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { ColliderBase, ColliderOptions } from './ColliderBase';

export interface SphereColliderOptions extends ColliderOptions
{
	radius?: number;
}

// Sphere physics shape, ported from tkkaushik369/socketControl. Pairs
// with BoxCollider/CylinderCollider as a primitive that map authoring
// can spawn via ShapeSpawnPoint.
export class SphereCollider extends ColliderBase
{
	constructor(scene: Scene, options: SphereColliderOptions)
	{
		super();

		const defaults: SphereColliderOptions = {
			mass: 0,
			position: new Vector3(),
			radius: 0.3,
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults) as SphereColliderOptions;

		const shape = new PhysicsShapeSphere(Vector3.Zero(), options.radius, scene);

		this.init(scene, 'sphereCollider', shape, options);
	}
}
