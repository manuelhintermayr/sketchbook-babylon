import * as THREE from 'three';
import { World } from '../World';
import { IWorldEntity } from '../../interfaces/IWorldEntity';
import { EntityType } from '../../enums/EntityType';
import { UpdateOrder } from '../../enums/UpdateOrder';
import { createMediaAudioElement, ensureAudioListener } from './AudioHelpers';

// 3D positional audio source, simplified port of tkkaushik369/socketControl's
// Speaker. The original spawned an HTMLMesh with a play/pause checkbox;
// this single-player port autoplays after the first user gesture and
// relies on THREE.PositionalAudio for distance-attenuated playback.
//
// Map authoring: drop an Empty in world.glb with userData.data='speaker'
// and userData.audio='<asset-path>'. World.loadScene picks it up and
// spawns a yellow wireframe sphere with a looping audio source attached.
export class Speaker extends THREE.Object3D implements IWorldEntity
{
	public entityType: EntityType = EntityType.Speaker;
	public updateOrder: number = UpdateOrder.Audio;

	public audio:
	{
		dom: HTMLAudioElement | null;
		source: HTMLSourceElement | null;
		posaudio: THREE.PositionalAudio | null;
	};

	private static gestureBound = false;
	private static pendingResume: HTMLAudioElement[] = [];

	constructor(audioUrl: string, world: World)
	{
		super();

		this.audio = { dom: null, source: null, posaudio: null };

		const mesh = new THREE.Mesh(
			new THREE.SphereGeometry(0.5, 8, 4),
			new THREE.MeshPhongMaterial({ color: 0xffff00, wireframe: true }),
		);
		mesh.position.set(0, 1, 0);
		this.add(mesh);

		this.attachAudio(audioUrl, world);
	}

	private attachAudio(audioUrl: string, world: World): void
	{
		const listener = ensureAudioListener(world);
		const { dom: audioDom, source: sourceDom } = createMediaAudioElement(audioUrl);

		const posAudio = new THREE.PositionalAudio(listener);
		posAudio.setMediaElementSource(audioDom);
		posAudio.setRefDistance(2);
		posAudio.setRolloffFactor(1.5);
		this.add(posAudio);

		this.audio = { dom: audioDom, source: sourceDom, posaudio: posAudio };

		// Browsers block autoplay until the user interacts with the page.
		// Park the element until the first click/keypress and start them
		// all together so multiple speakers stay in sync-ish.
		const tryPlay = audioDom.play();
		if (tryPlay && typeof tryPlay.then === 'function')
		{
			tryPlay.catch(() => Speaker.queueResume(audioDom));
		}
	}

	private static queueResume(el: HTMLAudioElement): void
	{
		Speaker.pendingResume.push(el);
		if (Speaker.gestureBound) return;
		Speaker.gestureBound = true;

		const start = () =>
		{
			window.removeEventListener('pointerdown', start);
			window.removeEventListener('keydown', start);
			Speaker.pendingResume.forEach((a) => a.play().catch(() => undefined));
			Speaker.pendingResume = [];
		};
		window.addEventListener('pointerdown', start, { once: true });
		window.addEventListener('keydown', start, { once: true });
	}

	public addToWorld(world: World): void
	{
		world.graphicsWorld.add(this);
	}

	public removeFromWorld(world: World): void
	{
		world.graphicsWorld.remove(this);
		if (this.audio.dom)
		{
			// Drop the dom element from the gesture-pending queue too -
			// the static array would otherwise keep a reference to a
			// paused, detached audio node across scenario switches that
			// happen before the user has clicked anywhere yet, and the
			// next gesture would try to .play() it for nothing.
			const idx = Speaker.pendingResume.indexOf(this.audio.dom);
			if (idx !== -1) Speaker.pendingResume.splice(idx, 1);
			this.audio.dom.pause();
			this.audio.dom.remove();
		}
	}

	public update(_timeStep: number): void { }
}
