// Branching NPC dialog. A Dialog is a map of nodes; each node has a
// speaker, body text, and a list of choices that can either jump to
// another node or end the conversation. The DialogBox singleton owns
// one DOM bar and renders the current node; it's opened by NPCs from
// their ProximityPrompt onInteract callback.

import * as THREE from 'three';
import { t } from '../../i18n';
import { Character } from '../../characters/Character';

export interface DialogOpenOptions
{
	// Characters to freeze while the dialog is open - typically the player
	// + the NPC they're talking to. Both stand still, drop their actions,
	// and ignore input until the dialog closes.
	participants?: Character[];
	onClose?: () => void;
}

export interface DialogChoice
{
	label: string;
	next: string | 'end';
}

export interface DialogNode
{
	speaker: string;
	role?: string;
	portrait?: string;
	text: string;
	choices: DialogChoice[];
}

export interface Dialog
{
	start: string;
	nodes: { [id: string]: DialogNode };
}

let instance: DialogBox | null = null;

export class DialogBox
{
	private bar: HTMLDivElement;
	private speakerEl: HTMLDivElement;
	private textEl: HTMLDivElement;
	private choicesEl: HTMLDivElement;
	private portraitImg: HTMLDivElement;
	private portraitName: HTMLDivElement;
	private portraitRole: HTMLDivElement;

	private currentDialog: Dialog | null = null;
	private currentNodeId: string | null = null;
	private onClose: (() => void) | null = null;
	private participants: Character[] = [];
	private boundKeyDown: (e: KeyboardEvent) => void;

	// Typewriter state. The full text of the current node is held here
	// while a setInterval reveals it one char at a time. Choices stay
	// hidden until isTyping flips false; clicking the bar (or pressing
	// Enter / Space / E) before then skips to the end without picking
	// any choice - the same skip-to-end pattern the portfolio uses.
	private typingTimer: ReturnType<typeof setInterval> | null = null;
	private typingFullText: string = '';
	private typingCharIndex: number = 0;
	private isTyping: boolean = false;

	public static getInstance(): DialogBox
	{
		if (instance === null) instance = new DialogBox();
		return instance;
	}

	private constructor()
	{
		this.bar = document.createElement('div');
		this.bar.id = 'dialog-bar';
		// No leaveHint and no Esc handling - players exit by picking a
		// choice (every dialog has one that routes to 'end'). Mirrors the
		// Three.js portfolio's DialogOverlay where escape doesn't apply
		// either.
		this.bar.innerHTML = `
			<div class="dialog-dim"></div>
			<div class="dialog-box">
				<div class="dialog-portrait">
					<div class="portrait-img" data-portrait></div>
					<div class="portrait-name" data-name></div>
					<div class="portrait-role" data-role></div>
				</div>
				<div class="dialog-content">
					<div class="dialog-speaker" data-speaker></div>
					<div class="dialog-text" data-text></div>
					<div class="dialog-choices" data-choices role="menu"></div>
				</div>
			</div>
		`;
		document.body.appendChild(this.bar);

		this.speakerEl = this.bar.querySelector('[data-speaker]') as HTMLDivElement;
		this.textEl = this.bar.querySelector('[data-text]') as HTMLDivElement;
		this.choicesEl = this.bar.querySelector('[data-choices]') as HTMLDivElement;
		this.portraitImg = this.bar.querySelector('[data-portrait]') as HTMLDivElement;
		this.portraitName = this.bar.querySelector('[data-name]') as HTMLDivElement;
		this.portraitRole = this.bar.querySelector('[data-role]') as HTMLDivElement;

		this.boundKeyDown = (e) => this.handleKeyDown(e);
		document.addEventListener('keydown', this.boundKeyDown);

		// Click-to-skip on the dialog box itself. Choice buttons live
		// inside the bar too - they stop event propagation in their own
		// click handler so this listener only fires for clicks on the
		// surrounding card.
		this.bar.addEventListener('click', () =>
		{
			if (this.isTyping) this.skipToEnd();
		});
	}

	public isOpen(): boolean
	{
		return this.currentDialog !== null;
	}

	public open(dialog: Dialog, options?: DialogOpenOptions): void
	{
		this.currentDialog = dialog;
		this.onClose = options?.onClose ?? null;
		this.participants = options?.participants ?? [];
		// Whoosh-in. DialogBox has no direct world ref (singleton),
		// but participants[0] is the player and carries one.
		const player = this.participants[0];
		if (player !== undefined && player.world !== undefined)
		{
			player.world.sfxBus.playDialogOpen();
		}
		// Freeze each participant - both player and NPC stop moving and
		// drop their actions for the duration. See Character.dialogFreeze.
		// resetControls() routes through triggerAction() so charState
		// gets onInputChange() and transitions back to Idle; without
		// it a walking NPC would stay in the Walk state with velocity.
		for (const p of this.participants)
		{
			p.dialogFreeze = true;
			p.resetControls();
		}
		// Face the player. participants[0] is the player (set by
		// ProximityPrompt); every NPC after them rotates so the
		// conversation is two characters looking at each other rather
		// than the NPC keeping their walking direction.
		if (this.participants.length >= 2)
		{
			const player = this.participants[0];
			for (let i = 1; i < this.participants.length; i++)
			{
				const npc = this.participants[i];
				const dx = player.position.x - npc.position.x;
				const dz = player.position.z - npc.position.z;
				if (dx === 0 && dz === 0) continue;
				npc.setOrientation(new THREE.Vector3(dx, 0, dz));
			}
		}
		this.bar.classList.add('visible');
		// Sticky CSS hook for "everything else off-screen during a
		// dialog": controls overlay, lil-gui debug stack, FPS box,
		// other proximity-prompt labels.
		document.documentElement.classList.add('dialog-active');
		this.goTo(dialog.start);
		window.dispatchEvent(new CustomEvent('dialog-change', { detail: { open: true } }));
	}

