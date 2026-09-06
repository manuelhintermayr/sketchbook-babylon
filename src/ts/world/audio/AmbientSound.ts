import { ProceduralAudio } from './ProceduralAudio';
import { AudioWorldContext } from './AudioHelpers';

// Procedural ambient atmosphere - wind (filtered white noise) and
// water (bandpass-filtered noise modulated by an LFO, gated by camera
// proximity to the ocean). Bird chirps moved out to per-bird
// PositionalAudio in Birds.ts so they fall off with distance instead
// of playing flat across the whole world.
//
// Lifecycle (start / stop / master volume sync / autoplay-resume) is
// inherited from ProceduralAudio; this file only builds the synth
// graph and updates per-frame water-proximity gating.

const WIND_GAIN = 0.08;
const WATER_GAIN = 0.12;

interface AmbientNodes
{
	windSource: AudioBufferSourceNode;
	windLowpass: BiquadFilterNode;
	windHighpass: BiquadFilterNode;
	windGain: GainNode;
	waterSource: AudioBufferSourceNode;
	waterFilter: BiquadFilterNode;
	waterLfo: OscillatorNode;
	waterLfoGain: GainNode;
	waterGain: GainNode;
}

export class AmbientSound extends ProceduralAudio
{
	protected readonly masterMix = 0.7;

	private nodes: AmbientNodes | null = null;

	constructor(world: AudioWorldContext)
	{
		super(world);
	}

	protected shouldPlay(): boolean
	{
		return !!this.world.params?.Sound_Effects;
	}

	protected buildSynth(ctx: AudioContext, master: GainNode): void
	{
		const noiseBuffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
		const noiseData = noiseBuffer.getChannelData(0);
		for (let i = 0; i < noiseData.length; i++)
		{
			noiseData[i] = Math.random() * 2 - 1;
		}

		// Wind - looped white noise through a low + highpass to land in
		// the rumbly mid-low range a real outdoor breeze sits in.
		const windSource = ctx.createBufferSource();
		windSource.buffer = noiseBuffer;
		windSource.loop = true;

		const windLowpass = ctx.createBiquadFilter();
		windLowpass.type = 'lowpass';
		windLowpass.frequency.value = 400;
		windLowpass.Q.value = 0.5;

		const windHighpass = ctx.createBiquadFilter();
		windHighpass.type = 'highpass';
		windHighpass.frequency.value = 100;
		windHighpass.Q.value = 0.5;

		const windGain = ctx.createGain();
		windGain.gain.value = WIND_GAIN;

		windSource.connect(windLowpass);
		windLowpass.connect(windHighpass);
		windHighpass.connect(windGain);
		windGain.connect(master);
		windSource.start();

		// Water - bandpass-filtered noise with a slow LFO sweeping the
		// filter centre. Gated by proximity to the ocean each frame.
		const waterSource = ctx.createBufferSource();
		waterSource.buffer = noiseBuffer;
		waterSource.loop = true;

		const waterFilter = ctx.createBiquadFilter();
		waterFilter.type = 'bandpass';
		waterFilter.frequency.value = 300;
		waterFilter.Q.value = 1;

		const waterLfo = ctx.createOscillator();
		waterLfo.type = 'sine';
		waterLfo.frequency.value = 0.15;

		const waterLfoGain = ctx.createGain();
		waterLfoGain.gain.value = 100;

		const waterGain = ctx.createGain();
		waterGain.gain.value = 0;

		waterLfo.connect(waterLfoGain);
		waterLfoGain.connect(waterFilter.frequency);
		waterSource.connect(waterFilter);
		waterFilter.connect(waterGain);
		waterGain.connect(master);
		waterSource.start();
		waterLfo.start();

		this.nodes =
		{
			windSource, windLowpass, windHighpass, windGain,
			waterSource, waterFilter, waterLfo, waterLfoGain, waterGain,
		};
	}

	protected teardownSynth(): void
	{
		const n = this.nodes;
		if (n === null) return;
		try
		{
			n.windSource.stop();
			n.waterSource.stop();
			n.waterLfo.stop();
		}
		catch (_e)
		{
			// Already stopped.
		}
		this.nodes = null;
	}

	protected updateSynth(_unscaledTimeStep: number): void
	{
		const n = this.nodes;
		if (n === null || this.ctx === null) return;

		// Water proximity gate. Inthenew's ocean tiles sit at y=12; we
		// gate the water synth on the camera being within 10m of that
		// vertical level - so a player on the spawn pad (cam ~y=23) is
		// out, but anyone walking to the strand or jumping in (cam ~y=14)
		// hears the surf. Cheap approximation; getWaveHeightAt would be
		// more accurate but allocates per call which is wasted for an
		// on/off gate.
		const cam = this.world.camera.position;
		const oceanY = 12;
		const nearWater = this.world.ocean !== null && Math.abs(cam.y - oceanY) < 10;
		n.waterGain.gain.setTargetAtTime(nearWater ? WATER_GAIN : 0, this.ctx.currentTime, 0.3);
	}
}
