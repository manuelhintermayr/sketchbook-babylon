import {
	CascadedShadowGenerator,
	Color3,
	Constants,
	DirectionalLight,
	HemisphericLight,
	Material,
	Mesh,
	MeshBuilder,
	Node,
	ShaderMaterial,
	ShadowGenerator,
	StandardMaterial,
	TransformNode,
	Vector3,
	VertexBuffer,
	Effect,
} from '@babylonjs/core';
import { SkyMaterial } from '@babylonjs/materials';

import * as Utils from '../core/FunctionLibrary';
import { World } from './World';
import { UpdateOrder } from '../enums/UpdateOrder';
import { markOutlineSkip } from '../enums/RenderLayers';
import { IUpdatable } from '../interfaces/IUpdatable';

// Star shell shader - constant screen-space point size, alpha fades in
// with nightFactor, per-vertex twinkle phase. Registered once in
// Effect.ShadersStore so ShaderMaterial can reference it by name.
Effect.ShadersStore['sketchbookStarsVertexShader'] = `
	precision highp float;
	attribute vec3 position;
	attribute float size;
	attribute float twinklePhase;
	uniform mat4 worldViewProjection;
	uniform float nightFactor;
	varying float vAlpha;
	varying float vTwinkle;

	void main()
	{
		vTwinkle = twinklePhase;
		vAlpha = nightFactor;
		// Constant screen-space size - the shell is at a fixed
		// radius so distance attenuation just makes them tiny.
		// Brightness fade lives entirely in vAlpha so the stars
		// fade in without also visually shrinking to nothing.
		gl_PointSize = size * 2.0;
		gl_Position = worldViewProjection * vec4(position, 1.0);
	}
`;

Effect.ShadersStore['sketchbookStarsFragmentShader'] = `
	precision highp float;
	uniform float time;
	varying float vAlpha;
	varying float vTwinkle;

	void main()
	{
		if (vAlpha < 0.01) discard;
		vec2 center = gl_PointCoord - 0.5;
		float dist = length(center);
		if (dist > 0.5) discard;
		float twinkle = 0.7 + 0.3 * sin(time * 3.0 + vTwinkle * 10.0);
		float alpha = (1.0 - dist * 2.0) * vAlpha * twinkle;
		gl_FragColor = vec4(1.0, 1.0, 0.95, alpha);
	}
`;

export class Sky extends TransformNode implements IUpdatable
{
	public updateOrder: number = UpdateOrder.Environment;

	public sunPosition: Vector3 = new Vector3();
	public sunLight: DirectionalLight;
	public shadowGenerator: CascadedShadowGenerator;

	set theta(value: number) {
		this._theta = value;
		this.refreshSunPosition();
	}

	get theta(): number {
		return this._theta;
	}

	set phi(value: number) {
		this._phi = value;
		this.refreshSunPosition();
		this.refreshHemiIntensity();
	}

	get phi(): number {
		return this._phi;
	}

	private _phi: number = 50;
	private _theta: number = 145;

	private hemiLight: HemisphericLight;
	private maxHemiIntensity: number = 0.9;
	private minHemiIntensity: number = 0.3;

	private skyMesh: Mesh;
	private skyMaterial: SkyMaterial;

	// Decorative black border around the moon when viewed from Earth.
	// See the constructor for the back-face-shell trick.
	private moonOutlineShell: Mesh;

	// Star field - only visible when the sun has dropped below the
	// horizon or the player is in space. The shader uses a nightFactor
	// uniform that we drive from the sun position each frame.
	private starsMesh: Mesh;
	private starsMaterial: ShaderMaterial;
	private starsTime: number = 0;

	private world: World;
	private lightDirection: Vector3 = new Vector3(0, -1, 0);

