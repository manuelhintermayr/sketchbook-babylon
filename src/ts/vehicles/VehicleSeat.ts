import { TransformNode } from '@babylonjs/core';

import { SeatType } from '../enums/SeatType';
import { IControllable } from '../interfaces/IControllable';
import { VehicleDoor } from './VehicleDoor';
import { Character } from '../characters/Character';
import { LoadedModel } from '../core/LoadingManager';
import * as Utils from '../core/FunctionLibrary';

export class VehicleSeat
{
	public vehicle: IControllable;
	public seatPointObject: TransformNode;

	// String of names of connected seats
	public connectedSeatsString: string;
	// Actual seatPoint objects, need to be identified
	// by parsing connectedSeatsString *after* all seats are imported
	public connectedSeats: VehicleSeat[] = [];

	public type: SeatType;
	public entryPoints: TransformNode[] = [];
	public door: VehicleDoor;

	public occupiedBy: Character = null;

	constructor(vehicle: IControllable, object: TransformNode, model: LoadedModel)
	{
		this.vehicle = vehicle;
		this.seatPointObject = object;

		const ud = Utils.userData(object);
		if (ud.hasOwnProperty('data'))
		{
			if (ud.hasOwnProperty('door_object'))
			{
				this.door = new VehicleDoor(this, Utils.findByName(model.root, ud.door_object) as TransformNode);
			}

			if (ud.hasOwnProperty('entry_points'))
			{
				let entry_points = (ud.entry_points as string).split(';');
				for (const entry_point of entry_points)
				{
					if (entry_point.length > 0)
					{
						this.entryPoints.push(Utils.findByName(model.root, entry_point) as TransformNode);
					}
				}
			}
			else
			{
				console.error('Seat object ' + object.name + ' has no entry point reference property.');
			}

			if (ud.hasOwnProperty('seat_type'))
			{
				this.type = ud.seat_type;
			}
			else
			{
				console.error('Seat object ' + object.name + ' has no seat type property.');
			}

			if (ud.hasOwnProperty('connected_seats'))
			{
				this.connectedSeatsString = ud.connected_seats;
			}
		}
	}

	public update(timeStep: number): void
	{
		if (this.door !== undefined)
		{
			this.door.update(timeStep);
		}
	}
}
