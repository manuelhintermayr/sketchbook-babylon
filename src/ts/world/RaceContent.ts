import { Color3, LinesMesh, MeshBuilder, TransformNode, Vector3 } from '@babylonjs/core';

import { World } from './World';
import { Scenario } from './scenarios/Scenario';
import { PathNode } from './scenarios/PathNode';
import { RaceCheckpoint } from './RaceCheckpoint';
import { IUpdatable } from '../interfaces/IUpdatable';
import { UpdateOrder } from '../enums/UpdateOrder';
import { CatmullRomCurve3 } from '../core/CatmullRomCurve3';
import * as Utils from '../core/FunctionLibrary';

// Curve-based lap tracking for race scenarios. Walks the scenario's AI
// first_node through its path graph, fits a CatmullRom curve, places a
// RaceCheckpoint at each path node, and watches a single tracked
// position (the camera by default) for plane crossings.
//
// Ported from tkkaushik369/socketControl. The original was multiplayer
// and tracked lapCount per Character; we collapse that to a single
// tracker since this engine is single-player.
export class RaceContent implements IUpdatable
{
	public updateOrder = UpdateOrder.Scenarios;

	public scenario: Scenario;
	public checkpointGroup: TransformNode;
	public curve: CatmullRomCurve3 | null = null;
	public checkpoints: RaceCheckpoint[] = [];

	// Single-player race state. socketControl held this on Character for
	// per-player tracking; our scenarios always have one human driver.
	private nextCheckpointIndex = -1;
	private lap = 0;
	private prevPos = new Vector3();
	private debugLine: LinesMesh | null = null;
	public onLap: ((lap: number) => void) | undefined;

	constructor(scenario: Scenario)
	{
		this.scenario = scenario;
		this.checkpointGroup = new TransformNode('raceCheckpoints', scenario.world.scene);
	}

	private get world(): World
	{
		return this.scenario.world;
	}

	// Build the curve and checkpoint planes from the AI spawn's first_node.
	// Returns true if a curve could be built (non-empty path).
	public launch(): boolean
	{
		const firstNodeName = this.findFirstNodeName();
		if (firstNodeName === null) return false;

		const allNodes = this.collectPathNodes(firstNodeName);
		if (allNodes.length === 0) return false;

		const points = allNodes.map(n =>
		{
			const v = new Vector3();
			Utils.getWorldPosition(n.object, v);
			return v;
		});

		this.curve = new CatmullRomCurve3(points, true, 'chordal', 0.5);

		// Visible debug-only line tracing the curve.
		const samples = this.curve.getPoints(200);
		this.debugLine = MeshBuilder.CreateLines('raceCurve', { points: samples }, this.world.scene);
		this.debugLine.color = Color3.FromHexString('#ffaa00');
		this.debugLine.parent = this.checkpointGroup;
		this.debugLine.setEnabled(false);

		this.checkpoints = points.map((p, i) => new RaceCheckpoint(p, i, this, this.curve!));
		this.checkpoints.forEach(cp => { cp.mesh.position.y += 0.01; });

		this.nextCheckpointIndex = 0;
		this.lap = 0;

		this.world.registerUpdatable(this);
		return true;
	}

	public dispose(): void
	{
		this.world.unregisterUpdatable(this);
		this.world.removeNode(this.checkpointGroup);
		this.checkpoints = [];
		this.curve = null;
		this.nextCheckpointIndex = -1;
	}

	// Toggle the visible checkpoint planes on/off (for debugging).
	public setCheckpointsVisible(visible: boolean): void
	{
		for (const cp of this.checkpoints) cp.mesh.setEnabled(visible);
		if (this.debugLine !== null) this.debugLine.setEnabled(visible);
	}

	public findClosestTOnCurve(target: Vector3, samples = 500): number
	{
		if (this.curve === null) return 0;
		let bestT = 0;
		let bestDist = Infinity;
		for (let i = 0; i <= samples; i++)
		{
			const u = i / samples;
			const p = this.curve.getPointAt(u);
			const d = Vector3.DistanceSquared(p, target);
			if (d < bestDist)
			{
				bestDist = d;
				bestT = u;
			}
		}
		return bestT;
	}

	public update(_timeStep: number): void
	{
		if (this.checkpoints.length === 0 || this.nextCheckpointIndex < 0) return;

		// Track the camera position - single-player follows the human
		// driver / character / vehicle through the camera operator.
		const currPos = this.world.camera.position;
		for (const cp of this.checkpoints)
		{
			if (cp.checkCross(this.prevPos, currPos))
			{
				this.onCheckpointPassed(cp.index);
			}
		}
		this.prevPos.copyFrom(currPos);
	}

	private onCheckpointPassed(index: number): void
	{
		if (index !== this.nextCheckpointIndex) return;

		this.nextCheckpointIndex = (this.nextCheckpointIndex + 1) % this.checkpoints.length;
		if (this.nextCheckpointIndex === 0)
		{
			this.lap++;
			this.onLap?.(this.lap);
			this.world.sfxBus.playLap();
		}
		else
		{
			this.world.sfxBus.playCheckpoint();
		}
	}

	private findFirstNodeName(): string | null
	{
		// Look in the scenario's spawn points for the first AI driver's
		// firstAINode - same convention socketControl uses, and matches
		// how our Boat Race lap tracker found its starting node.
		for (const sp of this.scenario.spawnPoints)
		{
			// VehicleSpawnPoint stores firstAINode for AI-driver entries.
			const candidate = (sp as { firstAINode?: string }).firstAINode;
			if (candidate) return candidate;
		}
		// Fallback: walk the scenario rootNode's userData.
		const rn = this.scenario.rootNode;
		if (rn === undefined) return null;
		for (const child of rn.getChildren())
		{
			const ud = Utils.userData(child);
			if (ud?.first_node) return ud.first_node as string;
		}
		return null;
	}

	private collectPathNodes(firstNodeName: string): PathNode[]
	{
		for (const path of this.world.paths)
		{
			const start = path.nodes[firstNodeName];
			if (start === undefined) continue;
			const out: PathNode[] = [];
			let node: PathNode | undefined = start;
			while (node !== undefined && (out.length === 0 || node !== start))
			{
				out.push(node);
				node = node.nextNode;
			}
			return out;
		}
		return [];
	}
}
