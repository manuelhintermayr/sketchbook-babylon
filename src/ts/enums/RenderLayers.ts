// Camera/object layers used for selective rendering passes.
// THREE.Object3D.layers is a 32-bit bitmask; a mesh is rendered when
// (mesh.layers & camera.layers) != 0.
export enum RenderLayer
{
	// Layer 0 - the default. Every mesh is on it unless moved off.
	// Listed here for documentation; not normally written explicitly.
	Default = 0,

	// Layer 1 - meshes opt INTO this layer to be skipped by the outline
	// depth pre-pass. Background geometry that would either look ugly
	// outlined (grass blades, water tiles) or has no real depth edges
	// the player benefits from (sky shell, stars, distant celestials)
	// belongs here. The main camera enables this layer so they still
	// render normally; OutlineEffect.renderPass temporarily strips the
	// bit before its depth pre-pass.
	OutlineSkip = 1,
}
