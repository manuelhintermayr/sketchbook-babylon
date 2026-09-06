import * as THREE from 'three';
import { World } from './World';
import { IUpdatable } from '../interfaces/IUpdatable';
import { UpdateOrder } from '../enums/UpdateOrder';
import { Character } from '../characters/Character';
import { DialogBox, Dialog } from './ui/DialogBox';
import { t } from '../i18n';

export type ProximityCenter = THREE.Vector3 | (() => THREE.Vector3);

export interface ProximityPromptParams
{
	text?: string;
	// Touch-mode variant of `text`. If unset, falls back to `text` -
	// keyboard-only prompts (e.g. environment triggers) don't need their
	// own touch label since touch devices won't see them anyway.
	touchText?: string;
	maxInteractDistance?: number;
	interactionCooldown?: number;
	// Either a flat callback (legacy Notblox-style) or a Dialog tree
	// rendered by the shared DialogBox singleton.
	onInteract?: (player: Character) => void;
	dialog?: Dialog;
	// Character to freeze alongside the player when the dialog opens -
	// typically the NPC the prompt is attached to. The dialog leaves
	// both standing still until the player picks a closing choice.
	targetCharacter?: Character;
}

// Single-player port of iErcann/Notblox's ProximityPrompt. The original
// is networked + ECS-based: a NetworkComponent the server attaches to
// any entity, plus a client system that draws a HUD label and forwards
// the E key. We collapse that to a per-frame distance check + a screen-
// space DOM label + a document keydown listener.
//
// Visibility uses the same stateless squared-distance check WorldLabels
// applies to the CSS2D name tags - simple, deterministic, and immune
// to the desync windows a TriggerCube + onEnter/onExit state machine
// can hit when the player teleports, gets dialogFreeze'd mid-step, or
// the NPC walks past at speed.
const _temp = new THREE.Vector3();

export class ProximityPrompt implements IUpdatable
{
	public updateOrder = UpdateOrder.Prompts;

	private world: World | null = null;
	private centerSource: ProximityCenter;

	private label: HTMLDivElement;
	private inside = false;
	private lastInteract = 0;
	private text: string;
	private touchText: string;
	private maxInteractDistanceSq: number;
	private interactionCooldown: number;
	private onInteract: ((player: Character) => void) | undefined;
	private dialog: Dialog | undefined;
	private targetCharacter: Character | undefined;
	private kind: 'dialog' | 'interact';

	private boundKeyDown: (e: KeyboardEvent) => void;
	private boundTouchModeChange: () => void;

	constructor(center: ProximityCenter, params: ProximityPromptParams)
	{
		this.centerSource = center;
		this.text = params.text ?? t('prompt.interact');
		this.touchText = params.touchText ?? params.text ?? t('prompt.interact.touch');
		const maxInteractDistance = params.maxInteractDistance ?? 3;
		this.maxInteractDistanceSq = maxInteractDistance * maxInteractDistance;
		this.interactionCooldown = params.interactionCooldown ?? 1000;
		this.onInteract = params.onInteract;
		this.dialog = params.dialog;
		this.targetCharacter = params.targetCharacter;
		// Buttons split in TouchControls by kind - dialog gets the E
		// button, plain interact gets the F button. Vehicles aren't
		// ProximityPrompts so they're handled separately.
		this.kind = params.dialog !== undefined ? 'dialog' : 'interact';

		this.label = document.createElement('div');
		this.label.className = 'proximity-prompt';
		this.refreshLabelText();
		this.label.style.cssText = [
			'position:absolute', 'top:55%', 'left:50%', 'transform:translate(-50%,-50%)',
			'padding:6px 14px', 'background:rgba(0,0,0,0.55)', 'color:#fff',
			'font-family:var(--font-label)', 'font-size:14px', 'border-radius:4px',
			'pointer-events:none', 'visibility:hidden', 'z-index:30',
			'text-shadow:0 1px 2px rgba(0,0,0,0.5)',
		].join(';');

		this.boundKeyDown = this.onKeyDown.bind(this);
		this.boundTouchModeChange = () => this.refreshLabelText();
	}

