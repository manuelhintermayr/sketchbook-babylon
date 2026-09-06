import * as THREE from 'three';
import { AudioWorldContext, getMasterVolume } from './AudioHelpers';

// Procedural sound-effects bus. Centralises every UI / player-action /
// race / vehicle / environmental SFX so the rest of the codebase only
// sees one entry point (`world.sfxBus.playX()`) instead of every state
// rolling its own AudioContext + oscillator + envelope.
//
// Each play* method builds its tiny synth graph on demand, schedules
// the envelope, and lets the browser GC the nodes once the burst
// finishes. Cheap; we never hold more than the few nodes needed for
// the currently-playing sound.
//
// Master_Volume on world.params is honoured per-call; Sound_Effects
// toggle gates everything (silently no-ops when off, so callers don't
// need to check). All play* methods are safe to call before any user
// gesture - the AudioContext starts suspended and resumes on demand.

export class SfxBus
{
	private world: AudioWorldContext;
	private ctx: AudioContext | null = null;
	private masterGain: GainNode | null = null;

	constructor(world: AudioWorldContext)
	{
		this.world = world;
	}

	// Lazy-init the shared context + master gain on first play. Returns
	// false when the SFX toggle is off so callers can short-circuit.
	private ensureContext(): boolean
	{
		if (!this.world.params?.Sound_Effects) return false;
		if (this.ctx === null)
		{
			this.ctx = THREE.AudioContext.getContext() as AudioContext;
			this.masterGain = this.ctx.createGain();
			this.masterGain.connect(this.ctx.destination);
		}
		if (this.ctx.state === 'suspended')
		{
			try { this.ctx.resume(); } catch (_e) { /* autoplay-blocked, retry next call */ }
		}
		this.masterGain!.gain.setTargetAtTime(getMasterVolume(this.world) * 0.6, this.ctx.currentTime, 0.05);
		return true;
	}

	private makeNoise(durSeconds: number): AudioBuffer
	{
		const ctx = this.ctx!;
		const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * durSeconds)), ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		return buf;
	}

	// Footstep / jump / land / door moved to per-character CharacterSfx
	// (PositionalAudio, attenuated by the listener-on-camera) so every
	// character - player and NPCs - emits its own sounds rather than
	// the player getting a flat global thud.

	// ---- Race ----

	// Checkpoint ping - quick triangle blip rising in pitch.
	public playCheckpoint(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 0.18;

		const osc = ctx.createOscillator();
		osc.type = 'triangle';
		osc.frequency.setValueAtTime(880, now);
		osc.frequency.exponentialRampToValueAtTime(1320, now + 0.05);

		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.18, now + 0.01);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

		osc.connect(gain);
		gain.connect(this.masterGain!);
		osc.start(now);
		osc.stop(now + dur);
	}

	// Lap completed - rising 3-tone fanfare (C5 -> E5 -> G5).
	public playLap(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const notes = [523.25, 659.25, 783.99];
		notes.forEach((freq, i) =>
		{
			const start = now + i * 0.12;
			const dur = 0.25;
			const osc = ctx.createOscillator();
			osc.type = 'triangle';
			osc.frequency.value = freq;
			const gain = ctx.createGain();
			gain.gain.setValueAtTime(0, start);
			gain.gain.linearRampToValueAtTime(0.15, start + 0.02);
			gain.gain.exponentialRampToValueAtTime(0.001, start + dur);
			osc.connect(gain);
			gain.connect(this.masterGain!);
			osc.start(start);
			osc.stop(start + dur);
		});
	}

	// ---- UI ----

	// Dialog open - bandpass noise sweep up. Reads as a 'whoosh-in'.
	public playDialogOpen(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 0.2;

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.setValueAtTime(800, now);
		filter.frequency.exponentialRampToValueAtTime(2400, now + dur);
		filter.Q.value = 4;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.16, now + 0.04);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain!);
		noise.start(now);
		noise.stop(now + dur);
	}

	// Generic UI tick - short sine blip. Used for prompt-appear,
	// pause-toggle, settings clicks.
	public playUiTick(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 0.06;
		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.value = 1200;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.07, now + 0.005);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		osc.connect(gain);
		gain.connect(this.masterGain!);
		osc.start(now);
		osc.stop(now + dur);
	}

	// Iris transition - long lowpass noise sweep down. Covers the
	// fullscreen iris-out + page-reload window with a single whoosh.
	public playIrisWhoosh(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 0.6;

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.setValueAtTime(2200, now);
		filter.frequency.exponentialRampToValueAtTime(220, now + dur);
		filter.Q.value = 2;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.18, now + 0.05);
		gain.gain.linearRampToValueAtTime(0.18, now + dur - 0.1);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain!);
		noise.start(now);
		noise.stop(now + dur);
	}

	// ---- Vehicle ----

	// Vehicle crash - lowpass noise body + sub-bass kick. force is the
	// collision impulse magnitude clamped to [0..1] by the caller.
	public playCrash(force: number = 1): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 0.4;
		const peak = Math.min(0.4, 0.18 * force);

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 800;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(peak, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain!);
		noise.start(now);
		noise.stop(now + dur);

		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(60, now);
		osc.frequency.exponentialRampToValueAtTime(35, now + 0.2);
		const oscGain = ctx.createGain();
		oscGain.gain.setValueAtTime(peak * 0.6, now);
		oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);
		osc.connect(oscGain);
		oscGain.connect(this.masterGain!);
		osc.start(now);
		osc.stop(now + 0.2);
	}

	// Rocket liftoff - 1.5 s sub-bass roar + lowpass noise rumble.
	// Plays alongside the per-rocket EngineSound so the ignition still
	// reads as a discrete event the moment thrust kicks in.
	public playRocketBoom(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 1.5;

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 400;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.28, now + 0.1);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain!);
		noise.start(now);
		noise.stop(now + dur);

		const osc = ctx.createOscillator();
		osc.type = 'sawtooth';
		osc.frequency.setValueAtTime(38, now);
		osc.frequency.linearRampToValueAtTime(64, now + dur);
		const oscGain = ctx.createGain();
		oscGain.gain.setValueAtTime(0, now);
		oscGain.gain.linearRampToValueAtTime(0.28, now + 0.1);
		oscGain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		osc.connect(oscGain);
		oscGain.connect(this.masterGain!);
		osc.start(now);
		osc.stop(now + dur);
	}

	// ---- Environmental ----

	// Water splash - highpass noise burst sweeping down.
	public playSplash(): void
	{
		if (!this.ensureContext()) return;
		const ctx = this.ctx!;
		const now = ctx.currentTime;
		const dur = 0.5;

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'highpass';
		filter.frequency.setValueAtTime(900, now);
		filter.frequency.exponentialRampToValueAtTime(220, now + dur);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.22, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.masterGain!);
		noise.start(now);
		noise.stop(now + dur);
	}
}
