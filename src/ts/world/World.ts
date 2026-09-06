import * as THREE from 'three';
import * as CANNON from 'cannon-es';
import Swal from 'sweetalert2';

import { CameraOperator } from '../core/CameraOperator';
import { CSS2DRenderer } from 'three/examples/jsm/renderers/CSS2DRenderer.js';
import WebGL from 'three/examples/jsm/capabilities/WebGL.js';

import Stats from 'stats.js';
import CannonDebugger from 'cannon-es-debugger';
import * as _ from 'lodash';

import { InputManager } from '../core/InputManager';
import { LoadingManager } from '../core/LoadingManager';
import { InfoStack } from '../core/InfoStack';
import { UIManager } from '../core/UIManager';
import { CameraShake } from '../core/CameraShake';
import { IWorldEntity } from '../interfaces/IWorldEntity';
import { IUpdatable } from '../interfaces/IUpdatable';
import { Character } from '../characters/Character';
import { Path } from './scenarios/Path';
import { Vehicle } from '../vehicles/Vehicle';
import { Helicopter } from '../vehicles/Helicopter';
import { Airplane } from '../vehicles/Airplane';
import { Car } from '../vehicles/Car';
import { Boat } from '../vehicles/Boat';
import { RocketShip } from '../vehicles/RocketShip';
import { Scenario } from './scenarios/Scenario';
import { Sky } from './Sky';
import { Ocean } from './Ocean';
import { PauseMenu } from './ui/PauseMenu';
import { SettingsModal } from './ui/SettingsModal';
import { t } from '../i18n';
import { IrisTransition } from './ui/IrisTransition';
import { OutlineEffect } from './OutlineEffect';
import { AmbientSound } from './audio/AmbientSound';
import { BackgroundMusic } from './audio/BackgroundMusic';
import { SfxBus } from './audio/SfxBus';
import { bootstrapHTML } from './setup/HTMLBootstrap';
import { setupRendererPipeline, tickRenderPipeline, tickCannonDebug } from './setup/RendererPipeline';
import { createParamsGUI } from './setup/ParamsGUI';
import { wireV02GameMode } from './setup/v02GameMode';
import { loadScene } from './loading/SceneLoader';
import { WorldLabels } from './ui/WorldLabels';
import { TouchControls } from '../core/TouchControls';

export class World
{
	public renderer: THREE.WebGLRenderer;
	public labelRenderer: CSS2DRenderer;
	public camera: THREE.PerspectiveCamera;
	public composer: any;
	public stats: Stats;
	public graphicsWorld: THREE.Scene;
	public sky: Sky;
	public physicsWorld: CANNON.World;
	public parallelPairs: any[];
	public physicsFrameRate: number;
	public physicsFrameTime: number;
	public physicsMaxPrediction: number;
	public renderDelta: number;
	public logicDelta: number;
	public requestDelta: number;
	private stopwatchLastTime: number = performance.now();
	public sinceLastFrame: number;
	public justRendered: boolean;
	public params: any;
	public inputManager: InputManager;
	public cameraOperator: CameraOperator;
	public timeScaleTarget: number = 1;
	public console: InfoStack;
	public cannonDebugRenderer: ReturnType<typeof CannonDebugger> | undefined;
	public cannonDebugMeshes: THREE.Mesh[] = [];
	public scenarios: Scenario[] = [];
	public characters: Character[] = [];
	public vehicles: Vehicle[] = [];
	public cars: Car[] = [];
	public helicopters: Helicopter[] = [];
	public airplanes: Airplane[] = [];
	public ocean: Ocean | null = null;
	public paths: Path[] = [];
	public lapCounter: HTMLElement;
	public onMoon: boolean = false;
	public scenarioGUIFolder: any;
	// Nested folder inside scenarioGUIFolder where the scenario launch
	// buttons land. Keeping them in their own sub-folder gives the
	// "Scenarios" group its own header (visually paired with "Map" -
	// the dropdown) instead of all nine buttons floating below the map
	// selector with no label.
	public scenarioListFolder: any;
	public updatables: IUpdatable[] = [];

