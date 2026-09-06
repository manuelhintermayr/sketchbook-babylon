import * as THREE from 'three';
import { World } from './World';
import { RenderLayer } from '../enums/RenderLayers';

// Depth-edge outline pass. Renders the scene's depth into a render
// target via a MeshDepthMaterial override, then runs a Sobel kernel
// on it through a fullscreen quad to find depth discontinuities -
// the classic Tron / toon outline look. Blends additively over
// whatever the main render produced.
//
// Pattern adapted from manuelhintermayr-portfolio/three-js
// OutlineEffect - reshaped from a React useFrame hook with
// useThree() to a vanilla TS class that World.render() calls
// explicitly. Owns its render target and shader materials, so a
// disabled toggle costs nothing per frame (the renderPass call is
// guarded externally).
//
// This is a separate pass deliberately, not an EffectComposer
// ShaderPass, because the composer's RenderPass doesn't expose the
// depth buffer in a way the Sobel kernel can sample. A standalone
// pre-pass into a depth-encoded RT is the cheapest option.

const OUTLINE_VERTEX = /* glsl */`
varying vec2 vUv;
void main()
{
	vUv = uv;
	gl_Position = vec4(position, 1.0);
}
`;

const OUTLINE_FRAGMENT = /* glsl */`
uniform sampler2D depthTex;
uniform vec2 resolution;
uniform vec3 outlineColor;
uniform float outlineStrength;
uniform float relativeThreshold;

varying vec2 vUv;

void main()
{
	vec2 texel = 1.0 / resolution;

	float tl = texture2D(depthTex, vUv + vec2(-texel.x,  texel.y)).r;
	float tc = texture2D(depthTex, vUv + vec2(     0.0,  texel.y)).r;
	float tr = texture2D(depthTex, vUv + vec2( texel.x,  texel.y)).r;
	float ml = texture2D(depthTex, vUv + vec2(-texel.x,      0.0)).r;
	float mr = texture2D(depthTex, vUv + vec2( texel.x,      0.0)).r;
	float bl = texture2D(depthTex, vUv + vec2(-texel.x, -texel.y)).r;
	float bc = texture2D(depthTex, vUv + vec2(     0.0, -texel.y)).r;
	float br = texture2D(depthTex, vUv + vec2( texel.x, -texel.y)).r;

	float gx = -tl - 2.0*ml - bl + tr + 2.0*mr + br;
	float gy = -tl - 2.0*tc - tr + bl + 2.0*bc + br;
	float edge = sqrt(gx * gx + gy * gy);

	// Scale-invariant thresholding. The Sobel edge magnitude at a
	// silhouette scales with the sample's depth - a player at d≈1.6
	// (third-person camera radius) produces a much smaller numeric
	// jump than the same silhouette at d=200, even though both should
	// outline. An absolute threshold can only catch one regime;
	// comparing edge/avgDepth makes the test depth-independent (a
	// clean object-against-background edge gives ratio ≈ 8 at every
	// distance, an interior smooth surface stays near 0). The 1e-6
	// floor on the divisor only protects pure-background pixels
	// (depth=0) from a div-by-zero - it must stay small enough not to
	// suppress genuinely-near silhouettes. With far=50000 a player at
	// d=1.6 has depth ≈ 3e-5; an earlier 1e-4 floor squashed that
	// ratio below the smoothstep range.
	float avgDepth = (tl + tc + tr + ml + mr + bl + bc + br) * 0.125;
	float scaledEdge = edge / max(avgDepth, 1e-6);

	float outline = smoothstep(relativeThreshold * 0.5, relativeThreshold, scaledEdge);
	gl_FragColor = vec4(outlineColor, outline * outlineStrength);
}
`;

export class OutlineEffect
{
	private world: World;
	private depthRT: THREE.WebGLRenderTarget;
	private depthMat: THREE.MeshDepthMaterial;
	private outlineMat: THREE.ShaderMaterial;
	private quadScene: THREE.Scene;
	private orthoCam: THREE.OrthographicCamera;

