import {
	Color4,
	Constants,
	Engine,
	FreeCamera,
	FxaaPostProcess,
	PhysicsBody,
	PhysicsViewer,
	Quaternion,
	Scene,
	Vector3,
} from '@babylonjs/core';

import { World } from '../World';
import { LabelRenderer } from '../ui/LabelRenderer';
import { createToneMappingPass } from '../ToneMappingPostProcess';

// Build the rendering pipeline - Babylon engine + scene, the DOM label
// overlay, the camera, the FXAA post-process, plus the window-resize
// handler that keeps every surface in sync.
//
// Side effects assigned to world by the time this returns:
//   - world.engine, world.canvas, world.scene, world.camera
//   - world.labelRenderer
//   - world.fxaaPass, world.toneMappingPass
//
// Run before bootstrapHTML - that function appends world.canvas to
// <body>, so the engine has to exist first.
export function setupRendererPipeline(world: World): void
{
	// Canvas + engine. Cap the effective pixel ratio at 2 - phones and
	// tablets often report DPR 3-4, which forces the GPU to render 9-16x
	// the pixels for barely visible sharpness gain past 2x. Babylon
	// expresses this as a hardware scaling level (1 / ratio).
	world.canvas = document.createElement('canvas');
	world.engine = new Engine(world.canvas, true, { stencil: false, preserveDrawingBuffer: false }, false);
	world.engine.setHardwareScalingLevel(1 / Math.min(window.devicePixelRatio, 2));

	// Right-handed scene so glTF content, the physics maths and every
	// hand-tuned coordinate in the maps carry over from three.js
	// unchanged (Y up, -Z forward for cameras).
	world.scene = new Scene(world.engine);
	world.scene.useRightHandedSystem = true;
	// Black space behind the Sky shell; Sky.update() hides the shell
	// once the camera leaves Earth's atmosphere, revealing this color.
	world.scene.clearColor = new Color4(0, 0, 0, 1);
	// Babylon's pointer pipeline calls preventDefault() on pointerdown /
	// pointerup by default, which suppresses the compatibility mousedown /
	// mouseup events InputManager's click-and-drag camera listens for.
	world.scene.preventDefaultOnPointerDown = false;
	world.scene.preventDefaultOnPointerUp = false;
	// Colour pipeline mirrors the three.js build, quirk included. With
	// FXAA on (the default) three rendered into the composer's linear
	// HalfFloat target and the FXAA pass wrote those raw values to the
	// screen - no tone mapping, no sRGB encode, clipped highlights, a
	// saturated cyan sky. That is the look every map was tuned against;
	// only the direct-to-canvas path (FXAA off) ran ACES + sRGB. So the
	// scene renders linear throughout - image processing off, glTF
	// textures as sRGB buffers, lights and colour constants at three's
	// linear values - and toneMappingPass reproduces the direct path
	// while FXAA is off (tickRenderPipeline swaps the two).
	world.scene.imageProcessingConfiguration.isEnabled = false;

	// Camera. far=1010 (swift502 default) clips the moon at distance
	// ~12320 and the rocketship's max-Y plane at 5200. Inthenew sets
	// far=2e10; 50000 is plenty for the authored geometry while still
	// keeping the depth buffer well-conditioned. No built-in inputs -
	// CameraOperator drives position + target itself.
	world.camera = new FreeCamera('camera', new Vector3(0, 2, 5), world.scene);
	world.camera.fov = 80 * Math.PI / 180;
	world.camera.minZ = 0.1;
	world.camera.maxZ = 50000;
	world.camera.rotationQuaternion = Quaternion.Identity();
	world.camera.inputs.clear();
	world.scene.activeCamera = world.camera;

	// DOM label overlay - drives the name tags above each character.
	// Same pattern socketControl used (a parallel renderer that projects
	// HTML divs to screen-space at the object's world position).
	// pointerEvents=none so labels never eat clicks.
	world.labelRenderer = new LabelRenderer(world.scene);
	world.labelRenderer.setSize(window.innerWidth, window.innerHeight);
	world.labelRenderer.domElement.id = 'labelRenderer';
	world.labelRenderer.domElement.style.position = 'absolute';
	world.labelRenderer.domElement.style.top = '0';
	world.labelRenderer.domElement.style.left = '0';
	world.labelRenderer.domElement.style.pointerEvents = 'none';
	document.body.appendChild(world.labelRenderer.domElement);

	// FXAA - the only post-process left after Bloom + DoF were dropped
	// (they cost frames on integrated GPUs without giving the toon-ish
	// look much). Attached to the camera right away; tickRenderPipeline
	// detaches it while params.FXAA is off.
	// Half-float targets like three's composer target, so highlights
	// above 1 reach FXAA's edge blending and the tone-mapping curve
	// instead of clipping at the pass boundary (the sky would turn grey).
	const passTextureType = world.engine.getCaps().textureHalfFloatRender
		? Constants.TEXTURETYPE_HALF_FLOAT
		: Constants.TEXTURETYPE_UNSIGNED_BYTE;
	world.fxaaPass = new FxaaPostProcess('fxaa', 1.0, world.camera, undefined, world.engine, false, passTextureType);
	world.fxaaAttached = true;
	world.toneMappingPass = createToneMappingPass(world.engine, passTextureType);

	// Auto window resize. The engine re-reads the canvas size; the label
	// overlay follows window.inner* like the canvas CSS does.
	window.addEventListener('resize', () =>
	{
		world.engine.resize();
		world.labelRenderer.setSize(window.innerWidth, window.innerHeight);
	}, false);
}