	public pauseMenu: PauseMenu;
	public audioListener: THREE.AudioListener | null = null;
	public gui: any;
	public cameraShake: CameraShake;
	public outlineEffect: OutlineEffect;
	public ambientSound: AmbientSound;
	public backgroundMusic: BackgroundMusic;
	public sfxBus: SfxBus;
	public worldLabels: WorldLabels;

	private lastScenarioID: string;

	constructor(worldScenePath?: any)
	{
		const scope = this;

		// WebGL 2 not supported
		if (!WebGL.isWebGL2Available())
		{
			Swal.fire({
				icon: 'warning',
				title: t('world.webgl.title'),
				text: t('world.webgl.body'),
				footer: '<a href="https://get.webgl.org/" target="_blank">' + t('world.webgl.footer') + '</a>',
				showConfirmButton: false,
				buttonsStyling: false
			});
		}

		setupRendererPipeline(this);

		bootstrapHTML(this);

		// Lap counter overlay (Inthenew/Sketchbook). Initially hidden;
		// Scenario.launch() flips visibility when a tracked race starts.
		this.lapCounter = document.createElement('h1');
		this.lapCounter.id = 'laps';
		this.lapCounter.innerHTML = t('world.lap', { n: '0' });
		this.lapCounter.style.position = 'absolute';
		this.lapCounter.style.top = '0';
		this.lapCounter.style.left = '50px';
		this.lapCounter.style.visibility = 'hidden';
		document.body.appendChild(this.lapCounter);

		// Z toggles the controls overlay (ported from Inthenew). Listened
		// at document level so it works whichever input receiver is
		// active - character, vehicle, or free camera.
		document.addEventListener('keydown', (e) =>
		{
			if (e.code === 'KeyZ' && !e.repeat) this.toggleControlsOverlay();
		});

		// Physics
		this.physicsWorld = new CANNON.World();
		this.physicsWorld.gravity.set(0, -9.81, 0);
		this.physicsWorld.broadphase = new CANNON.SAPBroadphase(this.physicsWorld);
		//this.physicsWorld.solver.iterations = 10; NOW DEFAULT for GSSolver
		this.physicsWorld.allowSleep = true;

		this.parallelPairs = [];
		this.physicsFrameRate = 60;
		this.physicsFrameTime = 1 / this.physicsFrameRate;
		this.physicsMaxPrediction = this.physicsFrameRate;

		// RenderLoop
		this.stopwatchLastTime = performance.now();
		this.renderDelta = 0;
		this.logicDelta = 0;
		this.sinceLastFrame = 0;
		this.justRendered = false;

		// Stats (FPS, Frame time, Memory). Upstream stats.js shows one panel
		// at a time and toggles on click; Sketchbook historically rendered
		// FPS + MS + MB side-by-side inside the UI container, hidden by
		// default until the Debug_FPS toggle is flipped. Replicate that.
		this.stats = new Stats();
		this.stats.dom.id = 'statsBox';
		this.stats.dom.style.display = 'none';
		// stats.js sets inline `position: fixed; top: 0; left: 0` on
		// the dom element. Inside the debug-stack flex column we want
		// it in the normal flow - strip those so CSS class selectors
		// take over.
		this.stats.dom.style.position = 'static';
		this.stats.dom.style.top = '';
		this.stats.dom.style.left = '';
		document.getElementById('debug-stack').appendChild(this.stats.dom);
		for (const panel of Array.from(this.stats.dom.children) as HTMLElement[])
		{
			panel.style.display = 'inline-block';
		}
		// Create right panel GUI
		createParamsGUI(this);

		// Pause menu (Esc) - disabled until the loader's
		// onFinishedCallback fires so it can't open over the welcome
		// dialog. The Settings button opens the SettingsModal, which
		// is built below and writes back through lil-gui controllers
		// so all the existing onChange wiring stays in one place.
		this.pauseMenu = new PauseMenu(this);
		const settingsModal = new SettingsModal(this);
		this.pauseMenu.setSettingsHandler(() => settingsModal.open());

		// Initialization
		this.inputManager = new InputManager(this, this.renderer.domElement);
		this.cameraOperator = new CameraOperator(this, this.camera, this.params.Mouse_Sensitivity);
		this.sky = new Sky(this);

		// swift502 v0.2 GameMode keys (B ball spawn, T slow-mo, V view
		// distance cycle). Available on every map, not just sw-v02 -
		// they're engine-wide free-roam features.
		wireV02GameMode(this);

		// Camera shake runs in the PostCamera slot (after CameraOperator)
		// and adds transient position offsets when vehicles slam down or
		// collide. Singleton API: anywhere can call CameraShake.trigger()
		// without a world reference.
		this.cameraShake = new CameraShake(this);
		this.registerUpdatable(this.cameraShake);

		// Outline effect - depth-based Sobel edges. Owned by World so the
		// render pipeline can call its renderPass after the composer pass.
		// No-op when params.Outlines is false.
		this.outlineEffect = new OutlineEffect(this);

		// Ambient soundscape - wind / birds / water. Lazily creates an
		// AudioContext when first enabled (browser autoplay policy is
		// satisfied by the title-screen gesture).
		this.ambientSound = new AmbientSound(this);
		this.registerUpdatable(this.ambientSound);

		// Bundled music tracks looped in shuffle, gated by
		// params.Background_Music + scaled by Master_Volume * Music_Volume.
		this.backgroundMusic = new BackgroundMusic(this);
		this.registerUpdatable(this.backgroundMusic);

		// Procedural SFX bus - footsteps / jumps / race pings / dialog
		// whoosh / vehicle crash / water splash / iris transition.
		// Stateless, no per-frame update; consumers call sfxBus.playX()
		// directly from the relevant event hook.
		this.sfxBus = new SfxBus(this);

		// World labels - registry + distance culling for CSS2D tags.
		// Constructed early so attachNameLabel calls from later spawn
		// code go through it.
		this.worldLabels = new WorldLabels(this);
		this.registerUpdatable(this.worldLabels);

		// Touch controls were installed at module load (sketchbook.ts) so
		// the DOM listeners are already wired up. Now that the World is
		// alive, hand it over so TouchControls can poll character/vehicle
		// proximity and toggle context-aware on-screen buttons.
		TouchControls.attachWorld(this);

		// Day / night cycle (ported from Inthenew/Sketchbook).
		// Mirror sky.phi back into params.Sun_Elevation (folded over 180 so
		// it stays in the slider's 0..180 range) so the listen()-bound
		// Sun_Elevation slider visibly tracks the sun while the cycle runs.
		setInterval(() =>
		{
			if (scope.params.Sun_Cycle)
			{
				let phi = scope.sky.phi + 0.01 * scope.params.Time_Scale;
				if (!scope.params.Has_Night_Time && phi >= 180) phi = 0;
				else if (scope.params.Has_Night_Time && phi >= 360) phi = 0;
				scope.sky.phi = phi;
				scope.params.Sun_Elevation = phi <= 180 ? phi : 360 - phi;
			}
		}, 10);

		// Load scene if path is supplied. The argument is either a string
		// path to a .glb (loaded async via GLTFLoader) or a BaseScene
		// instance from src/ts/world/sandboxes (built synchronously in
		// its constructor). Both paths funnel into loadScene().
		if (worldScenePath !== undefined)
		{
			let loadingManager = new LoadingManager(this);
			loadingManager.onFinishedCallback = () =>
			{
				this.update(1, 1);
				this.setTimeScale(1);

				Swal.fire({
					title: t('world.welcome.title'),
					// html (instead of text) so the <br><br> in the i18n
					// string actually breaks paragraphs - SweetAlert2's
					// plain `text:` collapses whitespace.
					html: t('world.welcome.body'),
					footer: '<a href="https://github.com/manuelhintermayr/sketchbook-upgraded" target="_blank">GitHub page</a>',
					confirmButtonText: t('world.welcome.button'),
					buttonsStyling: false
				}).then((result) => {
					if (result.isConfirmed) {
						UIManager.setUserInterfaceVisible(true);
						this.pauseMenu.enable();
					}
				})
			};
			if (typeof worldScenePath === 'string')
			{
				loadingManager.loadGLTF(worldScenePath, (gltf) =>
				{
					loadScene(this, loadingManager, gltf);
				}
				);
			}
			else if (worldScenePath && worldScenePath.scene instanceof THREE.Object3D)
			{
				// BaseScene instance - build a synthetic GLTF-shaped object
				// and feed it through the same loadScene path. A throwaway
				// tracker entry keeps the loading-screen accounting honest
				// in case no other async loads (vehicle GLBs) follow.
				const entry = loadingManager.addLoadingEntry('sandbox-scene');
				const fakeGltf = { scene: worldScenePath.scene, animations: worldScenePath.sceneAnimations || [] };
				loadScene(this, loadingManager, fakeGltf);
				loadingManager.doneLoading(entry);
			}
		}
		else
		{
			UIManager.setUserInterfaceVisible(true);
			UIManager.setLoadingScreenVisible(false);
			Swal.fire({
				icon: 'success',
				title: t('world.empty.title'),
				text: t('world.empty.body'),
				buttonsStyling: false
			});
		}

		this.render(this);
	}

