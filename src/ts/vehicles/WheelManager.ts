import * as Utils from '../core/FunctionLibrary';
import { RaycastVehicle } from '../physics/RaycastVehicle';
import { Wheel } from './Wheel';

// Per-frame wheel transform sync. The raycast vehicle reports wheel
// transforms in world space at the chassis's current pose; the wheel
// nodes live at the scene root (detached from the chassis in
// Vehicle.addToWorld) so they can be placed directly.
//
// Lives outside Vehicle as a free function because it's pure
// computation against two already-public objects (raycast vehicle,
// wheels array) and has no Vehicle-specific state.

export function syncWheelTransforms(
	rayCastVehicle: RaycastVehicle,
	wheels: Wheel[],
): void
{
	for (let i = 0; i < rayCastVehicle.wheelInfos.length; i++)
	{
		rayCastVehicle.updateWheelTransform(i);
		const transform = rayCastVehicle.getWheelTransformWorld(i);
		const wheelObject = wheels[i].wheelObject;
		wheelObject.position.copyFrom(transform.position);
		Utils.setQuaternion(wheelObject, transform.quaternion);
	}
}

// Vehicle-tuning hook for the World GUI's Vehicles folder. Writes
// `property` (Friction_Slip / Suspension_Stiffness / Damping_*  /
// Max_Suspension) into every raycast wheel info on the vehicle.
// Lives here next to syncWheelTransforms because both touch the same
// rayCastVehicle.wheelInfos array.
export function updateWheelProps(rayCastVehicle: RaycastVehicle, property: string, value: number): void
{
	const wheelInfos = rayCastVehicle.wheelInfos;
	for (let i = 0; i < wheelInfos.length; i++)
	{
		(wheelInfos[i] as any)[property] = value;
	}
}
