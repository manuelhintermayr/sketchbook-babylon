import * as CANNON from 'cannon-es';

import { Wheel } from './Wheel';

// Per-frame wheel transform sync. Cannon's RaycastVehicle reports
// wheel transforms in body-space at body.position; the chassis is
// rendered at body.interpolatedPosition. At high speeds the gap
// between those two is exactly the per-step velocity offset, so the
// wheels visually drift in front of (or behind) the car. Compensate
// by adding the same delta to every wheel.
//
// Lives outside Vehicle as a free function because it's pure
// computation against three already-public objects (raycast vehicle,
// wheels array, collision body) and has no Vehicle-specific state.

export function syncWheelTransforms(
	rayCastVehicle: CANNON.RaycastVehicle,
	wheels: Wheel[],
	collision: CANNON.Body,
): void
{
	const dx = collision.interpolatedPosition.x - collision.position.x;
	const dy = collision.interpolatedPosition.y - collision.position.y;
	const dz = collision.interpolatedPosition.z - collision.position.z;

	for (let i = 0; i < rayCastVehicle.wheelInfos.length; i++)
	{
		rayCastVehicle.updateWheelTransform(i);
		const transform = rayCastVehicle.getWheelTransformWorld(i);
		const wheelObject = wheels[i].wheelObject;
		wheelObject.position.set(
			transform.position.x + dx,
			transform.position.y + dy,
			transform.position.z + dz,
		);
		wheelObject.quaternion.set(
			transform.quaternion.x,
			transform.quaternion.y,
			transform.quaternion.z,
			transform.quaternion.w,
		);
	}
}

// Vehicle-tuning hook for the World GUI's Vehicles folder. Writes
// `property` (Friction_Slip / Suspension_Stiffness / Damping_*  /
// Max_Suspension) into every cannon raycast wheel info on the vehicle.
// Lives here next to syncWheelTransforms because both touch the same
// rayCastVehicle.wheelInfos array.
export function updateWheelProps(rayCastVehicle: CANNON.RaycastVehicle, property: string, value: number): void
{
	const wheelInfos = rayCastVehicle.wheelInfos;
	for (let i = 0; i < wheelInfos.length; i++)
	{
		(wheelInfos[i] as any)[property] = value;
	}
}