	// Update
	// Handles all logic updates.
	public update(timeStep: number, unscaledTimeStep: number): void
	{
		this.updatePhysics(timeStep);

		// Pipe Free_Cam_Speed (1..100, default 25 = upstream feel) into
		// CameraOperator's movementSpeed scalar. The base of 0.06 was the
		// original swift502 default at slider value 25; scale linearly.
		this.cameraOperator.movementSpeed = (this.params.Free_Cam_Speed / 25) * 0.06;

		// Update registred objects
		this.updatables.forEach((entity) => {
			entity.update(timeStep, unscaledTimeStep);
		});

		// Lerp time scale
		this.params.Time_Scale = THREE.MathUtils.lerp(this.params.Time_Scale, this.timeScaleTarget, 0.2);

		// Physics debug
		if (this.params.Debug_Physics) tickCannonDebug(this);
	}

	public updatePhysics(timeStep: number): void
	{
		// ADD PRE-STEPS for all characters and vehicles
		this.characters.forEach((char) => {
			if (typeof char.physicsPreStep == 'function')
			{
				char.physicsPreStep(char.characterCapsule.body, char)
			}
		})

		this.vehicles.forEach((vehicle) => {
			if (vehicle instanceof Car)
			{
				vehicle.physicsPreStep(vehicle.collision, vehicle)
			} else if (vehicle instanceof Helicopter)
			{
				vehicle.physicsPreStep(vehicle.collision, vehicle)
			} else if (vehicle instanceof Airplane)
			{
				vehicle.physicsPreStep(vehicle.collision, vehicle)
			} else if (vehicle instanceof Boat)
			{
				vehicle.physicsPreStep(vehicle.collision, vehicle)
			} else if (vehicle instanceof RocketShip)
			{
				vehicle.physicsPreStep(vehicle.collision, vehicle)
			}
		})

		// Switch to lunar gravity while the player is on the moon. Moon
		// surface gravity is ~1.62 m/s^2, ~1/6 of Earth's. Inthenew left
		// this commented out as WIP; we activate it now that the rocket
		// flight reliably sets/clears world.onMoon.
		const baseG = this.onMoon ? -1.62 : -9.81;
		const targetGravityY = baseG * (this.params?.Gravity_Scale ?? 1);
		if (this.physicsWorld.gravity.y !== targetGravityY)
		{
			this.physicsWorld.gravity.set(0, targetGravityY, 0);
		}

		// Step the physics world
		this.physicsWorld.step(this.physicsFrameTime, timeStep);

		this.characters.forEach((char) => {
			if (typeof char.physicsPostStep == 'function')
			{
				char.physicsPostStep(char.characterCapsule.body, char)
			}

			if (this.isOutOfBounds(char.characterCapsule.body.position))
			{
				this.outOfBoundsRespawn(char.characterCapsule.body);
			}
		});

		this.vehicles.forEach((vehicle) => {

			if (this.isOutOfBounds(vehicle.rayCastVehicle.chassisBody.position))
			{
				let worldPos = new THREE.Vector3();
				vehicle.spawnPoint.getWorldPosition(worldPos);
				//worldPos.setComponent(1, worldPos.getComponent(1) + 1);
				let worldPos_CANNON = new CANNON.Vec3(worldPos.x, worldPos.y+1, worldPos.z)
				//worldPos.y += 1;
				this.outOfBoundsRespawn(vehicle.rayCastVehicle.chassisBody, worldPos_CANNON);
			}
		});
	}

