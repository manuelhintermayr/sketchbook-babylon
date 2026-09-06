import { PhysicsShapeCylinder, Scene, Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { ColliderBase, ColliderOptions } from './ColliderBase';

export interface CylinderColliderOptions extends ColliderOptions
{
	radius?: number;
	height?: number;
	segment?: number;
}

// Cylinder physics shape, ported from tkkaushik369/socketControl. Useful
// for pillars, barrels, manhole-style triggers etc. Map authoring uses a
// Cylinder mesh in world.glb tagged with userData.type='cylinder'. Havok
// cylinders are analytic, so the segment count from the cannon days is
// accepted for compatibility and ignored.
export class CylinderCollider extends ColliderBase
{
	constructor(scene: Scene, options: CylinderColliderOptions)
	{
		super();

		const defaults: CylinderColliderOptions = {
			mass: 0,
			position: new Vector3(),
			radius: 0.3,
			height: 0.1,
			segment: 6,
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults) as CylinderColliderOptions;

		const halfHeight = options.height / 2;
		const shape = new PhysicsShapeCylinder(
			new Vector3(0, -halfHeight, 0),
			new Vector3(0, halfHeight, 0),
			options.radius,
			scene,
		);

		this.init(scene, 'cylinderCollider', shape, options);
	}
}
