import { AbstractMesh, Node } from '@babylonjs/core';

// Selective rendering passes. three used Object3D.layers bitmasks for
// this; Babylon meshes carry a layerMask too, but the only consumer is
// the outline depth pre-pass, whose render target takes a predicate.
// A metadata flag is simpler than juggling camera layer masks.
export enum RenderLayer
{
	// Layer 0 - the default. Every mesh is on it unless moved off.
	Default = 0,

	// Meshes opt INTO this layer to be skipped by the outline depth
	// pre-pass. Background geometry that would either look ugly
	// outlined (grass blades, water tiles) or has no real depth edges
	// the player benefits from (sky shell, stars, distant celestials)
	// belongs here.
	OutlineSkip = 1,
}

const FLAG = 'outlineSkip';

// Flags a node (and every mesh below it) as OutlineSkip.
export function markOutlineSkip(node: Node): void
{
	const apply = (n: Node): void =>
	{
		if (n.metadata === null || n.metadata === undefined) n.metadata = {};
		n.metadata[FLAG] = true;
	};
	apply(node);
	for (const child of node.getDescendants(false)) apply(child);
}

export function isOutlineSkip(mesh: AbstractMesh): boolean
{
	return mesh.metadata?.[FLAG] === true;
}
