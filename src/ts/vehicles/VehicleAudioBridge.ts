import { Observer, PhysicsBody, PhysicsEventType } from '@babylonjs/core';
import type { IPhysicsCollisionEvent } from '@babylonjs/core';

import { World } from '../world/World';
import { EngineSound, EngineProfile } from '../world/audio/EngineSound';

// Owns the two audio side-channels every vehicle wires up: the
// continuous EngineSound (registered as a world updatable) and the
// transient crash-audio collision observer on the chassis body. Vehicle
// used to do this inline in addToWorld / removeFromWorld; pulling it
// here keeps Vehicle as a physics wrapper and concentrates the audio
// lifecycle (attach + detach) in one place.
//
// Attach contract: pass a non-null `profile` to wire up engine sound
// (subclasses opt in by setting engineSoundProfile in their ctor).
// The crash listener attaches unconditionally - silent vehicles like
// the rocket still want a body-impact thud.

// Chassis mass the impulse is normalised against - Havok reports the
// collision impulse (N s), cannon reported the impact velocity along
// the contact normal. impulse / mass approximates that velocity.
const CHASSIS_MASS = 50;

export class VehicleAudioBridge
{
	private collision: PhysicsBody;
	private engineSound: EngineSound | null = null;
	private collideObserver: Observer<IPhysicsCollisionEvent> | null = null;

	constructor(collision: PhysicsBody)
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

		// Crash audio - Havok fires an event for every new contact, so
		// we throttle to ~3/sec and only play when the impact velocity
		// is significant. Otherwise resting on a kerb produces a
		// constant rumble. Observer stashed so detach() can remove it;
		// otherwise the closure keeps the vehicle pinned via the body
		// across scenario switches.
		let lastCrashAt = 0;
		this.collision.setCollisionCallbackEnabled(true);
		this.collideObserver = this.collision.getCollisionObservable().add((event) =>
		{
			if (event.type !== PhysicsEventType.COLLISION_STARTED) return;
			const now = performance.now();
			if (now - lastCrashAt < 350) return;
			const impact = Math.abs(event.impulse ?? 0) / CHASSIS_MASS;
			if (impact < 4) return;
			lastCrashAt = now;
			world.sfxBus.playCrash(Math.min(2, impact * 0.15));
		});
	}

	public detach(world: World): void
	{
		if (this.collideObserver !== null)
		{
			if (!this.collision.isDisposed)
			{
				this.collision.getCollisionObservable().remove(this.collideObserver);
				this.collision.setCollisionCallbackEnabled(false);
			}
			this.collideObserver = null;
		}
		if (this.engineSound !== null)
		{
			world.unregisterUpdatable(this.engineSound);
			this.engineSound.dispose();
			this.engineSound = null;
		}
	}
}
