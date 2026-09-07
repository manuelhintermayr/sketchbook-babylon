import { Mesh, MeshBuilder, Scene, StandardMaterial, TransformNode } from '@babylonjs/core';
import * as Utils from '../../core/FunctionLibrary';

// Shared types + colour schemes + low-level mesh helpers used by the
// per-species builders (CatBuilder, DogBuilder) and the per-frame
// animator (AnimalAnimator). The types stay here so any consumer can
// type-hint on `AnimalModel` without pulling a builder transitively.

export interface ColorScheme
{
	main: number;
	dark: number;
	light: number;
	nose: number;
	eye: number;
}

// A handful of colour palettes per species. Reused across the
// per-animal scale + heading variations so dogs and cats look like a
// real population instead of clones.
export const CAT_SCHEMES: ColorScheme[] =
[
	{ main: 0xe0e0e0, dark: 0x9c9c9c, light: 0xffffff, nose: 0xffb7c5, eye: 0x66cc66 }, // grey tabby
	{ main: 0xe8b97a, dark: 0xa86a2a, light: 0xfde9c4, nose: 0xff8888, eye: 0xeebb33 }, // ginger
	{ main: 0x222222, dark: 0x111111, light: 0x444444, nose: 0xff8899, eye: 0x88ee44 }, // black
	{ main: 0xc89070, dark: 0x6e3a1a, light: 0xf8e2c8, nose: 0xff9999, eye: 0x88aaee }, // tortoiseshell
];

export const DOG_SCHEMES: ColorScheme[] =
[
	{ main: 0xb5651d, dark: 0x6f3d10, light: 0xe5b070, nose: 0x222222, eye: 0x4a2e15 }, // brown
	{ main: 0xefd3a4, dark: 0xa07a4a, light: 0xfff0d0, nose: 0x222222, eye: 0x3a2410 }, // golden
	{ main: 0x4a3220, dark: 0x2a1a10, light: 0x7a5a40, nose: 0x111111, eye: 0x2a1a08 }, // dark brown
	{ main: 0xd0d0d0, dark: 0x808080, light: 0xffffff, nose: 0x222222, eye: 0x4a2e15 }, // white-grey
];

// Common contract every animal model satisfies. WanderingAnimals only
// reaches into these named handles - never the raw scene-graph
// children - so the cat / dog implementations stay swappable.
export interface AnimalModel
{
	group: TransformNode;
	body: TransformNode;
	head: TransformNode;
	tail: TransformNode[];
	legs: { fl: AnimalLeg; fr: AnimalLeg; bl: AnimalLeg; br: AnimalLeg };
	ears: { left: TransformNode; right: TransformNode };
	// Mouth-open mesh for voice animation. Hidden by default
	// (scaling.y ≈ 0); the animator scales it up while voiceFraction > 0
	// so meowing cats and barking dogs visibly open their mouth.
	mouthOpen: Mesh;
	// Resting body Y inside the parent group (so idle breath returns
	// to it and walk-cycle bobs around it).
	restY: number;
}

// A 2-segment leg: thigh swings around the hip, shin around the knee.
// The animator rotates these about the X axis to drive the gait.
export interface AnimalLeg
{
	thigh: TransformNode;
	shin: TransformNode;
}

// Y-shift inside the species group so the lowest paw sits at the
// root group's origin (= ground level). With makeLeg's chain (thigh
// y=0.65, shin y=-0.5, paw y=-0.5, paw geometry half-height 0.07)
// the lowest visible point is -0.42 in species-local space; lifting
// the species group by +0.42 cancels that out so the manager can
// just plant the root at ground without manual offsets per kind.
export const FOOT_OFFSET = 0.42;

// Shared matte-material factory. Builders + the animator use this
// instead of constructing materials inline so the flat, low-specular
// look stays consistent across cat, dog, eye-shine, mouth-open meshes.
export function mat(scene: Scene, color: number): StandardMaterial
{
	const material = new StandardMaterial('animal', scene);
	material.diffuseColor = Utils.linearColorFromHex(color);
	material.specularColor.set(0.05, 0.05, 0.05);
	return material;
}

// Pupil black and eye-shine white, built once per scene and shared
// across every animal to avoid material churn across N cats x M dogs.
const sharedMaterials = new WeakMap<Scene, { black: StandardMaterial; eyeWhite: StandardMaterial }>();

