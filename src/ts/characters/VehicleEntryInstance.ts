import { TransformNode, Vector3 } from '@babylonjs/core';
import * as Utils from '../core/FunctionLibrary';
import { VehicleSeat } from '../vehicles/VehicleSeat';
import { Character } from './Character';

export class VehicleEntryInstance
{
	public character: Character;
	public targetSeat: VehicleSeat;
	public entryPoint: TransformNode;
	public wantsToDrive: boolean = false;

	constructor(character: Character)
	{
		this.character = character;
	}

	public update(timeStep: number): void
	{
		let entryPointWorldPos = new Vector3();
		Utils.getWorldPosition(this.entryPoint, entryPointWorldPos);
		let viewVector = entryPointWorldPos.subtract(this.character.position);
		this.character.setOrientation(viewVector);
		
		let heightDifference = viewVector.y;
		viewVector.y = 0;
		if (this.character.charState.canEnterVehicles && viewVector.length() < 0.2 && heightDifference < 2) {
			this.character.enterVehicle(this.targetSeat, this.entryPoint);
		}
	}
}
