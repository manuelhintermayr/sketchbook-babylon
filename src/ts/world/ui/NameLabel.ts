import * as THREE from 'three';
import { CSS2DObject } from 'three/examples/jsm/renderers/CSS2DRenderer.js';

import { WorldLabels } from './WorldLabels';

// Pattern adapted from tkkaushik369/socketControl's PlayerClient.setUID
// (https://github.com/tkkaushik369/socketControl/.../PlayerClient.ts) -
// a CSS2DObject hovered above the character at +1.2 units. The .me
// flavour gets a different background colour so the player can spot
// themselves at a glance.
//
// As of the portfolio polish pass, attachment goes through WorldLabels
// when an instance exists - that adds distance culling + per-style
// className support without changing the call site. If WorldLabels
// hasn't been constructed yet (very early bootstrap, headless tests)
// we fall back to the old direct-attach path so this remains safe to
// call from anywhere.

export interface AttachOptions
{
	maxDistance?: number;
	className?: string;
	feature?: string;
}

export function attachNameLabel(
	target: THREE.Object3D,
	name: string,
	isPlayer: boolean = false,
	options: AttachOptions = {},
): CSS2DObject
{
	const className = options.className ?? ('name-label' + (isPlayer ? ' me' : ''));

	const manager = WorldLabels.getInstance();
	if (manager !== undefined)
	{
		return manager.register(target, name, {
			className,
			maxDistance: options.maxDistance,
			feature: options.feature,
		});
	}

	// Fallback path - pre-WorldLabels construction or test env. Same
	// behaviour the original implementation had: build a CSS2DObject,
	// attach as child, no culling.
	const div = document.createElement('div');
	div.className = className;
	div.textContent = name;
	const label = new CSS2DObject(div);
	label.position.set(0, 0.5, 0);
	target.add(label);
	return label;
}
