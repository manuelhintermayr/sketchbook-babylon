import { ProceduralAudio } from './ProceduralAudio';
import { AudioWorldContext } from './AudioHelpers';

// Looped background-music bus. Plays the bundled MP3s in audio/music/
// in shuffled order, advancing on each track's `ended` event and
// reshuffling once every track has cycled through.
//
// Routes through the shared Web Audio graph - the file plays out of
// an HTMLAudioElement, but the audio is piped via
// MediaElementAudioSourceNode -> perBusGain (Music_Volume) -> master
// (Master_Volume * masterMix). Same destination chain as EngineSound
// and AmbientSound, so a future master compressor / ducking node sits
// between this layer and the speakers automatically.
//
// Lifecycle inherited from ProceduralAudio: shouldPlay flips active,
// buildSynth wires the graph the first time we start, teardownSynth
// cleans up after a 200 ms gain ramp. The AudioContext is the shared
// THREE.AudioContext singleton.
const TRACKS = [
	'audio/music/Concrete Spawn.mp3',
	'audio/music/Just This Summer.mp3',
	'audio/music/Tape Confetti.mp3',
];

interface MusicNodes
{
	audioEl: HTMLAudioElement;
	source: MediaElementAudioSourceNode;
	perBusGain: GainNode;
	onEnded: () => void;
}

export class BackgroundMusic extends ProceduralAudio
{
	protected readonly masterMix = 1.0;

	private nodes: MusicNodes | null = null;
	private order: number[];
	private cursor: number = 0;

	constructor(world: AudioWorldContext)
	{
		super(world);
		this.order = this.shuffledOrder();
	}

	protected shouldPlay(): boolean
	{
		return !!this.world.params?.Background_Music && TRACKS.length > 0;
	}

	protected buildSynth(ctx: AudioContext, master: GainNode): void
	{
		// Fresh HTMLAudioElement each cycle - MediaElementAudioSource
		// can only be attached to one element once, and the previous
		// element + source were disconnected in teardownSynth.
		const audioEl = new Audio();
		audioEl.preload = 'auto';

		const source = ctx.createMediaElementSource(audioEl);
		const perBusGain = ctx.createGain();
		perBusGain.gain.value = this.musicGain();

		source.connect(perBusGain);
		perBusGain.connect(master);

		const onEnded = (): void => this.advanceAndPlay();
		audioEl.addEventListener('ended', onEnded);

		this.nodes = { audioEl, source, perBusGain, onEnded };

		// Kick off the current track. Autoplay-policy rejection (no
		// gesture yet) is silent - the next user interaction wakes the
		// AudioContext and the play() retried below in advanceAndPlay
		// or here when shouldPlay flips on after a click goes through.
		audioEl.src = encodeURI(TRACKS[this.order[this.cursor]]);
		audioEl.play().catch(() => { /* autoplay blocked - retry on next gesture */ });
	}

	protected teardownSynth(): void
	{
		const n = this.nodes;
		if (n === null) return;
		n.audioEl.removeEventListener('ended', n.onEnded);
		n.audioEl.pause();
		try
		{
			n.source.disconnect();
			n.perBusGain.disconnect();
		}
		catch (_e) { /* already disconnected */ }
		this.nodes = null;
	}

	protected updateSynth(_unscaledTimeStep: number): void
	{
		const n = this.nodes;
		if (n === null || this.ctx === null) return;
		// Music_Volume slider rides between Source and Master, so a
		// player can pull music down without affecting engine + ambient
		// + positional audio. Master is handled by ProceduralAudio.
		n.perBusGain.gain.setTargetAtTime(this.musicGain(), this.ctx.currentTime, 0.1);
	}

	private advanceAndPlay(): void
	{
		this.cursor = (this.cursor + 1) % this.order.length;
		// Reshuffle each time the playlist wraps so a long session
		// doesn't replay in the exact same cycle.
		if (this.cursor === 0) this.order = this.shuffledOrder();
		const n = this.nodes;
		if (n === null) return;
		n.audioEl.src = encodeURI(TRACKS[this.order[this.cursor]]);
		n.audioEl.play().catch(() => { /* noop */ });
	}

	private musicGain(): number
	{
		return Math.max(0, Math.min(1, (this.world.params?.Music_Volume ?? 60) / 100));
	}

	private shuffledOrder(): number[]
	{
		const arr = TRACKS.map((_, i) => i);
		// Fisher-Yates so each cycle is uniformly random.
		for (let i = arr.length - 1; i > 0; i--)
		{
			const j = Math.floor(Math.random() * (i + 1));
			[arr[i], arr[j]] = [arr[j], arr[i]];
		}
		return arr;
	}
}
