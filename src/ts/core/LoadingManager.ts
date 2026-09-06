import { AbstractMesh, AnimationGroup, ImportMeshAsync, Scene, Skeleton, TransformNode } from '@babylonjs/core';
import { GLTFLoaderAnimationStartMode } from '@babylonjs/loaders/glTF';
import Swal from 'sweetalert2';

import { LoadingTrackerEntry } from './LoadingTrackerEntry';
import { UIManager } from './UIManager';
import { Scenario } from '../world/scenarios/Scenario';
import { World } from '../world/World';

// What a loaded .glb (or a code-built sandbox) hands to the engine. The
// shape mirrors three's GLTF result closely enough that the consumers
// (Character, Vehicle, loadScene) read root + animations the same way:
// `root` is the __root__ node the glTF loader creates, `animationGroups`
// replaces gltf.animations.
export interface LoadedModel
{
	root: TransformNode;
	meshes: AbstractMesh[];
	animationGroups: AnimationGroup[];
	skeletons: Skeleton[];
	scene: Scene;
}

export async function loadModel(scene: Scene, path: string, onProgress?: (loaded: number, total: number, lengthComputable: boolean) => void): Promise<LoadedModel>
{
	const result = await ImportMeshAsync(path, scene, {
		onProgress: (event) => onProgress?.(event.loaded, event.total, event.lengthComputable),
		pluginOptions: {
			gltf: {
				animationStartMode: GLTFLoaderAnimationStartMode.NONE,
				compileMaterials: false,
				// three's GLTFLoader gave every node its own Mesh. Babylon
				// would turn nodes sharing a mesh into InstancedMeshes,
				// which the physics-marker dispatch can't hide or collide
				// (world.glb reuses one cube for dozens of collision boxes).
				createInstances: false,
			},
		},
	});

	let root: TransformNode;
	const first = result.meshes[0];
	if (first !== undefined && first.name === '__root__' && first.parent === null)
	{
		root = first;
	}
	else
	{
		root = new TransformNode('modelRoot', scene);
		for (const mesh of result.meshes) if (mesh.parent === null) mesh.parent = root;
		for (const node of result.transformNodes) if (node.parent === null) node.parent = root;
	}

	return {
		root,
		meshes: result.meshes,
		animationGroups: result.animationGroups,
		skeletons: result.skeletons,
		scene,
	};
}

export class LoadingManager
{
	public firstLoad: boolean = true;
	public onFinishedCallback: () => void;

	private world: World;
	private loadingTracker: LoadingTrackerEntry[] = [];

	constructor(world: World)
	{
		this.world = world;

		this.world.setTimeScale(0);
		UIManager.setUserInterfaceVisible(false);
		UIManager.setLoadingScreenVisible(true);
		UIManager.setLoadingProgress(0);
	}

	public loadGLTF(path: string, onLoadingFinished: (model: LoadedModel) => void): void
	{
		let trackerEntry = this.addLoadingEntry(path);

		loadModel(this.world.scene, path, (loaded, total, lengthComputable) =>
		{
			if (lengthComputable)
			{
				trackerEntry.progress = loaded / total;
				UIManager.setLoadingProgress(this.getLoadingPercentage());
			}
		}).then((model) =>
		{
			onLoadingFinished(model);
			this.doneLoading(trackerEntry);
		}).catch((error) =>
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
			// Wait until every material permutation and texture of the
			// freshly-loaded scene is ready on the GPU so the first time the
			// player turns toward a distant vehicle, NPC, or piece of
			// terrain the frame doesn't stall while WebGL builds shaders.
			await this.world.scene.whenReadyAsync();

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
