import {
	AnimationGroup,
	Color4,
	Material,
	Mesh,
	MeshBuilder,
	Node,
	Scene,
	StandardMaterial,
	TransformNode,
	Vector3,
	VertexData,
} from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';

// Procedural-scene base class ported from tkkaushik369/socketControl
// (src/world/ts/MapConfigs/BaseScene.ts). Subclasses build their world
// in the constructor by parenting meshes carrying Sketchbook-style
// userData markers (data: 'physics' / 'scenario' / 'spawn' / 'pathNode'
// / 'path') under `this.root`. World.loadScene then walks the resulting
// subtree exactly like a loaded .glb.
//
// The original also carried car / heli / airplane mesh slots that the
// Example scene populated with hand-built vehicle meshes. Sketchbook
// always loads vehicles from build/assets/{type}.glb, so those slots
// were dead weight and are not part of this port.
export abstract class BaseScene
{
	public scene: Scene;
	public root: TransformNode;
	public sceneAnimations: AnimationGroup[];

	constructor(scene: Scene)
	{
		this.scene = scene;
		this.root = new TransformNode('sandbox', scene);
		this.sceneAnimations = [];
	}
}

// Subset of socketControl's Utility class - only the helper the
// procedural scenes actually use (Test3 + Example call vertInx when
// building trimesh ramp geometry from raw vertex/index arrays).
export class Utility
{
	static vertInx(indices: number[], vertices: number[]): Float32Array
	{
		const iv: number[] = [];
		for (const index of indices)
		{
			iv.push(vertices[index * 3]);
			iv.push(vertices[index * 3 + 1]);
			iv.push(vertices[index * 3 + 2]);
		}
		return new Float32Array(iv);
	}
}

// Shared builders for the procedural scenes. They mirror the handful
// of three.js idioms the socketControl sandboxes were written in
// (unit-box meshes scaled into shape, empties carrying userData,
// hidden half-extent physics markers) so each scene reads like the
// original level description.

export interface MaterialOptions
{
	alpha?: number;
	wireframe?: boolean;
	name?: string;
}


// three's MeshLambertMaterial / MeshStandardMaterial({ color }) stand-in.
export function lambert(scene: Scene, color: number, options: MaterialOptions = {}): StandardMaterial
{
	const material = new StandardMaterial(options.name ?? 'sandbox', scene);
	material.diffuseColor = Utils.linearColorFromHex(color);
	material.specularColor.set(0, 0, 0);
	if (options.alpha !== undefined) material.alpha = options.alpha;
	if (options.wireframe === true) material.wireframe = true;
	return material;
}

// An empty transform (three's Object3D) with optional userData marker.
export function empty(scene: Scene, parent: Node | null, name: string, userData?: any): TransformNode
{
	const node = new TransformNode(name, scene);
	node.parent = parent;
	if (userData !== undefined) Utils.setUserData(node, userData);
	return node;
}

// Unit cube (three's BoxGeometry()) - scale it into shape afterwards.
export function unitBox(scene: Scene, parent: Node | null, material: Material | null, name: string = 'box'): Mesh
{
	const mesh = MeshBuilder.CreateBox(name, { size: 1 }, scene);
	mesh.parent = parent;
	mesh.material = material;
	mesh.receiveShadows = true;
	return mesh;
}

export function sphereMesh(scene: Scene, parent: Node | null, radius: number, material: Material | null, name: string = 'sphere'): Mesh
{
	const mesh = MeshBuilder.CreateSphere(name, { diameter: radius * 2, segments: 16 }, scene);
	mesh.parent = parent;
	mesh.material = material;
	mesh.receiveShadows = true;
	return mesh;
}

