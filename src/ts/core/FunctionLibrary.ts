import {
	AbstractMesh,
	Material,
	Matrix,
	Mesh,
	Node,
	PBRMaterial,
	Quaternion,
	Scene,
	StandardMaterial,
	Texture,
	TransformNode,
	Vector3,
} from '@babylonjs/core';
import * as _ from 'lodash';

import { SimulationFrame } from '../physics/spring_simulation/SimulationFrame';
import { Side } from '../enums/Side';
import { Space } from '../enums/Space';

//#region Math

const _Y_AXIS = new Vector3(0, 1, 0);
const _cross = new Vector3();
const _localMatrix = new Matrix();
const _axisQuat = new Quaternion();

/**
 * Constructs a 2D matrix from first vector, replacing the Y axes with the global Y axis,
 * and applies this matrix to the second vector. Saves performance when compared to full 3D matrix application.
 * Useful for character rotation, as it only happens on the Y axis.
 * @param {Vector3} a Vector to construct 2D matrix from
 * @param {Vector3} b Vector to apply basis to
 */
export function appplyVectorMatrixXZ(a: Vector3, b: Vector3): Vector3
{
	return new Vector3(
		(a.x * b.z + a.z * b.x),
		b.y,
		(a.z * b.z + -a.x * b.x)
	);
}

export function round(value: number, decimals: number = 0): number
{
	return Math.round(value * Math.pow(10, decimals)) / Math.pow(10, decimals);
}

export function roundVector(vector: Vector3, decimals: number = 0): Vector3
{
	return new Vector3(
		round(vector.x, decimals),
		round(vector.y, decimals),
		round(vector.z, decimals),
	);
}

