import { Vector3 } from '@babylonjs/core';

// Centripetal / chordal Catmull-Rom spline - a port of three's
// CatmullRomCurve3 (MIT), which the race-checkpoint system was written
// against. Babylon's Curve3.CreateCatmullRomSpline only offers the
// uniform variant and returns a fixed point list, while RaceContent
// needs getPointAt / getTangent at arbitrary arc-length parameters.
//
// Based on "Parameterization and applications of Catmull-Rom curves"
// (Yuksel, Schaefer, Keyser) - see http://www.cemyuksel.com/research/catmullrom_param/

class CubicPoly
{
	private c0 = 0;
	private c1 = 0;
	private c2 = 0;
	private c3 = 0;

	// Compute coefficients for a cubic polynomial p(s) = c0 + c1*s +
	// c2*s^2 + c3*s^3 such that p(0) = x0, p(1) = x1 and p'(0) = t0,
	// p'(1) = t1.
	public init(x0: number, x1: number, t0: number, t1: number): void
	{
		this.c0 = x0;
		this.c1 = t0;
		this.c2 = -3 * x0 + 3 * x1 - 2 * t0 - t1;
		this.c3 = 2 * x0 - 2 * x1 + t0 + t1;
	}

	public initCatmullRom(x0: number, x1: number, x2: number, x3: number, tension: number): void
	{
		this.init(x1, x2, tension * (x2 - x0), tension * (x3 - x1));
	}

	public initNonuniformCatmullRom(x0: number, x1: number, x2: number, x3: number, dt0: number, dt1: number, dt2: number): void
	{
		// compute tangents when parameterized in [t1,t2]
		let t1 = (x1 - x0) / dt0 - (x2 - x0) / (dt0 + dt1) + (x2 - x1) / dt1;
		let t2 = (x2 - x1) / dt1 - (x3 - x1) / (dt1 + dt2) + (x3 - x2) / dt2;

		// rescale tangents for parametrization in [0,1]
		t1 *= dt1;
		t2 *= dt1;

		this.init(x1, x2, t1, t2);
	}

	public calc(t: number): number
	{
		const t2 = t * t;
		const t3 = t2 * t;
		return this.c0 + this.c1 * t + this.c2 * t2 + this.c3 * t3;
	}
}

export type CurveType = 'centripetal' | 'chordal' | 'catmullrom';

const px = new CubicPoly();
const py = new CubicPoly();
const pz = new CubicPoly();
const tmp = new Vector3();

export class CatmullRomCurve3
{
	public points: Vector3[];
	public closed: boolean;
	public curveType: CurveType;
	public tension: number;
	public arcLengthDivisions: number = 200;

	private cacheArcLengths: number[] | null = null;

	constructor(points: Vector3[] = [], closed: boolean = false, curveType: CurveType = 'centripetal', tension: number = 0.5)
	{
		this.points = points;
		this.closed = closed;
		this.curveType = curveType;
		this.tension = tension;
	}

	public getPoint(t: number, optionalTarget: Vector3 = new Vector3()): Vector3
	{
		const point = optionalTarget;
		const points = this.points;
		const l = points.length;

		const p = (l - (this.closed ? 0 : 1)) * t;
		let intPoint = Math.floor(p);
		let weight = p - intPoint;

		if (this.closed)
		{
			intPoint += intPoint > 0 ? 0 : (Math.floor(Math.abs(intPoint) / l) + 1) * l;
		}
		else if (weight === 0 && intPoint === l - 1)
		{
			intPoint = l - 2;
			weight = 1;
		}

		let p0: Vector3, p3: Vector3;

		if (this.closed || intPoint > 0)
		{
			p0 = points[(intPoint - 1) % l];
		}
		else
		{
			// extrapolate first point
			tmp.copyFrom(points[0]).subtractInPlace(points[1]).addInPlace(points[0]);
			p0 = tmp.clone();
		}

		const p1 = points[intPoint % l];
		const p2 = points[(intPoint + 1) % l];

		if (this.closed || intPoint + 2 < l)
		{
			p3 = points[(intPoint + 2) % l];
		}
		else
		{
			// extrapolate last point
			tmp.copyFrom(points[l - 1]).subtractInPlace(points[l - 2]).addInPlace(points[l - 1]);
			p3 = tmp.clone();
		}

		if (this.curveType === 'centripetal' || this.curveType === 'chordal')
		{
			// init Centripetal / Chordal Catmull-Rom
			const pow = this.curveType === 'chordal' ? 0.5 : 0.25;
			let dt0 = Math.pow(Vector3.DistanceSquared(p0, p1), pow);
			let dt1 = Math.pow(Vector3.DistanceSquared(p1, p2), pow);
			let dt2 = Math.pow(Vector3.DistanceSquared(p2, p3), pow);

			// safety check for repeated points
			if (dt1 < 1e-4) dt1 = 1.0;
			if (dt0 < 1e-4) dt0 = dt1;
			if (dt2 < 1e-4) dt2 = dt1;

			px.initNonuniformCatmullRom(p0.x, p1.x, p2.x, p3.x, dt0, dt1, dt2);
			py.initNonuniformCatmullRom(p0.y, p1.y, p2.y, p3.y, dt0, dt1, dt2);
			pz.initNonuniformCatmullRom(p0.z, p1.z, p2.z, p3.z, dt0, dt1, dt2);
		}
		else
		{
			px.initCatmullRom(p0.x, p1.x, p2.x, p3.x, this.tension);
			py.initCatmullRom(p0.y, p1.y, p2.y, p3.y, this.tension);
			pz.initCatmullRom(p0.z, p1.z, p2.z, p3.z, this.tension);
		}

		point.set(px.calc(weight), py.calc(weight), pz.calc(weight));
		return point;
	}

