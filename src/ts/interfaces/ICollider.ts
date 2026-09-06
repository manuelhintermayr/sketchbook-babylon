import { PhysicsBody, PhysicsShape, TransformNode } from '@babylonjs/core';

export interface ICollider {
	body: PhysicsBody;
	shape: PhysicsShape;
	node: TransformNode;
	dispose(): void;
}
