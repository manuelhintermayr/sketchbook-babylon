import { t } from '../i18n';

// Shared rows for the on-screen controls HUD (the help overlay
// World.updateControls() drives). Returned as functions, not module
// constants, so t() resolves at call time and the strings reflect the
// current language - building them once at module load would freeze
// them in whatever locale was active first.

// Always-available shortcuts the world hands to every input receiver
// (player on foot AND every vehicle). B + T are the swift502 v0.2
// GameMode keys (ball spawn / slow-mo); V (view-distance cycle) is
// on-foot only because vehicles already use V for first-person
// toggle - it lives in Character.displayControls instead.
export function commonGlobalControls()
{
	return [
		{ keys: ['B'],               desc: t('controls.spawnBall') },
		{ keys: ['T'],               desc: t('controls.slowMotion') },
		{ keys: ['Shift', '+', 'R'], desc: t('controls.respawn') },
		{ keys: ['Shift', '+', 'C'], desc: t('controls.freeCamera') },
	];
}

// Vehicle-only common rows: view toggle + exit (+ optional seat switch),
// then the global ones. Spread into each Vehicle's inputReceiverInit
// after its own bindings. Pass hasSeatSwitch=true on vehicles that
// authored connectedSeats in the GLB (Car / Helicopter) so X gets a
// HUD row alongside its already-functional onInputChange handler.
export function commonVehicleControls(hasSeatSwitch: boolean = false)
{
	const rows = [
		{ keys: ['V'], desc: t('controls.viewSelect') },
		{ keys: ['F'], desc: t('controls.exitVehicle') },
	];
	if (hasSeatSwitch)
	{
		rows.push({ keys: ['X'], desc: t('controls.switchSeats') });
	}
	return [...rows, ...commonGlobalControls()];
}
