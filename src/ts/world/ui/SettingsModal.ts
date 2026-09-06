import { World } from '../World';
import { t, getLocale, setLocale, LOCALE_LABELS, Locale } from '../../i18n';
import { IrisTransition } from './IrisTransition';

// Settings modal opened from the pause menu. Each control writes its
// value into world.params and forwards through the matching lil-gui
// controller's setValue() so existing onChange wiring (shadow CSM,
// mouse sensitivity, etc.) fires too. That keeps the lil-gui debug
// panel and this modal as two views over one source of truth.
export class SettingsModal
{
	private world: World;
	private overlay: HTMLDivElement;
	private isOpen = false;

	// Lazy index of lil-gui controllers by property name. Built on the
	// first findController call so the cache picks up the gui after
	// World finishes wiring it. lil-gui's controllersRecursive walks the
	// folder tree on every call and we'd otherwise do that 30-50× during
	// a single slider drag.
	private controllerCache: Map<string, any> | null = null;

	constructor(world: World)
	{
		this.world = world;
		this.overlay = this.build();
		document.body.appendChild(this.overlay);
	}

	public open(): void
	{
		if (this.isOpen) return;
		// Lil-gui is wired up by the time the user can open this modal,
		// so the controller cache + the gui.onChange sync hook get
		// installed eagerly the first time we open. Subsequent opens
		// are cheap - the cache stays warm.
		this.ensureControllerCache();
		this.isOpen = true;
		this.refresh();
		this.overlay.classList.add('visible');
	}

	public close(): void
	{
		if (!this.isOpen) return;
		this.isOpen = false;
		this.overlay.classList.remove('visible');
	}

	// Pull every control back to the current params value - called on
	// open so the modal reflects whatever the lil-gui panel has done
	// in the meantime.
	private refresh(): void
	{
		const p = this.world.params;
		this.setRange('Master_Volume', p.Master_Volume);
		this.setRange('Music_Volume', p.Music_Volume);
		this.setRange('SFX_Volume', p.SFX_Volume);
		this.setRange('Mouse_Sensitivity', p.Mouse_Sensitivity);
		this.setRange('Free_Cam_Speed', p.Free_Cam_Speed);
		this.setRange('Gravity_Scale', p.Gravity_Scale);
		this.setToggle('Shadows', p.Shadows);
		this.setToggle('FXAA', p.FXAA);
		this.setToggle('Sun_Cycle', p.Sun_Cycle);
		this.setToggle('Debug_FPS', p.Debug_FPS);
		this.setToggle('Camera_Shake', p.Camera_Shake);
		this.setToggle('Master_Audio', p.Master_Audio);
		this.setToggle('Sound_Effects', p.Sound_Effects);
		this.setToggle('Background_Music', p.Background_Music);
		this.applyMasterAudioGate(p.Master_Audio);
		this.setToggle('Outlines', p.Outlines);
		this.setToggle('Labels', p.Labels);
		this.setToggle('Dark_Mode', p.Dark_Mode);
	}

