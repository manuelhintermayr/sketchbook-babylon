import { Color3, MeshBuilder, StandardMaterial, Vector3 } from '@babylonjs/core';

import { World } from '../World';
import { ShapeEntity } from '../spawn/ShapeEntity';
import { DialogBox } from '../ui/DialogBox';
import * as Utils from '../../core/FunctionLibrary';

// Three keyboard features ported from swift502 v0.2.0's
// `examples/characters.html` GameMode (FreeRoam):
//
//   B  - spawn a 0.3 m sphere at camera + forward direction (mass 1).
//        Ring buffer of 10 - the oldest one is removed on the 11th
//        spawn so the world doesn't accumulate balls indefinitely.
//        Originally bound to F upstream; we use B because F is the
//        engine's "enter vehicle" key.
//   T  - toggle slow motion (Time_Scale 1 <-> 0.3).
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

// Cameras look down local -Z in a right-handed scene.
const _LOCAL_FORWARD = new Vector3(0, 0, -1);

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
	const forward = cam.getDirection(_LOCAL_FORWARD);
	const spawnPos = cam.position.add(forward.scale(BALL_OFFSET));

	const mesh = MeshBuilder.CreateSphere('ball', { diameter: BALL_RADIUS * 2, segments: 12 }, world.scene);
	const mat = new StandardMaterial('ballMaterial', world.scene);
	mat.diffuseColor = Color3.FromHexString('#cccccc');
	mat.specularColor = Color3.Black();
	mesh.material = mat;
	mesh.position.copyFrom(spawnPos);
	Utils.setUserData(mesh, { mass: String(BALL_MASS), radius: String(BALL_RADIUS) });

	const ball = new ShapeEntity(mesh, 'sphere');
	// Toss the ball forward so it flies out of the camera instead of
	// dropping at the player's feet.
	ball.phys.body.setLinearVelocity(forward.scale(10));

	world.add(ball);
	balls.push(ball);

	if (balls.length > MAX_BALLS)
	{
		const oldest = balls.shift();
		if (oldest !== undefined) world.remove(oldest);
	}
}
