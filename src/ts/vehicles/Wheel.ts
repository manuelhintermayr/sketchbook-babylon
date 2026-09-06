import { TransformNode, Vector3 } from '@babylonjs/core';

import * as Utils from '../core/FunctionLibrary';

export class Wheel
{
	public wheelObject: TransformNode;
	public position: Vector3;
	public steering: boolean = false;
	public drive: string; // Drive type "fwd" or "rwd"
	public rayCastWheelInfoIndex: number; // Linked to a raycast vehicle WheelInfo structure

	constructor(wheelObject: TransformNode)
	{
		this.wheelObject = wheelObject;

		this.position = wheelObject.position.clone();

		const ud = Utils.userData(wheelObject);
		if (ud.hasOwnProperty('data'))
		{
			if (ud.hasOwnProperty('steering'))
			{
				this.steering = (ud.steering === 'true');
			}

			if (ud.hasOwnProperty('drive'))
			{
				this.drive = ud.drive;
			}
		}
	}
}