	constructor(world: World)
	{
		super('sky', world.scene);

		this.world = world;
		const scene = world.scene;

		// Sky material - the same Preetham atmospheric-scattering model
		// three's Sky example uses, driven by a sun direction.
		this.skyMaterial = new SkyMaterial('skyMaterial', scene);
		this.skyMaterial.backFaceCulling = false;
		this.skyMaterial.useSunPosition = true;
		this.skyMaterial.turbidity = 2;
		this.skyMaterial.rayleigh = 1;
		this.skyMaterial.mieCoefficient = 0.005;
		this.skyMaterial.mieDirectionalG = 0.8;
		this.skyMaterial.luminance = 1;
		this.skyMaterial.disableDepthWrite = true;

		// Mesh. Sky shell, Earth/Moon spheres, and the star points all
		// go on OutlineSkip - they're "background" geometry whose
		// silhouette would just create flickering Sobel noise on the
		// outline pass without adding anything readable.
		this.skyMesh = MeshBuilder.CreateSphere('skyShell', { diameter: 2000, segments: 24 }, scene);
		this.skyMesh.material = this.skyMaterial;
		this.skyMesh.parent = this;
		this.skyMesh.isPickable = false;
		this.skyMesh.alwaysSelectAsActiveMesh = true;
		markOutlineSkip(this.skyMesh);

		// Earth and Moon visuals (ported from Inthenew/Sketchbook).
		// Both are front-side spheres, intentionally only visible from
		// outside: the Earth sphere is centered at the world origin so
		// the player only sees it once they land on the Moon, and the
		// Moon sphere sits at Inthenew's hand-authored moon coordinates
		// so it shows as a body in the sky from anywhere on Earth.
		// 64x32 segments (was 24x12). Without the bump the silhouette
		// reads as a polygonal staircase under FXAA + the new moon
		// outline ring.
		const earthMesh = MeshBuilder.CreateSphere('earth', { diameter: 5010 * 2, segments: 32 }, scene);
		earthMesh.material = this.unlitTextured('earthMaterial', 'src/img/equirectangular-earth.png');
		earthMesh.isPickable = false;
		markOutlineSkip(earthMesh);

		// Inthenew uses radius 1252.5 (matching their gravity sphere).
		// That makes the moon dominate the sky at its authored distance;
		// halve the visual radius so it reads as a far-away body.
		const moonMesh = MeshBuilder.CreateSphere('moon', { diameter: 626.25 * 2, segments: 32 }, scene);
		moonMesh.material = this.unlitTextured('moonMaterial', 'src/img/equirectangular-moon.png');
		moonMesh.position.set(15.2758, 3852.67, -11696.4);
		moonMesh.isPickable = false;
		markOutlineSkip(moonMesh);

		// Cartoon-style outline ring around the moon: a slightly larger
		// back-face black sphere at the same position. Its back-facing
		// polygons sit behind the moon's front face, so depth-test
		// leaves the moon disk visible and only the thin annulus
		// between the two silhouettes shows up as black. Hidden in
		// space (see update) - up close the shell would just engulf
		// the view in black.
		this.moonOutlineShell = MeshBuilder.CreateSphere('moonOutline', { diameter: 626.25 * 1.04 * 2, segments: 32, sideOrientation: Mesh.BACKSIDE }, scene);
		const outlineMat = new StandardMaterial('moonOutlineMaterial', scene);
		outlineMat.disableLighting = true;
		outlineMat.emissiveColor = Color3.Black();
		outlineMat.diffuseColor = Color3.Black();
		outlineMat.backFaceCulling = false;
		this.moonOutlineShell.material = outlineMat;
		this.moonOutlineShell.position.copyFrom(moonMesh.position);
		this.moonOutlineShell.isPickable = false;
		markOutlineSkip(this.moonOutlineShell);

		// Stars - 2000 points on the upper hemisphere of a 800-unit
		// shell. Camera-anchored each frame (this node's position
		// follows world.camera), so the star field always surrounds the
		// player. The shader fades them in as nightFactor goes up and
		// adds a per-vertex twinkle phase. Pattern from
		// manuelhintermayr-portfolio/three-js DayNightCycle Stars
		// sub-component.
		this.starsMaterial = this.buildStarsMaterial();
		this.starsMesh = this.buildStarsMesh();
		this.starsMesh.material = this.starsMaterial;
		this.starsMesh.parent = this;
		this.starsMesh.alwaysSelectAsActiveMesh = true;
		this.starsMesh.isPickable = false;
		markOutlineSkip(this.starsMesh);

		// Ambient light. Sky colour HSL(0.59, 0.4, 0.6) and ground colour
		// HSL(0.095, 0.2, 0.75) from the three version, converted to RGB.
		this.hemiLight = new HemisphericLight('hemiLight', new Vector3(0, 1, 0), scene);
		this.hemiLight.diffuse = new Color3(0.44, 0.587, 0.76);
		this.hemiLight.groundColor = new Color3(0.8, 0.757, 0.7);
		this.hemiLight.specular = Color3.Black();
		this.refreshHemiIntensity();

		// Sun + cascaded shadow maps. three's CSM example got custom
		// splits at 1/16, 1/4 and 1 of 250 m; Babylon's practical split
		// with lambda 0.9 lands close enough. 1024 keeps shadow-map work
		// down to ~3 MP/frame across the 3 cascades.
		this.sunLight = new DirectionalLight('sun', new Vector3(-1, -1, -1), scene);
		this.sunLight.intensity = 1.6;
		this.sunLight.specular = Color3.Black();
		this.sunLight.shadowMinZ = 0.1;
		this.sunLight.shadowMaxZ = 250;

		this.shadowGenerator = new CascadedShadowGenerator(1024, this.sunLight);
		this.shadowGenerator.numCascades = 3;
		this.shadowGenerator.lambda = 0.9;
		this.shadowGenerator.shadowMaxZ = 250;
		this.shadowGenerator.stabilizeCascades = true;
		this.shadowGenerator.autoCalcDepthBounds = false;
		this.shadowGenerator.depthClamp = true;
		this.shadowGenerator.cascadeBlendPercentage = 0.1;
		this.shadowGenerator.usePercentageCloserFiltering = true;
		this.shadowGenerator.filteringQuality = ShadowGenerator.QUALITY_MEDIUM;
		this.shadowGenerator.bias = 0.002;
		this.shadowGenerator.normalBias = 0.02;

		this.refreshSunPosition();

		world.registerUpdatable(this);
	}

