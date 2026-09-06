import { TransformNode, Vector3 } from '@babylonjs/core';

import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { World } from '../World';
import { Character } from '../../characters/Character';
import { LoadingManager } from '../../core/LoadingManager';
import * as Utils from '../../core/FunctionLibrary';
import { attachNameLabel } from '../ui/NameLabel';
import { t } from '../../i18n';

export class CharacterSpawnPoint implements ISpawnPoint
{
	private object: TransformNode;

	constructor(object: TransformNode)
	{
		this.object = object;
	}

	public spawn(loadingManager: LoadingManager, world: World): void
	{
		loadingManager.loadGLTF('build/assets/boxman.glb', (model) =>
		{
			let player = new Character(model);

			let worldPos = new Vector3();
			Utils.getWorldPosition(this.object, worldPos);
			player.setPosition(worldPos.x, worldPos.y, worldPos.z);

			let forward = Utils.getForward(this.object);
			player.setOrientation(forward, true);

			player.isPlayer = true;
			world.add(player);
			player.takeControl();
			attachNameLabel(player, t('label.player'), true, { feature: 'Labels' });
		});
	}
}