// Per-frame GPU dispatch: FXAA gating, outline pre-pass toggling, the
// scene render itself, and the label projection. World.render() drives
// the loop (timestep + updatables); this helper just writes pixels.
export function tickRenderPipeline(world: World): void
{
	// FXAA on = three's composer path (raw linear to the screen), FXAA
	// off = its direct path (ACES + sRGB) - see setup. Either pass sits
	// at index 0 so the outline overlay draws on top of it.
	const wantFxaa = !!world.params.FXAA;
	if (wantFxaa !== world.fxaaAttached)
	{
		if (wantFxaa)
		{
			world.camera.detachPostProcess(world.toneMappingPass);
			world.camera.attachPostProcess(world.fxaaPass, 0);
		}
		else
		{
			world.camera.detachPostProcess(world.fxaaPass);
			world.camera.attachPostProcess(world.toneMappingPass, 0);
		}
		world.fxaaAttached = wantFxaa;
	}

	// Depth-Sobel outline overlay - internally guarded by params.Outlines
	// so a disabled toggle costs one branch per frame.
	world.outlineEffect.beforeRender();

	world.scene.render();

	// Label pass projects each name-label div above its anchor world
	// position. Cheap; no perf concerns at the scale of "a few NPCs
	// and a player".
	world.labelRenderer.render(world.camera);
}

// Physics debug pass. Babylon's PhysicsViewer draws a wireframe per
// body; bodies that spawn while the toggle is on are picked up here on
// their first frame, disposed ones are dropped. Gated on
// params.Debug_Physics by the caller (World.update).
export function tickPhysicsDebug(world: World): void
{
	if (world.physicsViewer === undefined) return;

	const shown = world.physicsDebugBodies;
	for (const body of world.physicsWorld.engine.getBodies())
	{
		if (!shown.has(body))
		{
			shown.add(body);
			world.physicsViewer.showBody(body);
		}
	}
	for (const body of shown)
	{
		if (body.isDisposed)
		{
			shown.delete(body);
			world.physicsViewer.hideBody(body);
		}
	}
}

export function setPhysicsDebugEnabled(world: World, enabled: boolean): void
{
	if (enabled && world.physicsViewer === undefined)
	{
		world.physicsViewer = new PhysicsViewer(world.scene);
		world.physicsDebugBodies = new Set<PhysicsBody>();
	}
	else if (!enabled && world.physicsViewer !== undefined)
	{
		world.physicsViewer.dispose();
		world.physicsViewer = undefined;
		world.physicsDebugBodies = new Set<PhysicsBody>();
	}
}
