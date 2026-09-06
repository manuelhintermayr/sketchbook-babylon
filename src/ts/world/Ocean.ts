import * as THREE from 'three';

import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { UpdateOrder } from '../enums/UpdateOrder';
import { RenderLayer } from '../enums/RenderLayers';

const DEG2RAD = Math.PI / 180;

// Wave-based ocean ported from Inthenew/Sketchbook (MIT). The shader is
// applied via MeshStandardMaterial.onBeforeCompile so three's lighting
// and normal-map pipeline are preserved. A 2x2 grid of plane tiles is
// laid around the origin to extend the ocean past the small ocean
// quad that ships in world.glb.
//
// IMPORTANT: the wave formula in moveWave() (GLSL injected via
// onBeforeCompile below) and getWaveHeightAt() (TypeScript) MUST stay in
// sync. If you change one, change the other.
export class Ocean implements IUpdatable
{
	public updateOrder = UpdateOrder.World;
	public material: THREE.MeshBasicMaterial;

	private world: World;
	private startTime: number;

	private readonly GrdSiz = 1000;
	private readonly segNum = 200;
	private readonly GrdRCs = 2;

	private waveGeometry: THREE.PlaneGeometry | null = null;
	private waveMaterial: THREE.MeshStandardMaterial | null = null;
	private waterNormalMap: THREE.Texture | null = null;
	private tiles: THREE.Mesh[] = [];
	private tileXOffsets: number[] = [];
	private tileZOffsets: number[] = [];
	private loaded = false;

	private readonly uniforms = {
		time: { value: 0 },
		grid: { value: 1000 },
	};

	constructor(object: THREE.Mesh, world: World)
	{
		this.world = world;

		// Hide the original ocean plane carried in world.glb - we render
		// the tiled wave grid on top of it.
		this.material = new THREE.MeshBasicMaterial({
			color: 'skyblue',
			transparent: true,
			opacity: 0,
		});
		object.material = this.material;

		// Wall-clock start time - feeds the wave shader's `time` uniform.
		// THREE.Clock used to do this; it is deprecated in favour of
		// performance.now() (THREE.Timer is the official replacement but
		// adds an updatable just to wrap the same call).
		this.startTime = performance.now();
		this.createOcean();
	}

	private createOcean(): void
	{
		const loadingManager = new THREE.LoadingManager();
		loadingManager.onLoad = () => { this.initTiles(); };

		const txtrLoader = new THREE.TextureLoader(loadingManager);
		txtrLoader.load('src/img/water/waternormals.jpg', (texture) =>
		{
			texture.magFilter = THREE.LinearFilter;
			texture.minFilter = THREE.LinearMipmapLinearFilter;
			texture.generateMipmaps = true;
			texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
			texture.offset.set(0, 0);
			texture.repeat.set(1, 1);
			texture.needsUpdate = true;
			this.waterNormalMap = texture;
		});
	}