	constructor(world: World)
	{
		this.world = world;

		const pr = world.renderer.getPixelRatio();
		const w = Math.floor(window.innerWidth * pr);
		const h = Math.floor(window.innerHeight * pr);

		// HalfFloat (16-bit) is plenty for the [0..1] depth the pre-pass
		// writes - its ~3 decimal-digit precision is far finer than what
		// the Sobel kernel's edge detection needs. FloatType (32-bit)
		// would double the RT's VRAM and bandwidth for no visible gain.
		this.depthRT = new THREE.WebGLRenderTarget(w, h, {
			format: THREE.RGBAFormat,
			type: THREE.HalfFloatType,
			minFilter: THREE.NearestFilter,
			magFilter: THREE.NearestFilter,
		});

		// MeshDepthMaterial handles SkinnedMesh + morph targets natively
		// - three.js wires the skinning chunks for us. A custom
		// ShaderMaterial here would render the bind-pose silhouette
		// (no animation applied) since our shader only saw `position`.
		// BasicDepthPacking puts depth in the .r channel where the
		// Sobel kernel below already samples it.
		this.depthMat = new THREE.MeshDepthMaterial({
			depthPacking: THREE.BasicDepthPacking,
		});

		this.outlineMat = new THREE.ShaderMaterial({
			vertexShader: OUTLINE_VERTEX,
			fragmentShader: OUTLINE_FRAGMENT,
			uniforms: {
				depthTex: { value: this.depthRT.texture },
				resolution: { value: new THREE.Vector2(w, h) },
				outlineColor: { value: new THREE.Color(0x222222) },
				outlineStrength: { value: 1.0 },
				// Edge/avgDepth ratio above which the pixel is treated
				// as a silhouette. A clean object-vs-background edge
				// ratios around 8, smooth interior surfaces near 0, so
				// 1.5 lands well into the "true edge" range without
				// catching float-precision flicker on far terrain.
				relativeThreshold: { value: 1.5 },
			},
			transparent: true,
			depthTest: false,
			depthWrite: false,
		});

		const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.outlineMat);
		this.quadScene = new THREE.Scene();
		this.quadScene.add(quad);

		this.orthoCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

		window.addEventListener('resize', () => this.onResize());
	}

	private onResize(): void
	{
		const pr = this.world.renderer.getPixelRatio();
		const w = Math.floor(window.innerWidth * pr);
		const h = Math.floor(window.innerHeight * pr);
		this.depthRT.setSize(w, h);
		this.outlineMat.uniforms.resolution.value.set(w, h);
	}

	// Called by World.render() after the main composer/renderer pass,
	// before labelRenderer. No-op when params.Outlines is false.
	public renderPass(): void
	{
		if (!this.world.params?.Outlines) return;

		const renderer = this.world.renderer;
		const scene = this.world.graphicsWorld;
		const camera = this.world.camera;

		// 1. Override every material with MeshDepthMaterial and render
		//    to the depth RT. Restoring afterwards is critical - without
		//    it the next composer.render would draw flat depth onto the
		//    screen. We also strip the OutlineSkip layer bit on the
		//    camera so the depth pre-pass walks only the meshes we care
		//    about silhouetting (Character, Vehicles, NPCs, static
		//    buildings) - sky, stars, ocean tiles, grass blades sit out
		//    this pass.
		const origOverride = scene.overrideMaterial;
		scene.overrideMaterial = this.depthMat;
		camera.layers.disable(RenderLayer.OutlineSkip);
		renderer.setRenderTarget(this.depthRT);
		renderer.render(scene, camera);
		camera.layers.enable(RenderLayer.OutlineSkip);
		scene.overrideMaterial = origOverride;
		renderer.setRenderTarget(null);

		// 2. Blend the Sobel-edge quad over the framebuffer additively.
		const prevAutoClear = renderer.autoClear;
		renderer.autoClear = false;
		renderer.render(this.quadScene, this.orthoCam);
		renderer.autoClear = prevAutoClear;
	}
}
