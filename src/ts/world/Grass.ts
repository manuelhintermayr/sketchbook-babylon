import {
	BoundingInfo,
	Effect,
	Mesh,
	Quaternion,
	ShaderMaterial,
	StandardMaterial,
	TransformNode,
	Vector3,
	VertexBuffer,
	VertexData,
} from '@babylonjs/core';

import * as Utils from '../core/FunctionLibrary';
import { World } from './World';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { EntityType } from '../enums/EntityType';
import { UpdateOrder } from '../enums/UpdateOrder';
import { markOutlineSkip } from '../enums/RenderLayers';
import { Noise } from './Perlin';
import { GrassShader } from './GrassShader';
import { WanderingAnimals } from './animals/WanderingAnimals';

Effect.ShadersStore['sketchbookGrassVertexShader'] = GrassShader.vertexShader;
Effect.ShadersStore['sketchbookGrassFragmentShader'] = GrassShader.fragmentShader;

// Reused per frame so refreshPushers() doesn't allocate. The helicopter
// pusher used to build a fresh Vector3 every frame (one per heli) just
// to feed it into the candidate pool; now the same vector is overwritten
// in place. The shared module scope is safe because the candidate
// pushed onto the pool stores values, not the reference.
const _heliSkid = new Vector3();

const MAX_PUSHERS = 16;

interface Candidate
{
	pos: Vector3;
	radius: number;
	distSq: number;
}

// Instanced-blade grass field, ported from tkkaushik369/socketControl (MIT).
// Based on "Realistic real-time grass rendering" by Eddie Lee, 2010
// (https://www.eddietree.com/grass). One blade mesh drawn N times with
// hardware instancing (forcedInstanceCount + instanced vertex buffers
// for the per-blade offset / orientation / stretch attributes).
//
// A scenario marks a flat plane in world.glb with material name 'grass'.
// loadScene picks that up and instantiates this class with the mesh's
// transform; the original mesh is hidden behind the blade field.
export class Grass implements IWorldEntity
{
	public updateOrder: number = UpdateOrder.World;
	public entityType: EntityType = EntityType.Grass;

	public groundMaterial: StandardMaterial;
	public grassMaterial: ShaderMaterial;

	private world: World;
	private meshes: Mesh[] = [];
	// Grow-only pool of candidate slots reused across frames. Each
	// refreshPushers() call resets `candidateCount` to 0 and bumps it
	// as it considers entities; objects are reused instead of GC'd.
	private candidatePool: Candidate[] = [];
	private candidateCount: number = 0;
	private pusherSlots: number[] = [];
	private pusherRadii: number[] = [];
	private time: number = 0;