	public addToWorld(world: World): void
	{
		this.world = world;
		document.body.appendChild(this.label);
		document.addEventListener('keydown', this.boundKeyDown);
		// Touch / interact button on the on-screen overlay. Both routes
		// land in the same interact() entrypoint so cooldown + dialog
		// gating apply equally.
		window.addEventListener('touch-interact', this.boundKeyDown as any);
		window.addEventListener('touchmode-change', this.boundTouchModeChange);
		world.registerUpdatable(this);
	}

	public removeFromWorld(world: World): void
	{
		this.label.remove();
		document.removeEventListener('keydown', this.boundKeyDown);
		window.removeEventListener('touch-interact', this.boundKeyDown as any);
		window.removeEventListener('touchmode-change', this.boundTouchModeChange);
		world.unregisterUpdatable(this);
		this.world = null;
	}

	public update(_timeStep: number): void
	{
		if (this.world === null) return;

		// Orphan detection - if our target NPC has been pulled from
		// the world (scenario switch, Shift+R restart), tear ourselves
		// down. Prompts are intentionally not part of clearEntities,
		// so the prompt has to notice itself when its target is gone.
		if (this.targetCharacter !== undefined)
		{
			if (this.world.characters.indexOf(this.targetCharacter) === -1)
			{
				this.label.style.visibility = 'hidden';
				this.removeFromWorld(this.world);
				return;
			}
		}

		// Use the explicit isPlayer flag instead of characters[0] -
		// async boxman.glb loads can land an NPC at index 0 if its
		// callback fires before the player's, which would put the
		// distance check at NPC↔NPC = 0 and stick the label visible
		// from anywhere on the map.
		const player = this.world.characters.find((c) => c.isPlayer);
		if (player === undefined)
		{
			if (this.inside) this.setInside(false);
			return;
		}

		const center = typeof this.centerSource === 'function'
			? this.centerSource()
			: this.centerSource;

		const dx = player.position.x - center.x;
		const dy = player.position.y - center.y;
		const dz = player.position.z - center.z;
		const distSq = dx * dx + dy * dy + dz * dz;
		const shouldBeInside = distSq <= this.maxInteractDistanceSq;

		if (shouldBeInside !== this.inside) this.setInside(shouldBeInside);
	}

	private setInside(value: boolean): void
	{
		this.inside = value;
		this.label.style.visibility = value ? 'visible' : 'hidden';
		if (value && this.world !== null) this.world.sfxBus.playUiTick();
		window.dispatchEvent(new CustomEvent(value ? 'proximity-near' : 'proximity-far', {
			detail: { kind: this.kind },
		}));
	}

	private refreshLabelText(): void
	{
		const touch = document.documentElement.classList.contains('touch-active');
		this.label.textContent = touch ? this.touchText : this.text;
	}

	private onKeyDown(e: KeyboardEvent | CustomEvent): void
	{
		// Either a real keydown (E for dialog/interact) or a synthetic
		// touch-interact CustomEvent dispatched by TouchControls when the
		// E / F button is tapped.
		const isTouch = (e as CustomEvent).type === 'touch-interact';
		if (!isTouch)
		{
			const code = (e as KeyboardEvent).code;
			// Dialog prompts respond to E, plain interact prompts to F
			// (matches the on-screen button labels). Keep E for both
			// kinds so existing keyboard muscle memory still works for
			// non-dialog interacts.
			if (code !== 'KeyE' && code !== 'KeyF') return;
			if (this.kind === 'dialog' && code !== 'KeyE') return;
		}
		else
		{
			const detail = (e as CustomEvent).detail as { kind?: string } | undefined;
			if (detail?.kind !== this.kind) return;
		}
		if (!this.inside) return;
		// Don't trigger while another dialog is already open (also
		// guards against re-entering this same prompt's dialog).
		if (DialogBox.getInstance().isOpen()) return;
		const now = Date.now();
		if (now - this.interactionCooldown < this.lastInteract) return;
		this.lastInteract = now;
		const player = this.world?.characters.find((c) => c.isPlayer);
		if (!player) return;

		if (this.dialog !== undefined)
		{
			const participants: Character[] = [player];
			if (this.targetCharacter !== undefined) participants.push(this.targetCharacter);
			DialogBox.getInstance().open(this.dialog, { participants });
		}
		if (this.onInteract !== undefined)
		{
			this.onInteract(player);
		}
	}
}