	private unlitTextured(name: string, url: string): StandardMaterial
	{
		const mat = new StandardMaterial(name, this.world.scene);
		mat.disableLighting = true;
		mat.emissiveTexture = Utils.loadTexture(this.world.scene, url);
		mat.diffuseColor = Color3.Black();
		mat.specularColor = Color3.Black();
		return mat;
	}

	// three's CSM wanted every material registered; Babylon's shadow
	// generator wants the casting meshes. Walks the node and adds every
	// mesh below it (and the node itself when it is one).
	public registerShadowCaster(node: Node): void
	{
		const meshes = node.getChildMeshes(false);
		if (node instanceof Mesh) meshes.push(node);
		for (const mesh of meshes)
		{
			// Hidden helpers (collision proxies, navmeshes) must not throw
			// shadows from geometry the player never sees.
			if (!mesh.isEnabled() || !mesh.isVisible) continue;
			this.shadowGenerator.addShadowCaster(mesh, false);
			mesh.receiveShadows = true;
		}
	}

	public unregisterShadowCaster(node: Node): void
	{
		const meshes = node.getChildMeshes(false);
		if (node instanceof Mesh) meshes.push(node);
		for (const mesh of meshes)
		{
			this.shadowGenerator.removeShadowCaster(mesh, false);
		}
	}

	public setShadowsEnabled(enabled: boolean): void
	{
		this.sunLight.shadowEnabled = enabled;
	}

