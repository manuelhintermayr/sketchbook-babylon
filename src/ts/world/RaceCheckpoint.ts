import * as THREE from 'three';
import { RaceContent } from './RaceContent';

// One trigger plane along a race curve. Crossing the plane front-to-back
// (relative to the curve tangent) within the rectangle counts as
// "passed". Ported from tkkaushik369/socketControl with their visual
// approach kept (transparent green plane + bar) so checkpoints can be
// turned on for debugging.
export class RaceCheckpoint
{
	private point: THREE.Vector3;
	public index: number;
	private raceContent: RaceContent;

	private t: number;
	public mesh: THREE.Mesh;
	public passed: boolean = false;

	private normal: THREE.Vector3;
	private localX: THREE.Vector3;
	private localY: THREE.Vector3;
	private halfW: number;
	private halfH: number;

	constructor(point: THREE.Vector3, index: number, raceContent: RaceContent, curve: THREE.CatmullRomCurve3)
	{
		this.point = point.clone();
		this.index = index;
		this.raceContent = raceContent;

		const PLANE_W = 40;
		const PLANE_H = 14;

		this.t = this.raceContent.findClosestTOnCurve(point);
		const tangent = curve.getTangent(this.t).normalize();

		const geom = new THREE.PlaneGeometry(PLANE_W, PLANE_H);
		const mat = new THREE.MeshStandardMaterial({
			color: 0x00ff88,
			side: THREE.DoubleSide,
			transparent: true,
			opacity: 0.35,
		});
		this.mesh = new THREE.Mesh(geom, mat);
		this.mesh.position.copy(this.point);

		// Rotate plane so its +Z axis points along the curve tangent.
		const zAxis = new THREE.Vector3(0, 0, 1);
		const quat = new THREE.Quaternion().setFromUnitVectors(zAxis, tangent);
		this.mesh.quaternion.copy(quat);

		// Visible bar to make the plane easier to spot.
		const bar = new THREE.Mesh(
			new THREE.BoxGeometry(PLANE_W, 0.1, 0.1),
			new THREE.MeshStandardMaterial({ color: 0x00ff88 }),
		);
		bar.position.set(0, 0, 0.01);
		this.mesh.add(bar);
		this.mesh.visible = false;

		this.raceContent.checkpointGroup.add(this.mesh);

		// Cache plane normal and local axes for the bounds check.
		this.normal = tangent.clone();
		this.localX = new THREE.Vector3(1, 0, 0).applyQuaternion(this.mesh.quaternion).normalize();
		this.localY = new THREE.Vector3(0, 1, 0).applyQuaternion(this.mesh.quaternion).normalize();
		this.halfW = PLANE_W / 2;
		this.halfH = PLANE_H / 2;
	}

	// Test whether the segment prevPos -> currPos crosses this plane and
	// the intersection lies inside the plane rectangle. Returns true on
	// the frame the player crosses.
	public checkCross(prevPos: THREE.Vector3, currPos: THREE.Vector3): boolean
	{
		const vPrev = prevPos.clone().sub(this.point);
		const vCurr = currPos.clone().sub(this.point);
		const dPrev = vPrev.dot(this.normal);
		const dCurr = vCurr.dot(this.normal);

		const crossed = (dPrev >= 0 && dCurr < 0) || (dPrev <= 0 && dCurr > 0);
		if (!crossed) return false;

		// Approximate intersection along the segment.
		const t = dPrev / (dPrev - dCurr);
		const intersect = prevPos.clone().lerp(currPos, t);

		const lx = intersect.clone().sub(this.point).dot(this.localX);
		const ly = intersect.clone().sub(this.point).dot(this.localY);
		return Math.abs(lx) <= this.halfW + 0.001 && Math.abs(ly) <= this.halfH + 0.001;
	}
}
