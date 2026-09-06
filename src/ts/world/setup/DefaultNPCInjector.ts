import * as THREE from 'three';

import { World } from '../World';
import { Path } from '../scenarios/Path';
import { NPCSpawnPoint } from '../spawn/NPCSpawnPoint';
import { getDefaultDialogs } from '../scenarios/defaultDialogs';

// Hand-placed Anna / Ben / Carla / Dieter NPCs around the Inthenew
// default spawn - gives the world some visible occupants without
// authoring markers in Blender. Tied to the default scenario so they
// re-spawn alongside it and clear on switch like other entities.
//
// Anna and Ben walk a synthetic 4-node loop in opposite directions
// (built here as a userData-tagged path so it goes through the same
// FollowPath consumer the GLB-authored paths use). Carla and Dieter
// stand and watch the player spawn.
//
// Sandboxes have their own minimal layouts where these coordinates
// don't make sense, so the whole thing is gated on the map switcher.
export function injectDefaultSceneNPCs(world: World): void
{
	const stored = localStorage.getItem('sketchbook.map');
	if (stored && stored !== 'inthenew') return;

	const defaultScenario = world.scenarios.find((s) => s.id === 'default');
	if (defaultScenario === undefined) return;

	// Build a synthetic 4-node loop near the spawn and register it
	// as a Path so two NPCs can FollowPath their way around it.
	// Same pattern Test3Scene uses (data:'pathNode', nextNode/
	// previousNode userData wiring) so we don't need a new code
	// path on the consumer side.
	const pathRoot = new THREE.Object3D();
	pathRoot.userData = { data: 'path', name: 'default_npc_loop' };
	const loopNodes: { name: string, prev: string, next: string, x: number, z: number }[] = [
		{ name: 'npc_node_1', prev: 'npc_node_4', next: 'npc_node_2', x:  8, z:  5 },
		{ name: 'npc_node_2', prev: 'npc_node_1', next: 'npc_node_3', x:  8, z: -5 },
		{ name: 'npc_node_3', prev: 'npc_node_2', next: 'npc_node_4', x: -8, z: -5 },
		{ name: 'npc_node_4', prev: 'npc_node_3', next: 'npc_node_1', x: -8, z:  5 },
	];
	for (const n of loopNodes)
	{
		const node = new THREE.Object3D();
		node.name = n.name;
		node.position.set(n.x, 18, n.z);
		node.userData = { data: 'pathNode', name: n.name, previousNode: n.prev, nextNode: n.next };
		pathRoot.add(node);
	}
	defaultScenario.rootNode.add(pathRoot);
	world.paths.push(new Path(pathRoot));

	// Two walking NPCs (Anna, Ben) trace the loop in opposite
	// directions; two standing NPCs (Carla, Dieter) flank the
	// player spawn so the area still has visible occupants.
	const npcSpawns: { x: number, y: number, z: number, faceX?: number, faceZ?: number, name: string, firstNode?: string }[] = [
		{ x:  8, y: 18, z:  5, name: 'Anna',   firstNode: 'npc_node_1' },
		{ x: -8, y: 18, z: -5, name: 'Ben',    firstNode: 'npc_node_3' },
		{ x:  3, y: 18, z:  1, faceX: 0,  faceZ: -1, name: 'Carla'  },
		{ x: -3, y: 18, z:  1, faceX: 0,  faceZ: -1, name: 'Dieter' },
	];

	// Hand-written dialogs from defaultDialogs.ts; absent NPCs
	// just stand silent (no prompt appears). getDefaultDialogs()
	// resolves text via i18n at lookup time, so a scenario
	// restart picks up a new locale.
	const dialogs = getDefaultDialogs();

	for (const s of npcSpawns)
	{
		const marker = new THREE.Object3D();
		marker.position.set(s.x, s.y, s.z);
		if (s.faceX !== undefined && s.faceZ !== undefined)
		{
			marker.lookAt(s.x + s.faceX, s.y, s.z + s.faceZ);
		}
		marker.userData.name = s.name;
		if (s.firstNode !== undefined) marker.userData.first_node = s.firstNode;
		defaultScenario.rootNode.add(marker);

		const dialogEntry = dialogs[s.name];
		defaultScenario.spawnPoints.push(
			new NPCSpawnPoint(marker, dialogEntry !== undefined
				? { dialog: dialogEntry.dialog, role: dialogEntry.role }
				: undefined),
		);
	}
}
