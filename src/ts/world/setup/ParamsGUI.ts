import GUI from 'lil-gui';
import CannonDebugger from 'cannon-es-debugger';

import { World } from '../World';
import { UIManager } from '../../core/UIManager';
import { Car } from '../../vehicles/Car';

// Builds the lil-gui debug panel and the params object that backs it.
// All onChange wiring lives here so that callers (SettingsModal, the
// pause-menu Settings card) can route writes through the matching
// controller's setValue() and inherit the side effects for free -
// CSM enable/disable, mouse sensitivity push to CameraOperator, etc.
//
// Persistence: the entire gui state snapshot serializes into
// localStorage('sketchbook-settings') on every onFinishChange and
// reloads on construction. lil-gui's gui.load() triggers each
// controller's onChange, so the side effects reapply automatically
// without a manual replay loop.
//
// Side effects assigned to world by the time this returns:
//   - world.params         the source-of-truth value bag
//   - world.gui            the lil-gui root
//   - world.scenarioGUIFolder  the open Scenarios folder Scenario.launch
//                              and the map switcher add into
export function createParamsGUI(world: World): void
{
	world.params = {
		Mouse_Sensitivity: 0.3,
		Time_Scale: 1,
		Shadows: true,
		FXAA: true,
		Debug_Physics: false,
		Debug_FPS: true,
		Sun_Elevation: 50,
		Sun_Rotation: 145,
		Sun_Cycle: false,
		Has_Night_Time: false,
		Gravity_Scale: 1,
		Free_Cam_Speed: 25,
		// Per-car raycast-vehicle tunables (defaults from Inthenew).
		Friction_Slip: 0.8,
		Suspension_Stiffness: 20,
		Max_Suspension: 1,
		Damping_Compression: 2,
		Damping_Relaxation: 2,
		Engine_Force: 10,
		// Audio mix. Master applies to all positional + procedural
		// sources via the shared THREE.AudioListener attached to the
		// camera, AND scales BackgroundMusic on top of Music_Volume.
		// SFX_Volume is still reserved (no per-bus SFX routing yet).
		Master_Volume: 80,
		Music_Volume: 60,
		SFX_Volume: 75,
		Camera_Shake: true,
		// Master audio gate. When off, every audio system silences
		// regardless of the sub-toggles below (it's the same flag the
		// title-screen mute button writes via sketchbook.soundMuted).
		// Sub-toggles are disabled in the UI while this is off.
		Master_Audio: localStorage.getItem('sketchbook.soundMuted') !== 'true',
		// Sub-toggles for the two audio buckets. Only meaningful while
		// Master_Audio is on.
		Sound_Effects: true,
		Background_Music: true,
		// Outlines OFF by default - the Sobel pass is a depth pre-pass
		// + fullscreen quad and costs ~10-15 FPS on integrated GPUs.
		// The High preset turns it on; Low keeps it off. Players who
		// want the toon look can flip it explicitly in the settings.
		Outlines: false,
		Labels: true,
		// Default off - light mode is the canonical look. The Title
		// screen toggle and the Settings modal both flip this; lil-gui
		// persists the value through `gui.save()` so the choice
		// survives reloads. The Title-screen toggle reads the existing
		// `html.dark` class on its first render so it doesn't have to
		// know about the params object.
		// Default off - light mode is canonical. Source of truth is
		// localStorage('sketchbook.darkMode'); the Title-screen toggle
		// writes there before World even exists. The Settings modal
		// toggle writes there too via the lil-gui onChange below, so
		// both UIs stay in sync.
		Dark_Mode: localStorage.getItem('sketchbook.darkMode') === 'true',
	};

	document.documentElement.classList.toggle('dark', !!world.params.Dark_Mode);

	// Hand the GUI a container so it sits inside #debug-stack (top-right
	// column shared with the FPS box) instead of auto-placing itself
	// fixed on the viewport. The container option also drops the
	// `lil-auto-place` class, so the library's own `position: fixed`
	// rule no longer applies.
	const debugStack = document.getElementById('debug-stack') ?? undefined;
	const gui = debugStack !== undefined ? new GUI({ container: debugStack }) : new GUI();
	world.gui = gui;

	// Scenario + Map - one outer folder. The map dropdown is added by
	// addMapSwitcher first (lands at the top), the nested 'Scenarios'
	// sub-folder is created lazily on the first scenario push so it
	// always renders BELOW the map dropdown regardless of how lil-gui
	// orders sibling controls.
	world.scenarioGUIFolder = gui.addFolder('Map & Scenarios');

	// World
	const worldFolder = gui.addFolder('World');
	worldFolder.add(world.params, 'Time_Scale', 0, 1).listen()
		.onChange((value) =>
		{
			world.timeScaleTarget = value;
		});
	worldFolder.add(world.params, 'Sun_Elevation', 0, 180).listen()
		.onChange((value) =>
		{
			world.sky.phi = value;
		});
	worldFolder.add(world.params, 'Sun_Rotation', 0, 360).listen()
		.onChange((value) =>
		{
			world.sky.theta = value;
		});
	// Master toggle for automatic sun movement. Sun_Cycle on -> sun
	// drifts (sky.phi += 0.01 * Time_Scale per tick); off -> sun stays
	// where Sun_Elevation puts it. Has_Night_Time only matters when
	// Sun_Cycle is on, so the sub-control is greyed out otherwise.
	const sunCycleCtrl = worldFolder.add(world.params, 'Sun_Cycle').listen();
	const nightTimeCtrl = worldFolder.add(world.params, 'Has_Night_Time').listen()
		.onChange((value) =>
		{
			world.params.Has_Night_Time = value;
		});
	sunCycleCtrl.onChange((value) =>
	{
		world.params.Sun_Cycle = value;
		nightTimeCtrl.enable(!!value);
	});
	nightTimeCtrl.enable(!!world.params.Sun_Cycle);
	// Gravity_Scale 0..2 lets the player toggle between zero-g and
	// double-g without rebuilding. updatePhysics reads
	// params.Gravity_Scale every step so this takes effect immediately.
	worldFolder.add(world.params, 'Gravity_Scale', 0, 2);
	// Free_Cam_Speed is read by CameraOperator when in free-cam mode.
	worldFolder.add(world.params, 'Free_Cam_Speed', 1, 100);

	// Per-car raycast-vehicle tuning (ported from Inthenew). Each
	// slider's onChange iterates the spawned cars and pushes the new
	// value into their cannon wheelInfos / engine factor. Defaults
	// match the constants the cars are constructed with.
	const vehiclesFolder = gui.addFolder('Vehicles');
	const applyToAllCars = (property: string, value: number, asEngineForce = false) =>
	{
		for (const v of world.vehicles)
		{
			if (v instanceof Car)
			{
				if (asEngineForce) v.updateCarSpeed(value);
				else v.updateWheelProps(property, value);
			}
		}
	};
	vehiclesFolder.add(world.params, 'Friction_Slip', 0, 5)
		.onChange((v) => applyToAllCars('frictionSlip', v));
	vehiclesFolder.add(world.params, 'Suspension_Stiffness', 0, 100)
		.onChange((v) => applyToAllCars('suspensionStiffness', v));
	vehiclesFolder.add(world.params, 'Max_Suspension', 0, 5)
		.onChange((v) => applyToAllCars('maxSuspensionTravel', v));
	vehiclesFolder.add(world.params, 'Damping_Compression', 0, 10)
		.onChange((v) => applyToAllCars('dampingCompression', v));
	vehiclesFolder.add(world.params, 'Damping_Relaxation', 0, 10)
		.onChange((v) => applyToAllCars('dampingRelaxation', v));
	vehiclesFolder.add(world.params, 'Engine_Force', 1, 50)
		.onChange((v) => applyToAllCars('', v, true));

	// Input
	const settingsFolder = gui.addFolder('Settings');
	settingsFolder.add(world.params, 'FXAA');
	settingsFolder.add(world.params, 'Shadows')
		.onChange((enabled) =>
		{
			world.sky.csm.lights.forEach((light) =>
			{
				light.castShadow = !!enabled;
			});
		});
	settingsFolder.add(world.params, 'Mouse_Sensitivity', 0, 1)
		.onChange((value) =>
		{
			world.cameraOperator.setSensitivity(value, value * 0.8);
		});
	settingsFolder.add(world.params, 'Debug_Physics')
		.onChange((enabled) =>
		{
			if (enabled)
			{
				// cannon-es-debugger adds meshes to the scene as the physics
				// world changes but does not expose a cleanup method. Track
				// them via onInit so we can remove them again when the user
				// turns debug rendering back off.
				world.cannonDebugMeshes = [];
				world.cannonDebugRenderer = CannonDebugger(
					world.graphicsWorld,
					world.physicsWorld,
					{
						onInit: (_body, mesh) => world.cannonDebugMeshes.push(mesh),
					},
				);
			}
			else
			{
				for (const mesh of world.cannonDebugMeshes)
				{
					world.graphicsWorld.remove(mesh);
				}
				world.cannonDebugMeshes = [];
				world.cannonDebugRenderer = undefined;
			}

			world.characters.forEach((char) =>
			{
				char.raycastBox.visible = enabled;
			});
		});
	settingsFolder.add(world.params, 'Debug_FPS')
		.onChange((enabled) =>
		{
			UIManager.setFPSVisible(enabled);
		});
	// Apply the initial state - onChange only fires on user input, but
	// the FPS box's CSS hides it by default. Without this call the box
	// stays hidden after boot even though the param is true.
	UIManager.setFPSVisible(world.params.Debug_FPS);
	settingsFolder.add(world.params, 'Camera_Shake');
	// Master audio gate first; the two sub-toggles disable themselves
	// in the UI when it's off so the player can't fiddle with them
	// while audio is globally muted.
	const masterAudioCtrl = settingsFolder.add(world.params, 'Master_Audio').listen();
	const sfxCtrl = settingsFolder.add(world.params, 'Sound_Effects');
	const musicCtrl = settingsFolder.add(world.params, 'Background_Music');
	const reflectMasterAudio = (on: boolean): void =>
	{
		sfxCtrl.enable(on);
		musicCtrl.enable(on);
	};
	masterAudioCtrl.onChange((on: boolean) =>
	{
		reflectMasterAudio(on);
		// Mirror to the title-screen mute key so the title screen
		// reflects the current state on next boot.
		localStorage.setItem('sketchbook.soundMuted', on ? 'false' : 'true');
		// Push to the THREE.AudioListener so 3D-positional sources
		// (BirdSound, CharacterSfx, Speaker) get muted alongside the
		// continuous synths that already gate through getMasterVolume.
		world.applyAudioListenerVolume();
	});
	reflectMasterAudio(world.params.Master_Audio);
	settingsFolder.add(world.params, 'Outlines');
	settingsFolder.add(world.params, 'Labels');
	settingsFolder.add(world.params, 'Dark_Mode')
		.onChange((enabled) =>
		{
			document.documentElement.classList.toggle('dark', !!enabled);
			localStorage.setItem('sketchbook.darkMode', enabled ? 'true' : 'false');
		});

	// Settings persistence (ported from Inthenew/Sketchbook).
	// Snapshot defaults before restoring so Reset_World_Settings can
	// fall back to them. lil-gui's controller.load() triggers onChange
	// internally, so all side effects (sky.phi, shadows, sensitivity,
	// ...) reapply automatically when the saved state is loaded.
	//
	// Override priority: localStorage values are the player's
	// preferences and load FIRST (here). Scenarios and World code that
	// run later (SceneLoader, scenario launch, RocketShip moon
	// transfer, etc.) write directly into world.params and therefore
	// always WIN against the persisted value - that's the intended
	// behaviour. The persisted value only re-takes precedence the
	// next time the player explicitly changes the slider.
	const SETTINGS_KEY = 'sketchbook-settings';
	const defaultWorldState = worldFolder.save();
	const persist = () =>
	{
		localStorage.setItem(SETTINGS_KEY, JSON.stringify(gui.save()));
	};

	const savedSettings = localStorage.getItem(SETTINGS_KEY);
	if (savedSettings)
	{
		try
		{
			gui.load(JSON.parse(savedSettings));
		}
		catch (e)
		{
			console.warn('[Sketchbook] Failed to load saved settings:', e);
			localStorage.removeItem(SETTINGS_KEY);
		}
	}

	gui.onFinishChange(persist);

	worldFolder.add({
		Reset_World_Settings: () =>
		{
			worldFolder.load(defaultWorldState);
			persist();
		},
	}, 'Reset_World_Settings');

	// Top-level gui stays open (the user can see all the section
	// headers); every folder inside it ships collapsed so the debug
	// panel doesn't dominate the screen on first paint. Click any
	// header to expand it. We force-close after gui.load() so a
	// previous session's open state doesn't override the default.
	gui.open();
	const closeRecursive = (g: any): void =>
	{
		if (typeof g.close === 'function' && g !== gui) g.close();
		if (Array.isArray(g.folders)) for (const f of g.folders) closeRecursive(f);
	};
	if (Array.isArray((gui as any).folders))
	{
		for (const f of (gui as any).folders) closeRecursive(f);
	}
}