function shared(scene: Scene): { black: StandardMaterial; eyeWhite: StandardMaterial }
{
	let entry = sharedMaterials.get(scene);
	if (entry === undefined)
	{
		entry = { black: mat(scene, 0x111111), eyeWhite: mat(scene, 0xffffff) };
		entry.eyeWhite.specularColor.set(0.3, 0.3, 0.3);
		sharedMaterials.set(scene, entry);
	}
	return entry;
}

export function blackMat(scene: Scene): StandardMaterial
{
	return shared(scene).black;
}

export function eyeWhiteMat(scene: Scene): StandardMaterial
{
	return shared(scene).eyeWhite;
}

export function group(scene: Scene, name: string, parent?: TransformNode): TransformNode
{
	const node = new TransformNode(name, scene);
	if (parent !== undefined) node.parent = parent;
	return node;
}

export function box(scene: Scene, parent: TransformNode, width: number, height: number, depth: number, material: StandardMaterial): Mesh
{
	const mesh = MeshBuilder.CreateBox('box', { width, height, depth }, scene);
	mesh.material = material;
	mesh.parent = parent;
	mesh.isPickable = false;
	return mesh;
}

// three's SphereGeometry(radius, widthSegments, heightSegments); the
// builders flat-shade these so tiny eyes read as faceted low-poly.
export function sphere(scene: Scene, parent: TransformNode, radius: number, segments: number, material: StandardMaterial): Mesh
{
	const mesh = MeshBuilder.CreateSphere('sphere', { diameter: radius * 2, segments }, scene);
	mesh.convertToFlatShadedMesh();
	mesh.material = material;
	mesh.parent = parent;
	mesh.isPickable = false;
	return mesh;
}

// three's ConeGeometry(radius, height, radialSegments) - apex up.
export function cone(scene: Scene, parent: TransformNode, radius: number, height: number, tessellation: number, material: StandardMaterial): Mesh
{
	const mesh = MeshBuilder.CreateCylinder('cone', { diameterTop: 0, diameterBottom: radius * 2, height, tessellation }, scene);
	mesh.convertToFlatShadedMesh();
	mesh.material = material;
	mesh.parent = parent;
	mesh.isPickable = false;
	return mesh;
}

// Receive-side shadow flag for every mesh under the node. Casting is
// registered by the manager through Sky.registerShadowCaster once the
// group is in the world.
export function applyShadow(node: TransformNode): void
{
	for (const mesh of node.getChildMeshes(false))
	{
		mesh.receiveShadows = true;
	}
}

export function makeLeg(scene: Scene, furMat: StandardMaterial, lightMat: StandardMaterial, x: number, z: number): AnimalLeg
{
	const thigh = group(scene, 'thigh');
	thigh.position.set(x, 0.65, z);
	const upper = box(scene, thigh, 0.27, 0.5, 0.27, furMat);
	upper.position.y = -0.25;

	const shin = group(scene, 'shin', thigh);
	shin.position.y = -0.5;
	const lower = box(scene, shin, 0.23, 0.45, 0.23, furMat);
	lower.position.y = -0.225;
	const paw = box(scene, shin, 0.28, 0.14, 0.36, lightMat);
	paw.position.set(0, -0.5, 0.04);

	return { thigh, shin };
}

// Multi-segment tail rooted at `rootY`/`rootZ` on the parent group.
// Each segment is the child of the previous one, so a rotation on
// segment N propagates to N+1..N+last - same chain the cat-game
// animator uses for the slow tail sway.
export function makeTail(scene: Scene, parent: TransformNode, segCount: number, rootY: number, rootZ: number, baseSize: number,
	furMat: StandardMaterial, darkMat: StandardMaterial, tipMat: StandardMaterial): TransformNode[]
{
	const root = group(scene, 'tailRoot', parent);
	root.position.set(0, rootY, rootZ);

	const segs: TransformNode[] = [];
	let p: TransformNode = root;
	for (let i = 0; i < segCount; i++)
	{
		const seg = group(scene, 'tailSeg', p);
		seg.position.z = i === 0 ? -0.05 : -0.27;
		const size = baseSize - i * 0.022;
		const segMesh = box(scene, seg, size, size, 0.28,
			i === segCount - 1 ? tipMat : (i % 2 === 0 ? furMat : darkMat));
		segMesh.position.z = -0.14;
		segs.push(seg);
		p = seg;
	}
	return segs;
}
