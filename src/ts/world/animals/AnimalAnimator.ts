import { AnimalModel } from './AnimalModels';

// Per-frame animation driver. Picks idle / walk / run / jump pose
// from the motion state + speed and mutates the model handles
// in-place. Same shape as the cat-game's animation block but as a
// pure function the manager calls once per animal per frame.

export interface AnimalAnimationOpts
{
	t: number;
	speed: number;
	isDog: boolean;
	moving: boolean;
	running: boolean;
	// 0..1, lifecycle of the active voice (1 = just started, 0 = done).
	// Drives mouth-open scale and the dog's bark head-shake.
	voiceFraction: number;
	// True while the body is in mid-air (cannon hasn't reported the
	// landing collision yet). Picks the jump pose ahead of any other
	// animation branch.
	jumping: boolean;
	// Body's vertical velocity in m/s; positive ascending, negative
	// descending. Drives body lean + leg pose during jumping.
	velocityY: number;
}

type LegKey = 'fl' | 'fr' | 'bl' | 'br';

function applyJumpPose(model: AnimalModel, velocityY: number): void
{
	model.body.position.y = model.restY;
	model.body.scale.set(1, 1, 1);
	model.body.rotation.x = velocityY > 0 ? -0.12 : 0.18;
	const tuck = velocityY > 0;
	for (const k in model.legs)
	{
		const leg = model.legs[k as LegKey];
		leg.thigh.rotation.x = tuck ? -0.5 : 0.35;
		leg.shin.rotation.x = tuck ? 1.0 : 0.0;
	}
	model.head.rotation.x = velocityY > 0 ? -0.18 : 0.12;
	model.head.rotation.y *= 0.85;
	model.mouthOpen.scale.y = 0.001;
	for (const seg of model.tail) seg.rotation.y *= 0.85;
}

function applyIdlePose(model: AnimalModel, t: number, isDog: boolean, voiceFraction: number): void
{
	const breath = Math.sin(t * 1.6) * (isDog ? 0.03 : 0.025);
	model.body.scale.set(1 + breath, 1 + breath, 1 + breath * 0.5);
	model.body.position.y = model.restY;
	model.body.rotation.x *= 0.85;

	if (isDog)
	{
		model.tail.forEach((seg, i) =>
		{
			const phase = t * 7 - i * 0.35;
			seg.rotation.y = Math.sin(phase) * (0.3 + i * 0.05);
			if (i === 0) seg.rotation.x = -0.6 + Math.cos(phase * 0.5) * 0.05;
			else seg.rotation.x = Math.cos(phase) * 0.05;
		});
		model.ears.left.rotation.z = 0.32;
		model.ears.right.rotation.z = -0.32;
	}
	else
	{
		model.tail.forEach((seg, i) =>
		{
			const phase = t * 1.4 - i * 0.45;
			seg.rotation.y = Math.sin(phase) * (0.18 + i * 0.04);
			const lift = i === 0 ? -0.35 : 0;
			seg.rotation.x = lift + Math.cos(phase * 0.8) * 0.04;
		});
		model.ears.left.rotation.z = 0.18;
		model.ears.right.rotation.z = -0.18;
		model.ears.left.rotation.x = -0.08;
		model.ears.right.rotation.x = -0.08;
	}

	// Dogs barking jerk their head down on each woof; idle cats
	// just sway their head gently. voiceFraction > 0 overrides
	// the lazy idle motion with the bark snap.
	if (isDog && voiceFraction > 0)
	{
		model.head.rotation.x = -0.18 + voiceFraction * 0.25;
		model.head.rotation.y = Math.sin(t * 18) * 0.06;
	}
	else
	{
		model.head.rotation.y = Math.sin(t * 0.5) * 0.12;
		model.head.rotation.x = Math.sin(t * 0.7) * 0.04;
	}

	for (const k in model.legs)
	{
		const leg = model.legs[k as LegKey];
		leg.thigh.rotation.x *= 0.85;
		leg.shin.rotation.x *= 0.85;
	}
}

