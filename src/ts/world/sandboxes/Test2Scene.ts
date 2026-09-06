import { Scene } from '@babylonjs/core';

import { BaseScene, empty, lambert, physicsBoxFor, unitBox } from './BaseScene';

export class Test2Scene extends BaseScene
{
	constructor(scene: Scene)
	{
		super(scene);

		{
			const ground = unitBox(scene, this.root, lambert(scene, 0xcccccc), 'ground');
			ground.scaling.set(16, 0.2, 16);
			physicsBoxFor(scene, ground);
		}
		{
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
				spawnPlayer.position.set(0, 2, 0);
			}
			{
				const scenario2 = empty(scene, this.root, 'scenario2', {
					name: 'default vehicles',
					data: 'scenario',
					spawn_always: 'true',
					invisible: 'true',
				});

				const spawnVehicle = empty(scene, scenario2, 'car', {
					data: 'spawn',
					type: 'car',
					subtype: 'car_test',
					name: 'car',
				});
				spawnVehicle.position.set(4, 2, 0);
			}
		}
	}
}
