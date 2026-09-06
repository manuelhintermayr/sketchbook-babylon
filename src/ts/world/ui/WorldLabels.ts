import { TransformNode, Vector3 } from '@babylonjs/core';

import { World } from '../World';
import { IUpdatable } from '../../interfaces/IUpdatable';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { LabelObject } from './LabelRenderer';

// Centralized registry for world-space DOM labels with distance
// culling. The LabelRenderer projects every name-tag div above its
// anchor (see World.labelRenderer); this class adds a per-frame
// visibility pass on top so labels hide when the camera is too far
// away to read them.
//
// Pattern adapted from manuelhintermayr-portfolio/three-js
// WorldLabels. The big win: animals (and any future ad-hoc labels) get
// distance culling without each entity having to know about the camera.

export interface RegisterOptions
{
	maxDistance?: number;
	className?: string;
	feature?: string;
	yOffset?: number;
}

// Default y-offset above the anchor's local origin. Was 1.2 - sat too
// far above NPCs when their model origin is roughly at the centre of
// the physics capsule. 0.5 places the tag right above the head.
const DEFAULT_LABEL_Y = 0.5;

// Default cull distance - labels disappear past 10 m. NPCs were
// unlimited before; 30 m turned out to still keep the whole spawn
// crowd labelled at once. 10 m gives an "only what I'm walking up to"
// readout. Animals override this to match (see WanderingAnimals).
const DEFAULT_MAX_DISTANCE = 10;

interface RegisteredLabel
{
	object: LabelObject;
	target: TransformNode;
	maxDistance: number;
	maxDistanceSq: number;
	feature: string | undefined;
}

const _temp = new Vector3();

export class WorldLabels implements IUpdatable
{
	public updateOrder: number = UpdateOrder.Labels;

	private static instance: WorldLabels | undefined;
	private world: World;
	private labels: RegisteredLabel[] = [];

	public static getInstance(): WorldLabels | undefined
	{
		return WorldLabels.instance;
	}

	constructor(world: World)
	{
		this.world = world;
		WorldLabels.instance = this;
	}

	// Builds the label div + anchor, registers it for distance culling,
	// returns the LabelObject. The anchor is a child of the target node,
	// so when the target is disposed the label leaves with it (the
	// renderer drops disposed anchors); callers that re-create
	// scenarios should also call unregister().
	public register(target: TransformNode, text: string, options: RegisterOptions = {}): LabelObject
	{
		const div = document.createElement('div');
		div.className = options.className ?? 'name-label';
		div.textContent = text;

		const object = this.world.labelRenderer.createLabel(div, target, new Vector3(0, options.yOffset ?? DEFAULT_LABEL_Y, 0));

		const maxDistance = options.maxDistance ?? DEFAULT_MAX_DISTANCE;
		this.labels.push({
			object,
			target,
			maxDistance,
			maxDistanceSq: maxDistance * maxDistance,
			feature: options.feature,
		});

		return object;
	}

	public unregister(object: LabelObject): void
	{
		const i = this.labels.findIndex((l) => l.object === object);
		if (i === -1) return;
		this.world.labelRenderer.remove(object);
		this.labels.splice(i, 1);
	}

	public update(_timeStep: number, _unscaledTimeStep: number): void
	{
		if (this.labels.length === 0) return;

		const camPos = this.world.camera.position;
		const params = this.world.params;

		for (let i = this.labels.length - 1; i >= 0; i--)
		{
			const entry = this.labels[i];

			// Target gone (scenario switch) - drop the entry; the
			// renderer already stopped drawing the disposed anchor.
			if (entry.target.isDisposed())
			{
				this.labels.splice(i, 1);
				continue;
			}

			// Feature gate (e.g. animal labels off by default).
			if (entry.feature !== undefined && params !== undefined && params[entry.feature] === false)
			{
				entry.object.visible = false;
				continue;
			}

			// Distance cull in squared space - skips one Math.sqrt per
			// label per frame.
			entry.target.computeWorldMatrix(true);
			_temp.copyFrom(entry.target.absolutePosition);
			const distSq = Vector3.DistanceSquared(_temp, camPos);
			entry.object.visible = distSq <= entry.maxDistanceSq;
		}
	}
}
