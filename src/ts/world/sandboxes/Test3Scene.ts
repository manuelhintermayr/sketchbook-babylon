import { MeshBuilder, Scene, TransformNode } from '@babylonjs/core';

import * as Utils from '../../core/FunctionLibrary';
import {
	BaseScene,
	axesHelper,
	empty,
	lambert,
	physicsBoxFor,
	polarGridHelper,
	sphereMesh,
	unitBox,
} from './BaseScene';

export class Test3Scene extends BaseScene
{
	constructor(scene: Scene)
	{
		super(scene);

		this.makeInfrastructure();
		this.makeScenario();
		this.makeScenarioVehicle();
		this.makeScenarioVehiclePath();
	}

	private makeInfrastructure(): void
	{
		const scene = this.scene;

		// ground
		{
			const ground = unitBox(scene, this.root, lambert(scene, 0xcccccc), 'ground');
			ground.scaling.set(124, 0.2, 124);
			physicsBoxFor(scene, ground);
		}
		// road
		{
			{
				const ramp = unitBox(scene, this.root, lambert(scene, 0x444444), 'ramp');
				ramp.position.set(5, 4, 30);
				ramp.scaling.set(15, 0.2, 40);
				ramp.rotation.x = -Math.PI / 15;
				physicsBoxFor(scene, ramp);
			}
			{
				const ground = unitBox(scene, this.root, lambert(scene, 0x444444), 'road');
				ground.scaling.set(60, 0.2, 15);
				ground.position.set(-17.5, 8.15, 57);
				physicsBoxFor(scene, ground);
			}
			{
				const ramp = unitBox(scene, this.root, lambert(scene, 0x444444), 'ramp');
				ramp.position.set(-40, 10.2, 40);
				ramp.scaling.set(15, 0.2, 20);
				ramp.rotation.x = Math.PI / 15;
				physicsBoxFor(scene, ramp);
			}
			{
				const ground = unitBox(scene, this.root, lambert(scene, 0x444444), 'road');
				ground.scaling.set(15, 0.2, 60);
				ground.position.set(-40, 12.25, 0.4);
				physicsBoxFor(scene, ground);
			}
		}
		// grass
		{
			const lawns: Array<[number, number]> = [[57, 57], [47, 47], [57, 47], [47, 57]];
			for (const [x, z] of lawns)
			{
				// three used a 2x2 plane rotated flat; CreateGround already
				// lies in the XZ plane facing up.
				const grassObj = MeshBuilder.CreateGround('grassLawn', { width: 2, height: 2 }, scene);
				grassObj.parent = this.root;
				grassObj.scaling.set(5, 5, 5);
				grassObj.position.set(x, 0.11, z);
				const material = lambert(scene, 0x000000, { name: 'grass' });
				Object.assign(Utils.materialUserData(material), {
					data: 'material',
					type: 'grass',
					instances: 50000,
				});
				grassObj.material = material;
			}
		}
	}

	private makeScenario(): void
	{
		const scenario1 = empty(this.scene, this.root, 'scenario1', {
			name: 'Free roam (default)',
			data: 'scenario',
			default: 'true',
			desc_title: 'Default spawn',
			camera_angle: 0,
			desc_content: 'Explore the world!',
		});

		const spawnPlayer = empty(this.scene, scenario1, 'user', {
			name: 'user',
			data: 'spawn',
			type: 'player',
		});
		spawnPlayer.position.set(0, 2, 0);
	}

	private makeScenarioVehicle(): void
	{
		const scene = this.scene;
		const scenario2 = empty(scene, this.root, 'scenario2', {
			name: 'default vehicles',
			data: 'scenario',
			spawn_always: 'true',
			invisible: 'true',
		});

		// vehicles
		{
			const spawnVehicle = empty(scene, scenario2, 'car_glb', {
				data: 'spawn',
				type: 'car',
				name: 'car_glb',
			});
			spawnVehicle.position.set(4, 2, 0);
		}
		{
			const spawnVehicle = empty(scene, scenario2, 'heliglb', {
				data: 'spawn',
				type: 'heli',
				name: 'heliglb',
			});
			spawnVehicle.position.set(6, 2, 0);
		}
		{
			const spawnVehicle = empty(scene, scenario2, 'car_ai', {
				data: 'spawn',
				type: 'car',
				name: 'car_ai',
				driver: 'ai',
				first_node: 'node1',
			});
			spawnVehicle.position.set(-10, 1, -10);
		}

		// box
		{
			const boxPhy = unitBox(scene, scenario2, lambert(scene, 0xccffff), 'shape_box_1');
			boxPhy.scaling.set(1, 0.4, 1);
			boxPhy.position.set(15, 2, -15);
			Utils.setUserData(boxPhy, {
				data: 'spawn',
				type: 'shape',
				subtype: 'box',
				name: 'shape_box_1',
				mass: 1,
			});
		}

		// sphere
		{
			const radius = 0.3;
			const spherePhy = sphereMesh(scene, scenario2, radius, lambert(scene, 0xccffff), 'shape_sphere_1');
			spherePhy.position.set(16, 2, -15);
			Utils.setUserData(spherePhy, {
				data: 'spawn',
				type: 'shape',
				subtype: 'sphere',
				name: 'shape_sphere_1',
				mass: 1,
				radius: radius,
			});
		}
	}

	private makeScenarioVehiclePath(): void
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
		path.position.set(-8, 0.1, 3);
	}
}