	public isOutOfBounds(position: CANNON.Vec3): boolean
	{
		let inside = position.x > -211.882 && position.x < 211.882 &&
					position.z > -169.098 && position.z < 153.232 &&
					position.y > 0.107;
		let belowSeaLevel = position.y < 14.989;

		return !inside && belowSeaLevel;
	}

	public outOfBoundsRespawn(body: CANNON.Body, position?: CANNON.Vec3): void
	{
		let newPos = position || new CANNON.Vec3(0, 16, 0);
		let newQuat = new CANNON.Quaternion(0, 0, 0, 1);

		body.position.copy(newPos);
		body.interpolatedPosition.copy(newPos);
		body.quaternion.copy(newQuat);
		body.interpolatedQuaternion.copy(newQuat);
		body.velocity.setZero();
		body.angularVelocity.setZero();
	}

	/**
	 * Rendering loop.
	 * Implements fps limiter and frame-skipping
	 * Calls world's "update" function before rendering.
	 * @param {World} world 
	 */
	public render(world: World): void
	{
		this.requestDelta = this.stopwatchDelta();

		requestAnimationFrame(() =>
		{
			world.render(world);
		});

		// Getting timeStep
		let unscaledTimeStep = (this.requestDelta + this.renderDelta + this.logicDelta) ;
		let timeStep = unscaledTimeStep * this.params.Time_Scale;
		timeStep = Math.min(timeStep, 1 / 30);    // min 30 fps

		// Logic
		world.update(timeStep, unscaledTimeStep);

		// Measuring logic time
		this.logicDelta = this.stopwatchDelta();

		// Frame limiting
		let interval = 1 / 60;
		this.sinceLastFrame += this.requestDelta + this.renderDelta + this.logicDelta;
		this.sinceLastFrame %= interval;

		// Stats end
		this.stats.end();
		this.stats.begin();

		// Actual GPU dispatch (composer/renderer + outline + label) lives
		// in setup/RendererPipeline so the pipeline build + the per-frame
		// draw calls sit next to each other.
		tickRenderPipeline(this);

		// Measuring render time
		this.renderDelta = this.stopwatchDelta();
	}

