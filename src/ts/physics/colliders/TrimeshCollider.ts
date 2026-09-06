import { Mesh, PhysicsShape, PhysicsShapeType, Scene } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { ColliderBase, ColliderOptions } from './ColliderBase';

// Static triangle-mesh collider built straight from a Babylon mesh.
// The mesh shape bakes the absolute scaling into the vertices (Havok
// shapes are rigid, no per-body scale), and the body sits on the mesh
// node itself so position + rotation come for free. Child meshes are
// folded in because the glTF loader splits multi-material meshes into
// one child per primitive under an empty parent mesh.
export class TrimeshCollider extends ColliderBase
{
	public mesh: Mesh;

	constructor(scene: Scene, mesh: Mesh, options: ColliderOptions)
	{
		super();

		this.mesh = mesh;

		const defaults: ColliderOptions = {
			mass: 0,
			friction: 0.3,
			node: mesh,
		};
		options = Utils.setDefaults(options, defaults) as ColliderOptions;

		const shape = new PhysicsShape({
			type: PhysicsShapeType.MESH,
			parameters: { mesh, includeChildMeshes: true },
		}, scene);

		this.init(scene, 'trimeshCollider', shape, options);
	}
}
