import * as THREE from 'three';

import { AudioWorldContext, getMasterVolume } from './AudioHelpers';

// Procedural play-once meow / bark / purr synthesis. One global
// AnimalVoiceBus that owns the AudioContext + master gain (so
// Master_Volume scales it like every other audio system), and three
// trigger functions that build a short oscillator graph, schedule
// stop, and disconnect on completion.
//
// 3D positional audio is NOT used here - the synths are short
// (50 ms attack, 200-700 ms total) and the listener is the player.
// Stereo panning is done with a StereoPannerNode keyed on the
// animal's offset from the player so a dog barking on the left ear
// reads as such without paying for the full PositionalAudio
// pipeline (which would need a Three.AudioListener and per-source
// AudioBuffer plumbing).

export type VoiceKind = 'meow' | 'bark' | 'purr';

const _scratch = new THREE.Vector3();

export class AnimalVoiceBus
{
	private world: AudioWorldContext;
	private ctx: AudioContext | null = null;
	private master: GainNode | null = null;
	private purrLoops: Map<string, PurrLoop> = new Map();

	constructor(world: AudioWorldContext)
	{
		this.world = world;
	}

	// Ensure the shared THREE AudioContext exists and our master gain
	// is wired up. Lazy so we don't poke the autoplay-policy before
	// the title-screen click goes through.
	private ensureContext(): boolean
	{
		if (this.ctx !== null) return true;
		try
		{
			const ctx = THREE.AudioContext.getContext() as AudioContext;
			const master = ctx.createGain();
			master.gain.value = this.masterGain();
			master.connect(ctx.destination);
			this.ctx = ctx;
			this.master = master;
			return true;
		}
		catch (_e)
		{
			return false;
		}
	}

	private masterGain(): number
	{
		// Voices use full master mix - they're brief enough that
		// dampening them under the engine sound bus would just make
		// them inaudible. Master_Volume still scales everything.
		return getMasterVolume(this.world);
	}

	// Sync per-frame so the slider feels live, not toggled.
	public updateMasterVolume(): void
	{
		if (this.master === null || this.ctx === null) return;
		this.master.gain.setTargetAtTime(this.masterGain(), this.ctx.currentTime, 0.1);
		// Also tick purr loops so their gain follows distance.
		for (const loop of this.purrLoops.values()) loop.tickDistance();
	}

	// Trigger a single one-shot voice at the animal's world position.
	// Returns the duration so callers can sync mouth animation.
	public play(kind: VoiceKind, position: THREE.Vector3): number
	{
		if (!this.ensureContext()) return 0;
		const ctx = this.ctx!;
		const master = this.master!;

		switch (kind)
		{
			case 'meow': return this.playMeow(ctx, master, position);
			case 'bark': return this.playBark(ctx, master, position);
			case 'purr': return this.playPurr(ctx, master, position);
		}
	}

	private buildPanner(ctx: AudioContext, position: THREE.Vector3): StereoPannerNode
	{
		const panner = ctx.createStereoPanner();
		panner.pan.value = this.panFor(position);
		return panner;
	}

	private panFor(position: THREE.Vector3): number
	{
		// Pan -1..+1 from the animal's offset along the camera's right
		// axis. Cheap proxy for stereo position - no proper HRTF.
		const cam = this.world.camera;
		if (cam === undefined) return 0;
		_scratch.copy(position).sub(cam.position);
		// Camera's local right = (1, 0, 0) in world after applying
		// world matrix's rotation. Three's MatrixWorld doesn't trivially
		// give us that, so fall back to a yaw-only approximation.
		const dx = _scratch.x;
		const dz = _scratch.z;
		const dist = Math.sqrt(dx * dx + dz * dz);
		if (dist < 0.001) return 0;
		// project onto camera's right axis. We need cam yaw; quaternion
		// y-component approximates it for typical near-horizon shots.
		const yaw = Math.atan2(
			2 * (cam.quaternion.w * cam.quaternion.y),
			1 - 2 * (cam.quaternion.y * cam.quaternion.y),
		);
		const right = Math.cos(yaw) * dx - Math.sin(yaw) * dz;
		const pan = Math.max(-1, Math.min(1, right / dist));
		return pan;
	}

