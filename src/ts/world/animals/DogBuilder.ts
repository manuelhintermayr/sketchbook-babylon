import { Scene, TransformNode } from '@babylonjs/core';

import {
	AnimalModel,
	ColorScheme,
	FOOT_OFFSET,
	applyShadow,
	box,
	eyeWhiteMat,
	group,
	makeLeg,
	makeTail,
	mat,
	sphere,
} from './AnimalModels';

// Dog model construction. Same hierarchy contract as the cat builder
// (body, head, legs, tail, ears, mouthOpen, restY) but stockier
// proportions, a longer snout, floppy ears, and a shorter perky tail
// that defaults to an upward carry.

export function buildDogModel(scene: Scene, scheme: ColorScheme): AnimalModel
{
	const root = group(scene, 'dog');
	const dog = group(scene, 'dogSpecies', root);
	dog.position.y = FOOT_OFFSET;

	const furMat = mat(scene, scheme.main);
	const darkMat = mat(scene, scheme.dark);
	const lightMat = mat(scene, scheme.light);
	const noseMat = mat(scene, scheme.nose);
	const eyeMat = mat(scene, scheme.eye);

	// Body - chunkier than the cat
	const body = group(scene, 'body', dog);
	box(scene, body, 1.45, 1.05, 2.3, furMat);
	const belly = box(scene, body, 1.1, 0.45, 1.85, lightMat);
	belly.position.y = -0.32;
	const restY = 1.15;
	body.position.y = restY;

	// Head - longer snout than cat
	const head = group(scene, 'head', dog);
	head.position.set(0, 1.45, 1.4);
	box(scene, head, 1.1, 0.95, 1.0, furMat);
	const snout = box(scene, head, 0.7, 0.55, 0.7, furMat);
	snout.position.set(0, -0.2, 0.62);
	const nose = box(scene, head, 0.3, 0.18, 0.18, noseMat);
	nose.position.set(0, -0.05, 0.96);

	// Mouth-open block under the snout - shown while barking.
	const mouthOpen = box(scene, head, 0.32, 0.18, 0.1, mat(scene, 0x2a0d10));
	mouthOpen.position.set(0, -0.32, 0.86);
	mouthOpen.scaling.y = 0.001;

	// Eyes
	const makeEye = (x: number): TransformNode =>
	{
		const g = group(scene, 'eye', head);
		const eye = sphere(scene, g, 0.13, 8, eyeMat);
		eye.scaling.z = 0.6;
		const shine = sphere(scene, g, 0.03, 6, eyeWhiteMat(scene));
		shine.position.set(0.04, 0.05, 0.09);
		g.position.set(x, 0.2, 0.42);
		return g;
	};
	makeEye(-0.27);
	makeEye(0.27);

	// Floppy ears (rotated outward, hanging forward)
	const makeEar = (x: number, side: number): TransformNode =>
	{
		const eg = group(scene, 'ear', head);
		eg.position.set(x, 0.4, 0.0);
		const ear = box(scene, eg, 0.22, 0.55, 0.18, darkMat);
		ear.position.y = -0.25;
		eg.rotation.z = side * 0.32;
		return eg;
	};
	const leftEar = makeEar(-0.45, 1);
	const rightEar = makeEar(0.45, -1);

	// Legs - same shape as cat but stockier
	const legs = {
		fl: makeLeg(scene, furMat, lightMat, -0.5, 0.78),
		fr: makeLeg(scene, furMat, lightMat, 0.5, 0.78),
		bl: makeLeg(scene, furMat, lightMat, -0.5, -0.85),
		br: makeLeg(scene, furMat, lightMat, 0.5, -0.85),
	};
	legs.fl.thigh.parent = dog;
	legs.fr.thigh.parent = dog;
	legs.bl.thigh.parent = dog;
	legs.br.thigh.parent = dog;

	// Shorter perky tail (4 segs)
	const tail = makeTail(scene, dog, 4, 1.3, -1.05, 0.24, furMat, darkMat, lightMat);
	// Default carry the dog tail upward
	if (tail.length > 0) tail[0].rotation.x = -0.6;

	applyShadow(root);
	return { group: root, body, head, tail, legs, ears: { left: leftEar, right: rightEar }, mouthOpen, restY };
}