	constructor(transform: TransformNode, world: World, instances: number = 300000)
	{
		this.world = world;
		const scene = world.scene;

		const joints = 3;
		const w_ = 0.02;
		const h_ = 0.2;

		const noise = new Noise();
		noise.seed(Math.random());

		this.groundMaterial = new StandardMaterial('grassGround', scene);
		this.groundMaterial.diffuseColor.set(0, 0.137, 0);

		// Base blade: a 1 x `joints` subdivided vertical quad, root at
		// y=0 (three's PlaneGeometry translated up by h/2).
		const grassMesh = new Mesh('grass', scene);
		this.buildBladeGeometry(grassMesh, w_, h_, joints);

		const offsets = new Float32Array(instances * 3);
		const orientations = new Float32Array(instances * 4);
		const stretches = new Float32Array(instances);
		const halfRootAngleSin = new Float32Array(instances);
		const halfRootAngleCos = new Float32Array(instances);

		let quaternion_0 = new Quaternion();
		const quaternion_1 = new Quaternion();
		let x: number, y: number, z: number, w: number;

		const min = -0.25;
		const max = 0.25;

		const halfWidth = transform.scaling.x;
		const halfDepth = transform.scaling.z;

		for (let i = 0; i < instances; i++)
		{
			x = Math.random() * halfWidth * 2 - halfWidth;
			z = Math.random() * halfDepth * 2 - halfDepth;
			y = 0;
			offsets[i * 3] = x;
			offsets[i * 3 + 1] = y;
			offsets[i * 3 + 2] = z;

			let angle = Math.PI - Math.random() * (2 * Math.PI);
			halfRootAngleSin[i] = Math.sin(0.5 * angle);
			halfRootAngleCos[i] = Math.cos(0.5 * angle);

			let RotationAxis = new Vector3(0, 1, 0);
			x = RotationAxis.x * Math.sin(angle / 2.0);
			y = RotationAxis.y * Math.sin(angle / 2.0);
			z = RotationAxis.z * Math.sin(angle / 2.0);
			w = Math.cos(angle / 2.0);
			quaternion_0.set(x, y, z, w).normalize();

			angle = Math.random() * (max - min) + min;
			RotationAxis = new Vector3(1, 0, 0);
			x = RotationAxis.x * Math.sin(angle / 2.0);
			y = RotationAxis.y * Math.sin(angle / 2.0);
			z = RotationAxis.z * Math.sin(angle / 2.0);
			w = Math.cos(angle / 2.0);
			quaternion_1.set(x, y, z, w).normalize();

			quaternion_0 = this.multiplyQuaternions(quaternion_0, quaternion_1);

			angle = Math.random() * (max - min) + min;
			RotationAxis = new Vector3(0, 0, 1);
			x = RotationAxis.x * Math.sin(angle / 2.0);
			y = RotationAxis.y * Math.sin(angle / 2.0);
			z = RotationAxis.z * Math.sin(angle / 2.0);
			w = Math.cos(angle / 2.0);
			quaternion_1.set(x, y, z, w).normalize();

			quaternion_0 = this.multiplyQuaternions(quaternion_0, quaternion_1);

			orientations[i * 4] = quaternion_0.x;
			orientations[i * 4 + 1] = quaternion_0.y;
			orientations[i * 4 + 2] = quaternion_0.z;
			orientations[i * 4 + 3] = quaternion_0.w;

			if (i < instances / 3)
			{
				stretches[i] = Math.random() * 1.8;
			}
			else
			{
				stretches[i] = Math.random();
			}
		}

		const engine = scene.getEngine();
		grassMesh.setVerticesBuffer(new VertexBuffer(engine, offsets, 'offset', false, false, 3, true));
		grassMesh.setVerticesBuffer(new VertexBuffer(engine, orientations, 'orientation', false, false, 4, true));
		grassMesh.setVerticesBuffer(new VertexBuffer(engine, stretches, 'stretch', false, false, 1, true));
		grassMesh.setVerticesBuffer(new VertexBuffer(engine, halfRootAngleSin, 'halfRootAngleSin', false, false, 1, true));
		grassMesh.setVerticesBuffer(new VertexBuffer(engine, halfRootAngleCos, 'halfRootAngleCos', false, false, 1, true));
		grassMesh.forcedInstanceCount = instances;

		// Bounding box spans the whole lawn, not the single base blade,
		// so frustum culling keeps the field alive while any of it is
		// on screen.
		grassMesh.setBoundingInfo(new BoundingInfo(
			new Vector3(-halfWidth, 0, -halfDepth),
			new Vector3(halfWidth, h_ * 3, halfDepth),
		));

		const texture = Utils.loadTexture(scene, 'src/img/grass/blade_diffuse.jpg');
		const alphaMap = Utils.loadTexture(scene, 'src/img/grass/blade_alpha.jpg');

		// Pre-allocate the pushers arrays so the shader always receives
		// a fixed-size uniform (matches `uniform vec3 pushers[MAX_PUSHERS]`
		// in the shader). update() rewrites the contents in-place each
		// frame; the slots past pusherCount are ignored on the GPU.
		for (let i = 0; i < MAX_PUSHERS; i++)
		{
			this.pusherSlots.push(1e6, 0, 0);
			this.pusherRadii.push(1.0);
		}

		this.grassMaterial = new ShaderMaterial('grassMaterial', scene, 'sketchbookGrass', {
			attributes: ['position', 'uv', 'offset', 'orientation', 'stretch', 'halfRootAngleSin', 'halfRootAngleCos'],
			uniforms: ['world', 'view', 'projection', 'time', 'pushers', 'pusherRadii', 'pusherCount'],
			samplers: ['map', 'alphaMap'],
		});
		this.grassMaterial.backFaceCulling = false;
		this.grassMaterial.setTexture('map', texture);
		this.grassMaterial.setTexture('alphaMap', alphaMap);
		this.grassMaterial.setFloat('time', 0);
		this.grassMaterial.setArray3('pushers', this.pusherSlots);
		this.grassMaterial.setFloats('pusherRadii', this.pusherRadii);
		this.grassMaterial.setInt('pusherCount', 0);

		grassMesh.material = this.grassMaterial;
		grassMesh.isPickable = false;

		// Skip grass instances past 60 units to keep the draw call cheap
		// when the player has wandered off the lawn. Was 30 - tighter
		// but the pop into the flat lambert base was too obvious from
		// medium-distance shots. 60 buys a much smoother transition for
		// the cost of ~600k extra triangles inside that ring; modern
		// GPUs handle it without a frame-rate hit.
		grassMesh.addLODLevel(60, null);

		transform.computeWorldMatrix(true);
		grassMesh.position.copyFrom(transform.absolutePosition);

		// Outlining 300k grass blades looks like static, and the depth
		// pre-pass would pay the full instanced draw call for nothing.
		markOutlineSkip(grassMesh);

		this.meshes.push(grassMesh);
	}

