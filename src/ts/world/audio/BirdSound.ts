import * as THREE from 'three';
import { AudioWorldContext, ensureAudioListener } from './AudioHelpers';

// Per-bird positional chirp synth. Same FM-bird timbre that used to
// live globally in AmbientSound; here it sits on a THREE.PositionalAudio
// attached to the bird's group so chirps fade with distance and pan
// from the bird's actual location.
//
// Lifecycle is gated on params.Sound_Effects: started lazily on first
// audio gesture (browser autoplay policy) and stopped when the toggle
// flips off. Carrier + modulator run continuously with gain=0 between
// bursts; scheduleChirp() pulses the gain on a Poisson schedule.
//
// Chirp cadence is wider per-bird (5-12 s) than the original global
// scheduler (2-7 s) - with 7 birds in flight the aggregate chirp rate
// stays close to a real morning ambience instead of constant noise.

const BIRD_GAIN = 0.6;
const REF_DISTANCE = 8;
const ROLLOFF = 1.2;
const MAX_DISTANCE = 60;
const CHIRP_DELAY_MIN_MS = 5000;
const CHIRP_DELAY_RANGE_MS = 7000;

interface BirdNodes
{
	carrier: OscillatorNode;
	modulator: OscillatorNode;
	modGain: GainNode;
	filter: BiquadFilterNode;
	gain: GainNode;
}

export class BirdSound
{
	private readonly parent: THREE.Object3D;
	private readonly world: AudioWorldContext;
	private positionalAudio: THREE.PositionalAudio | null = null;
	private nodes: BirdNodes | null = null;
	private chirpTimeout: ReturnType<typeof setTimeout> | undefined;
	private active: boolean = false;

	constructor(parent: THREE.Object3D, world: AudioWorldContext)
	{
		this.parent = parent;
		this.world = world;
	}

	public update(): void
	{
		const should = !!this.world.params?.Sound_Effects;

		if (should && !this.active)
		{
			this.start();
			this.active = true;
		}
		else if (!should && this.active)
		{
			this.stop();
			this.active = false;
		}
	}

	public dispose(): void
	{
		if (this.active) this.stop();
		this.active = false;
	}

	private start(): void
	{
		const listener = ensureAudioListener(this.world);
		const ctx = THREE.AudioContext.getContext() as AudioContext;

		const carrier = ctx.createOscillator();
		carrier.type = 'sine';
		carrier.frequency.value = 2000;

		const modulator = ctx.createOscillator();
		modulator.type = 'sine';
		modulator.frequency.value = 8;

		const modGain = ctx.createGain();
		modGain.gain.value = 500;

		const filter = ctx.createBiquadFilter();
		filter.type = 'bandpass';
		filter.frequency.value = 3000;
		filter.Q.value = 2;

		const gain = ctx.createGain();
		gain.gain.value = 0;

		modulator.connect(modGain);
		modGain.connect(carrier.frequency);
		carrier.connect(filter);
		filter.connect(gain);

		const posAudio = new THREE.PositionalAudio(listener);
		posAudio.setRefDistance(REF_DISTANCE);
		posAudio.setRolloffFactor(ROLLOFF);
		posAudio.setMaxDistance(MAX_DISTANCE);
		// three's setNodeSource type is narrowed to AudioScheduledSourceNode
		// in @types/three but the runtime accepts any AudioNode (it just
		// calls audioNode.connect(this.gain)). Cast through unknown so we
		// can feed the end of our filter chain directly.
		posAudio.setNodeSource(gain as unknown as AudioScheduledSourceNode);
		this.parent.add(posAudio);

		carrier.start();
		modulator.start();

		this.positionalAudio = posAudio;
		this.nodes = { carrier, modulator, modGain, filter, gain };

		this.scheduleChirp();
	}

	private stop(): void
	{
		if (this.chirpTimeout !== undefined)
		{
			clearTimeout(this.chirpTimeout);
			this.chirpTimeout = undefined;
		}

		const n = this.nodes;
		if (n !== null)
		{
			try { n.carrier.stop(); n.modulator.stop(); }
			catch (_e) { /* already stopped */ }
			this.nodes = null;
		}

		if (this.positionalAudio !== null)
		{
			this.parent.remove(this.positionalAudio);
			try { this.positionalAudio.disconnect(); }
			catch (_e) { /* already disconnected */ }
			this.positionalAudio = null;
		}
	}

	// FM bird chirp scheduler. Pokes carrier frequency + briefly opens
	// the gain for a short burst, then reschedules itself on a 5-12 s
	// random delay. Cleared in stop() so a teardown doesn't leave a
	// dangling timer poking dead nodes.
	private scheduleChirp(): void
	{
		const delay = CHIRP_DELAY_MIN_MS + Math.random() * CHIRP_DELAY_RANGE_MS;
		this.chirpTimeout = setTimeout(() =>
		{
			const n = this.nodes;
			if (n === null) return;
			const ctx = n.gain.context;
			if (ctx.state === 'closed') return;

			const now = ctx.currentTime;
			const chirpCount = 1 + Math.floor(Math.random() * 4);
			const chirpDuration = 0.1 + Math.random() * 0.2;

			for (let c = 0; c < chirpCount; c++)
			{
				const t = now + c * (chirpDuration + 0.05);
				n.carrier.frequency.setValueAtTime(1500 + Math.random() * 2000, t);
				n.modulator.frequency.setValueAtTime(5 + Math.random() * 15, t);
				n.gain.gain.linearRampToValueAtTime(BIRD_GAIN, t + 0.02);
				n.gain.gain.linearRampToValueAtTime(0, t + chirpDuration);
			}

			this.scheduleChirp();
		}, delay);
	}
}
