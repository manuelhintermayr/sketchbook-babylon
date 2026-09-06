import * as THREE from 'three';

import {
	AnimalModel,
	BLACK_MAT,
	ColorScheme,
	EYE_WHITE_MAT,
	FOOT_OFFSET,
	applyShadow,
	makeLeg,
	makeTail,
	mat,
} from './AnimalModels';

// Cat model construction. Pattern adapted from
// manuelhintermayr-portfolio/low-poly-cat-game (HTML demo). Builds the
// hierarchy WanderingAnimals expects (body, head, legs, tail, ears,
// mouthOpen, restY) so the animator can drive idle / walk / run /
// jump poses without poking into nested children.

export function buildCatModel(scheme: ColorScheme): AnimalModel
{
	const root = new THREE.Group();
	const cat = new THREE.Group();
	cat.position.y = FOOT_OFFSET;
	root.add(cat);

	const furMat = mat(scheme.main);
	const darkMat = mat(scheme.dark);
	const whiteMat = mat(scheme.light);
	const noseMat = mat(scheme.nose);
	const eyeMat = mat(scheme.eye);

	// Body
	const body = new THREE.Group();
	const torso = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.95, 2.1), furMat);
	body.add(torso);
	const belly = new THREE.Mesh(new THREE.BoxGeometry(0.95, 0.4, 1.7), whiteMat);
	belly.position.y = -0.3;
	body.add(belly);
	const restY = 1.05;
	body.position.y = restY;
	cat.add(body);

	// Head
	const head = new THREE.Group();
	head.position.set(0, 1.35, 1.25);
	cat.add(head);
	const headBox = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.95, 0.95), furMat);
	head.add(headBox);
	const snout = new THREE.Mesh(new THREE.BoxGeometry(0.65, 0.45, 0.45), whiteMat);
	snout.position.set(0, -0.18, 0.5);
	head.add(snout);
	const nose = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.14, 4), noseMat);
	nose.position.set(0, 0.0, 0.76);
	nose.rotation.x = Math.PI / 2;
	nose.rotation.y = Math.PI / 4;
	head.add(nose);

	// Mouth-open block - hidden by default, scaled up while meowing
	// to show an open mouth. Sits flat against the snout's underside.
	const mouthOpen = new THREE.Mesh(
		new THREE.BoxGeometry(0.22, 0.18, 0.07),
		mat(0x2a0d10),
	);
	mouthOpen.position.set(0, -0.27, 0.72);
	mouthOpen.scale.y = 0.001;
	head.add(mouthOpen);

	// Eyes (simple - no pupil tracking in v1)
	const makeEye = (x: number): THREE.Object3D =>
	{
		const g = new THREE.Group();
		const eye = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), eyeMat);
		eye.scale.z = 0.55;
		g.add(eye);
		const pupil = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.22, 0.04), BLACK_MAT);
		pupil.position.z = 0.09;
		g.add(pupil);
		const shine = new THREE.Mesh(new THREE.SphereGeometry(0.04, 6, 4), EYE_WHITE_MAT);
		shine.position.set(0.05, 0.07, 0.11);
		g.add(shine);
		g.position.set(x, 0.15, 0.4);
		head.add(g);
		return g;
	};
	makeEye(-0.27);
	makeEye(0.27);

	// Ears
	const makeEar = (x: number, side: number): THREE.Object3D =>
	{
		const eg = new THREE.Group();
		eg.position.set(x, 0.55, -0.05);
		const outer = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.55, 4), furMat);
		eg.add(outer);
		const inner = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.4, 4), mat(scheme.nose));
		inner.position.set(0, -0.05, 0.05);
		eg.add(inner);
		eg.rotation.z = side * 0.18;
		eg.rotation.x = -0.08;
		head.add(eg);
		return eg;
	};
	const leftEar = makeEar(-0.34, 1);
	const rightEar = makeEar(0.34, -1);

	// Legs
	const legs = {
		fl: makeLeg(furMat, whiteMat, -0.45, 0.7),
		fr: makeLeg(furMat, whiteMat, 0.45, 0.7),
		bl: makeLeg(furMat, whiteMat, -0.45, -0.75),
		br: makeLeg(furMat, whiteMat, 0.45, -0.75),
	};
	cat.add(legs.fl.thigh, legs.fr.thigh, legs.bl.thigh, legs.br.thigh);

	// Tail - 7 segments for the iconic flowing cat tail
	const tail = makeTail(cat, 7, 1.15, -1.0, 0.22, furMat, darkMat, whiteMat);

	applyShadow(root);
	return { group: root, body, head, tail, legs, ears: { left: leftEar, right: rightEar }, mouthOpen, restY };
}
