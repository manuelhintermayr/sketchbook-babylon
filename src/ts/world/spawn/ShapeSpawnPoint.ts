import { Mesh } from '@babylonjs/core';

import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { World } from '../World';
import { LoadingManager } from '../../core/LoadingManager';
import { ShapeEntity } from './ShapeEntity';
import * as Utils from '../../core/FunctionLibrary';

// Map-driven dynamic-shape spawner ported from tkkaushik369/socketControl.
// A scenario marker tagged userData.data='spawn', userData.type='shape'
// and userData.subtype='box' | 'sphere' becomes a Havok-driven primitive
// the player can knock around. Mass is read from userData.mass and
// the marker's scale doubles as the visual + collider extents.
export class ShapeSpawnPoint implements ISpawnPoint
{
	private object: Mesh;
	private subtype: 'box' | 'sphere';

	constructor(object: Mesh, subtype: 'box' | 'sphere')
	{
		this.object = object;
		this.subtype = subtype;
	}

	public spawn(_loadingManager: LoadingManager, world: World): void
	{
		// Clone so re-launching a scenario doesn't keep stacking the
		// same mesh into both the map and our entity list. The clone
		// shares geometry + material and carries the marker's userData.
		const obj = this.object.clone(this.object.name + '_shape', null, false) as Mesh;
		Utils.setUserData(obj, Object.assign({}, Utils.userData(this.object)));
		obj.setEnabled(true);
		obj.isVisible = true;
		const entity = new ShapeEntity(obj, this.subtype);
		world.add(entity);
	}
}
