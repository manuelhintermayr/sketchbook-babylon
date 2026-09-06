import * as THREE from 'three';

// Cross-cutting helpers + the slim World contract every audio class
// depends on. Audio modules used to import the full World class (~636
// LOC) just to read params + camera; AudioWorldContext narrows that
// to the handful of fields actually used. World still implements this
// structurally - no changes there - but a stub or test fake can now
// replace it without dragging in renderer / physics / scenarios.

// 0..100 lil-gui slider params surfaced to audio. All optional so the
// interface tolerates the partial-init phase before lil-gui has
// attached the full param panel.
export interface AudioParams
{
	Master_Audio?: boolean;
	Master_Volume?: number;
	Sound_Effects?: boolean;
	Background_Music?: boolean;
	Music_Volume?: number;
}

export interface AudioWorldContext
{
	params: AudioParams;
	camera: THREE.Camera;
	// Lazily created on the first positional source. Mutable so
	// ensureAudioListener can write the freshly-built listener back.
	audioListener: THREE.AudioListener | null;
	// Only null-checked (water-proximity gate in AmbientSound). The
	// concrete Ocean class isn't part of the audio contract.
	ocean: unknown;
}

// World.params.Master_Volume is a 0..100 slider; audio nodes need a
// 0..1 gain factor. Default 80 mirrors the lil-gui default so silence
// before the first frame doesn't surprise. Master_Audio is the global
// on/off toggle - when off, every audio source returns 0 here and
// goes silent regardless of its own per-bucket toggle / volume.
export function getMasterVolume(world: AudioWorldContext): number
{
	if (world.params?.Master_Audio === false) return 0;
	return (world.params?.Master_Volume ?? 80) / 100;
}

// Lazily create the world's AudioListener and attach it to the camera
// the first time something positional is built. Honours both the
// persisted Master_Volume and the Master_Audio mute flag so 3D-
// positional sources start at the correct level (zero when muted)
// without waiting for the next slider change.
export function ensureAudioListener(world: AudioWorldContext): THREE.AudioListener
{
	let listener = world.audioListener;
	if (listener === null)
	{
		listener = new THREE.AudioListener();
		world.camera.add(listener);
		world.audioListener = listener;
		const muted = world.params?.Master_Audio === false;
		const stored = world.params?.Master_Volume;
		if (muted)
		{
			listener.setMasterVolume(0);
		}
		else if (typeof stored === 'number')
		{
			listener.setMasterVolume(stored / 100);
		}
	}
	return listener;
}

// Web-platform helper: build the <audio> + <source> DOM pair Speaker
// uses for sample-based positional sources, attach to body. Lifted out
// of Speaker so the domain class stops touching DOM directly.
export interface MediaAudioElements
{
	dom: HTMLAudioElement;
	source: HTMLSourceElement;
}

export function createMediaAudioElement(audioUrl: string): MediaAudioElements
{
	const dom = document.createElement('audio');
	dom.preload = 'auto';
	dom.loop = true;
	dom.crossOrigin = 'anonymous';
	dom.style.display = 'none';

	const source = document.createElement('source');
	source.src = audioUrl;
	dom.appendChild(source);
	document.body.appendChild(dom);

	return { dom, source };
}
