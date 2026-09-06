import { World } from '../world/World';
import { IInputReceiver } from '../interfaces/IInputReceiver';
import { EntityType } from '../enums/EntityType';
import { IUpdatable } from '../interfaces/IUpdatable';
import { UpdateOrder } from '../enums/UpdateOrder';

export class InputManager implements IUpdatable
{
	public updateOrder: number = UpdateOrder.Input;

	public world: World;
	public domElement: any;
	public inputReceiver: IInputReceiver;

	public boundOnMouseDown: (evt: any) => void;
	public boundOnMouseMove: (evt: any) => void;
	public boundOnMouseUp: (evt: any) => void;
	public boundOnMouseWheelMove: (evt: any) => void;
	public boundOnKeyDown: (evt: any) => void;
	public boundOnKeyUp: (evt: any) => void;

	constructor(world: World, domElement: HTMLElement)
	{
		this.world = world;
		this.domElement = domElement || document.body;

		this.boundOnMouseDown = (evt) => this.onMouseDown(evt);
		this.boundOnMouseMove = (evt) => this.onMouseMove(evt);
		this.boundOnMouseUp = (evt) => this.onMouseUp(evt);
		this.boundOnMouseWheelMove = (evt) => this.onMouseWheelMove(evt);

		this.boundOnKeyDown = (evt) => this.onKeyDown(evt);
		this.boundOnKeyUp = (evt) => this.onKeyUp(evt);

		this.domElement.addEventListener('mousedown', this.boundOnMouseDown, false);
		document.addEventListener('wheel', this.boundOnMouseWheelMove, false);

		document.addEventListener('keydown', this.boundOnKeyDown, false);
		document.addEventListener('keyup', this.boundOnKeyUp, false);

		world.registerUpdatable(this);
	}

	public update(timestep: number, unscaledTimeStep: number): void
	{
		if (this.inputReceiver === undefined && this.world !== undefined && this.world.cameraOperator !== undefined)
		{
			this.setInputReceiver(this.world.cameraOperator);
		}

		this.inputReceiver?.inputReceiverUpdate(unscaledTimeStep);
	}

	public setInputReceiver(receiver: IInputReceiver): void
	{
		this.inputReceiver = receiver;
		this.inputReceiver.inputReceiverInit();
	}

	public onMouseDown(event: MouseEvent): void
	{
		// Click-and-drag camera: mousemove only fires while the button is
		// held. Touch input is dispatched separately via TouchControls.
		this.domElement.addEventListener('mousemove', this.boundOnMouseMove, false);
		this.domElement.addEventListener('mouseup', this.boundOnMouseUp, false);

		if (this.inputReceiver !== undefined)
		{
			this.inputReceiver.handleMouseButton(event, 'mouse' + event.button, true);
		}
	}

	public onMouseMove(event: MouseEvent): void
	{
		if (this.inputReceiver !== undefined)
		{
			this.inputReceiver.handleMouseMove(event, event.movementX, event.movementY);
		}
	}

	public onMouseUp(event: MouseEvent): void
	{
		this.domElement.removeEventListener('mousemove', this.boundOnMouseMove, false);
		this.domElement.removeEventListener('mouseup', this.boundOnMouseUp, false);

		if (this.inputReceiver !== undefined)
		{
			this.inputReceiver.handleMouseButton(event, 'mouse' + event.button, false);
		}
	}

	public onKeyDown(event: KeyboardEvent): void
	{
		if (this.inputReceiver !== undefined)
		{
			this.inputReceiver.handleKeyboardEvent(event, event.code, true);
		}
	}

	public onKeyUp(event: KeyboardEvent): void
	{
		if (this.inputReceiver !== undefined)
		{
			this.inputReceiver.handleKeyboardEvent(event, event.code, false);
		}
	}

	public onMouseWheelMove(event: WheelEvent): void
	{
		if (this.inputReceiver !== undefined)
		{
			this.inputReceiver.handleMouseWheel(event, event.deltaY);
		}
	}
}
