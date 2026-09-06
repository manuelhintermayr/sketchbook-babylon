// On-screen touch controls. Auto-mounted at module load on touch-capable
// devices, attached to the World once it boots. Synthesises the same
// KeyboardEvent / MouseEvent pairs the existing InputManager already
// listens for, plus a few CustomEvents so ProximityPrompt can route
// E / F taps to the right interact target.
//
// Layout: dynamic joystick anywhere on the canvas (appears at first
// drag), context-aware button cluster bottom-right. Buttons differ by
// state: foot-no-near = nothing, foot-near = E/F, in-vehicle = brake +
// vehicle-specific extras, dialog-open = nothing (the dialog UI owns
// the bottom edge).
//
// Touch / mouse coexistence: html.touch-active is added on real touch
// pointerdown, removed on mouse pointerdown or any gameplay keypress.
// CSS hides the entire #touch-controls + the keyboard-controls overlay
// + the lil-gui debug panel based on this class so hybrid devices (a
// Surface, a laptop with a touchscreen) get the right HUD per session.
//
// Pattern adapted from manuelhintermayr-portfolio-v2/MobileJoystick +
// portfolio/three-js useCustomTouchControls.

import { World } from '../world/World';
import { EntityType } from '../enums/EntityType';
import { DialogBox } from '../world/ui/DialogBox';
import { t } from '../i18n';

const JOYSTICK_RADIUS = 70;
const JOYSTICK_DEADZONE = 0.2;
const SPRINT_AUTO_THRESHOLD = 0.85;
const TAP_MAX_MOVE = 10;
const TAP_MAX_TIME = 500;
const TOUCH_CAM_SENSITIVITY = 2.5;
const NEAR_VEHICLE_DISTANCE = 10;      // matches Character.findVehicleToEnter
const KEYBOARD_DEACTIVATE_KEYS = new Set([
	'KeyW', 'KeyA', 'KeyS', 'KeyD', 'KeyE', 'KeyF', 'KeyV', 'KeyX', 'KeyQ', 'KeyR',
	'Space', 'ShiftLeft', 'Escape',
]);

type DirectionKey = 'KeyW' | 'KeyA' | 'KeyS' | 'KeyD';
type FingerRole = 'joystick' | 'camera';
type TouchMode = 'foot' | 'car' | 'boat' | 'aircraft' | 'rocket' | 'passenger' | 'dialog';

interface FingerSlot
{
	pointerId: number;
	role: FingerRole;
	startX: number;
	startY: number;
	startTime: number;
	currentX: number;
	currentY: number;
}

interface ButtonSpec
{
	id: string;
	label: string;
	code: string;
	primary: boolean;
	visible: boolean;
}

export class TouchControls
{
	private static instance: TouchControls | null = null;

	private world: World | null = null;

	private root: HTMLDivElement;
	private joystickBase: HTMLDivElement;
	private joystickThumb: HTMLDivElement;
	private buttonCluster: HTMLDivElement;
	private buttons: Map<string, HTMLButtonElement> = new Map();

	private fingers: (FingerSlot | null)[] = [null, null];
	private heldDirections: Set<DirectionKey> = new Set();
	private sprintAuto: boolean = false;

	private canvas: HTMLElement | null = null;

	// State driving button visibility
	private mode: TouchMode = 'foot';
	private nearInteractCount = 0;
	private nearDialogCount = 0;
	private nearVehicle = false;
	private dialogOpen = false;

	public static install(): void
	{
		if (TouchControls.instance !== null) return;
		if (!('ontouchstart' in window) && navigator.maxTouchPoints === 0) return;
		TouchControls.instance = new TouchControls();
	}

	public static attachWorld(world: World): void
	{
		TouchControls.instance?.setWorld(world);
	}

	public setWorld(world: World): void
	{
		this.world = world;
	}

