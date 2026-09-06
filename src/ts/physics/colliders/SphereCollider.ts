import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import * as Utils from '../../core/FunctionLibrary';
import { ICollider } from '../../interfaces/ICollider';

// Sphere physics shape, ported from tkkaushik369/socketControl. Pairs
// with BoxCollider/CylinderCollider as a primitive that map authoring
// can spawn via ShapeSpawnPoint.
export class SphereCollider implements ICollider
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
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults);
		this.options = options;

		options.position = new CANNON.Vec3(options.position.x, options.position.y, options.position.z);

		let mat = new CANNON.Material('sphereMat');
		mat.friction = options.friction;

		let shape = new CANNON.Sphere(options.radius);

		let physSphere = new CANNON.Body({
			mass: options.mass,
			position: options.position,
			shape,
		});
		physSphere.material = mat;

		this.body = physSphere;
	}
}
