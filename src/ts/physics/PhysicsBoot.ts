import HavokPhysics from '@babylonjs/havok';
import type { HavokPhysicsWithBindings } from '@babylonjs/havok';
// Importing the binary routes it through webpack's asset rule, which
// emits build/HavokPhysics.wasm next to the bundle and hands back its
// URL - the Emscripten loader's own import.meta.url fallback can't
// resolve anything from inside a UMD bundle.
import havokWasmUrl from '@babylonjs/havok/lib/esm/HavokPhysics.wasm';

// Single owner of the one-time Havok WASM instantiation. The module is
// fetched lazily (first call) and cached; World's constructor reads the
// instance synchronously via getHavok(), so callers must await
// initPhysics() before constructing a World. sketchbook.ts kicks the
// download off at module load so the title screen gesture normally
// lands on an already-resolved promise.

let instance: HavokPhysicsWithBindings | null = null;
let loading: Promise<HavokPhysicsWithBindings> | null = null;

export function preloadPhysics(): Promise<HavokPhysicsWithBindings>
{
	if (loading === null)
	{
		loading = HavokPhysics({
			locateFile: () => havokWasmUrl,
		}).then((havok) =>
		{
			instance = havok;
			return havok;
		});
	}
	return loading;
}

export async function initPhysics(): Promise<void>
{
	await preloadPhysics();
}

export function getHavok(): HavokPhysicsWithBindings
{
	if (instance === null)
	{
		throw new Error('Havok is not initialised - await Sketchbook.initPhysics() before constructing a World.');
	}
	return instance;
}