	private constructor()
	{
		this.root = document.createElement('div');
		this.root.id = 'touch-controls';

		this.joystickBase = document.createElement('div');
		this.joystickBase.id = 'touch-joystick-base';
		this.joystickThumb = document.createElement('div');
		this.joystickThumb.id = 'touch-joystick-thumb';
		this.joystickBase.appendChild(this.joystickThumb);
		this.root.appendChild(this.joystickBase);

		this.buttonCluster = document.createElement('div');
		this.buttonCluster.id = 'touch-buttons';
		this.root.appendChild(this.buttonCluster);

		// Build all possible buttons up front; CSS + JS toggle their
		// visibility per mode. Each spec carries its keycode and a
		// primary/secondary flag (drives size hierarchy).
		this.makeButton('touch-btn-talk',     t('touch.talk'),     'KeyE',     'primary');
		this.makeButton('touch-btn-action',   t('touch.action'),   'KeyF',     'primary');
		this.makeButton('touch-btn-brake',    t('touch.brake'),    'Space',    'secondary');
		this.makeButton('touch-btn-up',       t('touch.up'),       'ShiftLeft','secondary');
		this.makeButton('touch-btn-down',     t('touch.down'),     'Space',    'secondary');
		this.makeButton('touch-btn-view',     t('touch.view'),     'KeyV',     'secondary');
		this.makeButton('touch-btn-seat',     t('touch.seat'),     'KeyX',     'secondary');
		this.makeButton('touch-btn-yaw-left', t('touch.yawLeft'),  'KeyQ',     'secondary');
		this.makeButton('touch-btn-yaw-right',t('touch.yawRight'), 'KeyE',     'secondary');

		document.body.appendChild(this.root);

		this.canvas = document.getElementById('canvas');

		// Pointer events (joystick + camera) on document so we catch any
		// touch outside the control widgets. Buttons have their own
		// listeners + stopPropagation so they're skipped here.
		document.addEventListener('pointerdown', (e) => this.onPointerDown(e), { passive: false });
		document.addEventListener('pointermove', (e) => this.onPointerMove(e), { passive: false });
		document.addEventListener('pointerup', (e) => this.onPointerUp(e));
		document.addEventListener('pointercancel', (e) => this.onPointerUp(e));

		// Mode toggle: keypress on a gameplay key drops touch-active so
		// the keyboard HUD comes back. Mirrors the Babylon reference's
		// disableTouchMode-on-keydown branch.
		//
		// `isTrusted` filters out our OWN synthesised KeyboardEvents -
		// the joystick dispatches KeyW/A/S/D and the F/E buttons
		// dispatch their codes too. Without this guard, the very first
		// joystick drag would re-activate keyboard mode and yank the
		// touch UI out from under the player.
		document.addEventListener('keydown', (e) =>
		{
			if (!e.isTrusted) return;
			if (!document.documentElement.classList.contains('touch-active')) return;
			if (KEYBOARD_DEACTIVATE_KEYS.has(e.code)) this.exitTouchMode();
		});

		// State signals from elsewhere in the engine
		window.addEventListener('proximity-near', (e) =>
		{
			const kind = (e as CustomEvent).detail?.kind;
			if (kind === 'dialog') this.nearDialogCount++;
			else if (kind === 'interact') this.nearInteractCount++;
			this.refreshButtons();
		});
		window.addEventListener('proximity-far', (e) =>
		{
			const kind = (e as CustomEvent).detail?.kind;
			if (kind === 'dialog') this.nearDialogCount = Math.max(0, this.nearDialogCount - 1);
			else if (kind === 'interact') this.nearInteractCount = Math.max(0, this.nearInteractCount - 1);
			this.refreshButtons();
		});
		window.addEventListener('dialog-change', (e) =>
		{
			this.dialogOpen = !!(e as CustomEvent).detail?.open;
			this.refreshButtons();
		});

		// Vehicle proximity polling - Character/Vehicle don't dispatch
		// events for "player got close enough to enter", so we sample
		// once per animation frame. Cheap: a single distanceTo per
		// vehicle, max ~5 vehicles in a typical scene.
		const tick = (): void =>
		{
			this.pollWorldState();
			requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);

		this.refreshButtons();
	}

