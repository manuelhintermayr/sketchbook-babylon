import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { World } from '../World';
import { IUpdatable } from '../../interfaces/IUpdatable';
import { UpdateOrder } from '../../enums/UpdateOrder';

// Centralized registry for CSS2D world-space labels with distance
// culling. Sketchbook already uses three's CSS2DRenderer to project
// every name-tag div above its anchor (see World.labelRenderer); this
// class adds a per-frame visibility pass on top so labels hide when
// the camera is too far away to read them.
//
// Pattern adapted from manuelhintermayr-portfolio/three-js
// WorldLabels - ported from a manual screen-projection system to one
// that piggy-backs on Sketchbook's existing CSS2D pipeline. The big
// win: animals (and any future ad-hoc labels) get distance culling
// without each entity having to know about the camera.

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
	object: CSS2DObject;
	target: THREE.Object3D;
	maxDistance: number;
	maxDistanceSq: number;
	feature: string | undefined;
}

const _temp = new THREE.Vector3();

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

	// Builds the CSS2DObject + div, registers it for distance culling,
	// returns the CSS2DObject so the caller can position it (typically
	// by adding it as a child of the anchor object3D). When the anchor
	// is removed from graphicsWorld the label leaves with it; callers
	// that re-create scenarios should also call unregister().
	public register(target: THREE.Object3D, text: string, options: RegisterOptions = {}): CSS2DObject
	{
		const div = document.createElement('div');
		div.className = options.className ?? 'name-label';
		div.textContent = text;

		const object = new CSS2DObject(div);
		object.position.set(0, options.yOffset ?? DEFAULT_LABEL_Y, 0);
		target.add(object);

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

	public unregister(object: CSS2DObject): void
	{
		const i = this.labels.findIndex((l) => l.object === object);
		if (i === -1) return;
		const entry = this.labels[i];
		entry.target.remove(entry.object);
		this.labels.splice(i, 1);
	}

	public update(_timeStep: number, _unscaledTimeStep: number): void
	{
		if (this.labels.length === 0) return;

		const camPos = this.world.camera.position;
		const params = this.world.params;

		for (const entry of this.labels)
		{
			// Toggle the three.js Object3D `visible` flag - CSS2DRenderer
			// resets `element.style.display` to '' or 'none' every frame
			// based on it (see CSS2DRenderer.js render loop), so
			// overriding the inline style directly would be wiped on the
			// very next render pass.

			// Feature gate (e.g. animal labels off by default).
			if (entry.feature !== undefined && params !== undefined && params[entry.feature] === false)
			{
				entry.object.visible = false;
				continue;
			}

			// Distance cull in squared space - skips one Math.sqrt per
			// label per frame. CSS2D anchors via the target's world
			// position; getWorldPosition reads matrixWorld which three's
			// render loop has already updated this frame.
			entry.target.getWorldPosition(_temp);
			const distSq = _temp.distanceToSquared(camPos);
			entry.object.visible = distSq <= entry.maxDistanceSq;
		}
	}
}