	private build(): HTMLDivElement
	{
		const wrap = document.createElement('div');
		wrap.id = 'settings-modal';
		// Card titles + button labels are translated via i18n.
		// Individual control labels stay in English to keep the per-row
		// description tight; full row translation would inflate the
		// translation table without much value to non-English players
		// who already know what "FXAA" or "Mouse Sensitivity" means.
		wrap.innerHTML = `
			<div class="settings-container">
				<div class="settings-header">
					<h2 class="settings-title">${t('settings.title')}</h2>
					<button class="settings-close" data-close aria-label="Close">&times;</button>
				</div>

				<div class="settings-card">
					<h3>${t('settings.general')}</h3>
					<div class="setting-row">
						<div>
							<div class="setting-label">${t('settings.language')}</div>
							<div class="setting-desc">${t('settings.languageDesc')}</div>
						</div>
						<div class="setting-control">
							<select class="lang-select" data-lang>
								${(Object.keys(LOCALE_LABELS) as Locale[]).map((k) =>
									`<option value="${k}"${k === getLocale() ? ' selected' : ''}>${LOCALE_LABELS[k]}</option>`,
								).join('')}
							</select>
						</div>
					</div>
					${this.toggleRow('Dark_Mode', t('settings.darkMode'), t('settings.darkModeDesc'))}
					<div class="setting-row">
						<div>
							<div class="setting-label">${t('settings.reset')}</div>
							<div class="setting-desc">${t('settings.resetDesc')}</div>
						</div>
						<div class="setting-control">
							<button type="button" class="preset-btn" data-reset>${t('settings.resetBtn')}</button>
						</div>
					</div>
				</div>

				<div class="settings-card">
					<h3>${t('settings.graphics')}</h3>
					<div class="setting-row">
						<div>
							<div class="setting-label">${t('settings.presets')}</div>
							<div class="setting-desc">${t('settings.presetDesc')}</div>
						</div>
						<div class="setting-control">
							<button type="button" class="preset-btn" data-preset="low">${t('settings.presetLow')}</button>
							<button type="button" class="preset-btn" data-preset="high">${t('settings.presetHigh')}</button>
						</div>
					</div>
					${this.toggleRow('Shadows', 'Shadows', 'Cascaded shadow maps')}
					${this.toggleRow('FXAA', 'Anti-aliasing', 'FXAA post-process')}
					${this.toggleRow('Sun_Cycle', 'Sun cycle', 'Sun moves automatically (off = frozen at the elevation slider)')}
					${this.toggleRow('Outlines', 'Outlines', 'Depth-edge Sobel overlay (toon look)')}
					${this.toggleRow('Labels', 'Labels', 'Floating tags above player, NPCs, dogs and cats')}
					${this.toggleRow('Debug_FPS', 'FPS counter', 'Show stats.js box')}
				</div>

				<div class="settings-card">
					<h3>${t('settings.audio')}</h3>
					${this.toggleRow('Master_Audio', 'Audio', 'Master switch - when off, every sound is muted regardless of the sub-toggles below')}
					${this.rangeRow('Master_Volume', 'Master volume', 0, 100, 1, 'Volume level for all in-world audio')}
					${this.toggleRow('Sound_Effects', 'Sound effects', 'Engine, ambient (wind / water near the ocean), footsteps, jumps, race pings, vehicle crash, animal voices, bird chirps')}
					${this.toggleRow('Background_Music', 'Background music', 'Looped soundtrack while you play')}
					${this.rangeRow('Music_Volume', 'Music volume', 0, 100, 1, 'Background music level (multiplies with master)')}
				</div>

				<div class="settings-card">
					<h3>${t('settings.controls')}</h3>
					${this.rangeRow('Mouse_Sensitivity', 'Mouse sensitivity', 0, 1, 0.01, 'Camera look speed')}
					${this.rangeRow('Free_Cam_Speed', 'Free-camera speed', 1, 100, 1, 'Shift+C movement')}
					${this.rangeRow('Gravity_Scale', 'Gravity scale', 0, 2, 0.05, '0 = zero-g, 1 = Earth, 2 = double')}
					${this.toggleRow('Camera_Shake', 'Camera shake', 'Shake on vehicle hard landings + recovery')}
				</div>

				<div class="settings-footer">
					<button class="btn-gold" data-close>${t('settings.done')}</button>
				</div>
			</div>
		`;

		wrap.addEventListener('click', (e) =>
		{
			if (e.target === wrap) this.close();
		});
		wrap.querySelectorAll<HTMLButtonElement>('[data-close]').forEach((b) =>
		{
			b.addEventListener('click', () => this.close());
		});
		wrap.querySelectorAll<HTMLInputElement>('input[type="range"]').forEach((input) =>
		{
			input.addEventListener('input', () => this.applyRange(input));
		});
		wrap.querySelectorAll<HTMLButtonElement>('.toggle').forEach((toggle) =>
		{
			toggle.addEventListener('click', () => this.applyToggle(toggle));
		});
		wrap.querySelectorAll<HTMLButtonElement>('.preset-btn').forEach((btn) =>
		{
			btn.addEventListener('click', () => this.applyPreset(btn.dataset.preset as 'low' | 'high'));
		});
		const langSelect = wrap.querySelector<HTMLSelectElement>('select[data-lang]');
		if (langSelect !== null)
		{
			langSelect.addEventListener('change', () =>
			{
				this.applyLocale(langSelect.value as Locale);
			});
		}
		const resetBtn = wrap.querySelector<HTMLButtonElement>('[data-reset]');
		if (resetBtn !== null)
		{
			resetBtn.addEventListener('click', () => this.applyReset());
		}

		return wrap;
	}

