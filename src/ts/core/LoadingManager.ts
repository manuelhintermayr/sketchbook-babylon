import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { LoadingTrackerEntry } from './LoadingTrackerEntry';
import { UIManager } from './UIManager';
import { Scenario } from '../world/scenarios/Scenario';
import Swal from 'sweetalert2';
import { World } from '../world/World';

export class LoadingManager
{
	public firstLoad: boolean = true;
	public onFinishedCallback: () => void;
	
	private world: World;
	private gltfLoader: GLTFLoader;
	private loadingTracker: LoadingTrackerEntry[] = [];

	constructor(world: World)
	{
		this.world = world;
		this.gltfLoader = new GLTFLoader();

		this.world.setTimeScale(0);
		UIManager.setUserInterfaceVisible(false);
		UIManager.setLoadingScreenVisible(true);
		UIManager.setLoadingProgress(0);
	}

	public loadGLTF(path: string, onLoadingFinished: (gltf: any) => void): void
	{
		let trackerEntry = this.addLoadingEntry(path);

		this.gltfLoader.load(path,
			(gltf)  =>
			{
				onLoadingFinished(gltf);
				this.doneLoading(trackerEntry);
			},
			(xhr) =>
			{
				if ( xhr.lengthComputable )
				{
					trackerEntry.progress = xhr.loaded / xhr.total;
					UIManager.setLoadingProgress(this.getLoadingPercentage());
				}
			},
			(error)  =>
			{
				console.error(error);
			});
	}

	public addLoadingEntry(path: string): LoadingTrackerEntry
	{
		let entry = new LoadingTrackerEntry(path);
		this.loadingTracker.push(entry);

		return entry;
	}

	public async doneLoading(trackerEntry: LoadingTrackerEntry): Promise<void>
	{
		trackerEntry.finished = true;
		trackerEntry.progress = 1;
		UIManager.setLoadingProgress(this.getLoadingPercentage());

		if (this.isLoadingDone())
		{
			// Walk the freshly-loaded scene and pre-compile every material
			// permutation on the GPU so the first time the player turns
			// toward a distant vehicle, NPC, or piece of terrain the frame
			// doesn't stall while WebGL builds shaders. compileAsync yields
			// to the event loop between programs so the loading screen
			// stays responsive while it runs.
			await this.world.renderer.compileAsync(
				this.world.graphicsWorld,
				this.world.camera,
			);

			if (this.onFinishedCallback !== undefined)
			{
				this.onFinishedCallback();
			}
			else
			{
				UIManager.setUserInterfaceVisible(true);
			}

			UIManager.setLoadingScreenVisible(false);
		}
	}

	public createWelcomeScreenCallback(scenario: Scenario): void
	{
		if (this.onFinishedCallback === undefined)
		{
			this.onFinishedCallback = () =>
			{
				this.world.update(1, 1);
	
				Swal.fire({
					title: scenario.descriptionTitle,
					html: scenario.descriptionContent,
					confirmButtonText: 'Play',
					buttonsStyling: false
				}).then((result) => {
					if (result.isConfirmed) {
						this.world.setTimeScale(1);
						UIManager.setUserInterfaceVisible(true);
						this.world.pauseMenu?.enable();
					}
				})
			};
		}
	}

	public getLoadingPercentage(): number
	{
		let total = 0;
		let finished = 0;

		for (const item of this.loadingTracker)
		{
			total++;
			finished += item.progress;
		}

		if (total === 0) return 0;
		return (finished / total) * 100;
	}

	private isLoadingDone(): boolean
	{
		for (const entry of this.loadingTracker) {
			if (!entry.finished) return false;
		}
		return true;
	}
}