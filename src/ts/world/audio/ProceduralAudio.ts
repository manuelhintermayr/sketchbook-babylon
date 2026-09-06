import * as THREE from 'three';
import { IUpdatable } from '../../interfaces/IUpdatable';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { AudioWorldContext, getMasterVolume } from './AudioHelpers';

// Base class for procedural Web Audio synthesisers (engine sound,
// ambient soundscape, anything that builds an oscillator / filter
// graph instead of playing a sample). Centralises the lifecycle that
// EngineSound and AmbientSound used to duplicate:
//
//  - AudioContext acquisition via THREE.AudioContext.getContext() -
//    a static shared instance reused by THREE.AudioListener +
//    PositionalAudio. Browsers cap concurrent contexts at ~6, so
//    sharing one across all procedural layers + every Speaker keeps
//    us safely under the limit even when several vehicles spawn.
//  - Lazy start when shouldPlay() flips true; ramped stop when it
//    flips false (gain ramp + delayed teardown so the cut isn't
//    audible).
//  - Per-frame Master_Volume sync from world.params (same slider
//    that drives THREE.AudioListener for positional audio - single
//    source of truth across every audio source).
//  - Browser autoplay-policy resume each frame (cheap; the browser
//    ignores resume() when the context is already running).
//
// Subclass contract:
//  - masterMix       - fraction of Master_Volume this layer uses
//                      (engine = 1.0 full, ambient = 0.7 dampened)
//  - shouldPlay()    - when the synth should be running
//  - buildSynth()    - construct oscillators / filters, connect to
//                      master, start oscillators
//  - teardownSynth() - stop oscillators, called after the gain ramp
//                      so the cut isn't audible
//  - updateSynth()   - per-frame parameter modulation

export abstract class ProceduralAudio implements IUpdatable
{
	public updateOrder: number = UpdateOrder.Audio;

	protected world: AudioWorldContext;
	protected ctx: AudioContext | null = null;
	protected masterGain: GainNode | null = null;
	private active: boolean = false;

	protected abstract readonly masterMix: number;

	constructor(world: AudioWorldContext)
	{
		this.world = world;
	}

	public update(_timeStep: number, unscaledTimeStep: number): void
	{
		const should = this.shouldPlay();

		if (should && !this.active)
		{
			this.startInternal();
			this.active = true;
		}
		else if (!should && this.active)
		{
			this.stopInternal();
			this.active = false;
		}

		if (this.ctx === null || this.ctx.state === 'closed') return;

		if (this.ctx.state === 'suspended')
		{
			this.ctx.resume();
		}

		const target = this.targetMasterVolume();
		this.masterGain!.gain.setTargetAtTime(target, this.ctx.currentTime, 0.1);

		this.updateSynth(unscaledTimeStep);
	}

	public dispose(): void
	{
		if (this.active) this.stopInternal();
		this.active = false;
	}

	protected abstract shouldPlay(): boolean;
	protected abstract buildSynth(ctx: AudioContext, master: GainNode): void;
	protected abstract teardownSynth(): void;
	protected abstract updateSynth(unscaledTimeStep: number): void;

	private targetMasterVolume(): number
	{
		return getMasterVolume(this.world) * this.masterMix;
	}

	private startInternal(): void
	{
		const ctx = THREE.AudioContext.getContext() as AudioContext;
		const masterGain = ctx.createGain();
		masterGain.gain.value = this.targetMasterVolume();
		masterGain.connect(ctx.destination);

		this.ctx = ctx;
		this.masterGain = masterGain;

		this.buildSynth(ctx, masterGain);
	}

	private stopInternal(): void
	{
		if (this.ctx === null || this.masterGain === null) return;

		const ctx = this.ctx;
		const masterGain = this.masterGain;
		masterGain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);

		// Defer teardown so the gain ramp is audible. Subclass stops
		// its own oscillators here; we then disconnect the master gain
		// so it can be GC'd. The shared AudioContext is never closed
		// - other audio systems (other vehicles, Speakers) keep using
		// it.
		setTimeout(() =>
		{
			this.teardownSynth();
			try { masterGain.disconnect(); }
			catch (_e) { /* already disconnected */ }
		}, 200);

		this.ctx = null;
		this.masterGain = null;
	}
}
