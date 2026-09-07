import { Color3, DepthRenderer, Effect, PostProcess, Texture } from '@babylonjs/core';

import { World } from './World';
import { isOutlineSkip } from '../enums/RenderLayers';
import * as Utils from '../core/FunctionLibrary';

// Depth-edge outline pass. Babylon's DepthRenderer writes the scene's
// linear depth into a render target; a post-process then runs a Sobel
// kernel on it to find depth discontinuities - the classic Tron / toon
// outline look - and blends the edges additively over the frame.
//
// Pattern adapted from manuelhintermayr-portfolio/three-js
// OutlineEffect - reshaped from a React useFrame hook to a vanilla TS
// class that the render pipeline toggles each frame. The depth
// renderer and the post-process are only alive while the toggle is
// on, so a disabled outline costs one branch per frame.

const OUTLINE_FRAGMENT = `
	precision highp float;
	varying vec2 vUV;
	uniform sampler2D textureSampler;
	uniform sampler2D depthTex;
	uniform vec2 resolution;
	uniform vec3 outlineColor;
	uniform float outlineStrength;
	uniform float relativeThreshold;

	void main()
	{
		vec2 texel = 1.0 / resolution;

		float tl = texture2D(depthTex, vUV + vec2(-texel.x,  texel.y)).r;
		float tc = texture2D(depthTex, vUV + vec2(     0.0,  texel.y)).r;
		float tr = texture2D(depthTex, vUV + vec2( texel.x,  texel.y)).r;
		float ml = texture2D(depthTex, vUV + vec2(-texel.x,      0.0)).r;
		float mr = texture2D(depthTex, vUV + vec2( texel.x,      0.0)).r;
		float bl = texture2D(depthTex, vUV + vec2(-texel.x, -texel.y)).r;
		float bc = texture2D(depthTex, vUV + vec2(     0.0, -texel.y)).r;
		float br = texture2D(depthTex, vUV + vec2( texel.x, -texel.y)).r;

		float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
		float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
		float edge = sqrt(gx * gx + gy * gy);

		// Scale-invariant thresholding. The Sobel edge magnitude at a
		// silhouette scales with the sample's depth - a player at d~1.6
		// (third-person camera radius) produces a much smaller numeric
		// jump than the same silhouette at d=200, even though both should
		// outline. Comparing edge/avgDepth makes the test depth-independent
		// (a clean object-against-background edge gives a large ratio at
		// every distance, an interior smooth surface stays near 0). The
		// 1e-6 floor on the divisor only protects pure-background pixels
		// from a div-by-zero.
		float avgDepth = (tl + tc + tr + ml + mr + bl + bc + br) * 0.125;
		float scaledEdge = edge / max(avgDepth, 1e-6);

		float outline = smoothstep(relativeThreshold * 0.5, relativeThreshold, scaledEdge);
		vec4 base = texture2D(textureSampler, vUV);
		gl_FragColor = vec4(mix(base.rgb, outlineColor, outline * outlineStrength), base.a);
	}
`;

Effect.ShadersStore['sketchbookOutlineFragmentShader'] = OUTLINE_FRAGMENT;

export class OutlineEffect
{
	private world: World;
	private depthRenderer: DepthRenderer | null = null;
	private postProcess: PostProcess | null = null;

	private outlineColor: Color3 = Utils.linearColorFromHex(0x222222);
	private outlineStrength: number = 1.0;
	// Edge/avgDepth ratio above which the pixel is treated as a
	// silhouette. Babylon's depth renderer stores linear view-space
	// depth normalised to [near, far], so the ratios come out far
	// smaller than with three's non-linear depth packing.
	private relativeThreshold: number = 0.02;

	constructor(world: World)
	{
		this.world = world;
	}

	// Called by the render pipeline before scene.render(). Builds or
	// tears down the depth pre-pass + post-process as params.Outlines
	// flips, so the whole thing is free while disabled.
	public beforeRender(): void
	{
		const wanted = !!this.world.params?.Outlines;

		if (wanted && this.postProcess === null)
		{
			this.enable();
		}
		else if (!wanted && this.postProcess !== null)
		{
			this.disable();
		}
	}

	private enable(): void
	{
		const scene = this.world.scene;
		const camera = this.world.camera;

		// Depth pre-pass. The predicate walks only the meshes we care
		// about silhouetting (Character, Vehicles, NPCs, static
		// buildings) - sky, stars, ocean tiles, grass blades sit out.
		this.depthRenderer = scene.enableDepthRenderer(camera, false);
		this.depthRenderer.getDepthMap().renderListPredicate = (mesh) => !isOutlineSkip(mesh);
		this.depthRenderer.useOnlyInActiveCamera = true;

		this.postProcess = new PostProcess(
			'outline',
			'sketchbookOutline',
			['resolution', 'outlineColor', 'outlineStrength', 'relativeThreshold'],
			['depthTex'],
			1.0,
			camera,
			Texture.BILINEAR_SAMPLINGMODE,
		);
		this.postProcess.onApply = (effect) =>
		{
			if (this.depthRenderer === null) return;
			effect.setTexture('depthTex', this.depthRenderer.getDepthMap());
			effect.setFloat2('resolution', this.postProcess.width, this.postProcess.height);
			effect.setColor3('outlineColor', this.outlineColor);
			effect.setFloat('outlineStrength', this.outlineStrength);
			effect.setFloat('relativeThreshold', this.relativeThreshold);
		};
	}

	private disable(): void
	{
		if (this.postProcess !== null)
		{
			this.world.camera.detachPostProcess(this.postProcess);
			this.postProcess.dispose();
			this.postProcess = null;
		}
		if (this.depthRenderer !== null)
		{
			this.world.scene.disableDepthRenderer(this.world.camera);
			this.depthRenderer = null;
		}
	}
}
