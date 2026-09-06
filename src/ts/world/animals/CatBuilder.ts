import { Scene, TransformNode } from '@babylonjs/core';

import {
	AnimalModel,
	ColorScheme,
	FOOT_OFFSET,
	applyShadow,
	blackMat,
	box,
	cone,
	eyeWhiteMat,
	group,
	makeLeg,
	makeTail,
	mat,
	sphere,
} from './AnimalModels';

// Cat model construction. Pattern adapted from
// manuelhintermayr-portfolio/low-poly-cat-game (HTML demo). Builds the
// hierarchy WanderingAnimals expects (body, head, legs, tail, ears,
// mouthOpen, restY) so the animator can drive idle / walk / run /
// jump poses without poking into nested children.

export function buildCatModel(scene: Scene, scheme: ColorScheme): AnimalModel
{
	const root = group(scene, 'cat');
	const cat = group(scene, 'catSpecies', root);
	cat.position.y = FOOT_OFFSET;

	const furMat = mat(scene, scheme.main);
	const darkMat = mat(scene, scheme.dark);
	const whiteMat = mat(scene, scheme.light);
	const noseMat = mat(scene, scheme.nose);
	const eyeMat = mat(scene, scheme.eye);

	// Body
	const body = group(scene, 'body', cat);
	box(scene, body, 1.3, 0.95, 2.1, furMat);
	const belly = box(scene, body, 0.95, 0.4, 1.7, whiteMat);
	belly.position.y = -0.3;
	const restY = 1.05;
	body.position.y = restY;

	// Head
	const head = group(scene, 'head', cat);
	head.position.set(0, 1.35, 1.25);
	box(scene, head, 1.05, 0.95, 0.95, furMat);
	const snout = box(scene, head, 0.65, 0.45, 0.45, whiteMat);
	snout.position.set(0, -0.18, 0.5);
	const nose = cone(scene, head, 0.12, 0.14, 4, noseMat);
	nose.position.set(0, 0.0, 0.76);
	nose.rotation.x = Math.PI / 2;
	nose.rotation.y = Math.PI / 4;

	// Mouth-open block - hidden by default, scaled up while meowing
	// to show an open mouth. Sits flat against the snout's underside.
	const mouthOpen = box(scene, head, 0.22, 0.18, 0.07, mat(scene, 0x2a0d10));
	mouthOpen.position.set(0, -0.27, 0.72);
	mouthOpen.scaling.y = 0.001;

	// Eyes (simple - no pupil tracking in v1)
	const makeEye = (x: number): TransformNode =>
	{
		const g = group(scene, 'eye', head);
		const eye = sphere(scene, g, 0.16, 8, eyeMat);
		eye.scaling.z = 0.55;
		const pupil = box(scene, g, 0.045, 0.22, 0.04, blackMat(scene));
		pupil.position.z = 0.09;
		const shine = sphere(scene, g, 0.04, 6, eyeWhiteMat(scene));
		shine.position.set(0.05, 0.07, 0.11);
		g.position.set(x, 0.15, 0.4);
		return g;
	};
	makeEye(-0.27);
	makeEye(0.27);

	// Ears
	const makeEar = (x: number, side: number): TransformNode =>
	{
		const eg = group(scene, 'ear', head);
		eg.position.set(x, 0.55, -0.05);
		cone(scene, eg, 0.26, 0.55, 4, furMat);
		const inner = cone(scene, eg, 0.16, 0.4, 4, mat(scene, scheme.nose));
		inner.position.set(0, -0.05, 0.05);
		eg.rotation.z = side * 0.18;
		eg.rotation.x = -0.08;
		return eg;
	};
	const leftEar = makeEar(-0.34, 1);
	const rightEar = makeEar(0.34, -1);

	// Legs
	const legs = {
		fl: makeLeg(scene, furMat, whiteMat, -0.45, 0.7),
		fr: makeLeg(scene, furMat, whiteMat, 0.45, 0.7),
		bl: makeLeg(scene, furMat, whiteMat, -0.45, -0.75),
		br: makeLeg(scene, furMat, whiteMat, 0.45, -0.75),
	};
	legs.fl.thigh.parent = cat;
	legs.fr.thigh.parent = cat;
	legs.bl.thigh.parent = cat;
	legs.br.thigh.parent = cat;

	// Tail - 7 segments for the iconic flowing cat tail
	const tail = makeTail(scene, cat, 7, 1.15, -1.0, 0.22, furMat, darkMat, whiteMat);

	applyShadow(root);
	return { group: root, body, head, tail, legs, ears: { left: leftEar, right: rightEar }, mouthOpen, restY };
}
