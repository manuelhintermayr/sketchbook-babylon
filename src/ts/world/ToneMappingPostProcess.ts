import { Effect, Engine, PostProcess, Texture } from '@babylonjs/core';

// three's direct-to-canvas output transform - ACESFilmicToneMapping at
// exposure 1 (including its 1 / 0.6 pre-scale) followed by LinearTosRGB -
// as a fullscreen pass. The scene renders raw linear colour (see
// RendererPipeline); this pass is attached only while FXAA is off, the
// one case in which three tone mapped and encoded the frame.
Effect.ShadersStore['sketchbookToneMappingFragmentShader'] = `
	precision highp float;
	varying vec2 vUV;
	uniform sampler2D textureSampler;

	vec3 RRTAndODTFit( vec3 v ) {
		vec3 a = v * ( v + 0.0245786 ) - 0.000090537;
		vec3 b = v * ( 0.983729 * v + 0.4329510 ) + 0.238081;
		return a / b;
	}

	vec3 ACESFilmicToneMapping( vec3 color ) {
		const mat3 ACESInputMat = mat3(
			vec3( 0.59719, 0.07600, 0.02840 ),
			vec3( 0.35458, 0.90834, 0.13383 ),
			vec3( 0.04823, 0.01566, 0.83777 )
		);
		const mat3 ACESOutputMat = mat3(
			vec3( 1.60475, -0.10208, -0.00327 ),
			vec3( -0.53108, 1.10813, -0.07276 ),
			vec3( -0.07367, -0.00605, 1.07602 )
		);
		color *= 1.0 / 0.6;
		color = ACESInputMat * color;
		color = RRTAndODTFit( color );
		color = ACESOutputMat * color;
		return clamp( color, 0.0, 1.0 );
	}

	vec3 linearToSRGB( vec3 value ) {
		return mix( pow( value, vec3( 0.41666 ) ) * 1.055 - vec3( 0.055 ), value * 12.92, vec3( lessThanEqual( value, vec3( 0.0031308 ) ) ) );
	}

	void main() {
		vec4 base = texture2D( textureSampler, vUV );
		gl_FragColor = vec4( linearToSRGB( ACESFilmicToneMapping( base.rgb ) ), base.a );
	}
`;

// Not attached to a camera here - RendererPipeline swaps it in for FXAA.
export function createToneMappingPass(engine: Engine, textureType: number): PostProcess
{
	return new PostProcess('toneMapping', 'sketchbookToneMapping', null, null, 1.0, null, Texture.BILINEAR_SAMPLINGMODE, engine, false, null, textureType);
}
