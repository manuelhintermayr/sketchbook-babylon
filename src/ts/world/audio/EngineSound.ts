import { Vehicle } from '../../vehicles/Vehicle';
import { ProceduralAudio } from './ProceduralAudio';
import { AudioWorldContext } from './AudioHelpers';

// Procedural engine sound: 2-layer Web Audio synthesis (sawtooth +
// square exhaust through a lowpass + bandpass-filtered noise intake)
// modulated by chassis speed. Per-vehicle profile (idle / max / gain
// shape) lets each vehicle type have its own timbre without code
// duplication.
//
// Lifecycle (start / stop / master volume sync / autoplay-resume) is
// inherited from ProceduralAudio; this file just builds the synth
// graph and updates its parameters from chassis speed each frame.

export interface EngineProfile
{
	idleFreq: number;
	maxFreq: number;
	exhaustGain: number;
	intakeGain: number;
	exhaustLowpass: number;
	speedDivisor: number;
}

export const ENGINE_PROFILES: { [name: string]: EngineProfile } =
{
	car:      { idleFreq: 55, maxFreq: 220, exhaustGain: 0.30, intakeGain: 0.15, exhaustLowpass: 200, speedDivisor: 40 },
	heli:     { idleFreq: 80, maxFreq: 250, exhaustGain: 0.25, intakeGain: 0.20, exhaustLowpass: 350, speedDivisor: 25 },
	airplane: { idleFreq: 70, maxFreq: 280, exhaustGain: 0.28, intakeGain: 0.22, exhaustLowpass: 300, speedDivisor: 60 },
	boat:     { idleFreq: 45, maxFreq: 180, exhaustGain: 0.32, intakeGain: 0.10, exhaustLowpass: 150, speedDivisor: 20 },
	rocket:   { idleFreq: 30, maxFreq: 110, exhaustGain: 0.40, intakeGain: 0.25, exhaustLowpass: 120, speedDivisor: 80 },
};

interface EngineNodes
{
	exhaustOsc1: OscillatorNode;
	exhaustOsc2: OscillatorNode;
	exhaustFilter: BiquadFilterNode;
	exhaustGain: GainNode;
	intakeSource: AudioBufferSourceNode;
	intakeFilter: BiquadFilterNode;
	intakeGain: GainNode;
	compressor: DynamicsCompressorNode;
}

const IDLE_RPM = 800;
const MAX_RPM = 6000;

export class EngineSound extends ProceduralAudio
{
	protected readonly masterMix = 1.0;

	private vehicle: Vehicle;
	private profile: EngineProfile;
	private nodes: EngineNodes | null = null;
	private rpm: number = IDLE_RPM;

	constructor(vehicle: Vehicle, world: AudioWorldContext, profile: EngineProfile)
	{
		super(world);
		this.vehicle = vehicle;
		this.profile = profile;
	}

	protected shouldPlay(): boolean
	{
		return !!this.world.params?.Sound_Effects
			&& this.vehicle.controllingCharacter !== undefined;
	}