	// Wipes all persisted settings (lil-gui save + dark-mode + locale +
	// muted-flag) and reloads. The reload is the cleanest way to make
	// the title-screen-time defaults reapply across every system that
	// reads localStorage at construction.
	private applyReset(): void
	{
		localStorage.removeItem('sketchbook-settings');
		localStorage.removeItem('sketchbook.darkMode');
		localStorage.removeItem('sketchbook.soundMuted');
		localStorage.removeItem('sketchbook.locale');
		localStorage.removeItem('sketchbook.map');
		this.world.sfxBus.playIrisWhoosh();
		IrisTransition.getInstance().close().then(() => location.reload());
	}

	// Language change requires a page reload - the t(key) lookups
	// happen at construction time for every overlay, so the existing
	// strings in the DOM stay frozen at the previous locale otherwise.
	// Iris-wipe covers the reload flash, same trick as the map switch.
	private applyLocale(locale: Locale): void
	{
		if (locale === getLocale()) return;
		setLocale(locale);
		this.world.sfxBus.playIrisWhoosh();
		IrisTransition.getInstance().close().then(() => location.reload());
	}

	// Quick toggles for the heavy graphics features. "Low" disables
	// shadows + outlines (the things that move the FPS needle on
	// integrated GPUs / mobile). "High" turns both on so users can flip
	// back without remembering which row was where.
	private applyPreset(preset: 'low' | 'high'): void
	{
		const targets: { [k: string]: boolean } = preset === 'low'
			? { Shadows: false, Outlines: false }
			: { Shadows: true,  Outlines: true  };
		for (const key in targets)
		{
			this.write(key, targets[key]);
		}
		this.refresh();
	}

	private toggleRow(key: string, label: string, desc: string): string
	{
		return `
			<div class="setting-row">
				<div>
					<div class="setting-label">${label}</div>
					<div class="setting-desc">${desc}</div>
				</div>
				<div class="setting-control">
					<button type="button" class="toggle" data-toggle="${key}" aria-label="${label}"></button>
				</div>
			</div>
		`;
	}

	private rangeRow(key: string, label: string, min: number, max: number, step: number, desc: string): string
	{
		return `
			<div class="setting-row">
				<div>
					<div class="setting-label">${label}</div>
					<div class="setting-desc">${desc}</div>
				</div>
				<div class="setting-control">
					<input type="range" min="${min}" max="${max}" step="${step}" data-range="${key}">
					<span class="setting-value" data-value="${key}">0</span>
				</div>
			</div>
		`;
	}

	private setRange(key: string, value: number): void
	{
		const input = this.overlay.querySelector<HTMLInputElement>(`[data-range="${key}"]`);
		const valueEl = this.overlay.querySelector<HTMLSpanElement>(`[data-value="${key}"]`);
		if (input) input.value = String(value);
		if (valueEl) valueEl.textContent = formatValue(value);
	}

	private setToggle(key: string, value: boolean): void
	{
		const toggle = this.overlay.querySelector<HTMLButtonElement>(`[data-toggle="${key}"]`);
		if (toggle) toggle.classList.toggle('active', !!value);
	}

