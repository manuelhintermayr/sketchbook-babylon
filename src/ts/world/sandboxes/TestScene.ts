import {
	Animation,
	AnimationGroup,
	Bone,
	Color3,
	Matrix,
	Mesh,
	MeshBuilder,
	Scene,
	Skeleton,
	SkeletonViewer,
	StandardMaterial,
	Vector3,
	VertexBuffer,
} from '@babylonjs/core';

import { BaseScene } from './BaseScene';

interface Sizing
{
	segmentHeight: number;
	segmentCount: number;
	height: number;
	halfHeight: number;
}

// socketControl's skinned-cylinder test: a tall open cylinder bound to
// a 5-bone chain, plus a skeleton overlay and two (unused) animation
// clips. Ported 1:1 so the sandbox list stays complete.
export class TestScene extends BaseScene
{
	constructor(scene: Scene)
	{
		super(scene);

		const segmentHeight = 8;
		const segmentCount = 4;
		const height = segmentHeight * segmentCount;
		const halfHeight = height * 0.5;

		const sizing: Sizing = {
			segmentHeight,
			segmentCount,
			height,
			halfHeight,
		};

		const mesh = this.createMesh(sizing);
		this.createBones(mesh, sizing);
		mesh.parent = this.root;

		this.sceneAnimations.push(this.createRotationAnimation(mesh, 'rotate', 1000));
		this.sceneAnimations.push(this.createShakeAnimation(mesh, 'shake', 10000, new Vector3(0, 1, 0)));
	}

	private createMesh(sizing: Sizing): Mesh
	{
		const mesh = MeshBuilder.CreateCylinder('skinnedCylinder', {
			diameterTop: 10,
			diameterBottom: 10,
			height: sizing.height,
			tessellation: 8,
			subdivisions: sizing.segmentCount * 3,
			cap: Mesh.NO_CAP,
		}, this.scene);
		mesh.convertToFlatShadedMesh();

		// Skin weights: each vertex blends between the bone below and
		// the bone above it, proportional to its height inside the
		// segment. Top-most vertices land on the last bone with a zero
		// weight on the (non-existent) next one - clamp the index so
		// the shader never reads past the bone array.
		const positions = mesh.getVerticesData(VertexBuffer.PositionKind);
		const skinIndices: number[] = [];
		const skinWeights: number[] = [];
		const lastBone = sizing.segmentCount;
		for (let i = 0; i < positions.length / 3; i++)
		{
			const y = positions[i * 3 + 1] + sizing.halfHeight;
			const skinIndex = Math.min(lastBone, Math.floor(y / sizing.segmentHeight));
			const skinWeight = (y % sizing.segmentHeight) / sizing.segmentHeight;
			skinIndices.push(skinIndex, Math.min(lastBone, skinIndex + 1), 0, 0);
			skinWeights.push(1 - skinWeight, skinWeight, 0, 0);
		}
		mesh.setVerticesData(VertexBuffer.MatricesIndicesKind, skinIndices, false, 4);
		mesh.setVerticesData(VertexBuffer.MatricesWeightsKind, skinWeights, false, 4);

		const material = new StandardMaterial('skinnedCylinder', this.scene);
		material.diffuseColor = Color3.FromHexString('#156289');
		material.emissiveColor = Color3.FromHexString('#072534');
		material.specularColor.set(0.1, 0.1, 0.1);
		material.backFaceCulling = false;
		mesh.material = material;
		mesh.receiveShadows = true;

		return mesh;
	}

	private createBones(mesh: Mesh, sizing: Sizing): Skeleton
	{
		const skeleton = new Skeleton('testSkeleton', 'testSkeleton', this.scene);
		let prevBone = new Bone('bone0', skeleton, null, Matrix.Translation(0, -sizing.halfHeight, 0));
		for (let i = 0; i < sizing.segmentCount; i++)
		{
			prevBone = new Bone('bone' + (i + 1), skeleton, prevBone, Matrix.Translation(0, sizing.segmentHeight, 0));
		}
		mesh.skeleton = skeleton;

		const viewer = new SkeletonViewer(skeleton, mesh, this.scene, false, 3);
		viewer.isEnabled = true;
		return skeleton;
	}

	private createRotationAnimation(target: Mesh, name: string, period: number, axis: 'x' | 'y' | 'z' = 'x'): AnimationGroup
	{
		const animation = new Animation(name, 'rotation.' + axis, 60, Animation.ANIMATIONTYPE_FLOAT, Animation.ANIMATIONLOOPMODE_CYCLE);
		animation.setKeys([
			{ frame: 0, value: 0 },
			{ frame: period * 60, value: 360 },
		]);
		const group = new AnimationGroup(name, this.scene);
		group.addTargetedAnimation(animation, target);
		return group;
	}

	private createShakeAnimation(target: Mesh, name: string, duration: number, shakeScale: Vector3): AnimationGroup
	{
		const animation = new Animation(name, 'position', 60, Animation.ANIMATIONTYPE_VECTOR3, Animation.ANIMATIONLOOPMODE_CYCLE);
		const keys: Array<{ frame: number; value: Vector3 }> = [];
		for (let i = 0; i < duration * 10; i++)
		{
			keys.push({
				frame: (i / 10) * 60,
				value: new Vector3(
					(Math.random() * 2.0 - 1.0) * shakeScale.x,
					(Math.random() * 2.0 - 1.0) * shakeScale.y,
					(Math.random() * 2.0 - 1.0) * shakeScale.z,
				),
			});
		}
		animation.setKeys(keys);
		const group = new AnimationGroup(name, this.scene);
		group.addTargetedAnimation(animation, target);
		return group;
	}
}
