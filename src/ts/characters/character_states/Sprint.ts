import
{
	CharacterStateBase,
	EndWalk,
	JumpRunning,
	Walk,
} from './_stateLibrary';
import { Character } from '../Character';

// Sprint cadence - faster + harder than walk. Only the player gets
// steps; NPCs running FollowPath would chorus.
const SPRINT_STEP_INTERVAL = 0.28;
const SPRINT_STEP_SCALE = 1.15;

export class Sprint extends CharacterStateBase
{
	private stepTimer: number = 0;

	constructor(character: Character)
	{
		super(character);

		this.canEnterVehicles = true;

		this.character.velocitySimulator.mass = 10;
		this.character.rotationSimulator.damping = 0.8;
		this.character.rotationSimulator.mass = 50;

		this.character.setArcadeVelocityTarget(1.4);
		this.playAnimation('sprint', 0.1);
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);
		this.character.setCameraRelativeOrientationTarget();

		// Per-character PositionalAudio - listener on camera, no gate.
		this.stepTimer -= timeStep;
		if (this.stepTimer <= 0)
		{
			this.character.sfx?.playFootstep(SPRINT_STEP_SCALE);
			this.stepTimer = SPRINT_STEP_INTERVAL;
		}

		this.fallInAir();
	}

	public onInputChange(): void
	{
		super.onInputChange();

		if (!this.character.actions.run.isPressed)
		{
			this.character.setState(new Walk(this.character));
		}

		if (this.character.actions.jump.justPressed)
		{
			this.character.setState(new JumpRunning(this.character));
		}

		if (this.noDirection())
		{
			this.character.setState(new EndWalk(this.character));
		}
	}
}