	private makeButton(id: string, label: string, code: string, kind: 'primary' | 'secondary'): void
	{
		const btn = document.createElement('button');
		btn.id = id;
		btn.className = 'touch-action-btn ' + (kind === 'primary' ? 'touch-action-btn--primary' : 'touch-action-btn--secondary');
		btn.textContent = label;
		btn.dataset.code = code;
		btn.style.display = 'none';

		const press = (e: PointerEvent): void =>
		{
			e.preventDefault();
			e.stopPropagation();
			btn.classList.add('pressed');
			// setPointerCapture so a held finger that drifts off the
			// circle still gets pointerup → release. Without it pointer
			// leave fired mid-hold and silently dropped the key.
			try { btn.setPointerCapture(e.pointerId); } catch (_err) { /* noop */ }
			// E and F also drive ProximityPrompts via a synthetic event
			// - keyboard players press E/F directly, touch players go
			// through this bridge.
			if (code === 'KeyE')
			{
				window.dispatchEvent(new CustomEvent('touch-interact', { detail: { kind: 'dialog' } }));
			}
			else if (code === 'KeyF')
			{
				window.dispatchEvent(new CustomEvent('touch-interact', { detail: { kind: 'interact' } }));
			}
			this.dispatchKey(code, true);
		};
		const release = (e: PointerEvent): void =>
		{
			e.preventDefault();
			e.stopPropagation();
			btn.classList.remove('pressed');
			try { btn.releasePointerCapture(e.pointerId); } catch (_err) { /* noop */ }
			this.dispatchKey(code, false);
		};

		btn.addEventListener('pointerdown', press);
		btn.addEventListener('pointerup', release);
		btn.addEventListener('pointercancel', release);

		this.buttonCluster.appendChild(btn);
		this.buttons.set(id, btn);
	}

	// --- World state polling ---------------------------------------------

	private pollWorldState(): void
	{
		if (this.world === null) return;
		const player = this.world.characters.find((c) => c.isPlayer);
		if (!player) return;

		// Mode from controlledObject.entityType (driver) or occupyingSeat
		// (passenger - controlledObject is only set on the driver, but a
		// passenger still needs Exit + Seat-Switch buttons).
		let nextMode: TouchMode;
		if (this.dialogOpen) nextMode = 'dialog';
		else if (player.controlledObject !== undefined)
		{
			const et = (player.controlledObject as any).entityType as EntityType | undefined;
			switch (et)
			{
				case EntityType.Car:        nextMode = 'car'; break;
				case EntityType.Boat:       nextMode = 'boat'; break;
				case EntityType.Helicopter:
				case EntityType.Airplane:   nextMode = 'aircraft'; break;
				case EntityType.RocketShip: nextMode = 'rocket'; break;
				default:                    nextMode = 'foot';
			}
		}
		else if (player.occupyingSeat !== null) nextMode = 'passenger';
		else nextMode = 'foot';

		// Cheap vehicle-proximity sample (only matters on foot)
		let nextNearVehicle = false;
		if (nextMode === 'foot')
		{
			for (const v of this.world.vehicles)
			{
				if (player.position.distanceTo(v.position) < NEAR_VEHICLE_DISTANCE)
				{
					nextNearVehicle = true;
					break;
				}
			}
		}

		if (nextMode !== this.mode || nextNearVehicle !== this.nearVehicle)
		{
			this.mode = nextMode;
			this.nearVehicle = nextNearVehicle;
			this.refreshButtons();
		}
	}

	// --- Button visibility ------------------------------------------------

