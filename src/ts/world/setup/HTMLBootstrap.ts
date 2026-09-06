import { World } from '../World';
import { t } from '../../i18n';

// Body-level DOM scaffolding World needs in place before rendering:
// font links, the loading screen, the in-game UI container with the
// GitHub corner + controls overlay slot, the planet-selection modal
// the rocket flips visible at apogee, and the renderer's canvas.
// All written via insertAdjacentHTML - this only runs once at world
// construction; the markup never changes after.
export function bootstrapHTML(world: World): void
{
	// Fonts
	const fontHrefs = [
		'https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap',
		'https://fonts.googleapis.com/css2?family=Solway:wght@300;400;500;700;800&display=swap',
		'https://fonts.googleapis.com/css2?family=Catamaran:wght@400;500;700;800&display=swap',
		'https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap',
	];
	for (const href of fontHrefs)
	{
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		document.head.appendChild(link);
	}

	// Loader
	document.body.insertAdjacentHTML('beforeend', `
		<div id="loading-screen">
			<div id="loading-screen-background"></div>
			<h1 id="main-title" class="sb-font">Sketchbook 0.8.0</h1>
			<div class="cubeWrap">
				<div class="cube">
					<div class="faces1"></div>
					<div class="faces2"></div>
				</div>
			</div>
			<div id="loading-percent">0%</div>
			<div id="loading-bar-track"><div id="loading-bar-fill"></div></div>
			<div id="loading-text">${t('world.loading')}</div>
		</div>
	`);

	// Debug stack - pinned top-right column that holds the FPS box on
	// top and the lil-gui debug panel below. Both elements are
	// otherwise free-floating (lil-gui auto-places `position: fixed`,
	// stats.js sets inline `position: fixed; left: 0`); inside this
	// flex container they sit in the normal flow and stack cleanly.
	document.body.insertAdjacentHTML('beforeend', `
		<div id="debug-stack"></div>
	`);

	// UI
	document.body.insertAdjacentHTML('beforeend', `
		<div id="ui-container" style="display: none;">
			<div class="github-corner">
				<a href="https://github.com/manuelhintermayr/sketchbook-upgraded" target="_blank" title="Fork me on GitHub">
					<svg viewbox="0 0 100 100" fill="currentColor">
						<title>Fork me on GitHub</title>
						<path d="M0 0v100h100V0H0zm60 70.2h.2c1 2.7.3 4.7 0 5.2 1.4 1.4 2 3 2 5.2 0 7.4-4.4 9-8.7 9.5.7.7 1.3 2
						1.3 3.7V99c0 .5 1.4 1 1.4 1H44s1.2-.5 1.2-1v-3.8c-3.5 1.4-5.2-.8-5.2-.8-1.5-2-3-2-3-2-2-.5-.2-1-.2-1
						2-.7 3.5.8 3.5.8 2 1.7 4 1 5 .3.2-1.2.7-2 1.2-2.4-4.3-.4-8.8-2-8.8-9.4 0-2 .7-4 2-5.2-.2-.5-1-2.5.2-5
						0 0 1.5-.6 5.2 1.8 1.5-.4 3.2-.6 4.8-.6 1.6 0 3.3.2 4.8.7 2.8-2 4.4-2 5-2z"></path>
					</svg>
				</a>
			</div>
			<div class="left-panel">
				<div id="controls" class="panel-segment flex-bottom"></div>
			</div>
		</div>
	`);

	// Planet selection modal (Inthenew/Sketchbook). RocketShip flips
	// 'planet-menu-hidden' off once the liftoff sequence reaches
	// apogee, then handles clicks via addEventListener (Inthenew used
	// jQuery here, we do it in vanilla DOM during construction).
	document.body.insertAdjacentHTML('beforeend', `
		<div id="planet-menu" class="planet-menu-hidden">
			<h1 class="planet-heading">${t('world.planet.heading')}</h1>
			<div class="planet-item" id="earth">
				<img src="src/img/hemisphere-earth.png" alt="${t('world.planet.earth')}">
				<p>${t('world.planet.earth')}</p>
			</div>
			<div class="planet-item" id="moon">
				<img src="src/img/full-moon.png" alt="${t('world.planet.moon')}">
				<p>${t('world.planet.moon')}</p>
			</div>
		</div>
	`);

	// Canvas
	document.body.appendChild(world.renderer.domElement);
	world.renderer.domElement.id = 'canvas';
}
