import { Quaternion, TransformNode, Vector3 } from '@babylonjs/core';

import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { World } from '../World';
import { Helicopter } from '../../vehicles/Helicopter';
import { Airplane } from '../../vehicles/Airplane';
import { Car } from '../../vehicles/Car';
import { Boat } from '../../vehicles/Boat';
import { RocketShip } from '../../vehicles/RocketShip';
import * as Utils from '../../core/FunctionLibrary';
import { Vehicle } from '../../vehicles/Vehicle';
import { Character } from '../../characters/Character';
import { FollowPath } from '../../characters/character_ai/FollowPath';
import { LoadingManager, LoadedModel } from '../../core/LoadingManager';
import { PhysicsWorld } from '../../physics/PhysicsWorld';

export class VehicleSpawnPoint implements ISpawnPoint
{
	public type: string;
	public driver: string;
	public firstAINode: string;

	private object: TransformNode;

	constructor(object: TransformNode)
	{
		this.object = object;
	}

	public spawn(loadingManager: LoadingManager, world: World): void
	{
		loadingManager.loadGLTF('build/assets/' + this.type + '.glb', (model: LoadedModel) =>
		{
			let vehicle: Vehicle = this.getNewVehicleByType(model, this.type);
			vehicle.spawnPoint = this.object;

			let worldPos = new Vector3();
			let worldQuat = new Quaternion();
			Utils.getWorldPosition(this.object, worldPos);
			Utils.getWorldQuaternion(this.object, worldQuat);

			vehicle.setPosition(worldPos.x, worldPos.y + 1, worldPos.z);
			PhysicsWorld.setNodeRotation(vehicle, worldQuat);

			world.add(vehicle);

			if (this.driver !== undefined)
			{
				loadingManager.loadGLTF('build/assets/boxman.glb', (charModel) =>
				{
					let character = new Character(charModel);
					world.add(character);
					character.teleportToVehicle(vehicle, vehicle.seats[0]);

					if (this.driver === 'player')
					{
						character.takeControl();
					}
					else if (this.driver === 'ai')
					{
						if (this.firstAINode !== undefined)
						{
							let nodeFound = false;
							for (const pathName in world.paths) {
								if (world.paths.hasOwnProperty(pathName)) {
									const path = world.paths[pathName];

									for (const nodeName in path.nodes) {
										if (Object.prototype.hasOwnProperty.call(path.nodes, nodeName)) {
											const node = path.nodes[nodeName];

											if (node.object.name === this.firstAINode)
											{
												character.setBehaviour(new FollowPath(node, 10));
												nodeFound = true;
											}
										}
									}
								}
							}

							if (!nodeFound)
							{
								console.error('Path node ' + this.firstAINode + 'not found.');
							}
						}
					}
				});
			}
		});
	}

	private getNewVehicleByType(model: LoadedModel, type: string): Vehicle
	{
		switch (type)
		{
			case 'car': return new Car(model);
			case 'heli': return new Helicopter(model);
			case 'airplane': return new Airplane(model);
			case 'boat': return new Boat(model);
			case 'rocketship': return new RocketShip(model);
		}
	}
}
