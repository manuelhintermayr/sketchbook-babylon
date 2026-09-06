import { World } from '../World';
import { IrisTransition } from './IrisTransition';
import { t } from '../../i18n';

// Pause overlay driven by Esc. Pauses gameplay (timeScale → 0),
// exits pointer lock so the cursor is usable, and offers Resume,
// Settings (deferred to a callback), Reset Scenario, and Reload.
//
// Disabled by default - World enables it once the loading screen has
// finished, so the overlay can't show up over the loader / welcome
// dialog.
export class PauseMenu
{
	private world: World;
	private overlay: HTMLDivElement;
	private isOpen = false;
	private isEnabled = false;
	private savedTimeScale = 1;
	private boundKeyDown: (e: KeyboardEvent) => void;

	private onSettings: (() => void) | null = null;

	constructor(world: World)
	{
		this.world = world;
		this.overlay = this.buildOverlay();
		document.body.appendChild(this.overlay);

		this.boundKeyDown = (e) => this.handleKeyDown(e);
		document.addEventListener('keydown', this.boundKeyDown);
	}

	public enable(): void
	{
		this.isEnabled = true;
	}

	public setSettingsHandler(handler: () => void): void
	{
		this.onSettings = handler;
	}

	public open(): void
	{
		if (this.isOpen || !this.isEnabled) return;
		this.isOpen = true;
		this.savedTimeScale = this.world.timeScaleTarget;
		this.world.setTimeScale(0);
		this.overlay.classList.add('visible');
		this.world.sfxBus.playUiTick();
		const first = this.overlay.querySelector<HTMLButtonElement>('.pause-btn');
		first?.focus();
	}

	public close(): void
	{
		if (!this.isOpen) return;
		this.isOpen = false;
		this.world.sfxBus.playUiTick();
		this.world.setTimeScale(this.savedTimeScale || 1);
		this.overlay.classList.remove('visible');
	}

	public get open_state(): boolean
	{
		return this.isOpen;
	}

	private handleKeyDown(e: KeyboardEvent): void
	{
		if (e.code !== 'Escape') return;
		if (!this.isEnabled) return;
		// Don't fight other modals - if any other dialog is on top,
		// let it handle Esc first.
		const hasModalOpen = document.querySelector('.swal2-container')
			|| document.querySelector('#dialog-bar.visible')
			|| document.querySelector('#settings-modal.visible');
		if (hasModalOpen && !this.isOpen) return;

		e.preventDefault();
		if (this.isOpen) this.close();
		else this.open();
	}

	private buildOverlay(): HTMLDivElement
	{
		const wrap = document.createElement('div');
		wrap.id = 'pause-overlay';
		// Built once at construction; t() reads the current locale at the
		// moment of build. PauseMenu is constructed at world startup
		// after the title-screen language picker has stored a locale, so
		// the labels match the player's choice.
		wrap.innerHTML = `
			<h1 class="pause-title">${t('pause.title')}</h1>
			<div class="pause-menu" role="menu">
				<button class="pause-btn" data-action="resume" role="menuitem">
					<span class="pause-icon">&#9654;</span>
					<span>${t('pause.resume')}</span>
				</button>
				<button class="pause-btn" data-action="settings" role="menuitem">
					<span class="pause-icon">&#9881;</span>
					<span>${t('pause.settings')}</span>
				</button>
				<button class="pause-btn" data-action="restart" role="menuitem">
					<span class="pause-icon">&#8634;</span>
					<span>${t('pause.restart')}</span>
				</button>
				<button class="pause-btn danger" data-action="reload" role="menuitem">
					<span class="pause-icon">&#8629;</span>
					<span>${t('pause.reload')}</span>
				</button>
			</div>
			<p class="pause-hint">${t('pause.hint', { key: '<kbd class="ctrl-key">Esc</kbd>' })}</p>
		`;

		wrap.querySelectorAll<HTMLButtonElement>('.pause-btn').forEach((btn) =>
		{
			btn.addEventListener('click', () => this.handleAction(btn.dataset.action || ''));
		});

		return wrap;
	}

	private handleAction(action: string): void
	{
		switch (action)
		{
			case 'resume':
				this.close();
				break;
			case 'settings':
				if (this.onSettings) this.onSettings();
				break;
			case 'restart':
				this.close();
				this.world.restartScenario();
				break;
			case 'reload':
				this.world.sfxBus.playIrisWhoosh();
				IrisTransition.getInstance().close().then(() => location.reload());
				break;
		}
	}
}