function applyGaitLegs(model: AnimalModel, c: number, amp: number, running: boolean): void
{
	if (!running)
	{
		// Walk: diagonal pair (FL+BR vs FR+BL) - cat-game pattern.
		model.legs.fl.thigh.rotation.x = Math.sin(c) * amp;
		model.legs.br.thigh.rotation.x = Math.sin(c) * amp;
		model.legs.fr.thigh.rotation.x = Math.sin(c + Math.PI) * amp;
		model.legs.bl.thigh.rotation.x = Math.sin(c + Math.PI) * amp;
		model.legs.fl.shin.rotation.x = Math.max(0, Math.sin(c - 0.7)) * 0.5;
		model.legs.br.shin.rotation.x = Math.max(0, Math.sin(c - 0.7)) * 0.5;
		model.legs.fr.shin.rotation.x = Math.max(0, Math.sin(c + Math.PI - 0.7)) * 0.5;
		model.legs.bl.shin.rotation.x = Math.max(0, Math.sin(c + Math.PI - 0.7)) * 0.5;
		model.body.position.y = model.restY + Math.abs(Math.sin(c * 2)) * 0.04;
		model.body.rotation.x = Math.sin(c * 2) * 0.025;
		return;
	}

	// Run / gallop: near-synced front pair, near-synced back pair.
	const front = Math.sin(c) * amp;
	const back = Math.sin(c + Math.PI * 0.6) * amp;
	model.legs.fl.thigh.rotation.x = front;
	model.legs.fr.thigh.rotation.x = front - 0.08;
	model.legs.bl.thigh.rotation.x = back;
	model.legs.br.thigh.rotation.x = back - 0.08;
	model.legs.fl.shin.rotation.x = Math.max(0, Math.sin(c - 0.6)) * 0.65;
	model.legs.fr.shin.rotation.x = Math.max(0, Math.sin(c - 0.7)) * 0.65;
	model.legs.bl.shin.rotation.x = Math.max(0, Math.sin(c + Math.PI * 0.6 - 0.6)) * 0.65;
	model.legs.br.shin.rotation.x = Math.max(0, Math.sin(c + Math.PI * 0.6 - 0.7)) * 0.65;
	model.body.position.y = model.restY + Math.abs(Math.sin(c)) * 0.18;
	model.body.rotation.x = Math.sin(c) * 0.09;
}

function applyGaitTailEars(model: AnimalModel, c: number, t: number, isDog: boolean, running: boolean): void
{
	if (isDog)
	{
		model.tail.forEach((seg, i) =>
		{
			const phase = t * 8 - i * 0.35;
			seg.rotation.y = Math.sin(phase) * 0.28;
			if (i === 0) seg.rotation.x = -0.6 + Math.sin(c) * 0.08;
			else seg.rotation.x = Math.sin(c) * 0.04;
		});
		const bounce = Math.sin(c * 2) * 0.22;
		model.ears.left.rotation.x = bounce;
		model.ears.right.rotation.x = bounce;
		model.ears.left.rotation.z = 0.32 + Math.sin(c) * 0.08;
		model.ears.right.rotation.z = -0.32 - Math.sin(c) * 0.08;
		return;
	}

	model.tail.forEach((seg, i) =>
	{
		const phase = c * 0.5 - i * 0.35;
		seg.rotation.y = Math.sin(phase) * 0.12;
		seg.rotation.x = (i === 0 ? -0.55 : 0) + Math.sin(phase) * 0.08;
	});
	const earBack = running ? -0.35 : -0.12;
	model.ears.left.rotation.x = earBack;
	model.ears.right.rotation.x = earBack;
	model.ears.left.rotation.z = 0.18;
	model.ears.right.rotation.z = -0.18;
}

export function applyAnimalAnimation(model: AnimalModel, opts: AnimalAnimationOpts): void
{
	const { t, speed, isDog, moving, running, voiceFraction, jumping, velocityY } = opts;

	// Mid-jump pose. Takes priority over walk/idle/run so the silhouette
	// reads as airborne instead of an awkward walking-in-mid-air.
	if (jumping)
	{
		applyJumpPose(model, velocityY);
		return;
	}

	// Mouth opens during voices. Smooth-step in/out so the open isn't
	// a hard pop. Cats hold mouth open for the full meow; dogs jaw-
	// snap on each bark - same fade approximation works for both
	// (synth duration ~0.45 s, voiceFraction handles the timing).
	model.mouthOpen.scale.y = voiceFraction > 0
		? Math.max(0.001, voiceFraction)
		: 0.001;

	if (!moving)
	{
		applyIdlePose(model, t, isDog, voiceFraction);
		return;
	}

	// Walk / run gait.
	const cycleSpeed = running ? 13 : 8;
	const amp = running ? 0.75 : 0.5;
	const c = t * cycleSpeed;

	applyGaitLegs(model, c, amp, running);
	applyGaitTailEars(model, c, t, isDog, running);

	model.head.rotation.y *= 0.85;
	model.head.rotation.x = Math.sin(c) * 0.03;
	model.body.scale.set(1, 1, 1);

	// `speed` arg unused right now but kept on the signature: future
	// tweaks (paw-step audio, anim-blend factor) will read it.
	void speed;
}
