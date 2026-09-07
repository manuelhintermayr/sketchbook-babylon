import { Color3, Mesh, StandardMaterial, Vector3 } from '@babylonjs/core';

import { World } from '../World';
import { LoadedModel, LoadingManager } from '../../core/LoadingManager';
import * as Utils from '../../core/FunctionLibrary';
import { CollisionGroups } from '../../enums/CollisionGroups';
import { BoxCollider } from '../../physics/colliders/BoxCollider';
import { TrimeshCollider } from '../../physics/colliders/TrimeshCollider';
import { CylinderCollider } from '../../physics/colliders/CylinderCollider';
import { Scenario } from '../scenarios/Scenario';
import { Path } from '../scenarios/Path';
import { Ocean } from '../Ocean';
import { Grass } from '../Grass';
import { Speaker } from '../audio/Speaker';
import { addMapSwitcher } from '../setup/MapSwitcher';
import { injectDefaultSceneNPCs } from '../setup/DefaultNPCInjector';
import { injectWanderingAnimals, injectFlyingBirds, injectButterflies } from '../setup/AnimalInjector';

const _worldPos = new Vector3();

// Walks a freshly-loaded model (real .glb or sandbox-synthesised) and
// dispatches each node by its userData.data tag to the right entity
// constructor. Box / trimesh / cylinder physics shapes become static
// Havok bodies; paths and scenarios collect into world.paths /
// world.scenarios; positional audio markers spawn Speakers; ocean /
// grass material names trigger their respective shader entities.
//
// After the traversal finishes the map switcher and the procedural
// NPC + animal injectors run, and the default scenario is launched if
// one was authored.
export function loadScene(world: World, loadingManager: LoadingManager, model: LoadedModel): void
{
	// Map switcher first - the dropdown lands at the top of the
	// 'Map & Scenarios' folder so the player picks the world before
	// the per-map scenario buttons that get added during the traversal.
	addMapSwitcher(world);

	const scene = world.scene;

	Utils.traverse(model.root, (child) =>
	{
		if (Utils.isRenderableMesh(child))
		{
			Utils.setupMeshProperties(child);
			world.sky.registerShadowCaster(child);

			const material = child.material;
			const materialName = material !== null ? material.name : '';

			if (materialName === 'ocean' || materialName === 'ocean.001')
			{
				world.ocean = new Ocean(child, world);
				world.registerUpdatable(world.ocean);
				// The source plane is replaced by the ocean tiles and hidden.
				world.sky.unregisterShadowCaster(child);
			}

			// socketControl-style instanced grass field. Any mesh in
			// world.glb whose material is named 'grass' becomes a
			// shimmering 300k-blade lawn anchored at the mesh's
			// transform; the original mesh stays as the base.
			//
			// Replace the GLB-shipped material wholesale - the original
			// carries either a near-black diffuse map or fully-black
			// PBR factors, which made the meadow look black past the
			// LOD cut where the instanced blades drop out. A flat
			// mid-green lambert reads as continuous lawn from any
			// distance; nothing else inspects this material.
			if (materialName === 'grass')
			{
				const instances = material !== null ? Utils.materialUserData(material).instances : undefined;
				const lawn = new StandardMaterial('grass', scene);
				lawn.diffuseColor = Utils.linearColorFromHex(0x4a8a3a);
				lawn.specularColor = Color3.Black();
				child.material = lawn;
				const grass = new Grass(child, world, typeof instances === 'number' ? instances : undefined);
				world.add(grass);
			}

			// Inthenew's map tags the moon-surface mesh with name
			// 'Layer0_001' (an Adobe Illustrator export artifact).
			// Inthenew loaded an external Farmers Almanac photo here;
			// we use the DALL-E moon-with-flowers texture instead.
			if (child.name === 'Layer0_001')
			{
				const moonMat = new StandardMaterial('moonSurface', scene);
				moonMat.disableLighting = true;
				moonMat.emissiveTexture = Utils.loadColorTexture(scene, 'src/img/moon-with-flowers.png', false);
				child.material = moonMat;
			}
		}

		const ud = Utils.userData(child);
		if (ud.data === undefined) return;

		if (ud.data === 'physics' && ud.type !== undefined && child instanceof Mesh)
		{
			// The physics markers double as the body's transform node -
			// their position/rotation is the body pose, their scale the
			// shape size (boxes / cylinders) or gets baked into the
			// triangle soup (trimesh).
			if (ud.type === 'box')
			{
				new BoxCollider(scene, {
					size: child.scaling.clone(),
					node: child,
					collisionFilterMask: ~CollisionGroups.TrimeshColliders,
				});
			}
			else if (ud.type === 'trimesh')
			{
				new TrimeshCollider(scene, child, {});
			}
			else if (ud.type === 'cylinder')
			{
				// socketControl-style cylinder shape. Authored
				// scale.x is read as radius, scale.y as height
				// (Sketchbook convention - empties are
				// uniformly scaled and rotated).
				new CylinderCollider(scene, {
					radius: child.scaling.x,
					height: child.scaling.y,
					segment: 12,
					node: child,
					collisionFilterMask: ~CollisionGroups.TrimeshColliders,
				});
			}

			// Hidden collision geometry must not cast shadows either. The
			// glTF loader splits multi-material markers into one child
			// mesh per primitive, so hide those too.
			world.sky.unregisterShadowCaster(child);
			child.isVisible = false;
			child.isPickable = false;
			for (const primitive of child.getChildMeshes(false))
			{
				primitive.isVisible = false;
				primitive.isPickable = false;
			}
		}

		if (ud.data === 'path')
		{
			world.paths.push(new Path(child as any));
		}

		if (ud.data === 'scenario')
		{
			world.scenarios.push(new Scenario(child as any, world));
		}

		// socketControl-style positional audio source. The map
		// marker carries the audio asset path; Speaker handles
		// the autoplay-policy gating so multiple sources start
		// together on the first user gesture.
		if (ud.data === 'speaker' && typeof ud.audio === 'string')
		{
			const sp = new Speaker(ud.audio, world);
			Utils.getWorldPosition(child as any, _worldPos);
			sp.position.copyFrom(_worldPos);
			world.add(sp);
		}
	});

	world.addNode(model.root);

	// Hand-placed NPCs around the Inthenew default spawn - gives the
	// world some visible occupants without authoring markers in
	// Blender. Tied to the default scenario so they re-spawn alongside
	// it and get cleared on switch like other entities.
	injectDefaultSceneNPCs(world);

	// Wandering dogs / cats around the spawn area - only on the
	// Inthenew map (the sandboxes are testing zones with their own
	// flat layouts, animals would just walk off the edge).
	injectWanderingAnimals(world);

	// Flying birds + per-bird positional chirp synths. Spawned on
	// every map - they orbit at altitude so the layout below them
	// doesn't matter, and the chirps replace the global bird-chirp
	// synth that used to live in AmbientSound.
	injectFlyingBirds(world);

	// Ambient butterflies around the player. Pure visual fluff -
	// distance-culled at 30 m so they cost nothing when far away.
	injectButterflies(world);

	// Launch default scenario
	let defaultScenarioID: string | undefined;
	for (const scenario of world.scenarios)
	{
		if (scenario.default)
		{
			defaultScenarioID = scenario.id;
			break;
		}
	}
	if (defaultScenarioID !== undefined) world.launchScenario(defaultScenarioID, loadingManager);
}
