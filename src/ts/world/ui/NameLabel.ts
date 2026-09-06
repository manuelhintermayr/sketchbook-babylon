import { TransformNode } from '@babylonjs/core';

import { WorldLabels } from './WorldLabels';
import { LabelObject } from './LabelRenderer';

// Pattern adapted from tkkaushik369/socketControl's PlayerClient.setUID
// (https://github.com/tkkaushik369/socketControl/.../PlayerClient.ts) -
// a screen-projected label hovered above the character. The .me
// flavour gets a different background colour so the player can spot
// themselves at a glance.
//
// Attachment goes through WorldLabels, which owns the label renderer,
// adds distance culling and per-style className support.

export interface AttachOptions
{
	maxDistance?: number;
	className?: string;
	feature?: string;
}

export function attachNameLabel(
	target: TransformNode,
	name: string,
	isPlayer: boolean = false,
	options: AttachOptions = {},
): LabelObject | undefined
{
	const className = options.className ?? ('name-label' + (isPlayer ? ' me' : ''));

	const manager = WorldLabels.getInstance();
	if (manager === undefined)
	{
		console.warn('attachNameLabel called before WorldLabels exists - label skipped.');
		return undefined;
	}

	return manager.register(target, name, {
		className,
		maxDistance: options.maxDistance,
		feature: options.feature,
	});
}
