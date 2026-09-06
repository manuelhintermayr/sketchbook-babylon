import * as CANNON from 'cannon-es';

import { World } from '../world/World';
import { EngineSound, EngineProfile } from '../world/audio/EngineSound';

// Owns the two audio side-channels every vehicle wires up: the
// continuous EngineSound (registered as a world updatable) and the
// transient crash-audio collide listener on the cannon body. Vehicle
// used to do this inline in addToWorld / removeFromWorld; pulling it
// here keeps Vehicle as a cannon-wrapper and concentrates the audio
// lifecycle (attach + detach) in one place.
//
// Attach contract: pass a non-null `profile` to wire up engine sound
// (subclasses opt in by setting engineSoundProfile in their ctor).
// The crash listener attaches unconditionally - silent vehicles like
// the rocket still want a body-impact thud.

export class VehicleAudioBridge
{
	private collision: CANNON.Body;
	private engineSound: EngineSound | null = null;
	private collideListener: ((e: any) => void) | undefined;

	constructor(collision: CANNON.Body)
	{
		this.collision = collision;
	}

	public attach(world: World, vehicleForEngine: any, profile: EngineProfile | null): void
	{
		if (profile !== null)
		{
			this.engineSound = new EngineSound(vehicleForEngine, world, profile);
			world.registerUpdatable(this.engineSound);
		}

		// Crash audio - cannon fires 'collide' for every contact, so
		// we throttle to ~3/sec and only play when the relative impact
		// velocity is significant. Otherwise resting on a kerb produces
		// a constant rumble. Listener stashed so detach() can remove
		// it; otherwise the closure keeps the vehicle pinned via the
		// body across scenario switches.
		let lastCrashAt = 0;
		this.collideListener = (e: any) =>
		{
			const now = performance.now();
			if (now - lastCrashAt < 350) return;
			const impact = Math.abs(e.contact?.getImpactVelocityAlongNormal?.() ?? 0);
			if (impact < 4) return;
			lastCrashAt = now;
			world.sfxBus.playCrash(Math.min(2, impact * 0.15));
		};
		this.collision.addEventListener('collide', this.collideListener);
	}

	public detach(world: World): void
	{
		if (this.collideListener !== undefined)
		{
			this.collision.removeEventListener('collide', this.collideListener);
			this.collideListener = undefined;
		}
		if (this.engineSound !== null)
		{
			world.unregisterUpdatable(this.engineSound);
			this.engineSound.dispose();
			this.engineSound = null;
		}
	}
}
