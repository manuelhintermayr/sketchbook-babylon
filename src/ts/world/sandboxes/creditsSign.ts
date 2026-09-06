import * as THREE from 'three';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';

// Shared FBX + texture loader for the swift502 credits sign that
// both v0.1 and v0.2 demos use. The FBX was authored as a
// 4-sub-mesh group (sign / grass / sign_shadow / credits); each
// sub-mesh gets its own textured Lambert material. The 1.7x clone
// in both demos uses the larger credits.png + insets the sign and
// credits panels along local Z by 0.2 to keep them visually flush.

export const SIGN_DIR = 'build/assets/credits_sign/';

export function loadSignFbx(): Promise<THREE.Group>
{
	return new Promise((resolve, reject) =>
	{
		new FBXLoader().load(
			SIGN_DIR + 'sign.fbx',
			(group) => resolve(group),
			undefined,
			(err) => reject(err),
		);
	});
}

export function applySignMaterials(root: THREE.Object3D, bigCredits: boolean): void
{
	const tex = (file: string): THREE.Texture =>
	{
		const t = new THREE.TextureLoader().load(SIGN_DIR + file);
		t.colorSpace = THREE.SRGBColorSpace;
		return t;
	};

	root.traverse((child) =>
	{
		const mesh = child as THREE.Mesh;
		if ((mesh as any).isMesh)
		{
			mesh.castShadow = true;
			mesh.receiveShadow = true;
		}
		switch (child.name)
		{
			case 'grass':
				mesh.material = new THREE.MeshLambertMaterial({
					map: tex('grass.png'),
					transparent: true,
					depthWrite: false,
					side: THREE.DoubleSide,
				});
				mesh.castShadow = false;
				break;
			case 'sign':
				mesh.material = new THREE.MeshLambertMaterial({
					map: tex('sign.png'),
				});
				if (bigCredits) mesh.translateZ(-0.2);
				break;
			case 'sign_shadow':
				mesh.material = new THREE.MeshLambertMaterial({
					map: tex('sign_shadow.png'),
					transparent: true,
				});
				mesh.renderOrder = -1;
				break;
			case 'credits':
				mesh.material = new THREE.MeshLambertMaterial({
					map: tex(bigCredits ? 'credits.png' : 'credits2.png'),
					transparent: true,
				});
				if (bigCredits) mesh.translateZ(-0.2);
				break;
		}
	});
}