	private refreshButtons(): void
	{
		this.root.dataset.touchMode = this.mode;

		// Compute which buttons should show + which is the primary
		// (single big one, others stay small). DialogBox owns the bottom
		// edge during a conversation so we hide every touch button.
		const visible: Set<string> = new Set();
		let primary: string | null = null;

		if (this.mode === 'dialog')
		{
			// no buttons
		}
		else if (this.mode === 'foot')
		{
			if (this.nearDialogCount > 0)
			{
				visible.add('touch-btn-talk');
				primary = 'touch-btn-talk';
			}
			if (this.nearInteractCount > 0 || this.nearVehicle)
			{
				visible.add('touch-btn-action');
				if (primary === null) primary = 'touch-btn-action';
			}
		}
		else if (this.mode === 'car' || this.mode === 'boat')
		{
			visible.add('touch-btn-action'); // Exit (F)
			visible.add('touch-btn-brake');  // Space
			visible.add('touch-btn-view');   // V
			visible.add('touch-btn-seat');   // X
			primary = 'touch-btn-action';
		}
		else if (this.mode === 'aircraft')
		{
			visible.add('touch-btn-action');    // Exit (F)
			visible.add('touch-btn-up');        // ShiftLeft (ascend)
			visible.add('touch-btn-down');      // Space (descend)
			visible.add('touch-btn-yaw-left');  // Q
			visible.add('touch-btn-yaw-right'); // E
			visible.add('touch-btn-view');      // V
			primary = 'touch-btn-action';
		}
		else if (this.mode === 'rocket')
		{
			visible.add('touch-btn-action'); // Exit (F)
			// touch-btn-up (ShiftLeft "ascend") deliberately omitted -
			// the rocket inherits the keybinding from the helicopter
			// vehicle base but the liftoff sequence is fully scripted,
			// so manual ascend has no observable effect.
			visible.add('touch-btn-down');   // Space - triggers blast-off
			primary = 'touch-btn-action';
		}
		else if (this.mode === 'passenger')
		{
			// Passengers can't drive - just exit (F) or swap into the
			// driver seat (X). Brake / throttle / view all belong to
			// the driver.
			visible.add('touch-btn-action'); // Exit (F)
			visible.add('touch-btn-seat');   // Seat-switch (X)
			primary = 'touch-btn-action';
		}

		for (const [id, btn] of this.buttons)
		{
			const show = visible.has(id);
			btn.style.display = show ? 'flex' : 'none';
			btn.classList.toggle('touch-action-btn--primary', show && id === primary);
			btn.classList.toggle('touch-action-btn--secondary', show && id !== primary);
			delete btn.dataset.slot;
		}

		// Swap touch-btn-down's glyph to a rocket emoji in rocket mode -
		// the same button is "descend" in aircraft / vehicles and
		// "blast off" in the rocket, and the keycap should reflect what
		// it does. Restore the down-arrow text in every other mode.
		const downBtn = this.buttons.get('touch-btn-down');
		if (downBtn !== undefined)
		{
			const wantRocket = this.mode === 'rocket';
			const desired = wantRocket ? '🚀' : t('touch.down');
			if (downBtn.textContent !== desired) downBtn.textContent = desired;
		}

		// Assign slot indices in priority order: primary is slot 0
		// (outer-low corner), secondaries fill 1..N in the order they
		// were added to `visible`. Each slot has a fixed right/bottom
		// position in the CSS that paints the staircase. Insertion
		// order of a Set is iteration order in JS, so the per-mode
		// visible.add() calls above implicitly drive the priority.
		const ordered: string[] = [];
		if (primary !== null) ordered.push(primary);
		for (const id of visible) if (id !== primary) ordered.push(id);
		ordered.forEach((id, idx) =>
		{
			const btn = this.buttons.get(id);
			if (btn) btn.dataset.slot = String(idx);
		});
	}

	// --- Joystick + camera (pointer dispatch) ----------------------------

	private onPointerDown(e: PointerEvent): void
	{
		// Mouse → step out of touch mode. On a real desktop with a
		// mouse this fires immediately and the touch UI never shows.
		if (e.pointerType === 'mouse')
		{
			this.exitTouchMode();
			return;
		}
		if (this.isOnControlWidget(e.target as HTMLElement)) return;

		this.enterTouchMode();

		// preventDefault stops the browser from claiming the gesture
		// for scroll / swipe-back / pull-to-refresh - without it a
		// vertical drag fires pointercancel mid-joystick and yanks the
		// visual.
		e.preventDefault();

		// Slot 0 = movement joystick (always - appears at touch point),
		// slot 1 = camera drag. Both roles are decided up front so the
		// joystick visual shows up the instant the player touches down,
		// matching the portfolio's TouchCircles behaviour. A pure tap
		// (no drag) still fires jump on release; the joystick just
		// also flashes briefly, which is the conventional pattern.
		const slot = this.fingers[0] === null ? 0 : (this.fingers[1] === null ? 1 : -1);
		if (slot === -1) return;

		const role: FingerRole = slot === 0 ? 'joystick' : 'camera';
		const finger: FingerSlot =
		{
			pointerId: e.pointerId,
			role,
			startX: e.clientX,
			startY: e.clientY,
			startTime: Date.now(),
			currentX: e.clientX,
			currentY: e.clientY,
		};
		this.fingers[slot] = finger;

		// Capture the pointer on whichever element actually got it
		// (typically the canvas) so subsequent pointermove keeps
		// firing on the same element even if the finger drifts off.
		// Without this, Chrome reroutes mid-stroke and the joystick
		// vanishes when the finger crosses over a CSS2D label or off
		// the canvas edge.
		const captureTarget = e.target as Element | null;
		if (captureTarget !== null)
		{
			try { captureTarget.setPointerCapture(e.pointerId); } catch (_err) { /* noop */ }
		}

		if (role === 'joystick')
		{
			this.showJoystick(e.clientX, e.clientY);
		}
	}

