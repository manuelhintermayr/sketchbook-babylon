import * as THREE from 'three';

// Procedural-scene base class ported from tkkaushik369/socketControl
// (src/world/ts/MapConfigs/BaseScene.ts). Subclasses build their world
// in the constructor by populating `this.scene` with meshes carrying
// Sketchbook-style userData markers (data: 'physics' / 'scenario' /
// 'spawn' / 'pathNode' / 'path'). World.loadScene then walks the
// resulting subtree exactly like a GLTF.
//
// The car/heli/airplane mesh slots from the original are kept so the
// existing scene classes compile unchanged. Sketchbook always loads
// vehicles from build/assets/{type}.glb regardless, so any vehicles
// the subclass populates here are unused by our spawn pipeline - but
// keeping the slots in lets the upstream scene constructors run as-is.
export abstract class BaseScene
{
	public scene: THREE.Scene;
	public sceneAnimations: THREE.AnimationClip[];

	public car: THREE.Mesh;
	public carAnimations: THREE.AnimationClip[];

	public heli: THREE.Mesh;
	public heliAnimations: THREE.AnimationClip[];

	public airplane: THREE.Mesh;
	public airplaneAnimations: THREE.AnimationClip[];

	constructor()
	{
		this.scene = new THREE.Scene();
		this.sceneAnimations = [];

		this.car = new THREE.Mesh();
		this.carAnimations = [];
		this.heli = new THREE.Mesh();
		this.heliAnimations = [];
		this.airplane = new THREE.Mesh();
		this.airplaneAnimations = [];
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
