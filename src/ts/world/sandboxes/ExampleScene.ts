import { Scene, TransformNode, Vector3 } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import { CatmullRomCurve3 } from '../../core/CatmullRomCurve3';
import {
	BaseScene,
	Utility,
	axesHelper,
	empty,
	lambert,
	physicsBoxFor,
	polarGridHelper,
	trimesh,
	unitBox,
} from './BaseScene';

// socketControl's Example map: a flat ground plate, a hand-authored
// trimesh terrace, a spline-extruded loop ramp, a four-node AI path,
// and two scenarios (free roam with three characters, and the
// spawn_always vehicle lineup). The upstream file also hand-built car
// / heli / airplane meshes into BaseScene's vehicle slots; Sketchbook
// loads every vehicle from its .glb, so that dead half isn't ported.
export class Example extends BaseScene
{
	constructor(scene: Scene)
	{
		super(scene);

		this.makeWorld();
		this.makePath();
		this.makeScenarios();
	}

	private makeWorld(): void
	{
		const scene = this.scene;

		// physics box
		{
			const cube = unitBox(scene, this.root, lambert(scene, 0xaa00aa), 'ground');
			cube.scaling.set(60, 0.2, 60);
			physicsBoxFor(scene, cube);
		}
		// trimesh
		{
			/*
			6  7  8  9  16
			5  0  1  10 17
			4  3  2  11 18
			15 14 13 12 19
			24 23 22 21 20
			 */
			// prettier-ignore
			const vertices = [
				0, 0, 0, // 0
				8, 0, 0, // 1
				8, 0, 8, // 2
				0, 0, 8, // 3
				-8, 2, 8, // 4
				-8, 2, 0, // 5
				-8, 2, -8, // 6
				0, 2, -8, // 7
				8, 2, -8, // 8
				16, 2, -8, // 9
				16, 2, 0, // 10
				16, 2, 8, // 11
				16, 2, 16, // 12
				8, 2, 16, // 13
				0, 2, 16, // 14
				-8, 2, 16, // 15
			];

			// prettier-ignore
			const indices = [
				1, 0, 2,
				0, 3, 2,
				0, 5, 3,
				5, 4, 3,
				7, 6, 0,
				6, 5, 0,
				8, 7, 1,
				7, 0, 1,
				9, 8, 10,
				8, 1, 10,
				10, 1, 11,
				1, 2, 11,
				11, 2, 12,
				2, 13, 12,
				2, 3, 13,
				3, 14, 13,
				3, 4, 14,
				4, 15, 14,
			];

			const uvs: number[] = [];
			let t = true;
			for (let i = 0; i < indices.length; i += 3)
			{
				if (t) uvs.push(1, 1, 0, 1, 1, 0);
				else uvs.push(0, 1, 0, 0, 1, 0);
				t = !t;
			}

			const mesh = trimesh(scene, this.root, 'terrace', Utility.vertInx(indices, vertices), new Float32Array(uvs), lambert(scene, 0x00aaaa));
			Utils.setUserData(mesh, {
				debug: true,
				data: 'physics',
				type: 'trimesh',
			});
			mesh.position.set(30 + 8, -2, 5);
		}
		// spline extrude
		{
			const length = 0.4;
			const width = 0.05;
			const spline = new CatmullRomCurve3([
				new Vector3(-2.5, 1.5, 0.0),
				new Vector3(-2, 1.5, 0.0),
				new Vector3(-1.8, 1.5, 0.05),
				new Vector3(-0.2, 0, 0.1),
				new Vector3(0.2, 0.0, 0.15),
				new Vector3(0.5, 0.4, 0.2),
				new Vector3(0.48, 0.7, 0.25),
				new Vector3(0.2, 1, 0.3),
				new Vector3(-0.2, 1, 0.35),
				new Vector3(-0.48, 0.7, 0.4),
				new Vector3(-0.5, 0.4, 0.45),
				new Vector3(-0.2, 0.0, 0.5),
				new Vector3(0.2, 0, 0.55),
				new Vector3(1.8, 1.5, 0.6),
				new Vector3(2, 1.5, 0.65),
				new Vector3(2.5, 1.5, 0.65),
			]);

			spline.closed = false;
			spline.tension = 0;

			const vertices: number[] = [];
			const indices: number[] = [];
			const steps = 100;

			for (let i = 0; i <= steps; i++)
			{
				const p = spline.getPointAt(i / steps);

				const p0 = p.clone();
				const p1 = p.clone();
				const p2 = p.clone();
				const p3 = p.clone();
				p0.y -= width / 2;
				p0.z -= length / 2;
				p1.y -= width / 2;
				p1.z += length / 2;
				p2.y += width / 2;
				p2.z += length / 2;
				p3.y += width / 2;
				p3.z -= length / 2;

				vertices.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, p2.x, p2.y, p2.z, p3.x, p3.y, p3.z);
				// prettier-ignore
				if (i !== 0)
				{
					indices.push(
						(i * 4) + (/* p */2), (i * 4) + (/* p */3), (i * 4) + (/* l */2 - 4),
						(i * 4) + (/* p */3), (i * 4) + (/* l */3 - 4), (i * 4) + (/* l */2 - 4),

						(i * 4) + (/* p */1), (i * 4) + (/* p */2), (i * 4) + (/* l */1 - 4),
						(i * 4) + (/* p */2), (i * 4) + (/* l */2 - 4), (i * 4) + (/* l */1 - 4),

						(i * 4) + (/* p */0), (i * 4) + (/* p */1), (i * 4) + (/* l */0 - 4),
						(i * 4) + (/* p */1), (i * 4) + (/* l */1 - 4), (i * 4) + (/* l */0 - 4),

						(i * 4) + (/* p */3), (i * 4) + (/* p */0), (i * 4) + (/* l */3 - 4),
						(i * 4) + (/* p */0), (i * 4) + (/* l */0 - 4), (i * 4) + (/* l */3 - 4),
					);
				}
			}

			const mesh1 = trimesh(scene, this.root, 'loop', Utility.vertInx(indices, vertices), null, lambert(scene, 0xb0b000));
			Utils.setUserData(mesh1, {
				debug: true,
				data: 'physics',
				type: 'trimesh',
			});
			mesh1.position.set(78, -30.5, -8);
			mesh1.scaling.scaleInPlace(20);
		}
	}

	private makePath(): void
	{
		const scene = this.scene;
		const axisSize = 0.5;
		const path = empty(scene, this.root, 'path1', {
			data: 'path',
			name: 'path1',
		});

		const nodes: Array<[string, number, number, string, string]> = [
			['node1', -15, -10, 'node4', 'node2'],
			['node2', 5, -10, 'node1', 'node3'],
			['node3', 5, 10, 'node2', 'node4'],
			['node4', -15, 10, 'node3', 'node1'],
		];
		for (const [name, x, z, previousNode, nextNode] of nodes)
		{
			const node: TransformNode = empty(scene, path, name, {
				name,
				data: 'pathNode',
				previousNode,
				nextNode,
			});
			axesHelper(scene, node, axisSize);
			polarGridHelper(scene, node, 10, 16, 8, 64);
			node.position.x = x;
			node.position.z = z;
		}
		path.position.set(-8, 0, 3);
	}

	private makeScenarios(): void
	{
		const scene = this.scene;

		{
			const scenario1 = empty(scene, this.root, 'scenario1', {
				name: 'Free roam (default)',
				data: 'scenario',
				default: 'true',
				desc_title: 'Default spawn',
				camera_angle: 0,
				desc_content: 'Explore the world!',
			});

			const spawnPlayer = empty(scene, scenario1, 'user', {
				name: 'user',
				data: 'spawn',
				type: 'player',
			});
			spawnPlayer.position.set(5, 15, 5);

			const spawnCharAI = empty(scene, scenario1, 'john', {
				name: 'john',
				data: 'spawn',
				type: 'character_ai',
			});
			spawnCharAI.position.set(3, 15, 5);

			const spawnCharFollow = empty(scene, scenario1, 'bob', {
				name: 'bob',
				data: 'spawn',
				type: 'character_follow',
				target: 'john',
			});
			spawnCharFollow.position.set(1, 15, 5);
		}

		{
			const scenario2 = empty(scene, this.root, 'scenario2', {
				name: 'default vehicles',
				data: 'scenario',
				spawn_always: 'true',
				invisible: 'true',
			});

			const vehicles: Array<{ position: Vector3; rotationY?: number; userData: any }> = [
				{ position: new Vector3(6, 0, 0), userData: { data: 'spawn', type: 'car', subtype: 'car_test', name: 'car' } },
				{ position: new Vector3(-10, 1, -10), userData: { data: 'spawn', type: 'car', subtype: 'car_test', name: 'car_ai', driver: 'ai', first_node: 'node1' } },
				{ position: new Vector3(9, 0, 0), userData: { data: 'spawn', type: 'heli', subtype: 'heli_test', name: 'heli' } },
				{ position: new Vector3(125, 1, 5), rotationY: -Math.PI / 2, userData: { data: 'spawn', type: 'heli', subtype: 'heli_test', name: 'heli_ramp' } },
				{ position: new Vector3(12, 0, 0), userData: { data: 'spawn', type: 'airplane', subtype: 'airplane_test', name: 'airplane' } },
				{ position: new Vector3(6, 0, -5), userData: { data: 'spawn', type: 'car', name: 'car_glb' } },
				{ position: new Vector3(9, 0, -5), userData: { data: 'spawn', type: 'heli', name: 'heliglb' } },
				{ position: new Vector3(12, 0, -5), userData: { data: 'spawn', type: 'airplane', name: 'airplaneglb' } },
			];
			for (const vehicle of vehicles)
			{
				const spawnVehicle = empty(scene, scenario2, vehicle.userData.name, vehicle.userData);
				spawnVehicle.position.copyFrom(vehicle.position);
				if (vehicle.rotationY !== undefined) spawnVehicle.rotation.y = vehicle.rotationY;
			}
		}
	}
}
