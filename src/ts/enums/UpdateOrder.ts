// Per-frame update slots for IUpdatable.updateOrder. Lower runs first.
// Spaced by 10 so a new slot can squeeze between two existing ones
// without renumbering everything.
//
// Frame order (top → bottom):
//   physics → input → camera → world entities → audio → UI → post-camera
export enum UpdateOrder
{
	CharacterPhysics = 10,    // Character physics step + state machine
	VehiclePhysics   = 20,    // Vehicle physics step + state machine
	Input            = 30,    // InputManager, debug InfoStack
	Camera           = 40,    // CameraOperator follows player/vehicle
	Environment      = 50,    // Sky (sun position), ShapeEntity primitives
	Scenarios        = 60,    // RaceContent and other scripted progression
	World            = 100,   // Grass, Ocean, WanderingAnimals - need camera
	Audio            = 110,   // ProceduralAudio (engine/ambient), Speaker
	Prompts          = 130,   // ProximityPrompt (per-frame distance check)
	Labels           = 140,   // CSS2D WorldLabels
	PostCamera       = 150,   // CameraShake - runs after the camera is final
}