	public update(timeScale: number): void
	{
		this.position.copyFrom(this.world.camera.position);
		this.refreshSunPosition();

		// Hide the atmosphere shell once the camera leaves Earth so the
		// player sees plain black space instead of the blue Sky shader.
		// Threshold roughly matches Inthenew's launch apex - anything
		// above there is in transit or on the moon.
		const inSpace = this.world.onMoon || this.world.camera.position.y > 1500;
		this.skyMesh.setEnabled(!inSpace);

		// Outline ring only while earth-bound AND the global Outlines
		// toggle is on. The shell is a separate mesh, not part of the
		// depth-based outline pass, so it doesn't auto-hide when the
		// Outlines param flips - we have to mirror the gate here.
		// Past the atmosphere boundary the camera approaches the moon
		// and slips inside the shell, which then renders as a solid
		// black void - hence the inSpace half of the condition.
		this.moonOutlineShell.setEnabled(!inSpace && this.world.params?.Outlines === true);

		// Stars: linear ramp from late-afternoon (sunY=2, ~phi 168) to
		// deep dusk (sunY=-3, ~phi 197). In space we want them at full
		// brightness regardless of sun position.
		const sunY = this.sunPosition.y;
		const nightFactor = inSpace ? 1.0 : Utils.clamp((2 - sunY) / 5, 0, 1);
		this.starsTime += timeScale;
		this.starsMaterial.setFloat('nightFactor', nightFactor);
		this.starsMaterial.setFloat('time', this.starsTime);

		this.lightDirection.set(-this.sunPosition.x, -this.sunPosition.y, -this.sunPosition.z).normalize();
		this.sunLight.direction.copyFrom(this.lightDirection);
	}

	public refreshSunPosition(): void
	{
		const sunDistance = 10;

		this.sunPosition.x = sunDistance * Math.sin(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);
		this.sunPosition.y = sunDistance * Math.sin(this._phi * Math.PI / 180);
		this.sunPosition.z = sunDistance * Math.cos(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);

		this.skyMaterial.sunPosition.copyFrom(this.sunPosition);
	}

	public refreshHemiIntensity(): void
	{
		this.hemiLight.intensity = this.minHemiIntensity + Math.pow(1 - (Math.abs(this._phi - 90) / 90), 0.25) * (this.maxHemiIntensity - this.minHemiIntensity);
	}

	private buildStarsMesh(): Mesh
	{
		const STAR_COUNT = 2000;
		const SHELL_RADIUS = 800;

		const positions = new Float32Array(STAR_COUNT * 3);
		const sizes = new Float32Array(STAR_COUNT);
		const phases = new Float32Array(STAR_COUNT);

		for (let i = 0; i < STAR_COUNT; i++)
		{
			// Distribute on the upper hemisphere - stars below the horizon
			// would clip through the terrain anyway.
			const theta = Math.random() * Math.PI * 2;
			const phi = Math.acos(Math.random());
			let y = SHELL_RADIUS * Math.cos(phi);
			if (y < 0) y = -y;
			const x = SHELL_RADIUS * Math.sin(phi) * Math.cos(theta);
			const z = SHELL_RADIUS * Math.sin(phi) * Math.sin(theta);

			positions[i * 3] = x;
			positions[i * 3 + 1] = y;
			positions[i * 3 + 2] = z;
			sizes[i] = 1 + Math.random() * 3;
			phases[i] = Math.random() * Math.PI * 2;
		}

		const scene = this.world.scene;
		const mesh = new Mesh('stars', scene);
		mesh.setVerticesData(VertexBuffer.PositionKind, positions, false, 3);
		mesh.setVerticesBuffer(new VertexBuffer(scene.getEngine(), sizes, 'size', false, false, 1));
		mesh.setVerticesBuffer(new VertexBuffer(scene.getEngine(), phases, 'twinklePhase', false, false, 1));
		return mesh;
	}

	private buildStarsMaterial(): ShaderMaterial
	{
		const material = new ShaderMaterial('starsMaterial', this.world.scene, 'sketchbookStars', {
			attributes: ['position', 'size', 'twinklePhase'],
			uniforms: ['worldViewProjection', 'nightFactor', 'time'],
			needAlphaBlending: true,
		});
		material.fillMode = Material.PointFillMode;
		material.alphaMode = Constants.ALPHA_ADD;
		material.disableDepthWrite = true;
		material.backFaceCulling = false;
		material.setFloat('nightFactor', 0);
		material.setFloat('time', 0);
		return material;
	}
}
