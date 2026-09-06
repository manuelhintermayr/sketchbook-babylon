import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { World } from '../World';
import { LoadingManager } from '../../core/LoadingManager';
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

// Walks a freshly-loaded GLTF scene (real or sandbox-synthesised) and
// dispatches each node by its userData.data tag to the right entity
// constructor. Box / trimesh / cylinder physics shapes register on
// the cannon world; paths and scenarios collect into world.paths /
// world.scenarios; positional audio markers spawn Speakers; ocean /
// grass material names trigger their respective shader entities.
//
// After the traversal finishes the scene mesh is added to the
// graphicsWorld, the map switcher and the procedural NPC + animal
// injectors run, and the default scenario is launched if one was
// authored. Same flow as before, just lifted out of World.
export function loadScene(world: World, loadingManager: LoadingManager, gltf: any): void
{
	// Map switcher first - the dropdown lands at the top of the
	// 'Map & Scenarios' folder so the player picks the world before
	// the per-map scenario buttons that get added during the traversal.
	addMapSwitcher(world);

	gltf.scene.traverse((child) =>
	{
		if (!child.hasOwnProperty('userData')) return;

		if (child.type === 'Mesh')
		{
			// TrimeshCollider needs non-indexed geometry. Only convert
			// when actually indexed - sandbox scenes build their
			// BufferGeometries manually without an index, in which case
			// toNonIndexed() is a no-op that warns.
			if (child.geometry.index !== null) child.geometry = child.geometry.toNonIndexed();
			Utils.setupMeshProperties(child);
			world.sky.csm.setupMaterial(child.material);

			if (child.material.name === 'ocean' || child.material.name === 'ocean.001')
			{
				world.ocean = new Ocean(child, world);
				world.registerUpdatable(world.ocean);
			}

			// socketControl-style instanced grass field. Any mesh in
			// world.glb whose material is named 'grass' becomes a
			// shimmering 300k-blade lawn anchored at the mesh's
			// transform; the original mesh stays as the base.
			//
			// Replace the GLB-shipped material wholesale - the original
			// carries either a near-black diffuse map or fully-black
			// PBR factors, which made the meadow look black past the
			// 30 m LOD cut where the instanced blades drop out. A flat
			// mid-green Lambert reads as continuous lawn from any
			// distance; Grass shadow handling on the chassis is
			// unaffected because nothing else inspects this material.
			if (child.material.name === 'grass')
			{
				child.material = new THREE.MeshLambertMaterial({
					color: 0x4a8a3a,
					name: 'grass',
				});
				const grass = new Grass(child, world);
				world.add(grass);
			}

			// Inthenew's map tags the moon-surface mesh with name
			// 'Layer0_001' (an Adobe Illustrator export artifact).
			// Inthenew loaded an external Farmers Almanac photo here;
			// we use the DALL-E moon-with-flowers texture instead.
			if (child.name === 'Layer0_001')
			{
				const tex = new THREE.TextureLoader().load('src/img/moon-with-flowers.png');
				tex.colorSpace = THREE.SRGBColorSpace;
				child.material = new THREE.MeshBasicMaterial({ map: tex });
			}
		}

		if (!child.userData.hasOwnProperty('data')) return;

		if (child.userData.data === 'physics' && child.userData.hasOwnProperty('type'))
		{
			// Convex doesn't work! Stick to boxes!
			if (child.userData.type === 'box')
			{
				const phys = new BoxCollider({ size: new THREE.Vector3(child.scale.x, child.scale.y, child.scale.z) });
				phys.body.position.copy(new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
				phys.body.quaternion.copy(new CANNON.Quaternion(child.quaternion.x, child.quaternion.y, child.quaternion.z, child.quaternion.w));
				phys.body.updateAABB();

				phys.body.shapes.forEach((shape) =>
				{
					shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
				});

				world.physicsWorld.addBody(phys.body);
			}
			else if (child.userData.type === 'trimesh')
			{
				const phys = new TrimeshCollider(child, {});
				world.physicsWorld.addBody(phys.body);
			}
			else if (child.userData.type === 'cylinder')
			{
				// socketControl-style cylinder shape. Authored
				// scale.x is read as radius, scale.y as height
				// (Sketchbook convention - empties are
				// uniformly scaled and rotated).
				const phys = new CylinderCollider({
					radius: child.scale.x,
					height: child.scale.y,
					segment: 12,
				});
				phys.body.position.copy(new CANNON.Vec3(child.position.x, child.position.y, child.position.z));
				phys.body.quaternion.copy(new CANNON.Quaternion(child.quaternion.x, child.quaternion.y, child.quaternion.z, child.quaternion.w));
				phys.body.updateAABB();
				phys.body.shapes.forEach((shape) =>
				{
					shape.collisionFilterMask = ~CollisionGroups.TrimeshColliders;
				});
				world.physicsWorld.addBody(phys.body);
			}

			child.visible = false;
		}

		if (child.userData.data === 'path')
		{
			world.paths.push(new Path(child));
		}

		if (child.userData.data === 'scenario')
		{
			world.scenarios.push(new Scenario(child, world));
		}

		// socketControl-style positional audio source. The map
		// marker carries the audio asset path; Speaker handles
		// the autoplay-policy gating so multiple sources start
		// together on the first user gesture.
		if (child.userData.data === 'speaker' && typeof child.userData.audio === 'string')
		{
			const sp = new Speaker(child.userData.audio, world);
			sp.position.copy(child.getWorldPosition(new THREE.Vector3()));
			world.add(sp);
		}
	});

	world.graphicsWorld.add(gltf.scene);

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