	private onPointerMove(e: PointerEvent): void
	{
		if (e.pointerType === 'mouse') return;

		const finger = this.findFingerByPointerId(e.pointerId);
		if (finger === null) return;

		const dx = e.clientX - finger.currentX;
		const dy = e.clientY - finger.currentY;
		finger.currentX = e.clientX;
		finger.currentY = e.clientY;

		if (finger.role === 'joystick')
		{
			this.applyJoystick(e.clientX, e.clientY, finger);
		}
		else
		{
			this.dispatchMouseMove(dx * TOUCH_CAM_SENSITIVITY, dy * TOUCH_CAM_SENSITIVITY);
		}
	}

	private onPointerUp(e: PointerEvent): void
	{
		if (e.pointerType === 'mouse') return;

		const finger = this.findFingerByPointerId(e.pointerId);
		if (finger === null) return;

		const duration = Date.now() - finger.startTime;
		const totalDx = e.clientX - finger.startX;
		const totalDy = e.clientY - finger.startY;
		const drift = Math.sqrt(totalDx * totalDx + totalDy * totalDy);

		// Tap on ANY finger = jump (matches portfolio reference). No
		// drag, released fast, on foot - drift gate stops a casual
		// joystick flick from also firing jump.
		if (drift <= TAP_MAX_MOVE && duration < TAP_MAX_TIME)
		{
			if (this.mode === 'foot') this.fireJump();
		}

		if (finger.role === 'joystick')
		{
			this.hideJoystick();
			this.releaseAllDirections();
			this.releaseSprintAuto();
		}

		const slotIndex = this.fingers.indexOf(finger);
		if (slotIndex !== -1) this.fingers[slotIndex] = null;
	}

	private findFingerByPointerId(pointerId: number): FingerSlot | null
	{
		for (const f of this.fingers)
		{
			if (f !== null && f.pointerId === pointerId) return f;
		}
		return null;
	}

	private isOnControlWidget(target: HTMLElement | null): boolean
	{
		while (target !== null && target !== document.body)
		{
			if (target.id === 'touch-joystick-base' ||
				target.id === 'touch-joystick-thumb' ||
				target.classList?.contains('touch-action-btn') ||
				target.classList?.contains('lil-gui') ||
				target.id === 'pause-menu' ||
				target.id === 'settings-modal' ||
				target.id === 'dialog-bar' ||
				target.id === 'title-screen' ||
				target.id === 'planet-menu')
			{
				return true;
			}
			target = target.parentElement;
		}
		return false;
	}

	// --- Mode toggle ------------------------------------------------------

	private enterTouchMode(): void
	{
		const html = document.documentElement;
		if (html.classList.contains('touch-active')) return;
		html.classList.add('touch-active');
		window.dispatchEvent(new CustomEvent('touchmode-change', { detail: { touch: true } }));
	}

	private exitTouchMode(): void
	{
		const html = document.documentElement;
		if (!html.classList.contains('touch-active')) return;
		html.classList.remove('touch-active');
		// Drop anything we were holding so the keyboard player isn't
		// stuck with WASD pressed-from-touch.
		this.releaseAllDirections();
		this.releaseSprintAuto();
		this.hideJoystick();
		this.fingers[0] = null;
		this.fingers[1] = null;
		window.dispatchEvent(new CustomEvent('touchmode-change', { detail: { touch: false } }));
	}