	private applyRange(input: HTMLInputElement): void
	{
		const key = input.dataset.range || '';
		const numeric = parseFloat(input.value);
		const valueEl = this.overlay.querySelector<HTMLSpanElement>(`[data-value="${key}"]`);
		if (valueEl) valueEl.textContent = formatValue(numeric);
		this.write(key, numeric);
	}

	private applyToggle(toggle: HTMLButtonElement): void
	{
		const key = toggle.dataset.toggle || '';
		const next = !toggle.classList.contains('active');
		toggle.classList.toggle('active', next);
		this.write(key, next);
	}

	// Forward to lil-gui so the existing onChange handlers fire
	// (e.g. CSM enable/disable, sensitivity push to CameraOperator).
	// controller.setValue mutates params, calls onChange, and triggers
	// updateDisplay - doing the param write ourselves first would mean
	// lil-gui sees no diff and might skip onChange. Fallback for fields
	// that aren't bound to a controller.
	private write(key: string, value: any): void
	{
		const controller = this.findController(key);
		if (controller !== null)
		{
			controller.setValue(value);
		}
		else
		{
			this.world.params[key] = value;
		}

		if (key === 'Master_Volume')
		{
			this.world.setMasterVolume(value);
		}

		// Master audio gates the two sub-toggles in the modal as well.
		if (key === 'Master_Audio')
		{
			this.applyMasterAudioGate(value);
		}

		// lil-gui's onChange fires on setValue but onFinishChange (where
		// ParamsGUI hooks persist) does not - persist explicitly so a
		// modal toggle survives a reload.
		this.persistGui();
	}

	// Disable the dependent sub-toggles' UI when master audio is off.
	// The underlying flags don't change - we just stop the player from
	// fiddling with them while everything is muted globally.
	private applyMasterAudioGate(masterOn: boolean): void
	{
		const subRows = ['Sound_Effects', 'Background_Music'];
		for (const key of subRows)
		{
			const row = this.overlay.querySelector<HTMLElement>(`.toggle[data-toggle="${key}"]`)?.closest<HTMLElement>('.setting-row');
			if (row !== null && row !== undefined)
			{
				row.classList.toggle('disabled', !masterOn);
			}
		}
	}

	private persistGui(): void
	{
		const gui = this.world.gui;
		if (gui && typeof gui.save === 'function')
		{
			try { localStorage.setItem('sketchbook-settings', JSON.stringify(gui.save())); }
			catch (_e) { /* localStorage full / disabled */ }
		}
	}

	private findController(property: string): any
	{
		this.ensureControllerCache();
		return this.controllerCache?.get(property) ?? null;
	}

	private ensureControllerCache(): void
	{
		if (this.controllerCache !== null) return;
		const gui = this.world.gui;
		if (!gui || typeof gui.controllersRecursive !== 'function') return;
		this.controllerCache = new Map();
		for (const c of gui.controllersRecursive() as any[])
		{
			this.controllerCache.set(c.property, c);
		}
		// Bi-directional sync: gui.onChange fires for every controller
		// change (live drag + value writes). When the modal is open we
		// reflect the new value into our toggle / range UI so the
		// modal mirrors whatever was changed in the debug panel.
		// onFinishChange is already taken by ParamsGUI for persistence;
		// onChange is a separate slot.
		gui.onChange((event: any) =>
		{
			if (this.isOpen) this.syncControl(event.property, event.value);
		});
	}

	// Push a value-change from lil-gui back into the modal's UI so the
	// open modal stays in sync without needing a full refresh().
	private syncControl(key: string, value: any): void
	{
		if (typeof value === 'boolean')
		{
			this.setToggle(key, value);
		}
		else if (typeof value === 'number')
		{
			this.setRange(key, value);
		}
	}
}

function formatValue(v: number): string
{
	return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
