import { Effect } from '@babylonjs/core';

// three's Sky (examples/jsm/objects/Sky.js, r183) - the Preetham daylight
// model plus its procedural cloud layer - as a Babylon ShaderMaterial
// pair, so the dome looks like the three.js build instead of Babylon's
// older SkyMaterial port of the same model. Uniform names are three's;
// `world`, `viewProjection` and `cameraPosition` are bound by Babylon.

Effect.ShadersStore['sketchbookSkyVertexShader'] = `
	precision highp float;

	attribute vec3 position;

	uniform mat4 world;
	uniform mat4 viewProjection;
	uniform vec3 sunPosition;
	uniform float rayleigh;
	uniform float turbidity;
	uniform float mieCoefficient;
	uniform vec3 up;

	varying vec3 vWorldPosition;
	varying vec3 vSunDirection;
	varying float vSunfade;
	varying vec3 vBetaR;
	varying vec3 vBetaM;
	varying float vSunE;

	// constants for atmospheric scattering
	const float e = 2.71828182845904523536028747135266249775724709369995957;
	const float pi = 3.141592653589793238462643383279502884197169;

	// wavelength of used primaries, according to preetham
	const vec3 lambda = vec3( 680E-9, 550E-9, 450E-9 );
	// this pre-calculation replaces older TotalRayleigh(vec3 lambda) function:
	// (8.0 * pow(pi, 3.0) * pow(pow(n, 2.0) - 1.0, 2.0) * (6.0 + 3.0 * pn)) / (3.0 * N * pow(lambda, vec3(4.0)) * (6.0 - 7.0 * pn))
	const vec3 totalRayleigh = vec3( 5.804542996261093E-6, 1.3562911419845635E-5, 3.0265902468824876E-5 );

	// mie stuff
	// K coefficient for the primaries
	const float v = 4.0;
	const vec3 K = vec3( 0.686, 0.678, 0.666 );
	// MieConst = pi * pow( ( 2.0 * pi ) / lambda, vec3( v - 2.0 ) ) * K
	const vec3 MieConst = vec3( 1.8399918514433978E14, 2.7798023919660528E14, 4.0790479543861094E14 );

	// earth shadow hack
	// cutoffAngle = pi / 1.95;
	const float cutoffAngle = 1.6110731556870734;
	const float steepness = 1.5;
	const float EE = 1000.0;

	float sunIntensity( float zenithAngleCos ) {
		zenithAngleCos = clamp( zenithAngleCos, -1.0, 1.0 );
		return EE * max( 0.0, 1.0 - pow( e, -( ( cutoffAngle - acos( zenithAngleCos ) ) / steepness ) ) );
	}

	vec3 totalMie( float T ) {
		float c = ( 0.2 * T ) * 10E-18;
		return 0.434 * c * MieConst;
	}

	void main() {

		vec4 worldPosition = world * vec4( position, 1.0 );
		vWorldPosition = worldPosition.xyz;

		gl_Position = viewProjection * worldPosition;
		gl_Position.z = gl_Position.w; // set z to camera.far

		vSunDirection = normalize( sunPosition );

		vSunE = sunIntensity( dot( vSunDirection, up ) );

		vSunfade = 1.0 - clamp( 1.0 - exp( ( sunPosition.y / 450000.0 ) ), 0.0, 1.0 );

		float rayleighCoefficient = rayleigh - ( 1.0 * ( 1.0 - vSunfade ) );

		// extinction (absorption + out scattering)
		// rayleigh coefficients
		vBetaR = totalRayleigh * rayleighCoefficient;

		// mie coefficients
		vBetaM = totalMie( turbidity ) * mieCoefficient;

	}
`;

