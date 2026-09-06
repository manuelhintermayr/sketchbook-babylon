// Module declaration shims for non-code assets imported from TypeScript.
// Required under TypeScript 6 (strict module resolution).

declare module '*.css';

// Havok's WebAssembly binary is imported for its emitted URL (webpack
// asset/resource rule in webpack.common.js).
declare module '*.wasm'
{
	const url: string;
	export default url;
}
