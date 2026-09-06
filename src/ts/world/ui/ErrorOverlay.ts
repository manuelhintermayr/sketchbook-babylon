// Friendly error fallback. Wires window.onerror + unhandledrejection
// to show a card with the error message + stack and a Reload button.
// Once the overlay is up the page is effectively frozen - that's the
// intended behaviour because anything could be in a half-broken state.

import { t } from '../../i18n';

let installed = false;
let overlay: HTMLDivElement | null = null;

export function installErrorOverlay(): void
{
	if (installed) return;
	installed = true;

	overlay = document.createElement('div');
	overlay.id = 'error-overlay';
	overlay.innerHTML = `
		<div class="error-card">
			<div class="error-icon">!</div>
			<div class="error-code" data-code>${t('error.code')}</div>
			<h2 class="error-title" data-title>${t('error.title')}</h2>
			<p class="error-desc" data-desc>${t('error.desc')}</p>
			<div class="error-stack" data-stack></div>
			<div class="error-actions">
				<button class="error-btn error-btn-primary" data-reload>${t('error.reload')}</button>
				<button class="error-btn error-btn-outline" data-copy>${t('error.copy')}</button>
			</div>
		</div>
	`;
	document.body.appendChild(overlay);
	overlay.querySelector<HTMLButtonElement>('[data-reload]')!.addEventListener('click', () => location.reload());
	overlay.querySelector<HTMLButtonElement>('[data-copy]')!.addEventListener('click', copyDetails);

	window.addEventListener('error', (e: ErrorEvent) =>
	{
		showError({
			code: t('error.runtime'),
			title: e.message || t('error.fallbackUncaught'),
			stack: e.error?.stack || `${e.filename}:${e.lineno}:${e.colno}`,
		});
	});

	window.addEventListener('unhandledrejection', (e: PromiseRejectionEvent) =>
	{
		const reason = e.reason;
		showError({
			code: t('error.unhandled'),
			title: typeof reason === 'string' ? reason : (reason?.message ?? t('error.fallbackRejection')),
			stack: reason?.stack || String(reason),
		});
	});
}

interface ErrorPayload
{
	code: string;
	title: string;
	stack: string;
}

let lastError: ErrorPayload | null = null;

function showError(payload: ErrorPayload): void
{
	if (!overlay) return;
	// Don't keep replacing the card with subsequent errors - the first
	// one is usually the most informative; cascades drown it out.
	if (overlay.classList.contains('visible')) return;
	lastError = payload;
	overlay.querySelector('[data-code]')!.textContent = payload.code;
	overlay.querySelector('[data-title]')!.textContent = payload.title;
	overlay.querySelector('[data-stack]')!.textContent = payload.stack;
	overlay.classList.add('visible');
}

function copyDetails(): void
{
	if (lastError === null) return;
	const text = `${lastError.code}\n${lastError.title}\n\n${lastError.stack}`;
	if (navigator.clipboard !== undefined)
	{
		navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
	}
	else
	{
		fallbackCopy(text);
	}
}

function fallbackCopy(text: string): void
{
	const ta = document.createElement('textarea');
	ta.value = text;
	ta.style.position = 'fixed';
	ta.style.opacity = '0';
	document.body.appendChild(ta);
	ta.select();
	try { document.execCommand('copy'); } catch (_) { /* swallow */ }
	ta.remove();
}
