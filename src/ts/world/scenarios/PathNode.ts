import { TransformNode } from '@babylonjs/core';

import { Path } from './Path';

export class PathNode
{
	public object: TransformNode;
	public path: Path;
	public nextNode: PathNode;
	public previousNode: PathNode;

	constructor(child: TransformNode, path: Path)
	{
		this.object = child;
		this.path = path;
	}
}
