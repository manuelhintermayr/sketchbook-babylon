import { Camera, Matrix, TransformNode, Vector3 } from '@babylonjs/core';

// Web Audio spatialisation without an engine dependency. three shipped
// AudioListener + PositionalAudio on top of the platform PannerNode;
// Babylon's Sound API is built around loaded clips and doesn't take
// arbitrary synth graphs as sources, so this module re-creates the two
// small three classes the audio code was written against:
//
//   - one shared AudioContext (browsers cap concurrent contexts at ~6)
//   - AudioListener: master gain + the listener pose, refreshed from the
//     camera every frame by SpatialAudioUpdater
//   - PositionalAudio: PannerNode + gain, attached to a TransformNode
//     whose absolute position feeds the panner each frame
//
// Distance attenuation uses the inverse model with refDistance /
// rolloffFactor / maxDistance exactly as before, so every tuning value
// in CharacterSfx, BirdSound and Speaker carries over unchanged.

let sharedContext: AudioContext | null = null;

export function getAudioContext(): AudioContext
{
	if (sharedContext === null)
	{
		sharedContext = new AudioContext();
	}
	return sharedContext;
}

const _camWorld = new Matrix();
const _forward = new Vector3();
const _up = new Vector3();
const _pos = new Vector3();

export class AudioListener
{
	public context: AudioContext;
	public gain: GainNode;
	public sources: Set<PositionalAudio> = new Set();

	private masterVolume: number = 1;

	constructor()
	{
		this.context = getAudioContext();
		this.gain = this.context.createGain();
		this.gain.connect(this.context.destination);
	}

	public getMasterVolume(): number
	{
		return this.masterVolume;
	}

	public setMasterVolume(value: number): void
	{
		this.masterVolume = value;
		this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01);
	}

	// Pushes the camera pose into the platform listener. In a right-handed
	// scene the camera looks down its local -Z, so the forward vector is
	// the negated third row of the world matrix.
	public updateFromCamera(camera: Camera): void
	{
		_camWorld.copyFrom(camera.getWorldMatrix());
		const m = _camWorld.m;
		_pos.set(m[12], m[13], m[14]);
		_forward.set(-m[8], -m[9], -m[10]).normalize();
		_up.set(m[4], m[5], m[6]).normalize();

		const listener = this.context.listener;
		const t = this.context.currentTime;
		if (listener.positionX !== undefined)
		{
			listener.positionX.setTargetAtTime(_pos.x, t, 0.01);
			listener.positionY.setTargetAtTime(_pos.y, t, 0.01);
			listener.positionZ.setTargetAtTime(_pos.z, t, 0.01);
			listener.forwardX.setTargetAtTime(_forward.x, t, 0.01);
			listener.forwardY.setTargetAtTime(_forward.y, t, 0.01);
			listener.forwardZ.setTargetAtTime(_forward.z, t, 0.01);
			listener.upX.setTargetAtTime(_up.x, t, 0.01);
			listener.upY.setTargetAtTime(_up.y, t, 0.01);
			listener.upZ.setTargetAtTime(_up.z, t, 0.01);
		}
		else
		{
			listener.setPosition(_pos.x, _pos.y, _pos.z);
			listener.setOrientation(_forward.x, _forward.y, _forward.z, _up.x, _up.y, _up.z);
		}

		for (const source of this.sources) source.updatePosition();
	}
}

export class PositionalAudio
{
	public listener: AudioListener;
	public context: AudioContext;
	public panner: PannerNode;
	public gain: GainNode;
	public parent: TransformNode | null = null;

	private source: AudioNode | null = null;
	private mediaSource: MediaElementAudioSourceNode | null = null;

	constructor(listener: AudioListener)
	{
		this.listener = listener;
		this.context = listener.context;

		this.panner = this.context.createPanner();
		this.panner.panningModel = 'HRTF';
		this.panner.distanceModel = 'inverse';
		this.gain = this.context.createGain();

		this.panner.connect(this.gain);
		this.gain.connect(listener.gain);
	}

	public setRefDistance(value: number): void { this.panner.refDistance = value; }
	public setRolloffFactor(value: number): void { this.panner.rolloffFactor = value; }
	public setMaxDistance(value: number): void { this.panner.maxDistance = value; }
	public setVolume(value: number): void { this.gain.gain.setTargetAtTime(value, this.context.currentTime, 0.01); }

	// Routes an arbitrary node (the tail of a synth graph) into the panner.
	public setNodeSource(node: AudioNode): void
	{
		this.disconnectSource();
		this.source = node;
		node.connect(this.panner);
	}

	public setMediaElementSource(element: HTMLMediaElement): void
	{
		this.disconnectSource();
		this.mediaSource = this.context.createMediaElementSource(element);
		this.source = this.mediaSource;
		this.mediaSource.connect(this.panner);
	}

	// Follows the parent node's world position from now on. Mirrors
	// `parent.add(positionalAudio)` in the three version.
	public attachTo(parent: TransformNode): void
	{
		this.parent = parent;
		this.listener.sources.add(this);
		this.updatePosition();
	}

	public detach(): void
	{
		this.listener.sources.delete(this);
		this.parent = null;
	}

	public updatePosition(): void
	{
		if (this.parent === null || this.parent.isDisposed()) return;
		const p = this.parent.getAbsolutePosition();
		const t = this.context.currentTime;
		if (this.panner.positionX !== undefined)
		{
			this.panner.positionX.setTargetAtTime(p.x, t, 0.02);
			this.panner.positionY.setTargetAtTime(p.y, t, 0.02);
			this.panner.positionZ.setTargetAtTime(p.z, t, 0.02);
		}
		else
		{
			this.panner.setPosition(p.x, p.y, p.z);
		}
	}

	private disconnectSource(): void
	{
		if (this.source !== null)
		{
			try { this.source.disconnect(this.panner); }
			catch (_e) { /* already disconnected */ }
			this.source = null;
		}
		this.mediaSource = null;
	}

	public disconnect(): void
	{
		this.detach();
		this.disconnectSource();
		try { this.panner.disconnect(); this.gain.disconnect(); }
		catch (_e) { /* already disconnected */ }
	}
}
