// Multi-layer sine-based noise. Fast, smooth, deterministic. Returns a 3D
// offset vector. Used by CameraShake; kept as a pure math helper so it
// has no Three.js or world dependency.
//
// Reuses one output array per call so a per-frame trigger doesn't churn
// the GC. Callers that need to keep the values across frames must copy.

const out: [number, number, number] = [0, 0, 0];

export function sineNoise(x: number, y: number, z: number, time: number): [number, number, number]
{
	out[0] =
		Math.sin(x * 1.1 + time * 1.3) * 0.3 +
		Math.sin(y * 0.7 + time * 0.9) * 0.25 +
		Math.sin(z * 1.5 + time * 1.1) * 0.2 +
		Math.sin((x + z) * 0.8 + time * 1.7) * 0.15 +
		Math.sin((y - x) * 1.2 + time * 0.6) * 0.1;

	out[1] =
		Math.sin(x * 0.9 + time * 1.5) * 0.25 +
		Math.sin(y * 1.3 + time * 0.7) * 0.3 +
		Math.sin(z * 0.6 + time * 1.2) * 0.2 +
		Math.sin((x - y) * 1.1 + time * 0.8) * 0.15 +
		Math.sin((z + y) * 0.7 + time * 1.4) * 0.1;

	out[2] =
		Math.sin(x * 1.3 + time * 0.8) * 0.2 +
		Math.sin(y * 0.5 + time * 1.6) * 0.25 +
		Math.sin(z * 1.1 + time * 1.0) * 0.3 +
		Math.sin((z - x) * 0.9 + time * 1.3) * 0.15 +
		Math.sin((x + y) * 1.4 + time * 0.5) * 0.1;

	return out;
}
