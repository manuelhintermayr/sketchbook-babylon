import * as THREE from 'three';
import { AudioWorldContext, ensureAudioListener } from './AudioHelpers';

// Per-character positional sound effects. Same role for Characters that
// EngineSound has for Vehicles: every character (player + NPCs) carries
// its own SFX source attached to its body, panned + attenuated by the
// listener-on-camera. Footsteps from Anna walking the loop fade with
// distance instead of always playing at full volume from the player's
// ear, and door clunks land at the vehicle the character is climbing
// into rather than at the player.
//
// Each play* method builds a tiny burst synth (noise / sine), routes
// it through a permanent mixGain that's wired into a single
// THREE.PositionalAudio attached to the parent. Browser GC reaps the
// burst nodes once their `.stop()` time passes; the PositionalAudio +
// mixGain stay alive for the character's lifetime.

const REF_DISTANCE = 4;
const ROLLOFF = 1.5;
const MAX_DISTANCE = 35;

export class CharacterSfx
{
	private readonly parent: THREE.Object3D;
	private readonly world: AudioWorldContext;
	private posAudio: THREE.PositionalAudio | null = null;
	private mixGain: GainNode | null = null;

	constructor(parent: THREE.Object3D, world: AudioWorldContext)
	{
		this.parent = parent;
		this.world = world;
	}

	public dispose(): void
	{
		if (this.posAudio !== null)
		{
			this.parent.remove(this.posAudio);
			try { this.posAudio.disconnect(); }
			catch (_e) { /* already disconnected */ }
			this.posAudio = null;
		}
		this.mixGain = null;
	}

	// Build the permanent PositionalAudio + mixGain on first play. Also
	// gates on the global Sound_Effects toggle so callers don't need
	// their own check.
	private ensureNodes(): boolean
	{
		if (!this.world.params?.Sound_Effects) return false;
		if (this.posAudio === null)
		{
			const listener = ensureAudioListener(this.world);
			const ctx = THREE.AudioContext.getContext() as AudioContext;
			this.mixGain = ctx.createGain();
			this.mixGain.gain.value = 1;
			this.posAudio = new THREE.PositionalAudio(listener);
			this.posAudio.setRefDistance(REF_DISTANCE);
			this.posAudio.setRolloffFactor(ROLLOFF);
			this.posAudio.setMaxDistance(MAX_DISTANCE);
			// three's setNodeSource type is narrowed to AudioScheduledSourceNode
			// but accepts any AudioNode at runtime - it just calls
			// audioNode.connect(this.gain). Cast through unknown.
			this.posAudio.setNodeSource(this.mixGain as unknown as AudioScheduledSourceNode);
			this.parent.add(this.posAudio);
		}
		if (this.mixGain!.context.state === 'suspended')
		{
			try { (this.mixGain!.context as AudioContext).resume(); }
			catch (_e) { /* autoplay-blocked, retry next call */ }
		}
		return true;
	}

	private makeNoise(durSeconds: number): AudioBuffer
	{
		const ctx = this.mixGain!.context;
		const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * durSeconds)), ctx.sampleRate);
		const data = buf.getChannelData(0);
		for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
		return buf;
	}

	// Footstep - short noise burst with lowpass + slight pitch jitter.
	// Peak is higher than the global SfxBus equivalent because the
	// PositionalAudio attenuates with distance: refDistance=4 means a
	// camera 5-7 m behind the player already sees ~0.5-0.6 of the
	// signal, so the source has to be louder to land at the same
	// listener-side level.
	public playFootstep(scale: number = 1): void
	{
		if (!this.ensureNodes()) return;
		const ctx = this.mixGain!.context;
		const now = ctx.currentTime;
		const dur = 0.08;

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 500 + Math.random() * 250 * scale;
		filter.Q.value = 1.5;
		const gain = ctx.createGain();
		const peak = 0.5 * scale;
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(peak, now + 0.005);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.mixGain!);
		noise.start(now);
		noise.stop(now + dur);
	}

	// Jump kickoff - upward sine sweep.
	public playJump(): void
	{
		if (!this.ensureNodes()) return;
		const ctx = this.mixGain!.context;
		const now = ctx.currentTime;
		const dur = 0.22;

		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(180, now);
		osc.frequency.exponentialRampToValueAtTime(420, now + dur);
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0, now);
		gain.gain.linearRampToValueAtTime(0.55, now + 0.02);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		osc.connect(gain);
		gain.connect(this.mixGain!);
		osc.start(now);
		osc.stop(now + dur);
	}

	// Landing thump - lowpass noise + sub-bass kick.
	public playLand(force: number = 1): void
	{
		if (!this.ensureNodes()) return;
		const ctx = this.mixGain!.context;
		const now = ctx.currentTime;
		const dur = 0.18;
		const peak = Math.min(1.4, 0.45 * force);

		const noise = ctx.createBufferSource();
		noise.buffer = this.makeNoise(dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 220;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(peak, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		noise.connect(filter);
		filter.connect(gain);
		gain.connect(this.mixGain!);
		noise.start(now);
		noise.stop(now + dur);

		const osc = ctx.createOscillator();
		osc.type = 'sine';
		osc.frequency.setValueAtTime(85, now);
		osc.frequency.exponentialRampToValueAtTime(45, now + 0.1);
		const oscGain = ctx.createGain();
		oscGain.gain.setValueAtTime(peak * 0.5, now);
		oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
		osc.connect(oscGain);
		oscGain.connect(this.mixGain!);
		osc.start(now);
		osc.stop(now + 0.1);
	}

	// Door clunk - filtered square sweep.
	public playDoor(): void
	{
		if (!this.ensureNodes()) return;
		const ctx = this.mixGain!.context;
		const now = ctx.currentTime;
		const dur = 0.12;

		const osc = ctx.createOscillator();
		osc.type = 'square';
		osc.frequency.setValueAtTime(220, now);
		osc.frequency.exponentialRampToValueAtTime(80, now + dur);
		const filter = ctx.createBiquadFilter();
		filter.type = 'lowpass';
		filter.frequency.value = 600;
		const gain = ctx.createGain();
		gain.gain.setValueAtTime(0.4, now);
		gain.gain.exponentialRampToValueAtTime(0.001, now + dur);
		osc.connect(filter);
		filter.connect(gain);
		gain.connect(this.mixGain!);
		osc.start(now);
		osc.stop(now + dur);
	}
}
