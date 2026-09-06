import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { CameraShake } from '../core/CameraShake';

const STUCK_WINDOW = 6;
const STUCK_DIST = 0.5;
const FLIP_TIME = 3;
// cos(80°) ≈ 0.17 - chassis-up dot world-up below this means the
// vehicle is at or past sideways. Original Inthenew value cos(100°)
// only counted fully-upside-down chassis, so a heli or car that
// landed cleanly on its side just sat there. 80° still leaves a
// healthy margin (a vehicle parked on a 45° hill reads upY ≈ 0.7).
const UPSIDE_DOWN_THRESHOLD = Math.cos(80 * Math.PI / 180);
const RECOVERY_COOLDOWN = 2;

// Module-scoped scratch - see Helicopter / Airplane for the same
// allocation-pooling pattern. The recovery path runs at most once a
// few seconds, so the win is small, but staying consistent with the
// rest of the vehicle physics helpers is worth a few lines.
const _quat = new THREE.Quaternion();
const _euler = new THREE.Euler();
const _yawOnly = new THREE.Quaternion();

// Auto-recovery for stuck or flipped vehicles. Two independently
// toggleable gates:
//
//   - Stuck: while the player holds throttle/steering, sample distance
//     traveled over a 6 s window. If total motion stays below 0.5 m,
//     the vehicle is wedged on geometry - recover.
//   - Flip:  while the chassis is past horizontal (up.y < cos(100°)),
//     accumulate a timer. If it sits upside-down for 3 s, recover.
//
// Recovery lifts 2 m, snaps to a yaw-only orientation (preserves
// heading), zeroes velocity and angular velocity, fires a 'collision'
// camera shake, and locks out re-recovery for 2 s. Subclasses that
// hover by design (Helicopter, Airplane, RocketShip, Boat) opt out by
// flipping the public flags after construction.
export class StuckRecovery
{
	public stuckRecoveryEnabled: boolean = true;
	public flipRecoveryEnabled: boolean = true;

	private body: CANNON.Body;
	private noDirectionPressed: () => boolean;

	private stuckSamples: { dist: number; time: number }[] = [];
	private stuckLastPos: THREE.Vector3 = new THREE.Vector3();
	private stuckInitialized: boolean = false;
	private flipTimer: number = 0;
	private recoveryCooldown: number = 0;

	constructor(body: CANNON.Body, noDirectionPressed: () => boolean)
	{
		this.body = body;
		this.noDirectionPressed = noDirectionPressed;
	}

	public update(timeStep: number): void
	{
		const dt = Math.min(timeStep, 1 / 30);
		this.recoveryCooldown = Math.max(0, this.recoveryCooldown - dt);
		if (this.recoveryCooldown > 0) return;

		// Stuck sampling - track distance traveled while the player is
		// actively trying to move. Sitting at idle is not "stuck".
		if (this.stuckRecoveryEnabled && !this.noDirectionPressed())
		{
			const cur = this.body.position;
			if (!this.stuckInitialized)
			{
				this.stuckLastPos.set(cur.x, cur.y, cur.z);
				this.stuckInitialized = true;
			}

			const dx = cur.x - this.stuckLastPos.x;
			const dy = cur.y - this.stuckLastPos.y;
			const dz = cur.z - this.stuckLastPos.z;
			const traveled = Math.sqrt(dx * dx + dy * dy + dz * dz);
			this.stuckLastPos.set(cur.x, cur.y, cur.z);

			this.stuckSamples.unshift({ dist: traveled, time: dt });
		}
		else if (this.stuckInitialized)
		{
			// Player let go - drop the sample window so a long idle
			// doesn't immediately count as stuck the moment they touch
			// throttle again.
			this.stuckSamples.length = 0;
			this.stuckInitialized = false;
		}

		// Trim sample window to the last STUCK_WINDOW seconds.
		let totalDist = 0;
		let totalTime = 0;
		for (let i = 0; i < this.stuckSamples.length; i++)
		{
			if (totalTime >= STUCK_WINDOW)
			{
				this.stuckSamples.length = i;
				break;
			}
			totalDist += this.stuckSamples[i].dist;
			totalTime += this.stuckSamples[i].time;
		}
		const isStuck = totalTime >= STUCK_WINDOW && totalDist < STUCK_DIST;

		// Flip detection - accumulate while upside-down, reset on upright
		// so a brief tilt over a bump doesn't trigger.
		let flipTimerExpired = false;
		if (this.flipRecoveryEnabled)
		{
			const q = this.body.quaternion;
			// Apply quaternion to (0,1,0) - y component of the result is
			// up.dot(worldUp). When < threshold the chassis is past
			// horizontal.
			const upY = 1 - 2 * (q.x * q.x + q.z * q.z);
			if (upY < UPSIDE_DOWN_THRESHOLD)
			{
				this.flipTimer += dt;
			}
			else
			{
				this.flipTimer = 0;
			}
			flipTimerExpired = this.flipTimer >= FLIP_TIME;
		}

		if (!isStuck && !flipTimerExpired) return;

		// Recover: keep heading (yaw only), lift, zero out everything.
		const pos = this.body.position;
		this.body.position.set(pos.x, pos.y + 2, pos.z);

		_quat.set(
			this.body.quaternion.x,
			this.body.quaternion.y,
			this.body.quaternion.z,
			this.body.quaternion.w,
		);
		_euler.setFromQuaternion(_quat, 'YXZ');
		_euler.x = 0;
		_euler.z = 0;
		_yawOnly.setFromEuler(_euler);
		this.body.quaternion.set(_yawOnly.x, _yawOnly.y, _yawOnly.z, _yawOnly.w);

		this.body.velocity.setZero();
		this.body.angularVelocity.setZero();

		CameraShake.trigger('collision', 1.2);
		this.recoveryCooldown = RECOVERY_COOLDOWN;
		this.stuckSamples.length = 0;
		this.flipTimer = 0;
	}

	// Called when the vehicle has no driver - tear down the sample
	// window so a fresh entry doesn't see ghost data from before. The
	// cooldown keeps ticking; it's a global lockout.
	public reset(): void
	{
		this.stuckSamples.length = 0;
		this.flipTimer = 0;
		this.stuckInitialized = false;
	}
}
