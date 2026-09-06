import { IUpdatable } from '../interfaces/IUpdatable';
import { UpdateOrder } from '../enums/UpdateOrder';
import { World } from '../world/World';
import { sineNoise } from './NoiseLibrary';

// Per-frame camera-position perturbation triggered on impact events
// (vehicle hard landings, collisions). Pattern adapted from
// manuelhintermayr-portfolio/three-js useCameraShake - reshaped from a
// React hook into an IUpdatable that owns its own active-shake list and
// exposes a static fire-and-forget API so any vehicle / scene code can
// trigger it without touching the world reference.
//
// Runs in the PostCamera slot (after Camera) so the shake offset is
// applied on top of whatever the camera operator just computed for this
// frame. The offset is written back into camera.position directly; the
// next CameraOperator.update() resets the position from theta/phi/radius
// so accumulated shake never sticks.

export type ShakeType = 'collision' | 'land' | 'boost';

interface ShakePreset
{
	intensity: number;
	duration: number;
	frequency: number;
}

const PRESETS: { [key in ShakeType]: ShakePreset } =
{
	collision: { intensity: 0.5,  duration: 0.4,  frequency: 25 },
	land:      { intensity: 0.25, duration: 0.25, frequency: 20 },
	boost:     { intensity: 0.12, duration: 0.8,  frequency: 15 },
};

interface ActiveShake
{
	preset: ShakePreset;
	multiplier: number;
	elapsed: number;
}

export class CameraShake implements IUpdatable
{
	public updateOrder: number = UpdateOrder.PostCamera;

	private static instance: CameraShake | undefined;
	private active: ActiveShake[] = [];
	private world: World;

	constructor(world: World)
	{
		this.world = world;
		CameraShake.instance = this;
	}

	// Fire-and-forget API. Called from anywhere; silently no-ops if
	// camera shake is disabled or no instance has been constructed yet.
	public static trigger(type: ShakeType, multiplier: number = 1): void
	{
		const inst = CameraShake.instance;
		if (inst === undefined) return;
		if (!inst.world.params?.Camera_Shake) return;

		inst.active.push({
			preset: PRESETS[type],
			multiplier,
			elapsed: 0,
		});
	}

	public update(_timeStep: number, unscaledTimeStep: number): void
	{
		if (this.active.length === 0) return;
		if (!this.world.params?.Camera_Shake)
		{
			// Toggle was flipped off mid-shake - drop the queue.
			this.active.length = 0;
			return;
		}

		// Use unscaled time so a paused / slow-mo world doesn't freeze
		// the shake decay (would feel mushy).
		const dt = Math.min(unscaledTimeStep, 0.1);

		let ox = 0;
		let oy = 0;
		let oz = 0;

		for (let i = this.active.length - 1; i >= 0; i--)
		{
			const s = this.active[i];
			s.elapsed += dt;

			if (s.elapsed >= s.preset.duration)
			{
				this.active.splice(i, 1);
				continue;
			}

			// Quadratic decay envelope - most of the kick is in the first
			// half of the duration, then it tapers out smoothly.
			const progress = s.elapsed / s.preset.duration;
			const envelope = (1 - progress) * (1 - progress);
			const strength = s.preset.intensity * s.multiplier * envelope;

			const t = s.elapsed * s.preset.frequency;
			const noise = sineNoise(t, t * 0.7, t * 1.3, t);

			ox += noise[0] * strength;
			oy += noise[1] * strength;
			oz += noise[2] * strength;
		}

		const cam = this.world.camera;
		cam.position.x += ox;
		cam.position.y += oy;
		cam.position.z += oz;
	}
}
