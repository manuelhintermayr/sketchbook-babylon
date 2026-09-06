import { Node, TransformNode } from '@babylonjs/core';

import { PathNode } from './PathNode';
import * as Utils from '../../core/FunctionLibrary';

export class Path
{
	public nodes: {[nodeName: string]: PathNode} = {};
	private rootNode: TransformNode;

	constructor(root: TransformNode)
	{
		this.rootNode = root;

		Utils.traverse(this.rootNode, (child) => {
			this.addNode(child);
		});

		this.connectNodes();
	}

	public addNode(child: Node): void
	{
		if (!(child instanceof TransformNode)) return;
		const ud = Utils.userData(child);
		if (ud.hasOwnProperty('data'))
		{
			if (ud.data === 'pathNode')
			{
				let node = new PathNode(child, this);
				this.nodes[child.name] = node;
			}
		}
	}

	public connectNodes(): void
	{
		for (const nodeName in this.nodes)
		{
			if (this.nodes.hasOwnProperty(nodeName))
			{
				const node = this.nodes[nodeName];
				const ud = Utils.userData(node.object);
				node.nextNode = this.nodes[ud.nextNode];
				node.previousNode = this.nodes[ud.previousNode];
			}
		}
	}
}
