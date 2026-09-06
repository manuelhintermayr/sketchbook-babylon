import { World } from '../World';
import { IrisTransition } from '../ui/IrisTransition';

// Adds a Map dropdown to the Map & Scenarios lil-gui folder. Default
// is the Inthenew (v0.6) map; alternates are two procedural code-built
// recreations of the swift502 v0.1 + v0.2 demos (the originals predate
// Sketchbook's GLB+userData map authoring), two socketControl-flavoured
// Sketchbook v0.3 / v0.4 GLBs, and four code-built socketControl test
// sandboxes.
//
// Selection persists in localStorage('sketchbook.map'). Switching
// triggers a full page reload (cleanest way to swap the entire scene
// graph + spawn registry); the iris transition covers the reload
// flash so it lands behind a black wipe instead of a white blink.
export function addMapSwitcher(world: World): void
{
	const stored = localStorage.getItem('sketchbook.map');
	const choices: { [label: string]: string } = {
		'Inthenew (v0.6, default)': 'inthenew',
		'swift502 v0.1 (foundation)': 'sw-v01',
		'swift502 v0.2 (test world)': 'sw-v02',
		'sketchbook v0.3 (socketControl)': 'sc-v03',
		'sketchbook v0.4 (socketControl)': 'sc-v04',
		'test (socketControl sandbox)': 'sc-test',
		'test2 (socketControl sandbox)': 'sc-test2',
		'test3 (socketControl sandbox)': 'sc-test3',
		'example (socketControl sandbox)': 'sc-example',
	};
	// Validate the stored selection against the map's values without
	// allocating an intermediate array. (Object.values would be the
	// natural fit but we target ES2015.)
	let storedIsValid = false;
	for (const k in choices) if (choices[k] === stored) { storedIsValid = true; break; }
	world.params.Map = storedIsValid ? stored : 'inthenew';

	world.scenarioGUIFolder.add(world.params, 'Map', choices)
		.onChange((value: string) =>
		{
			localStorage.setItem('sketchbook.map', value);
			world.sfxBus.playIrisWhoosh();
			// Cover the canvas before reloading so the page-reload flash
			// happens behind a black iris instead of a white flicker.
			IrisTransition.getInstance().close().then(() => location.reload());
		});
}
