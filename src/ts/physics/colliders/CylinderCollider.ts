import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import * as Utils from '../../core/FunctionLibrary';
import { ICollider } from '../../interfaces/ICollider';

// Cylinder physics shape, ported from tkkaushik369/socketControl. Shaped
// like CANNON's other primitives (Box/Sphere); useful for pillars,
// barrels, manhole-style triggers etc. Map authoring uses a Cylinder
// mesh in world.glb tagged with userData.type='cylinder'.
export class CylinderCollider implements ICollider
{
	public options: any;
	public body: CANNON.Body;
	public debugModel: THREE.Mesh;

	constructor(options: any)
	{
		let defaults = {
			mass: 0,
			position: new THREE.Vector3(),
			radius: 0.3,
			height: 0.1,
			segment: 6,
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults);
		this.options = options;

		options.position = new CANNON.Vec3(options.position.x, options.position.y, options.position.z);

		let mat = new CANNON.Material('cylinderMat');
		mat.friction = options.friction;

		let shape = new CANNON.Cylinder(options.radius, options.radius, options.height, options.segment);

		let physCyl = new CANNON.Body({
			mass: options.mass,
			position: options.position,
			shape,
		});
		physCyl.material = mat;

		this.body = physCyl;
	}
}