	// Returns seconds elapsed since the previous call. Replaces the
	// now-deprecated THREE.Clock which was used the same way (three calls
	// per frame to measure request/logic/render phases).
	private stopwatchDelta(): number
	{
		const now = performance.now();
		const delta = (now - this.stopwatchLastTime) / 1000;
		this.stopwatchLastTime = now;
		return delta;
	}

	public setTimeScale(value: number): void
	{
		this.params.Time_Scale = value;
		this.timeScaleTarget = value;
	}

	public setMasterVolume(value: number): void
	{
		const v = Math.max(0, Math.min(100, value));
		this.params.Master_Volume = v;
		this.applyAudioListenerVolume();
	}

	// Applies the effective listener volume - 0 when Master_Audio is
	// off (mute), otherwise Master_Volume / 100. Called from both the
	// Master_Volume setter and the Master_Audio toggle so 3D audio
	// (PositionalAudio: BirdSound, CharacterSfx, Speaker) respects
	// the master gate the same way the continuous synths do via
	// getMasterVolume.
	public applyAudioListenerVolume(): void
	{
		if (!this.audioListener) return;
		const muted = this.params?.Master_Audio === false;
		this.audioListener.setMasterVolume(muted ? 0 : this.params.Master_Volume / 100);
	}

	public add(worldEntity: IWorldEntity): void
	{
		worldEntity.addToWorld(this);
		this.registerUpdatable(worldEntity);

		// Apply the current Vehicles-folder tuning to freshly spawned cars
		// so settings restored from localStorage (or changed mid-session
		// before this car existed) take effect immediately.
		if (worldEntity instanceof Car && this.params)
		{
			worldEntity.updateWheelProps('frictionSlip', this.params.Friction_Slip);
			worldEntity.updateWheelProps('suspensionStiffness', this.params.Suspension_Stiffness);
			worldEntity.updateWheelProps('maxSuspensionTravel', this.params.Max_Suspension);
			worldEntity.updateWheelProps('dampingCompression', this.params.Damping_Compression);
			worldEntity.updateWheelProps('dampingRelaxation', this.params.Damping_Relaxation);
			worldEntity.updateCarSpeed(this.params.Engine_Force);
		}
	}

