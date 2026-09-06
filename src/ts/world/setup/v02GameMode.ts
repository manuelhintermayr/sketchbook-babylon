import * as THREE from 'three';
import * as CANNON from 'cannon-es';

import { World } from '../World';
import { ShapeEntity } from '../spawn/ShapeEntity';
import { DialogBox } from '../ui/DialogBox';

// Three keyboard features ported from swift502 v0.2.0's
// `examples/characters.html` GameMode (FreeRoam):
//
//   B  - spawn a 0.3 m sphere at camera + forward direction (mass 1).
//        Ring buffer of 10 - the oldest one is removed on the 11th
//        spawn so the world doesn't accumulate balls indefinitely.
//        Originally bound to F upstream; we use B because F is the
//        engine's "enter vehicle" key.
//   T  - toggle slow motion (Time_Scale 1 ↔ 0.3).
//   V  - cycle the third-person camera radius through 1.6 / 3 / 6 / 10 m.
//        Only fires when the player is on foot - vehicles override V
//        for first-person toggle.
//
// All three skip while a dialog or pause menu is up so the player
// can't bonk a ball through a frozen NPC mid-conversation.

const VIEW_DISTANCES = [1.6, 3, 6, 10];
const SLOWMO_RATE = 0.3;
const BALL_RADIUS = 0.3;
const BALL_MASS = 1;
const MAX_BALLS = 10;
const BALL_OFFSET = 1.5; // meters in front of the camera

export function wireV02GameMode(world: World): void
{
	const balls: ShapeEntity[] = [];
	let viewIndex = 0; // matches the engine default (1.6) in Character.inputReceiverInit
	let slowMo = false;

	document.addEventListener('keydown', (e) =>
	{
		if (e.repeat) return;
		if (isInputBlocked(world)) return;

		if (e.code === 'KeyB') spawnBall(world, balls);
		else if (e.code === 'KeyT')
		{
			slowMo = !slowMo;
			world.setTimeScale(slowMo ? SLOWMO_RATE : 1);
		}
		else if (e.code === 'KeyV')
		{
			// Only on foot - vehicles already use V for first-person.
			const player = world.characters.find((c) => c.isPlayer);
			if (player !== undefined && player.controlledObject === undefined)
			{
				viewIndex = (viewIndex + 1) % VIEW_DISTANCES.length;
				world.cameraOperator.setRadius(VIEW_DISTANCES[viewIndex], false);
			}
		}
	});
}

function isInputBlocked(world: World): boolean
{
	if (DialogBox.getInstance().isOpen()) return true;
	// Pause menu / settings modal show the cursor; treat any time
	// where Time_Scale was forced to 0 by the pause path as blocked.
	if (world.timeScaleTarget === 0) return true;
	return false;
}

function spawnBall(world: World, balls: ShapeEntity[]): void
{
	const cam = world.camera;
	const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(cam.quaternion);
	const spawnPos = cam.position.clone().addScaledVector(forward, BALL_OFFSET);

	const mesh = new THREE.Mesh(
		new THREE.SphereGeometry(BALL_RADIUS, 16, 12),
		new THREE.MeshLambertMaterial({ color: 0xcccccc }),
	);
	mesh.castShadow = true;
	mesh.receiveShadow = true;
	mesh.position.copy(spawnPos);
	mesh.userData = { mass: String(BALL_MASS), radius: String(BALL_RADIUS) };

	const ball = new ShapeEntity(mesh, 'sphere');
	// Toss the ball forward so it flies out of the camera instead of
	// dropping at the player's feet.
	ball.phys.body.velocity.copy(new CANNON.Vec3(forward.x * 10, forward.y * 10, forward.z * 10));

	world.add(ball);
	balls.push(ball);

	if (balls.length > MAX_BALLS)
	{
		const oldest = balls.shift();
		if (oldest !== undefined) world.remove(oldest);
	}
}