	public close(): void
	{
		this.currentDialog = null;
		this.currentNodeId = null;
		this.bar.classList.remove('visible');
		document.documentElement.classList.remove('dialog-active');
		this.stopTyping();
		for (const p of this.participants) p.dialogFreeze = false;
		this.participants = [];
		if (this.onClose) this.onClose();
		this.onClose = null;
		window.dispatchEvent(new CustomEvent('dialog-change', { detail: { open: false } }));
	}

	private goTo(nodeId: string): void
	{
		if (this.currentDialog === null) return;
		const node = this.currentDialog.nodes[nodeId];
		if (node === undefined)
		{
			console.error(`DialogBox: missing node "${nodeId}"`);
			this.close();
			return;
		}
		this.currentNodeId = nodeId;
		this.render(node);
	}

	private render(node: DialogNode): void
	{
		this.speakerEl.textContent = node.speaker;
		this.portraitName.textContent = node.speaker;
		this.portraitRole.textContent = node.role ?? '';
		this.portraitImg.textContent = node.portrait ?? node.speaker.charAt(0).toUpperCase();

		// Build choices once, hidden until typing finishes. Stop click
		// from bubbling to the bar-level skip listener so picking a
		// choice doesn't get treated as a skip.
		this.choicesEl.innerHTML = '';
		this.choicesEl.style.visibility = 'hidden';
		node.choices.forEach((choice, i) =>
		{
			const btn = document.createElement('button');
			btn.className = 'dialog-choice';
			btn.setAttribute('role', 'menuitem');
			btn.dataset.index = String(i);
			btn.innerHTML = `<span class="dialog-key">${i + 1}</span><span>${escapeHtml(choice.label)}</span>`;
			btn.addEventListener('click', (e) =>
			{
				e.stopPropagation();
				if (!this.isTyping) this.pick(i);
			});
			this.choicesEl.appendChild(btn);
		});

		this.startTyping(node.text);
	}

	private startTyping(text: string): void
	{
		this.stopTyping();
		this.typingFullText = text;
		this.typingCharIndex = 0;
		this.isTyping = true;
		this.textEl.textContent = '';

		const CHAR_DELAY_MS = 28;
		this.typingTimer = setInterval(() =>
		{
			this.typingCharIndex++;
			if (this.typingCharIndex >= this.typingFullText.length)
			{
				this.finishTyping();
				return;
			}
			this.textEl.textContent = this.typingFullText.slice(0, this.typingCharIndex);
		}, CHAR_DELAY_MS);
	}

	private finishTyping(): void
	{
		this.stopTyping();
		this.textEl.textContent = this.typingFullText;
		this.choicesEl.style.visibility = '';
		// Focus the first choice so keyboard players land on it
		// immediately - same behaviour as before the typewriter pass.
		const first = this.choicesEl.querySelector<HTMLButtonElement>('.dialog-choice');
		first?.focus();
	}

	private skipToEnd(): void
	{
		if (!this.isTyping) return;
		this.finishTyping();
	}

	private stopTyping(): void
	{
		if (this.typingTimer !== null)
		{
			clearInterval(this.typingTimer);
			this.typingTimer = null;
		}
		this.isTyping = false;
	}

	private pick(i: number): void
	{
		if (this.currentDialog === null || this.currentNodeId === null) return;
		const node = this.currentDialog.nodes[this.currentNodeId];
		const choice = node.choices[i];
		if (choice === undefined) return;
		if (choice.next === 'end') this.close();
		else this.goTo(choice.next);
	}

	private handleKeyDown(e: KeyboardEvent): void
	{
		if (!this.isOpen()) return;
		// Esc deliberately does NOT close the dialog - players must pick a
		// choice (every dialog tree has an 'end' branch).

		// Skip-to-end while typing. E / Enter / Space all count, matching
		// the portfolio's "any acknowledgement" behaviour. ProximityPrompt
		// uses E to open - once the dialog is up the same key skips ahead.
		if (this.isTyping && (e.code === 'KeyE' || e.code === 'Enter' || e.code === 'Space'))
		{
			e.preventDefault();
			this.skipToEnd();
			return;
		}

		// Number keys 1–9 pick a choice. Ignored while typing so the
		// player doesn't accidentally pick before reading.
		if (this.isTyping) return;
		const num = e.code.startsWith('Digit') ? parseInt(e.code.slice(5), 10) - 1
			: e.code.startsWith('Numpad') ? parseInt(e.code.slice(6), 10) - 1 : -1;
		if (num >= 0 && num < 9)
		{
			const btn = this.choicesEl.querySelector<HTMLButtonElement>(`.dialog-choice[data-index="${num}"]`);
			if (btn)
			{
				e.preventDefault();
				this.pick(num);
			}
		}
	}
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
