import * as THREE from 'three';
import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { World } from '../World';
import { LoadingManager } from '../../core/LoadingManager';
import { ShapeEntity } from './ShapeEntity';

// Map-driven dynamic-shape spawner ported from tkkaushik369/socketControl.
// A scenario marker tagged userData.data='spawn', userData.type='shape'
// and userData.subtype='box' | 'sphere' becomes a CANNON-driven primitive
// the player can knock around. Mass is read from userData.mass and
// the marker's scale doubles as the visual + collider extents.
export class ShapeSpawnPoint implements ISpawnPoint
{
	private object: THREE.Object3D;
	private subtype: 'box' | 'sphere';

	constructor(object: THREE.Object3D, subtype: 'box' | 'sphere')
	{
		this.object = object;
		this.subtype = subtype;
	}

	public spawn(_loadingManager: LoadingManager, world: World): void
	{
		// Clone so re-launching a scenario doesn't keep stacking the
		// same Object3D into both the gltf scene and our entity list.
		const obj = this.object.clone(true);
		obj.visible = true;
		const entity = new ShapeEntity(obj, this.subtype);
		world.add(entity);
	}
}
