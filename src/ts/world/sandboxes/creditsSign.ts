import { Scene, StandardMaterial, Texture, TransformNode } from '@babylonjs/core';

import { LoadedModel, loadModel } from '../../core/LoadingManager';
import * as Utils from '../../core/FunctionLibrary';

// Shared loader for the swift502 credits sign that both v0.1 and v0.2
// demos use. The original FBX (kept next to the GLB) was converted to
// glTF for the Babylon loader; it's a 4-sub-mesh group (sign / grass /
// sign_shadow / credits) and each sub-mesh gets its own textured
// lambert-style material. The 1.7x clone in both demos uses the
// larger credits.png + insets the sign and credits panels along local
// Z by 0.2 to keep them visually flush.

export const SIGN_DIR = 'build/assets/credits_sign/';

export function loadSign(scene: Scene): Promise<LoadedModel>
{
	return loadModel(scene, SIGN_DIR + 'sign.glb');
}

export function applySignMaterials(scene: Scene, root: TransformNode, bigCredits: boolean): void
{
	// glTF UVs start top-left, so the textures load un-flipped - same
	// convention the glTF loader itself uses.
	const textured = (file: string, transparent: boolean): StandardMaterial =>
	{
		const material = new StandardMaterial(file, scene);
		const texture: Texture = Utils.loadTexture(scene, SIGN_DIR + file, false);
		material.diffuseTexture = texture;
		material.specularColor.set(0, 0, 0);
		if (transparent)
		{
			texture.hasAlpha = true;
			material.useAlphaFromDiffuseTexture = true;
		}
		return material;
	};

	for (const mesh of root.getChildMeshes(false))
	{
		mesh.receiveShadows = true;
		switch (mesh.name)
		{
			case 'grass':
			{
				const material = textured('grass.png', true);
				material.disableDepthWrite = true;
				material.backFaceCulling = false;
				mesh.material = material;
				break;
			}
			case 'sign':
				mesh.material = textured('sign.png', false);
				if (bigCredits) mesh.position.z -= 0.2;
				break;
			case 'sign_shadow':
				mesh.material = textured('sign_shadow.png', true);
				// Drawn first among the transparent meshes, like
				// renderOrder = -1 did.
				mesh.alphaIndex = -1;
				break;
			case 'credits':
				mesh.material = textured(bigCredits ? 'credits.png' : 'credits2.png', true);
				if (bigCredits) mesh.position.z -= 0.2;
				break;
		}
	}
}