	private distanceGain(position: THREE.Vector3): number
	{
		// 1 m -> 1.0, 30 m -> 0.0. Linear falloff, plenty for a small
		// world. Past 30 m the sound is silent and gets disposed.
		const cam = this.world.camera;
		if (cam === undefined) return 1;
		const d = position.distanceTo(cam.position);
		return Math.max(0, 1 - (d - 1) / 29);
	}

	// ── meow ───────────────────────────────────────────────────────
	// Two-formant rising-then-falling glide on a sawtooth carrier
	// shaped through a bandpass filter. ~600 ms total.
	private playMeow(ctx: AudioContext, master: GainNode, position: THREE.Vector3): number
	{
		const distGain = this.distanceGain(position);
		if (distGain <= 0) return 0;

		const t0 = ctx.currentTime;
		const dur = 0.6;

		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.setValueAtTime(420, t0);
		osc.frequency.linearRampToValueAtTime(680, t0 + 0.18);
		osc.frequency.linearRampToValueAtTime(380, t0 + dur);

		const filter = ctx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = 900;
		filter.Q.value = 4;

		const env = ctx.createGain();
		env.gain.setValueAtTime(0, t0);
		env.gain.linearRampToValueAtTime(0.35 * distGain, t0 + 0.05);
		env.gain.linearRampToValueAtTime(0.25 * distGain, t0 + 0.4);
		env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);

		const panner = this.buildPanner(ctx, position);

		osc.connect(filter);
		filter.connect(env);
		env.connect(panner);
		panner.connect(master);
		osc.start(t0);
		osc.stop(t0 + dur);
		osc.onended = () =>
		{
			try
			{
				osc.disconnect();
				filter.disconnect();
				env.disconnect();
				panner.disconnect();
			}
			catch (_e) { /* noop */ }
		};
		return dur;
	}

	// ── bark ───────────────────────────────────────────────────────
	// Two short "woof"-shaped pulses. Each pulse is a square wave
	// dropping pitch ~30 Hz over 80 ms, lowpass-filtered to round it.
	private playBark(ctx: AudioContext, master: GainNode, position: THREE.Vector3): number
	{
		const distGain = this.distanceGain(position);
		if (distGain <= 0) return 0;

		const t0 = ctx.currentTime;
		const totalDur = 0.45;
		const panner = this.buildPanner(ctx, position);
		panner.connect(master);

		const woof = (offset: number, baseFreq: number): void =>
		{
			const start = t0 + offset;
			const dur = 0.12;
			const osc = ctx.createOscillator();
			osc.type = 'square';
			osc.frequency.setValueAtTime(baseFreq, start);
			osc.frequency.exponentialRampToValueAtTime(baseFreq * 0.65, start + dur);

			const filter = ctx.createBiquadFilter();
			filter.type = 'lowpass';
			filter.frequency.value = 1500;

			const env = ctx.createGain();
			env.gain.setValueAtTime(0, start);
			env.gain.linearRampToValueAtTime(0.5 * distGain, start + 0.02);
			env.gain.exponentialRampToValueAtTime(0.001, start + dur);

			osc.connect(filter);
			filter.connect(env);
			env.connect(panner);
			osc.start(start);
			osc.stop(start + dur);
			osc.onended = () =>
			{
				try
				{
					osc.disconnect();
					filter.disconnect();
					env.disconnect();
				}
				catch (_e) { /* noop */ }
			};
		};

		woof(0, 220);
		woof(0.18, 200);

		// Disconnect the panner once both woofs finished
		setTimeout(() =>
		{
			try { panner.disconnect(); }
			catch (_e) { /* noop */ }
		}, totalDur * 1000 + 50);

		return totalDur;
	}

	// ── purr ──────────────────────────────────────────────────────
	// Looped low-frequency sawtooth amplitude-modulated by an LFO at
	// ~25 Hz. Lives until stopPurr() is called by the caller, with
	// distance-based gain ducking on tickDistance() each frame.
	private playPurr(ctx: AudioContext, master: GainNode, position: THREE.Vector3): number
	{
		// playPurr is a one-shot trigger here for symmetry; the
		// looped variant is startPurrLoop below. Most callers want
		// the loop, but a one-shot purr (e.g. a player petting an
		// animal) is occasionally useful.
		const distGain = this.distanceGain(position);
		if (distGain <= 0) return 0;

		const t0 = ctx.currentTime;
		const dur = 0.8;

		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.value = 60;

		const lfo = ctx.createOscillator();
		lfo.frequency.value = 25;
		const lfoGain = ctx.createGain();
		lfoGain.gain.value = 0.5;
		lfo.connect(lfoGain);

		const env = ctx.createGain();
		env.gain.setValueAtTime(0, t0);
		env.gain.linearRampToValueAtTime(0.18 * distGain, t0 + 0.1);
		env.gain.linearRampToValueAtTime(0.18 * distGain, t0 + dur - 0.15);
		env.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
		lfoGain.connect(env.gain);

		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 200;

		const panner = this.buildPanner(ctx, position);

		osc.connect(filter);
		filter.connect(env);
		env.connect(panner);
		panner.connect(master);
		osc.start(t0);
		lfo.start(t0);
		osc.stop(t0 + dur);
		lfo.stop(t0 + dur);
		osc.onended = () =>
		{
			try
			{
				osc.disconnect();
				lfo.disconnect();
				lfoGain.disconnect();
				filter.disconnect();
				env.disconnect();
				panner.disconnect();
			}
			catch (_e) { /* noop */ }
		};
		return dur;
	}

	// Looped purr for tame cats sitting near the player. Identified
	// by a stable id (e.g. animal index) so the manager can stop the
	// right one when the cat moves out of range or the toggle flips.
	public startPurrLoop(id: string, position: THREE.Vector3): void
	{
		if (this.purrLoops.has(id)) return;
		if (!this.ensureContext()) return;
		const loop = new PurrLoop(this.ctx!, this.master!, this.world, position);
		this.purrLoops.set(id, loop);
	}

	public stopPurrLoop(id: string): void
	{
		const loop = this.purrLoops.get(id);
		if (loop === undefined) return;
		loop.stop();
		this.purrLoops.delete(id);
	}

	public hasPurrLoop(id: string): boolean
	{
		return this.purrLoops.has(id);
	}
}

