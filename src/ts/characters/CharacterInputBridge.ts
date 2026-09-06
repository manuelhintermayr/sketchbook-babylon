import * as _ from 'lodash';

import { Character } from './Character';

// Keyboard / mouse routing for Character. The platform-side input
// handlers (InputManager) call these methods on the receiving
// character; that's still the public API. The Character methods just
// delegate here so the routing logic + the action dispatching live
// next to each other instead of clogging up the orchestrator class.
//
// Pattern in every handler is the same: dialogFreeze early-return,
// forward to controlledObject if the character is driving a vehicle,
// otherwise translate the event to an action and call triggerAction.
// The only handler that does something non-routing is the keyboard
// one, which also catches Shift+C (free camera) and Shift+R (restart).

export function handleKeyboardEvent(character: Character, event: KeyboardEvent, code: string, pressed: boolean): void
{
	if (character.dialogFreeze) return;
	if (character.controlledObject !== undefined)
	{
		character.controlledObject.handleKeyboardEvent(event, code, pressed);
		return;
	}

	// Free camera
	if (code === 'KeyC' && pressed === true && event.shiftKey === true)
	{
		character.resetControls();
		character.world.cameraOperator.characterCaller = character;
		character.world.inputManager.setInputReceiver(character.world.cameraOperator);
		return;
	}

	if (code === 'KeyR' && pressed === true && event.shiftKey === true)
	{
		character.world.restartScenario();
		return;
	}

	for (const action in character.actions)
	{
		if (character.actions.hasOwnProperty(action))
		{
			const binding = character.actions[action];
			if (_.includes(binding.eventCodes, code))
			{
				triggerAction(character, action, pressed);
			}
		}
	}
}

export function handleMouseButton(character: Character, event: MouseEvent, code: string, pressed: boolean): void
{
	if (character.dialogFreeze) return;
	if (character.controlledObject !== undefined)
	{
		character.controlledObject.handleMouseButton(event, code, pressed);
		return;
	}

	for (const action in character.actions)
	{
		if (character.actions.hasOwnProperty(action))
		{
			const binding = character.actions[action];
			if (_.includes(binding.eventCodes, code))
			{
				triggerAction(character, action, pressed);
			}
		}
	}
}

export function handleMouseMove(character: Character, event: MouseEvent, deltaX: number, deltaY: number): void
{
	if (character.dialogFreeze) return;
	if (character.controlledObject !== undefined)
	{
		character.controlledObject.handleMouseMove(event, deltaX, deltaY);
	}
	else
	{
		character.world.cameraOperator.move(deltaX, deltaY);
	}
}

export function handleMouseWheel(character: Character, event: WheelEvent, value: number): void
{
	if (character.dialogFreeze) return;
	if (character.controlledObject !== undefined)
	{
		character.controlledObject.handleMouseWheel(event, value);
	}
	else
	{
		character.world.scrollTheTimeScale(value);
	}
}

// Applies a press/release to the named action and triggers the state
// machine to react. The 'just' attributes are flipped on so the
// state's onInputChange can see "this just happened", then cleared
// again before returning so the next frame doesn't see a stale flag.
export function triggerAction(character: Character, actionName: string, value: boolean): void
{
	const action = character.actions[actionName];

	if (action.isPressed === value) return;

	action.isPressed = value;
	action.justPressed = false;
	action.justReleased = false;

	if (value) action.justPressed = true;
	else action.justReleased = true;

	character.charState.onInputChange();

	action.justPressed = false;
	action.justReleased = false;
}