	// --- Joystick ---------------------------------------------------------

	private showJoystick(x: number, y: number): void
	{
		this.joystickBase.classList.add('active');
		const halfW = this.joystickBase.offsetWidth / 2 || JOYSTICK_RADIUS;
		const halfH = this.joystickBase.offsetHeight / 2 || JOYSTICK_RADIUS;
		this.joystickBase.style.left = `${x - halfW}px`;
		this.joystickBase.style.top = `${y - halfH}px`;
		this.joystickThumb.style.transform = 'translate(-50%, -50%)';
	}

	private hideJoystick(): void
	{
		this.joystickBase.classList.remove('active');
		this.joystickThumb.style.transform = 'translate(-50%, -50%)';
	}

	private applyJoystick(currentX: number, currentY: number, finger: FingerSlot): void
	{
		const dx = currentX - finger.startX;
		const dy = currentY - finger.startY;
		const len = Math.sqrt(dx * dx + dy * dy);
		const clampedLen = Math.min(len, JOYSTICK_RADIUS);
		const nx = len > 0 ? (dx / len) * clampedLen : 0;
		const ny = len > 0 ? (dy / len) * clampedLen : 0;

		this.joystickThumb.style.transform =
			`translate(calc(-50% + ${nx}px), calc(-50% + ${ny}px))`;

		const normX = nx / JOYSTICK_RADIUS;
		const normY = ny / JOYSTICK_RADIUS;
		const magnitude = Math.sqrt(normX * normX + normY * normY);

		this.setDirection('KeyA', normX < -JOYSTICK_DEADZONE);
		this.setDirection('KeyD', normX >  JOYSTICK_DEADZONE);
		this.setDirection('KeyW', normY < -JOYSTICK_DEADZONE);
		this.setDirection('KeyS', normY >  JOYSTICK_DEADZONE);

		// Auto-sprint at the joystick rim only makes sense on foot;
		// vehicles don't read ShiftLeft as run, so leave it alone.
		if (this.mode === 'foot')
		{
			const wantSprint = magnitude > SPRINT_AUTO_THRESHOLD;
			if (wantSprint && !this.sprintAuto)
			{
				this.dispatchKey('ShiftLeft', true);
				this.sprintAuto = true;
			}
			else if (!wantSprint && this.sprintAuto)
			{
				this.dispatchKey('ShiftLeft', false);
				this.sprintAuto = false;
			}
		}
	}

	private setDirection(code: DirectionKey, want: boolean): void
	{
		const has = this.heldDirections.has(code);
		if (want && !has)
		{
			this.heldDirections.add(code);
			this.dispatchKey(code, true);
		}
		else if (!want && has)
		{
			this.heldDirections.delete(code);
			this.dispatchKey(code, false);
		}
	}

	private releaseAllDirections(): void
	{
		for (const code of this.heldDirections)
		{
			this.dispatchKey(code, false);
		}
		this.heldDirections.clear();
	}

	private releaseSprintAuto(): void
	{
		if (this.sprintAuto)
		{
			this.dispatchKey('ShiftLeft', false);
			this.sprintAuto = false;
		}
	}

	private fireJump(): void
	{
		this.dispatchKey('Space', true);
		setTimeout(() => this.dispatchKey('Space', false), 80);
	}

	// --- Event dispatch ---------------------------------------------------

	private dispatchKey(code: string, pressed: boolean): void
	{
		const evt = new KeyboardEvent(pressed ? 'keydown' : 'keyup', { code });
		document.dispatchEvent(evt);
	}

	private dispatchMouseMove(deltaX: number, deltaY: number): void
	{
		if (this.canvas === null) this.canvas = document.getElementById('canvas');
		if (this.canvas === null) return;

		this.canvas.dispatchEvent(new MouseEvent('mousedown'));
		this.canvas.dispatchEvent(new MouseEvent('mousemove', {
			movementX: deltaX,
			movementY: deltaY,
		}));
		this.canvas.dispatchEvent(new MouseEvent('mouseup'));
	}
}