	private initTiles(): void
	{
		this.waveGeometry = new THREE.PlaneGeometry(this.GrdSiz, this.GrdSiz, this.segNum, this.segNum);
		this.waveGeometry.rotateX(-Math.PI * 0.5);

		// Tweaked from the original 0.5 / 0.6: lower metalness lets a
		// touch of refracted scene colour through, slightly slicker
		// roughness sharpens highlights so the wave crests catch the
		// sun instead of flat-shading.
		this.waveMaterial = new THREE.MeshStandardMaterial({
			normalMap: this.waterNormalMap,
			metalness: 0.3,
			roughness: 0.45,
			name: 'ocean.001',
		});
		this.waveMaterial.onBeforeCompile = (shader) =>
		{
			shader.uniforms.time = this.uniforms.time;
			shader.uniforms.grid = this.uniforms.grid;
			shader.uniforms.noWaveCenter = { value: new THREE.Vector2(0.0, 0.0) };
			shader.uniforms.noWaveHalfSize = { value: new THREE.Vector2(180.0, 140.0) };
			shader.uniforms.noWaveHalfSize2 = { value: new THREE.Vector2(300.0, 330.0) };

			shader.vertexShader = shader.vertexShader.replace(
				'void main() {',
				`
				uniform float time;
				uniform float grid;
				uniform vec2 noWaveCenter;
				uniform vec2 noWaveHalfSize;
				uniform vec2 noWaveHalfSize2;
				varying float vHeight;
				varying float vInvisible;

				vec3 moveWave(vec3 p) {
					float num = 0.7;
					vec4 worldPos = modelMatrix * vec4(p, 1.0);
					vec3 retVal = p;
					float ang;
					float kzx = 360.0 / grid;

					ang = 50.0 * time + -1.0 * p.x * kzx + -2.0 * p.z * kzx;
					if (ang > 360.0) ang -= 360.0;
					ang = ang * 3.14159265 / 180.0;
					retVal.y = num * 3.0 * sin(ang);

					ang = 25.0 * time + -3.0 * p.x * kzx;
					if (ang > 360.0) ang -= 360.0;
					ang = ang * 3.14159265 / 180.0;
					retVal.y += num * 2.0 * sin(ang);

					ang = 15.0 * time - 3.0 * p.z * kzx;
					if (ang > 360.0) ang -= 360.0;
					ang = ang * 3.14159265 / 180.0;
					retVal.y += num * 2.0 * sin(ang);

					ang = 50.0 * time + 4.0 * p.x * kzx + 8.0 * p.z * kzx;
					if (ang > 360.0) ang -= 360.0;
					ang = ang * 3.14159265 / 180.0;
					retVal.y += num * 0.5 * sin(ang);

					ang = 50.0 * time + 8.0 * p.x * kzx;
					if (ang > 360.0) ang -= 360.0;
					ang = ang * 3.14159265 / 180.0;
					retVal.y += num * 0.5 * sin(ang);

					float inZone = 0.0;
					if (abs(worldPos.x - noWaveCenter.x) < noWaveHalfSize.x &&
							abs(worldPos.z - noWaveCenter.y) < noWaveHalfSize.y) {
						inZone = 1.0;
						retVal.y = -100.0;
					} else if (abs(worldPos.x - noWaveCenter.x) < noWaveHalfSize2.x &&
								abs(worldPos.z - noWaveCenter.y) < noWaveHalfSize2.y) {
						retVal.y = 8.5;
					} else {
						retVal.y += 3.6;
					}
					vInvisible = inZone;
					return retVal;
				}

				void main() {
				`
			);

			shader.vertexShader = shader.vertexShader.replace(
				'#include <begin_vertex>',
				`
				#include <begin_vertex>
				transformed = moveWave(transformed);
				vHeight = transformed.y;
				`
			);

			shader.fragmentShader = 'varying float vHeight;\nvarying float vInvisible;\n' + shader.fragmentShader;
			shader.fragmentShader = shader.fragmentShader.replace(
				'#include <color_fragment>',
				`
				#include <color_fragment>
				if(vInvisible > 0.5) { discard; }
				// Deeper teal in the troughs, brighter aqua at the crests -
				// gives the sea a livelier vertical gradient than the old
				// flat dark-blue → muted-blue mix.
				diffuseColor.rgb = mix(vec3(0.03, 0.10, 0.22), vec3(0.18, 0.42, 0.62), smoothstep(0.0, 6.0, vHeight));
				`
			);
		};

		// Lay out a GrdRCs x GrdRCs grid of tiles centered on origin.
		let zx = -0.5 * this.GrdRCs * this.GrdSiz + 0.5 * this.GrdSiz;
		for (let i = 0; i < this.GrdRCs; i++)
		{
			this.tileZOffsets[i] = zx;
			this.tileXOffsets[i] = zx;
			zx += this.GrdSiz;
		}

		let n = 0;
		for (let z = 0; z < this.GrdRCs; z++)
		{
			for (let x = 0; x < this.GrdRCs; x++)
			{
				const tile = new THREE.Mesh(this.waveGeometry, this.waveMaterial);
				tile.position.set(this.tileXOffsets[x], 12, -this.tileZOffsets[z]);
				// Outline pass skips ocean tiles - wave displacement
				// would otherwise generate constant Sobel noise across
				// the whole water surface every frame.
				tile.layers.set(RenderLayer.OutlineSkip);
				this.world.graphicsWorld.add(tile);
				this.tiles[n] = tile;
				n++;
			}
		}
		this.loaded = true;
	}