	public registerUpdatable(registree: IUpdatable): void
	{
		this.updatables.push(registree);
		this.updatables.sort((a, b) => (a.updateOrder > b.updateOrder) ? 1 : -1);
	}

	public remove(worldEntity: IWorldEntity): void
	{
		worldEntity.removeFromWorld(this);
		this.unregisterUpdatable(worldEntity);
	}

	public unregisterUpdatable(registree: IUpdatable): void
	{
		_.pull(this.updatables, registree);
	}

	public launchScenario(scenarioID: string, loadingManager?: LoadingManager): void
	{
		this.lastScenarioID = scenarioID;

		// Reset cross-scenario world state so a Shift+R from the moon or a
		// scenario switch with the planet menu open lands the player
		// cleanly back on Earth.
		this.onMoon = false;
		document.getElementById('planet-menu')?.classList.add('planet-menu-hidden');

		this.clearEntities();

		// Launch default scenario
		if (!loadingManager) loadingManager = new LoadingManager(this);
		for (const scenario of this.scenarios) {
			if (scenario.id === scenarioID || scenario.spawnAlways) {
				scenario.launch(loadingManager, this);
			}
		}
	}

	public restartScenario(): void
	{
		if (this.lastScenarioID !== undefined)
		{
			// Hide the chaotic teardown / respawn flash behind the iris,
			// then re-open it once the new scenario's spawn points have
			// run. clearEntities + scenario.launch are synchronous so the
			// open() comes immediately after launchScenario returns.
			this.sfxBus.playIrisWhoosh();
			const iris = IrisTransition.getInstance();
			iris.close().then(() =>
			{
				this.launchScenario(this.lastScenarioID);
				iris.open();
			});
		}
		else
		{
			console.warn('Can\'t restart scenario. Last scenarioID is undefined.');
		}
	}

	public clearEntities(): void
	{
		// Only scenario-bound entities go here - characters, vehicles
		// and the prompts that target them. Map-bound entities
		// (animals, birds, butterflies, grass, ocean) live for the
		// whole map session and survive scenario switches; they're
		// re-injected only when the GLB reloads (= page reload via
		// the map switcher). Stale prompts left over from removed
		// NPCs self-clean on the next update via orphan-detection in
		// ProximityPrompt.update(), so we don't need to track them
		// explicitly here.
		for (let i = 0; i < this.characters.length; i++) {
			this.remove(this.characters[i]);
			i--;
		}

		for (let i = 0; i < this.vehicles.length; i++) {
			this.remove(this.vehicles[i]);
			i--;
		}
	}

	public scrollTheTimeScale(scrollAmount: number): void
	{
		// Changing time scale with scroll wheel
		const timeScaleBottomLimit = 0.003;
		const timeScaleChangeSpeed = 1.3;
	
		if (scrollAmount > 0)
		{
			this.timeScaleTarget /= timeScaleChangeSpeed;
			if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = 0;
		}
		else
		{
			this.timeScaleTarget *= timeScaleChangeSpeed;
			if (this.timeScaleTarget < timeScaleBottomLimit) this.timeScaleTarget = timeScaleBottomLimit;
			this.timeScaleTarget = Math.min(this.timeScaleTarget, 1);
		}
	}

	public toggleControlsOverlay(): void
	{
		const controls = document.getElementById('controls');
		if (!controls) return;
		controls.style.display = controls.style.display === 'none' ? '' : 'none';
	}

	public updateControls(controls: any): void
	{
		let html = '';
		html += '<h2 class="controls-title">' + t('controls.header') + '</h2>';

		controls.forEach((row) =>
		{
			html += '<div class="ctrl-row">';
			row.keys.forEach((key) => {
				if (key === '+' || key === 'and' || key === 'or' || key === '&') html += '&nbsp;' + key + '&nbsp;';
				else html += '<span class="ctrl-key">' + key + '</span>';
			});

			html += '<span class="ctrl-desc">' + row.desc + '</span></div>';
		});

		document.getElementById('controls').innerHTML = html;
	}

}