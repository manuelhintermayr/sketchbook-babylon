import { Mesh, TransformNode } from '@babylonjs/core';

import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { VehicleSpawnPoint } from '../spawn/VehicleSpawnPoint';
import { CharacterSpawnPoint } from '../spawn/CharacterSpawnPoint';
import { NPCSpawnPoint } from '../spawn/NPCSpawnPoint';
import { ShapeSpawnPoint } from '../spawn/ShapeSpawnPoint';
import { World } from '../World';
import { LoadingManager } from '../../core/LoadingManager';
import { RaceContent } from '../RaceContent';
import { t } from '../../i18n';
import * as Utils from '../../core/FunctionLibrary';

// Scenarios whose lap counter runs off the curve-based RaceContent
// system. Any scenario with a desc_title matching one of these and an
// AI driver pointing at a path's first_node gets a checkpoint plane
// per node; the player must cross them in order to count a lap.
const RACE_TITLES = new Set<string>([
	'Oval race',
	'Tunnel race',
	'Figure 8 race',
	'Boat Race',
]);

export class Scenario
{
	public id: string;
	public name: string;
	public spawnAlways: boolean = false;
	public default: boolean = false;
	public world: World;
	public descriptionTitle: string;
	public descriptionContent: string;

	public isRace: boolean = false;

	public rootNode: TransformNode;
	public spawnPoints: ISpawnPoint[] = [];
	private invisible: boolean = false;
	private initialCameraAngle: number;

	private raceContent: RaceContent | undefined;

	constructor(root: TransformNode, world: World)
	{
		this.rootNode = root;
		this.world = world;
		this.id = root.name;

		const ud = Utils.userData(root);

		// Scenario
		if (ud.hasOwnProperty('name'))
		{
			this.name = ud.name;
		}
		if (ud.hasOwnProperty('default') && ud.default === 'true')
		{
			this.default = true;
		}
		if (ud.hasOwnProperty('spawn_always') && ud.spawn_always === 'true')
		{
			this.spawnAlways = true;
		}
		if (ud.hasOwnProperty('invisible') && ud.invisible === 'true')
		{
			this.invisible = true;
		}
		if (ud.hasOwnProperty('desc_title'))
		{
			this.descriptionTitle = ud.desc_title;
		}
		if (ud.hasOwnProperty('desc_content'))
		{
			this.descriptionContent = ud.desc_content;
		}
		if (ud.hasOwnProperty('camera_angle'))
		{
			this.initialCameraAngle = ud.camera_angle;
		}

		if (!this.invisible) this.createLaunchLink();

		// Find all scenario spawns and entities
		Utils.traverse(root, (child) => {
			if (!(child instanceof TransformNode)) return;
			const cud = Utils.userData(child);
			if (cud.hasOwnProperty('data'))
			{
				if (cud.data === 'spawn')
				{
					if (cud.type === 'car' || cud.type === 'airplane' || cud.type === 'heli' || cud.type === 'boat' || cud.type === 'rocketship')
					{
						let sp = new VehicleSpawnPoint(child);

						if (cud.hasOwnProperty('type'))
						{
							sp.type = cud.type;
						}

						if (cud.hasOwnProperty('driver'))
						{
							sp.driver = cud.driver;

							if (cud.driver === 'ai' && cud.hasOwnProperty('first_node'))
							{
								sp.firstAINode = cud.first_node;
							}
						}

						this.spawnPoints.push(sp);
					}
					else if (cud.type === 'player')
					{
						let sp = new CharacterSpawnPoint(child);
						this.spawnPoints.push(sp);
					}
					else if (cud.type === 'npc' || cud.type === 'character_ai' || cud.type === 'character_follow')
					{
						// socketControl uses character_ai (path-following) and
						// character_follow (follows the player); we collapse
						// both into our NPCSpawnPoint, which already reads
						// userData.first_node when present.
						this.spawnPoints.push(new NPCSpawnPoint(child));
					}
					else if (cud.type === 'shape' && child instanceof Mesh)
					{
						const subtype = cud.subtype === 'sphere' ? 'sphere' : 'box';
						this.spawnPoints.push(new ShapeSpawnPoint(child, subtype));
					}
				}
			}
		});
	}

	public createLaunchLink(): void
	{
		this.world.params[this.name] = () =>
		{
			this.world.launchScenario(this.id);
		};
		// Lazy-create the 'Scenarios' sub-folder on the first launch
		// link so it sits below the map dropdown (which addMapSwitcher
		// adds first). All later Scenario.createLaunchLink calls reuse
		// this folder. Stays collapsed by default like every other
		// folder in the debug panel.
		if (this.world.scenarioListFolder === undefined)
		{
			this.world.scenarioListFolder = this.world.scenarioGUIFolder.addFolder('Scenarios');
		}
		this.world.scenarioListFolder.add(this.world.params, this.name);
	}

	public cancelRaceTimer(): void
	{
		if (this.raceContent !== undefined)
		{
			this.raceContent.dispose();
			this.raceContent = undefined;
		}
		this.isRace = false;
	}

	public launch(loadingManager: LoadingManager, world: World): void
	{
		this.spawnPoints.forEach((sp) => {
			sp.spawn(loadingManager, world);
		});

		// Cancel any race state left over from a previously launched
		// scenario before starting (or skipping) a new one.
		for (const s of world.scenarios) s.cancelRaceTimer();

		world.lapCounter.innerHTML = t('world.lap', { n: '0' });
		world.lapCounter.style.visibility = 'hidden';

		if (RACE_TITLES.has(this.descriptionTitle))
		{
			const rc = new RaceContent(this);
			if (rc.launch())
			{
				this.isRace = true;
				this.raceContent = rc;
				rc.onLap = (lap) => {
					world.lapCounter.innerHTML = t('world.lap', { n: String(lap) });
				};
				world.lapCounter.style.visibility = 'visible';
			}
		}

		if (!this.spawnAlways)
		{
			loadingManager.createWelcomeScreenCallback(this);

			world.cameraOperator.theta = this.initialCameraAngle;
			world.cameraOperator.phi = 15;
		}
	}
}
