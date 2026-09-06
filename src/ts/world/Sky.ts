import { Sky as ThreeSky } from 'three/examples/jsm/objects/Sky.js';
import * as THREE from 'three';
import { World } from './World';
import { EntityType } from '../enums/EntityType';
import { UpdateOrder } from '../enums/UpdateOrder';
import { RenderLayer } from '../enums/RenderLayers';
import { IUpdatable } from '../interfaces/IUpdatable';
import { CSM } from 'three/examples/jsm/csm/CSM.js';

export class Sky extends THREE.Object3D implements IUpdatable
{
	public updateOrder: number = UpdateOrder.Environment;

	public sunPosition: THREE.Vector3 = new THREE.Vector3();
	public csm: CSM;

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

	private hemiLight: THREE.HemisphereLight;
	private maxHemiIntensity: number = 0.9;
	private minHemiIntensity: number = 0.3;

	private sky: ThreeSky;
	private skyMesh: THREE.Mesh;
	private skyMaterial: THREE.ShaderMaterial;

	// Decorative black border around the moon when viewed from Earth.
	// See the constructor for the BackSide-shell trick.
	private moonOutlineShell: THREE.Mesh;

	// Star field - only visible when the sun has dropped below the
	// horizon or the player is in space. The shader uses a nightFactor
	// uniform that we drive from the sun position each frame.
	private starsPoints: THREE.Points;
	private starsMaterial: THREE.ShaderMaterial;

	private world: World;

	constructor(world: World)
	{
		super();

		this.world = world;

		// Create sky for material
		const sky = new ThreeSky();
		sky.scale.setScalar( 450000 );
		sky.visible = true;
		
		// Sky material
		this.skyMaterial = new THREE.ShaderMaterial({
			uniforms: THREE.UniformsUtils.clone(sky.material.uniforms),
			fragmentShader: sky.material.fragmentShader,
			vertexShader: sky.material.vertexShader,
			side: THREE.BackSide
		});

		// Mesh. Sky shell, Earth/Moon spheres, and the star points all
		// move to OutlineSkip - they're "background" geometry whose
		// silhouette would just create flickering Sobel noise on the
		// outline pass without adding anything readable.
		this.skyMesh = new THREE.Mesh(
			new THREE.SphereGeometry(1000, 24, 12),
			this.skyMaterial
		);
		this.skyMesh.layers.set(RenderLayer.OutlineSkip);
		this.attach(this.skyMesh);

		// Earth and Moon visuals (ported from Inthenew/Sketchbook).
		// Both are FrontSide spheres, intentionally only visible from
		// outside: the Earth sphere is centered at the world origin so
		// the player only sees it once they land on the Moon, and the
		// Moon sphere sits at Inthenew's hand-authored moon coordinates
		// so it shows as a body in the sky from anywhere on Earth.
		const textureLoader = new THREE.TextureLoader();
		// 64x32 segments (was 24x12). Without the bump the silhouette
		// reads as a polygonal staircase under FXAA + the new moon
		// outline ring.
		const earthMesh = new THREE.Mesh(
			new THREE.SphereGeometry(5010, 64, 32),
			new THREE.MeshBasicMaterial({
				side: THREE.FrontSide,
				map: textureLoader.load('src/img/equirectangular-earth.png'),
			}),
		);
		earthMesh.layers.set(RenderLayer.OutlineSkip);
		world.graphicsWorld.add(earthMesh);

		// Inthenew uses radius 1252.5 (matching their gravity sphere).
		// That makes the moon dominate the sky at its authored distance;
		// halve the visual radius so it reads as a far-away body. Block 4
		// will keep the original 1252.5 for the gravity sphere.
		const moonMesh = new THREE.Mesh(
			new THREE.SphereGeometry(626.25, 64, 32),
			new THREE.MeshBasicMaterial({
				side: THREE.FrontSide,
				map: textureLoader.load('src/img/equirectangular-moon.png'),
			}),
		);
		moonMesh.position.set(15.2758, 3852.67, -11696.4);
		moonMesh.layers.set(RenderLayer.OutlineSkip);
		world.graphicsWorld.add(moonMesh);

		// Cartoon-style outline ring around the moon: a slightly larger
		// BackSide black sphere at the same position. Its back-facing
		// polygons sit behind the moon's front face, so depth-test
		// leaves the moon disk visible and only the thin annulus
		// between the two silhouettes shows up as black. Hidden in
		// space (see update) - up close the shell would just engulf
		// the view in black.
		this.moonOutlineShell = new THREE.Mesh(
			new THREE.SphereGeometry(626.25 * 1.04, 64, 32),
			new THREE.MeshBasicMaterial({
				side: THREE.BackSide,
				color: 0x000000,
			}),
		);
		this.moonOutlineShell.position.copy(moonMesh.position);
		this.moonOutlineShell.layers.set(RenderLayer.OutlineSkip);
		world.graphicsWorld.add(this.moonOutlineShell);

		// Stars - 2000 points on the upper hemisphere of a 800-unit
		// shell. Camera-anchored each frame (this object's position
		// follows world.camera), so the star field always surrounds the
		// player. The shader fades them in as nightFactor goes up and
		// adds a per-vertex twinkle phase. Pattern from
		// manuelhintermayr-portfolio/three-js DayNightCycle Stars
		// sub-component.
		this.starsMaterial = this.buildStarsMaterial();
		this.starsPoints = new THREE.Points(this.buildStarsGeometry(), this.starsMaterial);
		this.starsPoints.frustumCulled = false;
		this.starsPoints.layers.set(RenderLayer.OutlineSkip);
		this.attach(this.starsPoints);

		// Ambient light
		this.hemiLight = new THREE.HemisphereLight( 0xffffff, 0xffffff, 1.0 );
		this.refreshHemiIntensity();
		this.hemiLight.color.setHSL( 0.59, 0.4, 0.6 );
		this.hemiLight.groundColor.setHSL( 0.095, 0.2, 0.75 );
		this.hemiLight.position.set( 0, 50, 0 );
		this.world.graphicsWorld.add( this.hemiLight );

		// CSM: split callback pushes into the target array (three's built-in
		// CSM API, replacing the legacy `return arr` style of three-csm).
		let splitsCallback = (amount: number, near: number, far: number, target: number[]) =>
		{
			for (let i = amount - 1; i >= 0; i--)
			{
				target.push(Math.pow(1 / 4, i));
			}
		};

		this.csm = new CSM({
			//fov: 80,
			maxFar: 250,	// maxFar
			lightIntensity: 2.5,
			cascades: 3,
			// 1024 keeps shadow-map work down to ~3 MP/frame across the
			// 3 cascades. 2048 looked marginally crisper on hard edges
			// but cost 4× the GPU work and ~50 MB of VRAM.
			shadowMapSize: 1024,
			camera: world.camera,
			parent: world.graphicsWorld,
			mode: 'custom',
			customSplitsCallback: splitsCallback
		});
		this.csm.fade = true;

		this.refreshSunPosition();
		
		world.graphicsWorld.add(this);
		world.registerUpdatable(this);
	}

