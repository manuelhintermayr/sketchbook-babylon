import * as THREE from 'three';

import {
	AnimalModel,
	ColorScheme,
	EYE_WHITE_MAT,
	FOOT_OFFSET,
	applyShadow,
	makeLeg,
	makeTail,
	mat,
} from './AnimalModels';

// Dog model construction. Same hierarchy contract as the cat builder
// (body, head, legs, tail, ears, mouthOpen, restY) but stockier
// proportions, a longer snout, floppy ears, and a shorter perky tail
// that defaults to an upward carry.

export function buildDogModel(scheme: ColorScheme): AnimalModel
{
	const root = new THREE.Group();
	const dog = new THREE.Group();
	dog.position.y = FOOT_OFFSET;
	root.add(dog);

	const furMat = mat(scheme.main);
	const darkMat = mat(scheme.dark);
	const lightMat = mat(scheme.light);
	const noseMat = mat(scheme.nose);
	const eyeMat = mat(scheme.eye);

	// Body - chunkier than the cat
	const body = new THREE.Group();
	const torso = new THREE.Mesh(new THREE.BoxGeometry(1.45, 1.05, 2.3), furMat);
	body.add(torso);
	const belly = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.45, 1.85), lightMat);
	belly.position.y = -0.32;
	body.add(belly);
	const restY = 1.15;
	body.position.y = restY;
	dog.add(body);

	// Head - longer snout than cat
	const head = new THREE.Group();
	head.position.set(0, 1.45, 1.4);
	dog.add(head);
	const headBox = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.95, 1.0), furMat);
	head.add(headBox);
	const snout = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.55, 0.7), furMat);
	snout.position.set(0, -0.2, 0.62);
	head.add(snout);
	const nose = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.18), noseMat);
	nose.position.set(0, -0.05, 0.96);
	head.add(nose);

	// Mouth-open block under the snout - shown while barking.
	const mouthOpen = new THREE.Mesh(
		new THREE.BoxGeometry(0.32, 0.18, 0.1),
		mat(0x2a0d10),
	);
	mouthOpen.position.set(0, -0.32, 0.86);
	mouthOpen.scale.y = 0.001;
	head.add(mouthOpen);

	// Eyes
	const makeEye = (x: number): THREE.Object3D =>
	{
		const g = new THREE.Group();
		const eye = new THREE.Mesh(new THREE.SphereGeometry(0.13, 8, 6), eyeMat);
		eye.scale.z = 0.6;
		g.add(eye);
		const shine = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), EYE_WHITE_MAT);
		shine.position.set(0.04, 0.05, 0.09);
		g.add(shine);
		g.position.set(x, 0.2, 0.42);
		head.add(g);
		return g;
	};
	makeEye(-0.27);
	makeEye(0.27);

	// Floppy ears (rotated outward, hanging forward)
	const makeEar = (x: number, side: number): THREE.Object3D =>
	{
		const eg = new THREE.Group();
		eg.position.set(x, 0.4, 0.0);
		const ear = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.55, 0.18), darkMat);
		ear.position.y = -0.25;
		eg.add(ear);
		eg.rotation.z = side * 0.32;
		head.add(eg);
		return eg;
	};
	const leftEar = makeEar(-0.45, 1);
	const rightEar = makeEar(0.45, -1);

	// Legs - same shape as cat but stockier
	const legs = {
		fl: makeLeg(furMat, lightMat, -0.5, 0.78),
		fr: makeLeg(furMat, lightMat, 0.5, 0.78),
		bl: makeLeg(furMat, lightMat, -0.5, -0.85),
		br: makeLeg(furMat, lightMat, 0.5, -0.85),
	};
	dog.add(legs.fl.thigh, legs.fr.thigh, legs.bl.thigh, legs.br.thigh);

	// Shorter perky tail (4 segs)
	const tail = makeTail(dog, 4, 1.3, -1.05, 0.24, furMat, darkMat, lightMat);
	// Default carry the dog tail upward
	if (tail.length > 0) tail[0].rotation.x = -0.6;

	applyShadow(root);
	return { group: root, body, head, tail, legs, ears: { left: leftEar, right: rightEar }, mouthOpen, restY };
}
