// UI helper for show/hide of fixed shell elements + driving the
// loading-screen progress display from LoadingManager.
export class UIManager
{
	public static setUserInterfaceVisible(value: boolean): void
	{
		const el = document.getElementById('ui-container');
		if (el) el.style.display = value ? 'block' : 'none';
	}

	public static setLoadingScreenVisible(value: boolean): void
	{
		const el = document.getElementById('loading-screen');
		if (el) el.style.display = value ? 'flex' : 'none';
	}

	public static setFPSVisible(value: boolean): void
	{
		const stats = document.getElementById('statsBox');
		if (stats) stats.style.display = value ? 'block' : 'none';
		const gui = document.getElementById('dat-gui-container');
		if (gui) gui.style.top = value ? '48px' : '0px';
	}

	// LoadingManager calls this on each progress tick. Both the
	// percent label and the bar fill are updated; the value clamps to
	// [0, 100] so a flaky xhr-progress doesn't push past the track.
	public static setLoadingProgress(percent: number): void
	{
		const v = Math.max(0, Math.min(100, percent));
		const label = document.getElementById('loading-percent');
		const fill = document.getElementById('loading-bar-fill');
		if (label) label.textContent = Math.floor(v) + '%';
		if (fill) fill.style.width = v + '%';
	}
}