	private buildBladeGeometry(mesh: Mesh, width: number, height: number, joints: number): void
	{
		const rows = joints + 1;
		const positions: number[] = [];
		const uvs: number[] = [];
		const indices: number[] = [];

		for (let row = 0; row < rows; row++)
		{
			const v = row / joints;
			const y = v * height;
			positions.push(-width / 2, y, 0, width / 2, y, 0);
			uvs.push(0, v, 1, v);
		}
		for (let row = 0; row < joints; row++)
		{
			const a = row * 2;
			const b = a + 1;
			const c = a + 2;
			const d = a + 3;
			indices.push(a, b, d, a, d, c);
		}

		const data = new VertexData();
		data.positions = positions;
		data.uvs = uvs;
		data.indices = indices;
		data.applyToMesh(mesh, false);
	}

	private multiplyQuaternions(q1: Quaternion, q2: Quaternion): Quaternion
	{
		const x = q1.x * q2.w + q1.y * q2.z - q1.z * q2.y + q1.w * q2.x;
		const y = -q1.x * q2.z + q1.y * q2.w + q1.z * q2.x + q1.w * q2.y;
		const z = q1.x * q2.y - q1.y * q2.x + q1.z * q2.w + q1.w * q2.z;
		const w = -q1.x * q2.x - q1.y * q2.y - q1.z * q2.z + q1.w * q2.w;
		return new Quaternion(x, y, z, w);
	}

	public addToWorld(world: World): void
	{
		this.meshes.forEach((mesh) => world.addNode(mesh));
	}

	public removeFromWorld(world: World): void
	{
		this.meshes.forEach((mesh) => world.removeNode(mesh));
	}

	public update(timeStep: number): void
	{
		this.time += timeStep;
		this.grassMaterial.setFloat('time', this.time);
		this.refreshPushers();
	}

	// Collect every world-space "object on the lawn" the shader should
	// bend blades around: the player + every vehicle + every visible
	// animal. Each blade only checks the closest few pushers (loop in
	// shader caps at MAX_PUSHERS), so on crowded scenes we trim by
	// camera distance to keep nearby pushers winning over a parked car
	// on the other side of the map.
	private refreshPushers(): void
	{
		const camPos = this.world.camera.position;

		this.candidateCount = 0;
		const consider = (p: Vector3, radius: number): void =>
		{
			const dx = p.x - camPos.x;
			const dz = p.z - camPos.z;
			let cand: Candidate;
			if (this.candidateCount < this.candidatePool.length)
			{
				cand = this.candidatePool[this.candidateCount];
				cand.pos = p;
				cand.radius = radius;
				cand.distSq = dx * dx + dz * dz;
			}
			else
			{
				cand = { pos: p, radius, distSq: dx * dx + dz * dz };
				this.candidatePool.push(cand);
			}
			this.candidateCount++;
		};

		// Player + every NPC (Anna / Ben / Carla / Dieter live in
		// world.characters too). 0.8 m roughly matches a person's
		// shoulder-width plus a little aura.
		for (const c of this.world.characters) consider(c.position, 0.8);

		// Vehicles. Each per-frame pusher is sized to roughly the
		// footprint that actually touches the lawn.
		for (const v of this.world.vehicles)
		{
			if (v.entityType === EntityType.Car) consider(v.position, 1.5);
			else if (v.entityType === EntityType.Boat) consider(v.position, 2.0);
			else if (v.entityType === EntityType.Helicopter)
			{
				// heli.glb has no wheel markers - skids are part of the
				// chassis mesh. Approximate them with a virtual pusher
				// 1.2 m below chassis center; when the heli is on the
				// ground that lands roughly at blade level. _heliSkid is
				// module-scoped so the per-frame allocation is gone.
				_heliSkid.set(v.position.x, v.position.y - 1.2, v.position.z);
				consider(_heliSkid, 1.5);
			}
			// Airplane chassis is skipped; the GLB-authored wheels
			// handle ground contact. RocketShip too.

			for (const w of v.wheels) consider(w.wheelObject.position, 0.5);
		}

		// Animals - dogs and cats are small. 0.5 m ring per body.
		const wa = WanderingAnimals.getInstance();
		if (wa !== null)
		{
			for (const p of wa.getAnimalPositions()) consider(p, 0.5);
		}

		// Sort closest-first across the live range only.
		const used = this.candidateCount;
		const live = this.candidatePool.slice(0, used);
		live.sort((a, b) => a.distSq - b.distSq);

		const count = Math.min(used, MAX_PUSHERS);
		for (let i = 0; i < count; i++)
		{
			this.pusherSlots[i * 3] = live[i].pos.x;
			this.pusherSlots[i * 3 + 1] = live[i].pos.y;
			this.pusherSlots[i * 3 + 2] = live[i].pos.z;
			this.pusherRadii[i] = live[i].radius;
		}
		this.grassMaterial.setArray3('pushers', this.pusherSlots);
		this.grassMaterial.setFloats('pusherRadii', this.pusherRadii);
		this.grassMaterial.setInt('pusherCount', count);
	}
}
