import { Color3, Mesh, MeshBuilder, Quaternion, StandardMaterial, Vector3 } from '@babylonjs/core';

import { RaceContent } from './RaceContent';
import { CatmullRomCurve3 } from '../core/CatmullRomCurve3';

// One trigger plane along a race curve. Crossing the plane front-to-back
// (relative to the curve tangent) within the rectangle counts as
// "passed". Ported from tkkaushik369/socketControl with their visual
// approach kept (transparent green plane + bar) so checkpoints can be
// turned on for debugging.
export class RaceCheckpoint
{
	private point: Vector3;
	public index: number;
	private raceContent: RaceContent;

	private t: number;
	public mesh: Mesh;
	public passed: boolean = false;

	private normal: Vector3;
	private localX: Vector3;
	private localY: Vector3;
	private halfW: number;
	private halfH: number;

	constructor(point: Vector3, index: number, raceContent: RaceContent, curve: CatmullRomCurve3)
	{
		this.point = point.clone();
		this.index = index;
		this.raceContent = raceContent;

		const PLANE_W = 40;
		const PLANE_H = 14;

		const scene = raceContent.scenario.world.scene;

		this.t = this.raceContent.findClosestTOnCurve(point);
		const tangent = curve.getTangent(this.t).normalize();

		const mat = new StandardMaterial('checkpointMaterial', scene);
		mat.diffuseColor = Color3.FromHexString('#00ff88');
		mat.emissiveColor = Color3.FromHexString('#00ff88');
		mat.alpha = 0.35;
		mat.backFaceCulling = false;

		this.mesh = MeshBuilder.CreatePlane('checkpoint' + index, { width: PLANE_W, height: PLANE_H }, scene);
		this.mesh.material = mat;
		this.mesh.position.copyFrom(this.point);
		this.mesh.isPickable = false;

		// Rotate plane so its +Z axis points along the curve tangent.
		const zAxis = new Vector3(0, 0, 1);
		const quat = new Quaternion();
		Quaternion.FromUnitVectorsToRef(zAxis, tangent, quat);
		this.mesh.rotationQuaternion = quat;

		// Visible bar to make the plane easier to spot.
		const barMat = new StandardMaterial('checkpointBarMaterial', scene);
		barMat.emissiveColor = Color3.FromHexString('#00ff88');
		const bar = MeshBuilder.CreateBox('checkpointBar' + index, { width: PLANE_W, height: 0.1, depth: 0.1 }, scene);
		bar.material = barMat;
		bar.position.set(0, 0, 0.01);
		bar.parent = this.mesh;
		this.mesh.setEnabled(false);

		this.mesh.parent = this.raceContent.checkpointGroup;

		// Cache plane normal and local axes for the bounds check.
		this.normal = tangent.clone();
		this.localX = new Vector3(1, 0, 0).applyRotationQuaternionInPlace(quat).normalize();
		this.localY = new Vector3(0, 1, 0).applyRotationQuaternionInPlace(quat).normalize();
		this.halfW = PLANE_W / 2;
		this.halfH = PLANE_H / 2;
	}

	// Test whether the segment prevPos -> currPos crosses this plane and
	// the intersection lies inside the plane rectangle. Returns true on
	// the frame the player crosses.
	public checkCross(prevPos: Vector3, currPos: Vector3): boolean
	{
		const vPrev = prevPos.subtract(this.point);
		const vCurr = currPos.subtract(this.point);
		const dPrev = Vector3.Dot(vPrev, this.normal);
		const dCurr = Vector3.Dot(vCurr, this.normal);

		const crossed = (dPrev >= 0 && dCurr < 0) || (dPrev <= 0 && dCurr > 0);
		if (!crossed) return false;

		// Approximate intersection along the segment.
		const t = dPrev / (dPrev - dCurr);
		const intersect = Vector3.Lerp(prevPos, currPos, t);

		const lx = Vector3.Dot(intersect.subtract(this.point), this.localX);
		const ly = Vector3.Dot(intersect.subtract(this.point), this.localY);
		return Math.abs(lx) <= this.halfW + 0.001 && Math.abs(ly) <= this.halfH + 0.001;
	}
}
