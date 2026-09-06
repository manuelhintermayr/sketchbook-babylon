import * as THREE from 'three';

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
// reaches into these named handles - never the raw Three children -
// so the cat / dog implementations stay swappable.
export interface AnimalModel
{
	group: THREE.Group;
	body: THREE.Group;
	head: THREE.Group;
	tail: THREE.Object3D[];
	legs: { fl: AnimalLeg; fr: AnimalLeg; bl: AnimalLeg; br: AnimalLeg };
	ears: { left: THREE.Object3D; right: THREE.Object3D };
	// Mouth-open mesh for voice animation. Hidden by default
	// (scale.y ≈ 0); the animator scales it up while voiceFraction > 0
	// so meowing cats and barking dogs visibly open their mouth.
	mouthOpen: THREE.Mesh;
	// Resting body Y inside the parent group (so idle breath returns
	// to it and walk-cycle bobs around it).
	restY: number;
}

// A 2-segment leg: thigh swings around the hip, shin around the knee.
// The animator rotates these about the X axis to drive the gait.
export interface AnimalLeg
{
	thigh: THREE.Object3D;
	shin: THREE.Object3D;
}

// Y-shift inside the species group so the lowest paw sits at the
// root group's origin (= ground level). With makeLeg's chain (thigh
// y=0.65, shin y=-0.5, paw y=-0.5, paw geometry half-height 0.07)
// the lowest visible point is -0.42 in species-local space; lifting
// the species group by +0.42 cancels that out so the manager can
// just plant the root at ground without manual offsets per kind.
export const FOOT_OFFSET = 0.42;

// Shared standard-material factory. Builders + the animator use this
// instead of constructing materials inline so flatShading + roughness
// stay consistent across cat, dog, eye-shine, mouth-open meshes.
export function mat(color: number): THREE.MeshStandardMaterial
{
	return new THREE.MeshStandardMaterial({ color, roughness: 0.85, flatShading: true });
}

// Pre-built materials reused for every animal: the pupil black and
// the eye-shine white. Constructing once and sharing avoids GPU
// material churn across N cats × M dogs.
export const BLACK_MAT = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.9, flatShading: true });
export const EYE_WHITE_MAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, flatShading: true });

export function applyShadow(obj: THREE.Object3D): void
{
	obj.traverse((child) =>
	{
		if ((child as THREE.Mesh).isMesh)
		{
			child.castShadow = true;
			child.receiveShadow = true;
		}
	});
}

export function makeLeg(furMat: THREE.MeshStandardMaterial, lightMat: THREE.MeshStandardMaterial, x: number, z: number): AnimalLeg
{
	const thigh = new THREE.Group();
	thigh.position.set(x, 0.65, z);
	const upper = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.5, 0.27), furMat);
	upper.position.y = -0.25;
	thigh.add(upper);

	const shin = new THREE.Group();
	shin.position.y = -0.5;
	thigh.add(shin);
	const lower = new THREE.Mesh(new THREE.BoxGeometry(0.23, 0.45, 0.23), furMat);
	lower.position.y = -0.225;
	shin.add(lower);
	const paw = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.14, 0.36), lightMat);
	paw.position.set(0, -0.5, 0.04);
	shin.add(paw);

	return { thigh, shin };
}

// Multi-segment tail rooted at `rootY`/`rootZ` on the parent group.
// Each segment is the child of the previous one, so a rotation on
// segment N propagates to N+1..N+last - same chain the cat-game
// animator uses for the slow tail sway.
export function makeTail(parent: THREE.Object3D, segCount: number, rootY: number, rootZ: number, baseSize: number,
	furMat: THREE.MeshStandardMaterial, darkMat: THREE.MeshStandardMaterial, tipMat: THREE.MeshStandardMaterial): THREE.Object3D[]
{
	const root = new THREE.Group();
	root.position.set(0, rootY, rootZ);
	parent.add(root);

	const segs: THREE.Object3D[] = [];
	let p: THREE.Object3D = root;
	for (let i = 0; i < segCount; i++)
	{
		const seg = new THREE.Group();
		seg.position.z = i === 0 ? -0.05 : -0.27;
		const size = baseSize - i * 0.022;
		const segMesh = new THREE.Mesh(
			new THREE.BoxGeometry(size, size, 0.28),
			i === segCount - 1 ? tipMat : (i % 2 === 0 ? furMat : darkMat),
		);
		segMesh.position.z = -0.14;
		seg.add(segMesh);
		p.add(seg);
		segs.push(seg);
		p = seg;
	}
	return segs;
}