Effect.ShadersStore['sketchbookSkyFragmentShader'] = `
	precision highp float;

	varying vec3 vWorldPosition;
	varying vec3 vSunDirection;
	varying vec3 vBetaR;
	varying vec3 vBetaM;
	varying float vSunE;

	uniform vec3 cameraPosition;
	uniform float mieDirectionalG;
	uniform vec3 up;
	uniform float cloudScale;
	uniform float cloudSpeed;
	uniform float cloudCoverage;
	uniform float cloudDensity;
	uniform float cloudElevation;
	uniform float time;

	// Cloud noise functions
	float hash( vec2 p ) {
		return fract( sin( dot( p, vec2( 127.1, 311.7 ) ) ) * 43758.5453123 );
	}

	float noise( vec2 p ) {
		vec2 i = floor( p );
		vec2 f = fract( p );
		f = f * f * ( 3.0 - 2.0 * f );
		float a = hash( i );
		float b = hash( i + vec2( 1.0, 0.0 ) );
		float c = hash( i + vec2( 0.0, 1.0 ) );
		float d = hash( i + vec2( 1.0, 1.0 ) );
		return mix( mix( a, b, f.x ), mix( c, d, f.x ), f.y );
	}

	float fbm( vec2 p ) {
		float value = 0.0;
		float amplitude = 0.5;
		for ( int i = 0; i < 5; i ++ ) {
			value += amplitude * noise( p );
			p *= 2.0;
			amplitude *= 0.5;
		}
		return value;
	}

	// constants for atmospheric scattering
	const float pi = 3.141592653589793238462643383279502884197169;

	// optical length at zenith for molecules
	const float rayleighZenithLength = 8.4E3;
	const float mieZenithLength = 1.25E3;
	// 66 arc seconds -> degrees, and the cosine of that
	const float sunAngularDiameterCos = 0.999956676946448443553574619906976478926848692873900859324;

	// 3.0 / ( 16.0 * pi )
	const float THREE_OVER_SIXTEENPI = 0.05968310365946075;
	// 1.0 / ( 4.0 * pi )
	const float ONE_OVER_FOURPI = 0.07957747154594767;

	float rayleighPhase( float cosTheta ) {
		return THREE_OVER_SIXTEENPI * ( 1.0 + pow( cosTheta, 2.0 ) );
	}

	float hgPhase( float cosTheta, float g ) {
		float g2 = pow( g, 2.0 );
		float inverse = 1.0 / pow( 1.0 - 2.0 * g * cosTheta + g2, 1.5 );
		return ONE_OVER_FOURPI * ( ( 1.0 - g2 ) * inverse );
	}

	void main() {

		vec3 direction = normalize( vWorldPosition - cameraPosition );

		// optical length
		// cutoff angle at 90 to avoid singularity in next formula.
		float zenithAngle = acos( max( 0.0, dot( up, direction ) ) );
		float inverse = 1.0 / ( cos( zenithAngle ) + 0.15 * pow( 93.885 - ( ( zenithAngle * 180.0 ) / pi ), -1.253 ) );
		float sR = rayleighZenithLength * inverse;
		float sM = mieZenithLength * inverse;

		// combined extinction factor
		vec3 Fex = exp( -( vBetaR * sR + vBetaM * sM ) );

		// in scattering
		float cosTheta = dot( direction, vSunDirection );

		float rPhase = rayleighPhase( cosTheta * 0.5 + 0.5 );
		vec3 betaRTheta = vBetaR * rPhase;

		float mPhase = hgPhase( cosTheta, mieDirectionalG );
		vec3 betaMTheta = vBetaM * mPhase;

		vec3 Lin = pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * ( 1.0 - Fex ), vec3( 1.5 ) );
		Lin *= mix( vec3( 1.0 ), pow( vSunE * ( ( betaRTheta + betaMTheta ) / ( vBetaR + vBetaM ) ) * Fex, vec3( 1.0 / 2.0 ) ), clamp( pow( 1.0 - dot( up, vSunDirection ), 5.0 ), 0.0, 1.0 ) );

		// nightsky
		vec3 L0 = vec3( 0.1 ) * Fex;

		// composition + solar disc
		float sundisk = smoothstep( sunAngularDiameterCos, sunAngularDiameterCos + 0.00002, cosTheta );
		L0 += ( vSunE * 19000.0 * Fex ) * sundisk;

		vec3 texColor = ( Lin + L0 ) * 0.04 + vec3( 0.0, 0.0003, 0.00075 );

		// Clouds
		if ( direction.y > 0.0 && cloudCoverage > 0.0 ) {

			// Project to cloud plane (higher elevation = clouds appear lower/closer)
			float elevation = mix( 1.0, 0.1, cloudElevation );
			vec2 cloudUV = direction.xz / ( direction.y * elevation );
			cloudUV *= cloudScale;
			cloudUV += time * cloudSpeed;

			// Multi-octave noise for fluffy clouds
			float cloudNoise = fbm( cloudUV * 1000.0 );
			cloudNoise += 0.5 * fbm( cloudUV * 2000.0 + 3.7 );
			cloudNoise = cloudNoise * 0.5 + 0.5;

			// Apply coverage threshold
			float cloudMask = smoothstep( 1.0 - cloudCoverage, 1.0 - cloudCoverage + 0.3, cloudNoise );

			// Fade clouds near horizon (adjusted by elevation)
			float horizonFade = smoothstep( 0.0, 0.1 + 0.2 * cloudElevation, direction.y );
			cloudMask *= horizonFade;

			// Cloud lighting based on sun position
			float sunInfluence = dot( direction, vSunDirection ) * 0.5 + 0.5;
			float daylight = max( 0.0, vSunDirection.y * 2.0 );

			// Base cloud color affected by atmosphere
			vec3 atmosphereColor = Lin * 0.04;
			vec3 cloudColor = mix( vec3( 0.3 ), vec3( 1.0 ), daylight );
			cloudColor = mix( cloudColor, atmosphereColor + vec3( 1.0 ), sunInfluence * 0.5 );
			cloudColor *= vSunE * 0.00002;

			// Blend clouds with sky
			texColor = mix( texColor, cloudColor, cloudMask * cloudDensity );

		}

		// three's tonemapping / colorspace chunks live in the tone-mapping
		// pass (see RendererPipeline); the dome writes raw linear colour
		// like every other material.
		gl_FragColor = vec4( texColor, 1.0 );

	}
`;