	// Compute the water height at world coordinate (x, z) and time t. Uses
	// the same multi-sine stack as the GLSL moveWave() above so boat
	// physics can ride the visible waves. Returns 'inner-zone' if the
	// sample is inside the no-wave dock area (caller decides what to do).
	public getWaveHeightAt(x: number, z: number, t: number): number | 'inner-zone'
	{
		const gridSize = this.GrdSiz;
		const segmentSize = gridSize / this.segNum;
		const totalSize = this.GrdRCs * gridSize;

		const oceanX = x + totalSize / 2;
		const oceanZ = z + totalSize / 2;
		const tileXIndex = Math.floor(oceanX / gridSize);
		const tileZIndex = Math.floor(oceanZ / gridSize);
		const tileIndex = tileZIndex * this.GrdRCs + tileXIndex;

		if (tileIndex < 0 || tileIndex >= this.tiles.length) return 12;
		const tile = this.tiles[tileIndex];
		if (!tile) return 12;

		const localXFull = x - tile.position.x;
		const localZFull = z - tile.position.z;
		const vertexX = Math.round((localXFull + gridSize / 2) / segmentSize) * segmentSize - gridSize / 2;
		const vertexZ = Math.round((localZFull + gridSize / 2) / segmentSize) * segmentSize - gridSize / 2;

		if (!isFinite(vertexX) || !isFinite(vertexZ))
		{
			return 8.5 + tile.position.y + 0.1;
		}

		const num = 0.7;
		const kzx = 360.0 / this.uniforms.grid.value;
		// Inline degrees -> radians using the cached DEG2RAD constant
		// (Math.PI / 180 = ~0.01745). Saves a function-call indirection
		// per sample, called 5x per vertex per query.
		const toRadians = (angle: number): number =>
			((angle > 360 ? angle - 360 : angle) * DEG2RAD);

		let y = num * 3.0 * Math.sin(toRadians(50.0 * t - 1.0 * vertexX * kzx - 2.0 * vertexZ * kzx));
		y += num * 2.0 * Math.sin(toRadians(25.0 * t - 3.0 * vertexX * kzx));
		y += num * 2.0 * Math.sin(toRadians(15.0 * t - 3.0 * vertexZ * kzx));
		y += num * 0.5 * Math.sin(toRadians(50.0 * t + 4.0 * vertexX * kzx + 8.0 * vertexZ * kzx));
		y += num * 0.5 * Math.sin(toRadians(50.0 * t + 8.0 * vertexX * kzx));

		const worldX = tile.position.x + vertexX;
		const worldZ = tile.position.z + vertexZ;
		const noWaveCenter = { x: 0.0, z: 0.0 };
		const noWaveHalfSize = { x: 180.0, z: 140.0 };
		const noWaveHalfSize2 = { x: 300.0, z: 330.0 };

		if (Math.abs(worldX - noWaveCenter.x) < noWaveHalfSize.x
			&& Math.abs(worldZ - noWaveCenter.z) < noWaveHalfSize.z)
		{
			return 'inner-zone';
		}
		if (Math.abs(worldX - noWaveCenter.x) < noWaveHalfSize2.x
			&& Math.abs(worldZ - noWaveCenter.z) < noWaveHalfSize2.z)
		{
			return 8.5 + tile.position.y + 0.1;
		}
		return y + 3.6 + tile.position.y + 0.1;
	}

	// Wall-clock seconds since the ocean was constructed. Mirrors the
	// `time` value the wave shader sees, so callers (Boat) can sample
	// getWaveHeightAt with a t that matches the visible waves.
	public getElapsedTime(): number
	{
		return (performance.now() - this.startTime) / 1000;
	}

	public update(_timeStep: number): void
	{
		if (!this.loaded) return;
		this.uniforms.time.value = this.getElapsedTime();

		if (this.waterNormalMap)
		{
			// Faster scroll than the original 5e-5 - the old rate was
			// barely perceptible, so the sea looked still even though
			// the geometry was moving. 4× brings the ripple drift up
			// to a recognisable surface-current speed.
			this.waterNormalMap.offset.x -= 0.0002;
			this.waterNormalMap.offset.y += 0.0001;
		}
	}
}