// Static box collider marker matching a visual mesh: same transform,
// half the scale (BoxCollider reads the marker scale as half extents),
// tagged so SceneLoader spawns the body and hides the marker.
export function physicsBoxFor(scene: Scene, visual: Mesh): Mesh
{
	const marker = unitBox(scene, visual.parent, null, visual.name + '_phy');
	marker.scaling.copyFrom(visual.scaling).scaleInPlace(0.5);
	marker.position.copyFrom(visual.position);
	marker.rotation.copyFrom(visual.rotation);
	Utils.setUserData(marker, { data: 'physics', type: 'box' });
	return marker;
}

// Physics-only static box (no visual). `size` is the full extent.
export function staticBoxCollider(scene: Scene, parent: Node | null, position: Vector3, size: Vector3): Mesh
{
	const marker = unitBox(scene, parent, null, 'collider');
	marker.scaling.set(size.x / 2, size.y / 2, size.z / 2);
	marker.position.copyFrom(position);
	Utils.setUserData(marker, { data: 'physics', type: 'box' });
	return marker;
}

// Non-indexed triangle soup (three's BufferGeometry + vertInx) with
// computed normals. Winding stays counter-clockwise like the source
// arrays, which is the front face in a right-handed scene.
export function trimesh(scene: Scene, parent: Node | null, name: string, positions: Float32Array, uvs: Float32Array | null, material: Material): Mesh
{
	const mesh = new Mesh(name, scene);
	const indices: number[] = [];
	for (let i = 0; i < positions.length / 3; i++) indices.push(i);
	const normals: number[] = [];
	VertexData.ComputeNormals(positions, indices, normals);

	const data = new VertexData();
	data.positions = positions;
	data.indices = indices;
	data.normals = normals;
	if (uvs !== null) data.uvs = uvs;
	data.applyToMesh(mesh);

	material.sideOrientation = Material.CounterClockWiseSideOrientation;
	mesh.material = material;
	mesh.parent = parent;
	mesh.receiveShadows = true;
	return mesh;
}

// three's AxesHelper: red X, green Y, blue Z line from the origin.
export function axesHelper(scene: Scene, parent: Node | null, size: number = 1): TransformNode
{
	const node = new TransformNode('axes', scene);
	node.parent = parent;
	const axes: Array<[Vector3, Color4]> = [
		[new Vector3(size, 0, 0), new Color4(1, 0, 0, 1)],
		[new Vector3(0, size, 0), new Color4(0, 1, 0, 1)],
		[new Vector3(0, 0, size), new Color4(0, 0, 1, 1)],
	];
	for (const [end, color] of axes)
	{
		const line = MeshBuilder.CreateLines('axis', { points: [Vector3.Zero(), end], colors: [color, color] }, scene);
		line.parent = node;
		line.isPickable = false;
	}
	return node;
}

// three's PolarGridHelper: `sectors` spokes and `rings` concentric
// circles (each drawn with `divisions` segments) in the XZ plane.
export function polarGridHelper(scene: Scene, parent: Node | null, radius: number, sectors: number, rings: number, divisions: number): TransformNode
{
	const node = new TransformNode('polarGrid', scene);
	node.parent = parent;
	const lines: Vector3[][] = [];

	for (let i = 0; i < sectors; i++)
	{
		const angle = (i / sectors) * Math.PI * 2;
		lines.push([Vector3.Zero(), new Vector3(Math.sin(angle) * radius, 0, Math.cos(angle) * radius)]);
	}
	for (let r = 1; r <= rings; r++)
	{
		const ringRadius = radius * (r / rings);
		const ring: Vector3[] = [];
		for (let s = 0; s <= divisions; s++)
		{
			const angle = (s / divisions) * Math.PI * 2;
			ring.push(new Vector3(Math.sin(angle) * ringRadius, 0, Math.cos(angle) * ringRadius));
		}
		lines.push(ring);
	}

	const system = MeshBuilder.CreateLineSystem('polarGridLines', { lines }, scene);
	system.color = Utils.linearColorFromHex(0x888888);
	system.parent = node;
	system.isPickable = false;
	return node;
}
