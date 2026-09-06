// Pre-game title screen. Lives in index.html before any World instance
// exists - bootstraps the fonts and styles itself, then resolves a
// promise on first user gesture so the caller can build the World.
//
// The first user gesture also unblocks browser audio autoplay, which
// is what Speaker relies on for in-world positional audio.

import { LOCALE_LABELS, getLocale, setLocale, t, Locale } from '../../i18n';

const FONT_HREFS = [
	'https://fonts.googleapis.com/css2?family=Alfa+Slab+One&display=swap',
	'https://fonts.googleapis.com/css2?family=Solway:wght@300;400;500;700;800&display=swap',
	'https://fonts.googleapis.com/css2?family=Catamaran:wght@400;500;700;800&display=swap',
	'https://fonts.googleapis.com/css2?family=Cutive+Mono&display=swap',
];

export interface TitleScreenOptions
{
	title?: string;
	version?: string;
	prompt?: string;
}

// Show the title screen and resolve when the player presses any key
// or clicks. Caller is responsible for instantiating the World after.
export function showTitleScreen(options: TitleScreenOptions = {}): Promise<void>
{
	const title = options.title ?? 'Sketchbook';
	const version = options.version ?? 'Version 0.8.0';
	// Caller can pass a literal English prompt for back-compat, but if
	// they don't we look it up via i18n so the player's saved locale
	// applies before the prompt is even drawn.
	const promptText = options.prompt ?? t('title.prompt');

	// Inject fonts so the title screen looks right even before main.css
	// has had a chance to attach them (it does it inside World).
	for (const href of FONT_HREFS)
	{
		const existing = document.querySelector(`link[href="${href}"]`);
		if (existing) continue;
		const link = document.createElement('link');
		link.rel = 'stylesheet';
		link.href = href;
		document.head.appendChild(link);
	}

	// Apply the persisted dark-mode preference before the title screen
	// even renders so the page never flashes the wrong theme. ParamsGUI
	// reads the same key when World boots, so the Settings modal stays
	// in sync.
	const darkOnInit = localStorage.getItem('sketchbook.darkMode') === 'true';
	document.documentElement.classList.toggle('dark', darkOnInit);

	const langButtons = (['en', 'de', 'es'] as Locale[]).map((l) => `
		<button class="title-lang-btn" data-lang="${l}" type="button">${escapeHtml(LOCALE_LABELS[l])}</button>
	`).join('');

	const wrap = document.createElement('div');
	wrap.id = 'title-screen';
	wrap.innerHTML = `
		<div class="title-text">${escapeHtml(title)}</div>
		<div class="title-version">${escapeHtml(version)}</div>
		<div class="cube-bounce">
			<div class="cubeWrap">
				<div class="cube">
					<div class="faces1"></div>
					<div class="faces2"></div>
				</div>
			</div>
		</div>
		<p class="title-prompt">${formatPrompt(promptText)}</p>
		<div class="title-lang">
			<span class="title-lang-label">${escapeHtml(t('title.languagePrompt'))}:</span>
			${langButtons}
			<button class="title-theme-btn" type="button" aria-label="Toggle dark mode">
				<span class="title-theme-icon" aria-hidden="true"></span>
			</button>
			<button class="title-sound-btn" type="button" aria-label="Toggle sound">
				<span class="title-sound-icon" aria-hidden="true"></span>
			</button>
		</div>
	`;
	document.body.appendChild(wrap);

	const promptEl = wrap.querySelector<HTMLParagraphElement>('.title-prompt');
	const labelEl = wrap.querySelector<HTMLSpanElement>('.title-lang-label');
	const themeBtn = wrap.querySelector<HTMLButtonElement>('.title-theme-btn');
	const soundBtn = wrap.querySelector<HTMLButtonElement>('.title-sound-btn');

	const refreshThemeBtn = (): void =>
	{
		if (themeBtn === null) return;
		const dark = document.documentElement.classList.contains('dark');
		themeBtn.classList.toggle('active', dark);
		themeBtn.title = dark ? 'Switch to light mode' : 'Switch to dark mode';
	};
	refreshThemeBtn();

	if (themeBtn !== null)
	{
		const onThemeClick = (e: Event): void =>
		{
			// Same dismiss-suppression as the language buttons - the
			// player is toggling theme, not asking to start.
			e.stopPropagation();
			const next = !document.documentElement.classList.contains('dark');
			document.documentElement.classList.toggle('dark', next);
			localStorage.setItem('sketchbook.darkMode', next ? 'true' : 'false');
			refreshThemeBtn();
		};
		themeBtn.addEventListener('click', onThemeClick);
		themeBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
	}

	// Sound mute toggle. Backed by sketchbook.soundMuted in localStorage
	// so the choice survives the title-screen dismiss + ParamsGUI reads
	// the same key when it builds the params object - whatever the
	// player picks here lands in Master_Volume + the Sound_Effects
	// composite the moment World boots.
	const refreshSoundBtn = (): void =>
	{
		if (soundBtn === null) return;
		const muted = localStorage.getItem('sketchbook.soundMuted') === 'true';
		soundBtn.classList.toggle('active', !muted);
		soundBtn.title = muted ? 'Sound: off (click to enable)' : 'Sound: on (click to mute)';
	};
	refreshSoundBtn();
	if (soundBtn !== null)
	{
		const onSoundClick = (e: Event): void =>
		{
			e.stopPropagation();
			const next = localStorage.getItem('sketchbook.soundMuted') !== 'true';
			localStorage.setItem('sketchbook.soundMuted', next ? 'true' : 'false');
			refreshSoundBtn();
		};
		soundBtn.addEventListener('click', onSoundClick);
		soundBtn.addEventListener('pointerdown', (e) => e.stopPropagation());
	}

	const refreshActiveLang = (): void =>
	{
		const active = getLocale();
		wrap.querySelectorAll<HTMLButtonElement>('.title-lang-btn').forEach((b) =>
		{
			b.classList.toggle('active', b.dataset.lang === active);
		});
	};
	refreshActiveLang();

	wrap.querySelectorAll<HTMLButtonElement>('.title-lang-btn').forEach((btn) =>
	{
		btn.addEventListener('click', (e) =>
		{
			// Stop the click from bubbling to the dismiss listener - the
			// player is selecting language, not asking to start.
			e.stopPropagation();
			const lang = btn.dataset.lang as Locale | undefined;
			if (lang === undefined) return;
			setLocale(lang);
			if (promptEl) promptEl.innerHTML = formatPrompt(t('title.prompt'));
			if (labelEl) labelEl.textContent = t('title.languagePrompt') + ':';
			refreshActiveLang();
		});
		// Pointerdown also bubbles to the document-level dismiss listener
		// - same stop here.
		btn.addEventListener('pointerdown', (e) => e.stopPropagation());
	});

	return new Promise<void>((resolve) =>
	{
		let dismissed = false;
		const dismiss = (): void =>
		{
			if (dismissed) return;
			dismissed = true;
			window.removeEventListener('keydown', onKeyDown);
			window.removeEventListener('pointerdown', onPointer);
			wrap.classList.add('fade-out');
			window.setTimeout(() =>
			{
				wrap.remove();
				resolve();
			}, 400);
		};
		const onKeyDown = (_e: KeyboardEvent): void => dismiss();
		const onPointer = (_e: PointerEvent): void => dismiss();
		window.addEventListener('keydown', onKeyDown);
		window.addEventListener('pointerdown', onPointer);
	});
}

function escapeHtml(s: string): string
{
	return s.replace(/[&<>"']/g, (c) =>
	{
		switch (c)
		{
			case '&': return '&amp;';
			case '<': return '&lt;';
			case '>': return '&gt;';
			case '"': return '&quot;';
			case "'": return '&#39;';
			default: return c;
		}
	});
}

function formatPrompt(prompt: string): string
{
	// Wrap key names in <kbd> for the styled keycap look. Per-locale
	// patterns - the German + Spanish equivalents of "any key" need
	// their own match so the keycap effect lands on every translation.
	return escapeHtml(prompt).replace(
		/\b(any key|eine Taste|Taste|una tecla|tecla|Esc|Space|Leertaste|Enter|F)\b/gi,
		'<kbd>$1</kbd>',
	);
}
