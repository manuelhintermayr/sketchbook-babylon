export abstract class SimulatorBase
{
	public mass: any;
	public damping: any;
	public frameTime: number;
	public offset: number;
	public abstract cache: any[];
	
	constructor(fps: number, mass: number, damping: number)
	{
		this.mass = mass;
		this.damping = damping;
		// Clamp fps so 1/fps is finite. setFPS(0) or a 0 in the
		// constructor would otherwise produce frameTime=Infinity, which
		// later divides position/velocity samples in subclasses to NaN.
		this.frameTime = 1 / Math.max(1, fps);
		this.offset = 0;
	}

	public setFPS(value: number): void
	{
		this.frameTime = 1 / Math.max(1, value);
	}

	public lastFrame(): any
	{
		return this.cache[this.cache.length - 1];
	}

	/**
	 * Generates frames between last simulation call and the current one
	 * @param {timeStep} timeStep 
	 */
	public generateFrames(timeStep: number): void
	{
		// Update cache
		// Find out how many frames needs to be generated
		let totalTimeStep = this.offset + timeStep;
		let framesToGenerate = Math.floor(totalTimeStep / this.frameTime);
		this.offset = totalTimeStep % this.frameTime;

		// Generate simulation frames
		if (framesToGenerate > 0)
		{
			for (let i = 0; i < framesToGenerate; i++)
			{
				this.cache.push(this.getFrame(i + 1 === framesToGenerate));
			}
			this.cache = this.cache.slice(-2);
		}
	}

	public abstract getFrame(isLastFrame: boolean): any;
	public abstract simulate(timeStep: number): void;
}