	public update(timeScale: number): void
	{
		this.position.copy(this.world.camera.position);
		this.refreshSunPosition();

		// Hide the atmosphere shell once the camera leaves Earth so the
		// player sees plain black space instead of the blue Sky shader.
		// Threshold roughly matches Inthenew's launch apex - anything
		// above there is in transit or on the moon.
		const inSpace = this.world.onMoon || this.world.camera.position.y > 1500;
		this.skyMesh.visible = !inSpace;

		// Outline ring only while earth-bound AND the global Outlines
		// toggle is on. The shell is a separate mesh, not part of the
		// depth-based outline pass, so it doesn't auto-hide when the
		// Outlines param flips - we have to mirror the gate here.
		// Past the atmosphere boundary the camera approaches the moon
		// and slips inside the shell, which then renders as a solid
		// black void - hence the inSpace half of the condition.
		this.moonOutlineShell.visible = !inSpace && this.world.params?.Outlines === true;

		// Stars: linear ramp from late-afternoon (sunY=2, ~phi 168) to
		// deep dusk (sunY=-3, ~phi 197). Earlier curve kept this squared
		// from -sunY/10, which only became visible when the sun had
		// dropped halfway to nadir - by which point the player had
		// already been staring at a black sky for a while wondering
		// where the stars were. In space we want them at full brightness
		// regardless of sun position.
		const sunY = this.sunPosition.y;
		const nightFactor = inSpace ? 1.0 : THREE.MathUtils.clamp((2 - sunY) / 5, 0, 1);
		this.starsMaterial.uniforms.nightFactor.value = nightFactor;
		this.starsMaterial.uniforms.time.value += timeScale;

		this.csm.update(); // Removed argument
		this.csm.lightDirection = new THREE.Vector3(-this.sunPosition.x, -this.sunPosition.y, -this.sunPosition.z).normalize();
	}

	public refreshSunPosition(): void
	{
		const sunDistance = 10;

		this.sunPosition.x = sunDistance * Math.sin(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);
		this.sunPosition.y = sunDistance * Math.sin(this._phi * Math.PI / 180);
		this.sunPosition.z = sunDistance * Math.cos(this._theta * Math.PI / 180) * Math.cos(this._phi * Math.PI / 180);

		this.skyMaterial.uniforms.sunPosition.value.copy(this.sunPosition);
	}

	public refreshHemiIntensity(): void
	{
		this.hemiLight.intensity = this.minHemiIntensity + Math.pow(1 - (Math.abs(this._phi - 90) / 90), 0.25) * (this.maxHemiIntensity - this.minHemiIntensity);
	}

	private buildStarsGeometry(): THREE.BufferGeometry
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

		const geo = new THREE.BufferGeometry();
		geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
		geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));
		geo.setAttribute('twinklePhase', new THREE.BufferAttribute(phases, 1));
		return geo;
	}

	private buildStarsMaterial(): THREE.ShaderMaterial
	{
		return new THREE.ShaderMaterial({
			vertexShader: `
				attribute float size;
				attribute float twinklePhase;
				uniform float nightFactor;
				varying float vAlpha;
				varying float vTwinkle;

				void main()
				{
					vTwinkle = twinklePhase;
					vAlpha = nightFactor;
					vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
					// Constant screen-space size - the shell is at a fixed
					// radius so distance attenuation just makes them tiny.
					// Brightness fade lives entirely in vAlpha so the stars
					// fade in without also visually shrinking to nothing.
					gl_PointSize = size * 2.0;
					gl_Position = projectionMatrix * mvPosition;
				}
			`,
			fragmentShader: `
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
			`,
			uniforms:
			{
				time: { value: 0 },
				nightFactor: { value: 0 },
			},
			transparent: true,
			blending: THREE.AdditiveBlending,
			depthWrite: false,
		});
	}
}