// One purr loop instance. Holds an oscillator + LFO + lowpass +
// distance-modulated gain, runs forever until stop() ramps it down
// and disconnects.
class PurrLoop
{
	private ctx: AudioContext;
	private world: AudioWorldContext;
	private position: THREE.Vector3;
	private osc: OscillatorNode;
	private lfo: OscillatorNode;
	private env: GainNode;

	constructor(ctx: AudioContext, master: GainNode, world: AudioWorldContext, position: THREE.Vector3)
	{
		this.ctx = ctx;
		this.world = world;
		this.position = position;

		const t0 = ctx.currentTime;

		this.osc = ctx.createOscillator();
		this.osc.type = 'sawtooth';
		this.osc.frequency.value = 60;

		this.lfo = ctx.createOscillator();
		this.lfo.frequency.value = 25;
		const lfoGain = ctx.createGain();
		lfoGain.gain.value = 0.4;
		this.lfo.connect(lfoGain);

		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 200;

		this.env = ctx.createGain();
		this.env.gain.setValueAtTime(0, t0);
		this.env.gain.linearRampToValueAtTime(0.15 * this.distanceGain(), t0 + 0.4);
		lfoGain.connect(this.env.gain);

		const panner = ctx.createStereoPanner();
		panner.pan.value = 0;

		this.osc.connect(filter);
		filter.connect(this.env);
		this.env.connect(panner);
		panner.connect(master);
		this.osc.start(t0);
		this.lfo.start(t0);
	}

	public tickDistance(): void
	{
		this.env.gain.setTargetAtTime(0.15 * this.distanceGain(), this.ctx.currentTime, 0.2);
	}

	public stop(): void
	{
		const t = this.ctx.currentTime;
		this.env.gain.setTargetAtTime(0, t, 0.15);
		this.osc.stop(t + 0.5);
		this.lfo.stop(t + 0.5);
		this.osc.onended = () =>
		{
			try
			{
				this.osc.disconnect();
				this.lfo.disconnect();
				this.env.disconnect();
			}
			catch (_e) { /* noop */ }
		};
	}

	private distanceGain(): number
	{
		const cam = this.world.camera;
		if (cam === undefined) return 1;
		const d = this.position.distanceTo(cam.position);
		return Math.max(0, 1 - (d - 1) / 14);  // tighter than one-shots
	}
}
