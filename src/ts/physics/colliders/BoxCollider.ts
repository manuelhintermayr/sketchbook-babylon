import { PhysicsShapeBox, Quaternion, Scene, Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { ColliderBase, ColliderOptions } from './ColliderBase';

export interface BoxColliderOptions extends ColliderOptions
{
	// Half extents, same convention CANNON.Box used. Havok wants full
	// extents so the wrapper doubles them.
	size?: Vector3;
}

export class BoxCollider extends ColliderBase
{
	constructor(scene: Scene, options: BoxColliderOptions)
	{
		super();

		const defaults: BoxColliderOptions = {
			mass: 0,
			position: new Vector3(),
			size: new Vector3(0.3, 0.3, 0.3),
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults) as BoxColliderOptions;

		const shape = new PhysicsShapeBox(
			Vector3.Zero(),
			Quaternion.Identity(),
			options.size.scale(2),
			scene,
		);

		this.init(scene, 'boxCollider', shape, options);
	}
}
