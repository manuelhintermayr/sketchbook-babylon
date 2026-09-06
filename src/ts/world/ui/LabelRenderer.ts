import { Camera, Matrix, Scene, TransformNode, Vector3, Viewport } from '@babylonjs/core';

// DOM label overlay - the job three's CSS2DRenderer + CSS2DObject did.
// Each label is an HTML element parked in an absolutely positioned,
// pointer-events:none layer above the canvas; every frame it's moved to
// the screen projection of its anchor node. Labels behind the camera or
// flagged invisible are hidden with display:none, which is what the old
// renderer also did with Object3D.visible.

export class LabelObject
{
	public element: HTMLElement;
	public anchor: TransformNode;
	public visible: boolean = true;

	constructor(element: HTMLElement, anchor: TransformNode)
	{
		this.element = element;
		this.anchor = anchor;
	}

	public dispose(): void
	{
		this.element.remove();
		this.anchor.dispose();
	}
}

const _world = new Vector3();
const _view = new Vector3();
const _projected = new Vector3();
const _identity = Matrix.Identity();

export class LabelRenderer
{
	public domElement: HTMLDivElement;

	private scene: Scene;
	private labels: Set<LabelObject> = new Set();
	private viewport: Viewport = new Viewport(0, 0, 1, 1);
	private width: number = 1;
	private height: number = 1;

	constructor(scene: Scene)
	{
		this.scene = scene;
		this.domElement = document.createElement('div');
		this.domElement.style.position = 'absolute';
		this.domElement.style.top = '0';
		this.domElement.style.left = '0';
		this.domElement.style.overflow = 'hidden';
		// The layer sits above the canvas; without this it would swallow
		// the click-and-drag camera input.
		this.domElement.style.pointerEvents = 'none';
	}

	public setSize(width: number, height: number): void
	{
		this.width = width;
		this.height = height;
		this.domElement.style.width = width + 'px';
		this.domElement.style.height = height + 'px';
	}

	// Creates the anchor child under `parent` (local offset, like a
	// CSS2DObject's position) and registers the element.
	public createLabel(element: HTMLElement, parent: TransformNode, offset: Vector3): LabelObject
	{
		const anchor = new TransformNode('labelAnchor', this.scene);
		anchor.parent = parent;
		anchor.position.copyFrom(offset);

		element.style.position = 'absolute';
		element.style.left = '0';
		element.style.top = '0';
		element.style.transform = 'translate(-50%, -50%)';
		element.style.whiteSpace = 'nowrap';
		this.domElement.appendChild(element);

		const label = new LabelObject(element, anchor);
		this.labels.add(label);
		return label;
	}

	public remove(label: LabelObject): void
	{
		this.labels.delete(label);
		label.dispose();
	}

	public render(camera: Camera): void
	{
		if (this.labels.size === 0) return;

		const transform = this.scene.getTransformMatrix();
		const view = camera.getViewMatrix();

		for (const label of this.labels)
		{
			if (label.anchor.isDisposed())
			{
				this.labels.delete(label);
				label.element.remove();
				continue;
			}

			// In a right-handed view space everything in front of the
			// camera has negative z.
			label.anchor.computeWorldMatrix(true);
			_world.copyFrom(label.anchor.absolutePosition);
			Vector3.TransformCoordinatesToRef(_world, view, _view);
			const inFront = _view.z < 0;

			if (!label.visible || !inFront)
			{
				if (label.element.style.display !== 'none') label.element.style.display = 'none';
				continue;
			}

			Vector3.ProjectToRef(_world, _identity, transform, this.viewport, _projected);
			const x = _projected.x * this.width;
			const y = _projected.y * this.height;

			label.element.style.display = '';
			label.element.style.transform = `translate(-50%, -50%) translate(${x}px, ${y}px)`;
		}
	}
}