	// Point at arc-length parameter u in [0, 1].
	public getPointAt(u: number, optionalTarget?: Vector3): Vector3
	{
		const t = this.getUtoTmapping(u);
		return this.getPoint(t, optionalTarget);
	}

	public getPoints(divisions: number = 5): Vector3[]
	{
		const points: Vector3[] = [];
		for (let d = 0; d <= divisions; d++)
		{
			points.push(this.getPoint(d / divisions));
		}
		return points;
	}

	public getLengths(divisions: number = this.arcLengthDivisions): number[]
	{
		if (this.cacheArcLengths !== null && this.cacheArcLengths.length === divisions + 1)
		{
			return this.cacheArcLengths;
		}

		const cache: number[] = [];
		let current: Vector3;
		let last = this.getPoint(0);
		let sum = 0;

		cache.push(0);

		for (let p = 1; p <= divisions; p++)
		{
			current = this.getPoint(p / divisions);
			sum += Vector3.Distance(current, last);
			cache.push(sum);
			last = current;
		}

		this.cacheArcLengths = cache;
		return cache;
	}

	// Given u (0 .. 1), get a t to find p. This gives you points which
	// are equidistant.
	public getUtoTmapping(u: number, distance?: number): number
	{
		const arcLengths = this.getLengths();

		let i: number;
		const il = arcLengths.length;

		let targetArcLength: number;
		if (distance !== undefined)
		{
			targetArcLength = distance;
		}
		else
		{
			targetArcLength = u * arcLengths[il - 1];
		}

		// binary search for the index with largest value smaller than target u distance
		let low = 0, high = il - 1, comparison: number;
		while (low <= high)
		{
			i = Math.floor(low + (high - low) / 2);
			comparison = arcLengths[i] - targetArcLength;
			if (comparison < 0)
			{
				low = i + 1;
			}
			else if (comparison > 0)
			{
				high = i - 1;
			}
			else
			{
				high = i;
				break;
			}
		}

		i = high;

		if (arcLengths[i] === targetArcLength)
		{
			return i / (il - 1);
		}

		// we could get finer grain at lengths, or use simple interpolation between two points
		const lengthBefore = arcLengths[i];
		const lengthAfter = arcLengths[i + 1];
		const segmentLength = lengthAfter - lengthBefore;

		// determine where we are between the 'before' and 'after' points
		const segmentFraction = (targetArcLength - lengthBefore) / segmentLength;

		// add that fractional amount to t
		return (i + segmentFraction) / (il - 1);
	}

	// Unit tangent by finite differences around t.
	public getTangent(t: number, optionalTarget: Vector3 = new Vector3()): Vector3
	{
		const delta = 0.0001;
		let t1 = t - delta;
		let t2 = t + delta;

		// Capping in case of danger
		if (t1 < 0) t1 = 0;
		if (t2 > 1) t2 = 1;

		const pt1 = this.getPoint(t1);
		const pt2 = this.getPoint(t2);

		return optionalTarget.copyFrom(pt2).subtractInPlace(pt1).normalize();
	}

	public getTangentAt(u: number, optionalTarget?: Vector3): Vector3
	{
		const t = this.getUtoTmapping(u);
		return this.getTangent(t, optionalTarget);
	}
}
