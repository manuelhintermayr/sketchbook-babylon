// Circular iris-wipe overlay. Used to mask hard scene boundaries
// (map switch, scenario restart, page reload) so they feel like
// in-engine transitions instead of jarring location.reload() flashes.
//
// Pattern adapted from manuelhintermayr-portfolio/three-js
// IrisTransition + useSceneTransition. Reshaped from a React store-
// driven overlay into a singleton with promise-returning open/close
// methods - Sketchbook calls them imperatively from World code.
//
// The animation itself is pure CSS (clip-path circle) so this file
// only manages DOM lifecycle + waits for transitionend.

const TRANSITION_MS = 700;

export class IrisTransition
{
	private static instance: IrisTransition | undefined;
	private overlay: HTMLDivElement;

	public static getInstance(): IrisTransition
	{
		if (IrisTransition.instance === undefined)
		{
			IrisTransition.instance = new IrisTransition();
		}
		return IrisTransition.instance;
	}

	private constructor()
	{
		this.overlay = document.createElement('div');
		this.overlay.id = 'iris-transition';
		document.body.appendChild(this.overlay);
	}

	// Expand the iris (overlay → fully opaque). Resolves once the
	// transition has run. The await pattern lets callers chain a
	// scene swap behind the cover before opening it again.
	public close(): Promise<void>
	{
		this.overlay.classList.add('visible');
		return this.waitForTransition();
	}

	// Contract the iris (overlay → invisible).
	public open(): Promise<void>
	{
		this.overlay.classList.remove('visible');
		return this.waitForTransition();
	}

	private waitForTransition(): Promise<void>
	{
		return new Promise<void>((resolve) =>
		{
			// Belt-and-braces - transitionend can be missed on some browsers
			// when the layout was never dirtied (e.g. close() called twice
			// in a row). Always resolve after the duration anyway.
			let resolved = false;
			const done = (): void =>
			{
				if (resolved) return;
				resolved = true;
				this.overlay.removeEventListener('transitionend', done);
				resolve();
			};
			this.overlay.addEventListener('transitionend', done, { once: true });
			setTimeout(done, TRANSITION_MS + 50);
		});
	}
}
