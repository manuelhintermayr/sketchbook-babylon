import
{
	CharacterStateBase,
	EndWalk,
	Idle,
	JumpRunning,
	Sprint,
} from './_stateLibrary';
import { Character } from '../Character';

// Walk-cycle footstep cadence (seconds between steps). 0.42 reads as
// a casual stride; sprint shortens this further. Only the player
// triggers steps - NPCs walking on FollowPath would otherwise create
// a constant chorus of footsteps from every direction.
const WALK_STEP_INTERVAL = 0.42;
const WALK_STEP_SCALE = 0.75;

export class Walk extends CharacterStateBase
{
	// Start at 0 so the first step lands the moment the player enters
	// Walk - the StartWalk* states that lead in here don't emit steps,
	// and waiting half an interval after that produced an awkward
	// "running silently for a beat" feel.
	private stepTimer: number = 0;

	constructor(character: Character)
	{
		super(character);

		this.canEnterVehicles = true;
		this.character.setArcadeVelocityTarget(0.8);
		this.playAnimation('run', 0.1);
	}

	public update(timeStep: number): void
	{
		super.update(timeStep);

		this.character.setCameraRelativeOrientationTarget();

		// Footstep tick - every character (player + NPCs) plays its own
		// PositionalAudio steps via CharacterSfx, attenuated by the
		// listener-on-camera. Anna / Ben walking the loop fade with
		// distance instead of needing a behaviour gate.
		this.stepTimer -= timeStep;
		if (this.stepTimer <= 0)
		{
			this.character.sfx?.playFootstep(WALK_STEP_SCALE);
			this.stepTimer = WALK_STEP_INTERVAL;
		}

		this.fallInAir();
	}

	public onInputChange(): void
	{
		super.onInputChange();

		if (this.noDirection())
		{
			this.character.setState(new EndWalk(this.character));
		}
		
		if (this.character.actions.run.isPressed)
		{
			this.character.setState(new Sprint(this.character));
		}
		
		if (this.character.actions.run.justPressed)
		{
			this.character.setState(new Sprint(this.character));
		}

		if (this.character.actions.jump.justPressed)
		{
			this.character.setState(new JumpRunning(this.character));
		}

		if (this.noDirection())
		{
			if (this.character.velocity.length() > 1)
			{
				this.character.setState(new EndWalk(this.character));
			}
			else
			{
				this.character.setState(new Idle(this.character));
			}
		}
	}
}