import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { VehicleSpawnPoint } from '../spawn/VehicleSpawnPoint';
import { CharacterSpawnPoint } from '../spawn/CharacterSpawnPoint';
import { NPCSpawnPoint } from '../spawn/NPCSpawnPoint';
import { ShapeSpawnPoint } from '../spawn/ShapeSpawnPoint';
import { World } from '../World';
import { LoadingManager } from '../../core/LoadingManager';
import { RaceContent } from '../RaceContent';
import { t } from '../../i18n';
import * as THREE from 'three';

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

	public rootNode: THREE.Object3D;
	public spawnPoints: ISpawnPoint[] = [];
	private invisible: boolean = false;
	private initialCameraAngle: number;

	private raceContent: RaceContent | undefined;

	constructor(root: THREE.Object3D, world: World)
	{
		this.rootNode = root;
		this.world = world;
		this.id = root.name;

		// Scenario
		if (root.userData.hasOwnProperty('name'))
		{
			this.name = root.userData.name;
		}
		if (root.userData.hasOwnProperty('default') && root.userData.default === 'true')
		{
			this.default = true;
		}
		if (root.userData.hasOwnProperty('spawn_always') && root.userData.spawn_always === 'true')
		{
			this.spawnAlways = true;
		}
		if (root.userData.hasOwnProperty('invisible') && root.userData.invisible === 'true')
		{
			this.invisible = true;
		}
		if (root.userData.hasOwnProperty('desc_title'))
		{
			this.descriptionTitle = root.userData.desc_title;
		}
		if (root.userData.hasOwnProperty('desc_content'))
		{
			this.descriptionContent = root.userData.desc_content;
		}
		if (root.userData.hasOwnProperty('camera_angle'))
		{
			this.initialCameraAngle = root.userData.camera_angle;
		}

		if (!this.invisible) this.createLaunchLink();

		// Find all scenario spawns and entities
		root.traverse((child) => {
			if (child.hasOwnProperty('userData') && child.userData.hasOwnProperty('data'))
			{
				if (child.userData.data === 'spawn')
				{
					if (child.userData.type === 'car' || child.userData.type === 'airplane' || child.userData.type === 'heli' || child.userData.type === 'boat' || child.userData.type === 'rocketship')
					{
						let sp = new VehicleSpawnPoint(child);

						if (child.userData.hasOwnProperty('type'))
						{
							sp.type = child.userData.type;
						}

						if (child.userData.hasOwnProperty('driver'))
						{
							sp.driver = child.userData.driver;

							if (child.userData.driver === 'ai' && child.userData.hasOwnProperty('first_node'))
							{
								sp.firstAINode = child.userData.first_node;
							}
						}

						this.spawnPoints.push(sp);
					}
					else if (child.userData.type === 'player')
					{
						let sp = new CharacterSpawnPoint(child);
						this.spawnPoints.push(sp);
					}
					else if (child.userData.type === 'npc' || child.userData.type === 'character_ai' || child.userData.type === 'character_follow')
					{
						// socketControl uses character_ai (path-following) and
						// character_follow (follows the player); we collapse
						// both into our NPCSpawnPoint, which already reads
						// userData.first_node when present.
						this.spawnPoints.push(new NPCSpawnPoint(child));
					}
					else if (child.userData.type === 'shape')
					{
						const subtype = child.userData.subtype === 'sphere' ? 'sphere' : 'box';
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