	protected buildSynth(ctx: AudioContext, master: GainNode): void
	{
		const compressor = ctx.createDynamicsCompressor();
		compressor.threshold.value = -24;
		compressor.knee.value = 30;
		compressor.ratio.value = 12;
		compressor.attack.value = 0.003;
		compressor.release.value = 0.25;
		compressor.connect(master);

		const exhaustOsc1 = ctx.createOscillator();
		exhaustOsc1.type = 'sawtooth';
		exhaustOsc1.frequency.value = this.profile.idleFreq;

		const exhaustOsc2 = ctx.createOscillator();
		exhaustOsc2.type = 'square';
		exhaustOsc2.frequency.value = this.profile.idleFreq * 0.5;

		const exhaustFilter = ctx.createBiquadFilter();
		exhaustFilter.type = 'lowpass';
		exhaustFilter.frequency.value = this.profile.exhaustLowpass;

		const exhaustGain = ctx.createGain();
		exhaustGain.gain.value = this.profile.exhaustGain;

		exhaustOsc1.connect(exhaustFilter);
		exhaustOsc2.connect(exhaustFilter);
		exhaustFilter.connect(exhaustGain);
		exhaustGain.connect(compressor);
		exhaustOsc1.start();
		exhaustOsc2.start();

		const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const noiseData = noiseBuffer.getChannelData(0);
		for (let i = 0; i < noiseData.length; i++)
		{
			noiseData[i] = Math.random() * 2 - 1;
		}

		const intakeSource = ctx.createBufferSource();
		intakeSource.buffer = noiseBuffer;
		intakeSource.loop = true;

		const intakeFilter = ctx.createBiquadFilter();
		intakeFilter.type = 'bandpass';
		intakeFilter.frequency.value = 800;
		intakeFilter.Q.value = 2;

		const intakeGain = ctx.createGain();
		intakeGain.gain.value = 0;

		intakeSource.connect(intakeFilter);
		intakeFilter.connect(intakeGain);
		intakeGain.connect(compressor);
		intakeSource.start();

		this.nodes =
		{
			exhaustOsc1, exhaustOsc2, exhaustFilter, exhaustGain,
			intakeSource, intakeFilter, intakeGain,
			compressor,
		};
		this.rpm = IDLE_RPM;
	}

	protected teardownSynth(): void
	{
		const n = this.nodes;
		if (n === null) return;
		try
		{
			n.exhaustOsc1.stop();
			n.exhaustOsc2.stop();
			n.intakeSource.stop();
			n.compressor.disconnect();
		}
		catch (_e)
		{
			// Already stopped - Web Audio throws InvalidStateError if
			// stop() is called twice; safe to swallow.
		}
		this.nodes = null;
	}

	protected updateSynth(unscaledTimeStep: number): void
	{
		const n = this.nodes;
		if (n === null) return;

		const dt = Math.min(unscaledTimeStep, 0.05);

		// Velocity can briefly go non-finite when cannon resolves an
		// extreme contact (the rocket teleporting to the moon pad
		// produces a one-tick NaN in some browsers). Skip the frame
		// instead of propagating it into AudioParam.value, which throws
		// 'The provided float value is non-finite.' and tears down the
		// whole synth.
		const v = this.vehicle.collision.velocity;
		const speedSq = v.x * v.x + v.z * v.z;
		if (!Number.isFinite(speedSq)) return;

		// rpm is integrated across frames - one bad frame in the past
		// would otherwise stick NaN into it forever. Reset to idle if it
		// has somehow gone non-finite.
		if (!Number.isFinite(this.rpm)) this.rpm = IDLE_RPM;

		const speed = Math.sqrt(speedSq);
		const speedFactor = Math.min(speed / this.profile.speedDivisor, 1);

		const targetRPM = IDLE_RPM + (MAX_RPM - IDLE_RPM) * speedFactor;
		this.rpm += (targetRPM - this.rpm) * Math.min(1, dt * 5);
		const rpmFactor = (this.rpm - IDLE_RPM) / (MAX_RPM - IDLE_RPM);

		const baseFreq = this.profile.idleFreq + (this.profile.maxFreq - this.profile.idleFreq) * rpmFactor;
		n.exhaustOsc1.frequency.value = baseFreq;
		n.exhaustOsc2.frequency.value = baseFreq * 0.5;
		n.exhaustFilter.frequency.value = this.profile.exhaustLowpass + rpmFactor * 400;
		n.exhaustGain.gain.value = this.profile.exhaustGain * (0.7 + rpmFactor * 0.3);

		n.intakeFilter.frequency.value = 600 + rpmFactor * 1200;
		n.intakeGain.gain.value = speedFactor > 0.1
			? this.profile.intakeGain * speedFactor * (0.5 + rpmFactor)
			: 0;
	}
}