export function lerp(a: number, b: number, t: number): number
{
	return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number
{
	return Math.max(min, Math.min(max, value));
}

/**
 * Finds an angle between two vectors
 */
export function getAngleBetweenVectors(v1: Vector3, v2: Vector3, dotTreshold: number = 0.0005): number
{
	let angle: number;
	let dot = Vector3.Dot(v1, v2);

	// If dot is close to 1, we'll round angle to zero
	if (dot > 1 - dotTreshold)
	{
		angle = 0;
	}
	else
	{
		// Dot too close to -1
		if (dot < -1 + dotTreshold)
		{
			angle = Math.PI;
		}
		else
		{
			// Get angle difference in radians
			angle = Math.acos(dot);
		}
	}

	return angle;
}

/**
 * Finds an angle between two vectors with a sign relative to normal vector
 */
export function getSignedAngleBetweenVectors(v1: Vector3, v2: Vector3, normal: Vector3 = _Y_AXIS, dotTreshold: number = 0.0005): number
{
	let angle = getAngleBetweenVectors(v1, v2, dotTreshold);

	// Get vector pointing up or down
	Vector3.CrossToRef(v1, v2, _cross);
	// Compare cross with normal to find out direction
	if (Vector3.Dot(normal, _cross) < 0)
	{
		angle = -angle;
	}

	return angle;
}

export function haveSameSigns(n1: number, n2: number): boolean
{
	return (n1 < 0) === (n2 < 0);
}

export function haveDifferentSigns(n1: number, n2: number): boolean
{
	return (n1 < 0) !== (n2 < 0);
}

// Rotates a vector around an axis in place (three's applyAxisAngle).
export function applyAxisAngle(vector: Vector3, axis: Vector3, angle: number): Vector3
{
	Quaternion.RotationAxisToRef(axis, angle, _axisQuat);
	return vector.applyRotationQuaternionInPlace(_axisQuat);
}

//#endregion

//#region Miscellaneous

export function setDefaults(options: {}, defaults: {}): {}
{
	return _.defaults({}, _.clone(options), defaults);
}

export function getGlobalProperties(prefix: string = ''): any[]
{
	let keyValues = [];
	let global = window; // window for browser environments
	for (let prop in global)
	{
		// check the prefix
		if (prop.indexOf(prefix) === 0) {
			keyValues.push(prop /*+ "=" + global[prop]*/);
		}
	}
	return keyValues; // build the string
}

export function spring(source: number, dest: number, velocity: number, mass: number, damping: number): SimulationFrame
{
	let acceleration = dest - source;
	acceleration /= mass;
	velocity += acceleration;
	velocity *= damping;

	let position = source + velocity;

	return new SimulationFrame(position, velocity);
}

export function springV(source: Vector3, dest: Vector3, velocity: Vector3, mass: number, damping: number): void
{
	let acceleration = dest.subtract(source);
	acceleration.scaleInPlace(1 / mass);
	velocity.addInPlace(acceleration);
	velocity.scaleInPlace(damping);
	source.addInPlace(velocity);
}

//#endregion

//#region Scene graph

// Map authoring rides on glTF extras (three exposed them as
// Object3D.userData). The Babylon loader stores them under
// metadata.gltf.extras; sandbox scenes write markers straight into
// metadata.userData. userData() unifies both: one stable, mutable
// object per node that dispatchers read and code-built scenes fill.
export function userData(node: Node): any
{
	if (node.metadata === null || node.metadata === undefined) node.metadata = {};
	const metadata = node.metadata;
	if (metadata.userData === undefined)
	{
		const extras = metadata.gltf?.extras;
		metadata.userData = extras !== undefined ? Object.assign({}, extras) : {};
	}
	return metadata.userData;
}

export function setUserData(node: Node, data: any): void
{
	if (node.metadata === null || node.metadata === undefined) node.metadata = {};
	node.metadata.userData = data;
}

export function materialUserData(material: Material): any
{
	if (material.metadata === null || material.metadata === undefined) material.metadata = {};
	if (material.metadata.userData === undefined) material.metadata.userData = {};
	return material.metadata.userData;
}

// Depth-first walk over a node and all its descendants, matching
// Object3D.traverse - the callback sees the root first.
export function traverse(root: Node, callback: (node: Node) => void): void
{
	callback(root);
	const descendants = root.getDescendants(false);
	for (const child of descendants) callback(child);
}

export function findByName(root: Node, name: string): Node | undefined
{
	if (root.name === name) return root;
	return root.getDescendants(false, (node) => node.name === name)[0];
}

// A node with actual geometry - the glTF loader hands back
// TransformNodes for empties and Meshes (possibly vertex-less parents)
// for everything else.
export function isRenderableMesh(node: Node): node is Mesh
{
	return node instanceof Mesh && node.getTotalVertices() > 0;
}

export function getWorldPosition(node: TransformNode, out: Vector3): Vector3
{
	node.computeWorldMatrix(true);
	return out.copyFrom(node.absolutePosition);
}

export function getWorldQuaternion(node: TransformNode, out: Quaternion): Quaternion
{
	node.computeWorldMatrix(true);
	return out.copyFrom(node.absoluteRotationQuaternion);
}

// Babylon nodes rotate through either .rotation (Euler) or the optional
// .rotationQuaternion; glTF nodes come with the quaternion set, code-built
// ones usually don't. Sketchbook always works in quaternions, so promote
// on first access.
export function getQuaternion(node: TransformNode): Quaternion
{
	if (node.rotationQuaternion === null)
	{
		node.rotationQuaternion = Quaternion.FromEulerVector(node.rotation);
	}
	return node.rotationQuaternion;
}

export function setQuaternion(node: TransformNode, rotation: Quaternion): void
{
	getQuaternion(node).copyFrom(rotation);
}

export function setEulerRotation(node: TransformNode, x: number, y: number, z: number): void
{
	if (node.rotationQuaternion !== null)
	{
		Quaternion.FromEulerAnglesToRef(x, y, z, node.rotationQuaternion);
	}
	else
	{
		node.rotation.set(x, y, z);
	}
}

// three's Euler.setFromQuaternion: builds the rotation matrix straight
// from the (possibly non-unit) quaternion components and decomposes it
// in the requested intrinsic order. Kept bit-for-bit because the
// vehicle stabilisers feed it deliberately scaled-down quaternions
// (x,y,z,w *= 0.3) and rely on the resulting "small angle" values.
export function eulerFromQuaternion(q: Quaternion, order: 'XYZ' | 'YXZ', out: Vector3): Vector3
{
	const x = q.x, y = q.y, z = q.z, w = q.w;
	const x2 = x + x, y2 = y + y, z2 = z + z;
	const xx = x * x2, xy = x * y2, xz = x * z2;
	const yy = y * y2, yz = y * z2, zz = z * z2;
	const wx = w * x2, wy = w * y2, wz = w * z2;

	const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
	const m21 = xy + wz, m22 = 1 - (xx + zz), m23 = yz - wx;
	const m31 = xz - wy, m32 = yz + wx, m33 = 1 - (xx + yy);

	if (order === 'XYZ')
	{
		out.y = Math.asin(clamp(m13, -1, 1));
		if (Math.abs(m13) < 0.9999999)
		{
			out.x = Math.atan2(-m23, m33);
			out.z = Math.atan2(-m12, m11);
		}
		else
		{
			out.x = Math.atan2(m32, m22);
			out.z = 0;
		}
	}
	else
	{
		out.x = Math.asin(-clamp(m23, -1, 1));
		if (Math.abs(m23) < 0.9999999)
		{
			out.y = Math.atan2(m13, m33);
			out.z = Math.atan2(m21, m22);
		}
		else
		{
			out.y = Math.atan2(-m31, m11);
			out.z = 0;
		}
	}
	return out;
}

// three's Euler -> Quaternion for the XYZ order.
export function quaternionFromEulerXYZ(x: number, y: number, z: number, out: Quaternion): Quaternion
{
	const c1 = Math.cos(x / 2), c2 = Math.cos(y / 2), c3 = Math.cos(z / 2);
	const s1 = Math.sin(x / 2), s2 = Math.sin(y / 2), s3 = Math.sin(z / 2);
	out.x = s1 * c2 * c3 + c1 * s2 * s3;
	out.y = c1 * s2 * c3 - s1 * c2 * s3;
	out.z = c1 * c2 * s3 + s1 * s2 * c3;
	out.w = c1 * c2 * c3 - s1 * s2 * s3;
	return out;
}

// Object3D.rotation.<axis> = value for glTF nodes. three kept an XYZ
// Euler next to the quaternion and rebuilt the quaternion whenever one
// component changed; Babylon nodes loaded from glTF only carry the
// quaternion, so the Euler is decomposed once, cached in metadata and
// re-composed after the write. Exactly matches three for authored
// parts with non-trivial base rotations (elevators, ailerons).
export function setEulerComponent(node: TransformNode, axis: 'x' | 'y' | 'z', value: number): void
{
	if (node.metadata === null || node.metadata === undefined) node.metadata = {};
	let euler: Vector3 = node.metadata.eulerXYZ;
	if (euler === undefined)
	{
		euler = new Vector3();
		if (node.rotationQuaternion !== null) eulerFromQuaternion(node.rotationQuaternion, 'XYZ', euler);
		else euler.copyFrom(node.rotation);
		node.metadata.eulerXYZ = euler;
	}
	euler[axis] = value;
	quaternionFromEulerXYZ(euler.x, euler.y, euler.z, getQuaternion(node));
}

export function getMatrix(obj: TransformNode, space: Space): Matrix
{
	switch (space)
	{
		case Space.Local:
			Matrix.ComposeToRef(obj.scaling, getQuaternion(obj), obj.position, _localMatrix);
			return _localMatrix;
		case Space.Global:
			return obj.computeWorldMatrix(true);
	}
}

export function getRight(obj: TransformNode, space: Space = Space.Global): Vector3
{
	const m = getMatrix(obj, space).m;
	return new Vector3(m[0], m[1], m[2]).normalize();
}

export function getUp(obj: TransformNode, space: Space = Space.Global): Vector3
{
	const m = getMatrix(obj, space).m;
	return new Vector3(m[4], m[5], m[6]).normalize();
}

export function getForward(obj: TransformNode, space: Space = Space.Global): Vector3
{
	const m = getMatrix(obj, space).m;
	return new Vector3(m[8], m[9], m[10]).normalize();
}

export function getBack(obj: TransformNode, space: Space = Space.Global): Vector3
{
	const m = getMatrix(obj, space).m;
	return new Vector3(-m[8], -m[9], -m[10]).normalize();
}

export function detectRelativeSide(from: TransformNode, to: TransformNode): Side
{
	const right = getRight(from, Space.Local);
	const viewVector = to.position.subtract(from.position).normalize();

	return Vector3.Dot(right, viewVector) > 0 ? Side.Left : Side.Right;
}

// Object3D.lookAt for non-cameras: point the local +Z axis at a
// world-space target. Babylon uses the same yaw/pitch convention, only
// the parent-space adjustment is needed for attached nodes.
export function lookAtWorld(node: TransformNode, target: Vector3): void
{
	if (node.parent === null)
	{
		node.lookAt(target);
	}
	else
	{
		const parentInverse = (node.parent as TransformNode).computeWorldMatrix(true).clone().invert();
		const localTarget = Vector3.TransformCoordinates(target, parentInverse);
		node.lookAt(localTarget);
	}
}

export function easeInOutSine(x: number): number
{
	return -(Math.cos(Math.PI * x) - 1) / 2;
}

export function easeOutQuad(x: number): number
{
	return 1 - (1 - x) * (1 - x);
}

//#endregion

//#region Materials

// Flat, lambert-style look for imported models: three swapped every
// textured glTF material for a shininess-0 MeshPhongMaterial. The
// Babylon equivalent is a StandardMaterial with black specular, fed by
// the PBR material's albedo texture / colour. Untextured materials go
// through the same conversion so lighting responds uniformly.
export function setupMeshProperties(child: AbstractMesh): void
{
	child.receiveShadows = true;

	const source = child.material;
	if (source === null || source instanceof StandardMaterial) return;

	const mat = new StandardMaterial(source.name, child.getScene());
	mat.specularColor.set(0, 0, 0);
	mat.backFaceCulling = source.backFaceCulling;
	mat.sideOrientation = source.sideOrientation;
	mat.alpha = source.alpha;

	if (source instanceof PBRMaterial)
	{
		mat.diffuseColor.copyFrom(source.albedoColor);
		mat.emissiveColor.copyFrom(source.emissiveColor);
		if (source.albedoTexture !== null)
		{
			mat.diffuseTexture = source.albedoTexture;
			(source.albedoTexture as Texture).anisotropicFilteringLevel = 4;
			if (source.useAlphaFromAlbedoTexture || source.albedoTexture.hasAlpha)
			{
				mat.diffuseTexture.hasAlpha = true;
				mat.useAlphaFromDiffuseTexture = source.useAlphaFromAlbedoTexture;
			}
		}
		if (source.ambientTexture !== null) mat.ambientTexture = source.ambientTexture;
		if (source.transparencyMode !== null) mat.transparencyMode = source.transparencyMode;
	}

	child.material = mat;
}

export function loadTexture(scene: Scene, url: string, invertY: boolean = true): Texture
{
	return new Texture(url, scene, false, invertY);
}

//#endregion

//#region Geometry helpers

export function isIndexed(mesh: Mesh): boolean
{
	const indices = mesh.getIndices();
	return indices !== null && indices.length > 0;
}

// Mulberry32 - small deterministic PRNG. Used by every animal /
// bird / butterfly manager so spawn placement stays stable across
// page reloads. Single shared implementation here instead of three
// near-identical copies per manager.
export function mulberry32(seed: number): () => number
{
	return () =>
	{
		seed |= 0;
		seed = (seed + 0x6d2b79f5) | 0;
		let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

//#endregion
