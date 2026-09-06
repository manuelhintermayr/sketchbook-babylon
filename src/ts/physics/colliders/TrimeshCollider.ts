import * as CANNON from 'cannon-es';
import * as THREE from 'three';
import * as Utils from '../../core/FunctionLibrary';
import { ICollider } from '../../interfaces/ICollider';
import { Object3D } from 'three';

export class TrimeshCollider implements ICollider
{
	public mesh: any;
	public options: any;
	public body: CANNON.Body;
	public debugModel: any;

	constructor(mesh: Object3D, options: any)
	{
		this.mesh = mesh.clone();
		// Geometry conversion (toNonIndexed) is done once at scene-load
		// in World rather than per-collider here.

		const defaults = {
			mass: 0,
			position: mesh.position,
			rotation: mesh.quaternion,
			friction: 0.3,
		};
		options = Utils.setDefaults(options, defaults);
		this.options = options;

		const mat = new CANNON.Material('triMat');
		mat.friction = options.friction;

		// Build CANNON.Trimesh directly from the geometry. Previously
		// went through three-to-cannon's MESH path, but its
		// getTrimeshParameters builds an indices array sized to the
		// vertex *float* count instead of the vertex count, which lets
		// the per-triangle vertex lookup walk past the end of the
		// vertices buffer and produce NaN positions. The debug
		// renderer then trips computeBoundingSphere on those NaNs.
		// Easier to construct the CANNON.Trimesh ourselves than to
		// patch the upstream lib.
		const geometry = (this.mesh as THREE.Mesh).geometry as THREE.BufferGeometry;

		// Bake the mesh's local scale into the vertex positions; the
		// CANNON.Body uses the mesh's position + quaternion but ignores
		// scale. (Same approach three-to-cannon takes via
		// normalizeGeometry.)
		this.mesh.updateMatrixWorld(true);
		const scale = new THREE.Vector3();
		this.mesh.matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), scale);

		const positionAttr = geometry.attributes.position as THREE.BufferAttribute;
		const vertCount = positionAttr.count;
		const vertices = new Float32Array(vertCount * 3);
		for (let i = 0; i < vertCount; i++)
		{
			vertices[i * 3]     = positionAttr.getX(i) * scale.x;
			vertices[i * 3 + 1] = positionAttr.getY(i) * scale.y;
			vertices[i * 3 + 2] = positionAttr.getZ(i) * scale.z;
		}

		// Geometry has been toNonIndexed()'d at load time (or built
		// without an index in the sandbox scenes), so each consecutive
		// triple of vertices forms one triangle - the indices array is
		// just [0, 1, 2, ..., vertCount-1].
		const indices = new Uint32Array(vertCount);
		for (let i = 0; i < vertCount; i++) indices[i] = i;

		// CANNON.Trimesh's typings want number[] but the constructor
		// happily accepts a typed array (it wraps with new Float32Array
		// / new Int16Array internally). Cast to bypass the strict type.
		const shape = new CANNON.Trimesh(vertices as unknown as number[], indices as unknown as number[]);

		const body = new CANNON.Body({
			mass: options.mass,
			position: options.position,
			quaternion: options.rotation,
			shape,
		});
		body.material = mat;

		this.body = body;
	}
}
