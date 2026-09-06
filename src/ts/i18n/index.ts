// Lightweight i18n. Translation lookup is a flat map keyed by locale
// then by message id; t(locale, key, vars) supports {placeholder}
// substitution. Persisted via localStorage so a user's choice on the
// title-screen language picker carries across sessions.
//
// Pattern adapted from manuelhintermayr-portfolio/three-js i18n -
// reshaped from a Next-style module into a plain TS singleton with a
// pure t() function so it can be called from anywhere without a
// React context.

export type Locale = 'en' | 'de' | 'es';

const STORAGE_KEY = 'sketchbook.locale';
const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABELS: { [k in Locale]: string } =
{
	en: 'English',
	de: 'Deutsch',
	es: 'Español',
};

type LocaleMap = { [k in Locale]: string };

const TRANSLATIONS: { [key: string]: LocaleMap } =
{
	'title.prompt':
	{
		en: 'Click or press any key to start',
		de: 'Klicken oder Taste drücken, um zu starten',
		es: 'Haz clic o pulsa una tecla para empezar',
	},
	'title.languagePrompt':
	{
		en: 'Select language',
		de: 'Sprache wählen',
		es: 'Selecciona idioma',
	},

	'pause.title':       { en: 'PAUSED',           de: 'PAUSIERT',          es: 'PAUSADO' },
	'pause.resume':      { en: 'Resume',           de: 'Fortsetzen',        es: 'Reanudar' },
	'pause.settings':    { en: 'Settings',         de: 'Einstellungen',     es: 'Ajustes' },
	'pause.restart':     { en: 'Restart Scenario', de: 'Szenario neu starten', es: 'Reiniciar escenario' },
	'pause.reload':      { en: 'Reload Page',      de: 'Seite neu laden',   es: 'Recargar página' },
	'pause.hint':        { en: 'Press {key} to resume', de: '{key} drücken zum Fortsetzen', es: 'Pulsa {key} para reanudar' },

	'settings.title':    { en: 'Settings',         de: 'Einstellungen',     es: 'Ajustes' },
	'settings.general':  { en: 'General',          de: 'Allgemein',         es: 'General' },
	'settings.graphics': { en: 'Graphics',         de: 'Grafik',            es: 'Gráficos' },
	'settings.audio':    { en: 'Audio',            de: 'Audio',             es: 'Audio' },
	'settings.controls': { en: 'Controls',         de: 'Steuerung',         es: 'Controles' },
	'settings.language':     { en: 'Language',     de: 'Sprache',           es: 'Idioma' },
	'settings.languageDesc': { en: 'Reloads the page to apply', de: 'Seite wird neu geladen', es: 'Recarga la página al aplicar' },
	'settings.darkMode':     { en: 'Dark mode',    de: 'Dunkelmodus',       es: 'Modo oscuro' },
	'settings.darkModeDesc': { en: 'Dark surfaces for the modal stack', de: 'Dunkle Oberflächen für die Menüs', es: 'Superficies oscuras para los menús' },
	'settings.reset':        { en: 'Reset settings', de: 'Einstellungen zurücksetzen', es: 'Restablecer ajustes' },
	'settings.resetDesc':    { en: 'Wipe persisted values and reload', de: 'Gespeicherte Werte löschen und neu laden', es: 'Borrar los valores guardados y recargar' },
	'settings.resetBtn':     { en: 'Reset',         de: 'Zurücksetzen',      es: 'Restablecer' },
	'settings.done':     { en: 'Done',             de: 'Fertig',            es: 'Listo' },
	'settings.presets':  { en: 'Quality preset',   de: 'Qualitäts-Preset',  es: 'Preset de calidad' },
	'settings.presetLow':{ en: 'Low',              de: 'Niedrig',           es: 'Bajo' },
	'settings.presetHigh':{ en: 'High',            de: 'Hoch',              es: 'Alto' },
	'settings.presetDesc':{ en: 'Quick toggles for shadows + outlines', de: 'Schatten + Outlines auf einen Schlag', es: 'Atajos para sombras + contornos' },

	'error.reload':      { en: 'Reload',           de: 'Neu laden',         es: 'Recargar' },
	'error.copy':        { en: 'Copy details',     de: 'Details kopieren',  es: 'Copiar detalles' },
	'error.code':        { en: 'ERROR',            de: 'FEHLER',            es: 'ERROR' },
	'error.runtime':     { en: 'RUNTIME ERROR',    de: 'LAUFZEITFEHLER',    es: 'ERROR DE EJECUCIÓN' },
	'error.unhandled':   { en: 'UNHANDLED PROMISE', de: 'NICHT BEHANDELTE PROMISE', es: 'PROMESA NO MANEJADA' },
	'error.title':       { en: 'Something went wrong', de: 'Etwas ist schiefgelaufen', es: 'Algo salió mal' },
	'error.desc':        { en: 'The game engine encountered an unexpected error. You can try reloading the page; if the problem persists, please report it.',
	                       de: 'Die Spiel-Engine hatte einen unerwarteten Fehler. Du kannst die Seite neu laden; falls das Problem bleibt, bitte melden.',
	                       es: 'El motor del juego encontró un error inesperado. Puedes recargar la página; si el problema persiste, repórtalo.' },
	'error.fallbackUncaught':  { en: 'Uncaught exception',          de: 'Nicht abgefangene Ausnahme',  es: 'Excepción no capturada' },
	'error.fallbackRejection': { en: 'Unhandled promise rejection', de: 'Nicht behandelte Promise-Ablehnung', es: 'Rechazo de promesa no manejado' },

	// World - welcome dialog, lap counter, loading screen, WebGL warning, planet menu
	'world.welcome.title': { en: 'Welcome to Sketchbook!', de: 'Willkommen bei Sketchbook!', es: '¡Bienvenido a Sketchbook!' },
	'world.welcome.body':  { en: 'Feel free to explore the world and interact with available vehicles. There are also various scenarios ready to launch from the right panel.<br><br>Have fun with all the new features that have recently been added!',
	                         de: 'Erkunde die Welt und probiere die Fahrzeuge aus. Im rechten Panel kannst du verschiedene Szenarien starten.<br><br>Viel Spaß bei allen neuen Features, die kürzlich hinzugefügt wurden!',
	                         es: 'Siéntete libre de explorar el mundo e interactuar con los vehículos. También hay varios escenarios listos para lanzar desde el panel derecho.<br><br>¡Diviértete con todas las nuevas funciones añadidas recientemente!' },
	'world.welcome.button': { en: 'Okay',                  de: 'OK',                          es: 'Vale' },
	'world.empty.title':   { en: 'Hello world!',           de: 'Hallo Welt!',                 es: '¡Hola mundo!' },
	'world.empty.body':    { en: 'Empty Sketchbook world was successfully initialized. Enjoy the blueness of the sky.',
	                         de: 'Leere Sketchbook-Welt wurde erfolgreich initialisiert. Genieße das Blau des Himmels.',
	                         es: 'Mundo vacío de Sketchbook inicializado correctamente. Disfruta del azul del cielo.' },
	'world.webgl.title':   { en: 'WebGL compatibility',    de: 'WebGL-Kompatibilität',        es: 'Compatibilidad WebGL' },
	'world.webgl.body':    { en: "This browser doesn't seem to have the required WebGL 2 capabilities. The application may not work correctly.",
	                         de: 'Dieser Browser scheint die benötigten WebGL-2-Fähigkeiten nicht zu haben. Die App funktioniert möglicherweise nicht korrekt.',
	                         es: 'Este navegador no parece tener las capacidades WebGL 2 requeridas. La aplicación puede no funcionar correctamente.' },
	'world.webgl.footer':  { en: 'Click here for more information', de: 'Hier klicken für mehr Infos', es: 'Haz clic aquí para más información' },
	'world.lap':           { en: 'Lap: {n}',               de: 'Runde: {n}',                  es: 'Vuelta: {n}' },
	'world.loading':       { en: 'Loading world assets...', de: 'Lade Welt-Assets...',         es: 'Cargando recursos del mundo...' },
	'world.planet.heading': { en: 'Which planet do you want to go to?', de: 'Zu welchem Planeten willst du?', es: '¿A qué planeta quieres ir?' },
	'world.planet.earth':  { en: 'Earth',                  de: 'Erde',                        es: 'Tierra' },
	'world.planet.moon':   { en: 'Moon',                   de: 'Mond',                        es: 'Luna' },

	// World labels (player + animals; NPC names come from userData.name on the marker)
	'label.player':        { en: 'You',                    de: 'Du',                          es: 'Tú' },
	'animal.dog':          { en: 'Dog',                    de: 'Hund',                        es: 'Perro' },
	'animal.cat':          { en: 'Cat',                    de: 'Katze',                       es: 'Gato' },

	// Proximity prompts
	'prompt.talkTo':       { en: 'Press E to talk to {name}', de: 'E drücken zum Sprechen mit {name}', es: 'Pulsa E para hablar con {name}' },
	'prompt.interact':     { en: 'Press E to interact',    de: 'E drücken zum Interagieren',  es: 'Pulsa E para interactuar' },
	'prompt.talkTo.touch': { en: 'Tap E to talk to {name}',  de: 'E tippen zum Sprechen mit {name}', es: 'Toca E para hablar con {name}' },
	'prompt.interact.touch': { en: 'Tap F to interact',    de: 'F tippen zum Interagieren',   es: 'Toca F para interactuar' },
	'prompt.npcAnonymous': { en: 'NPC #{n}',               de: 'NPC #{n}',                    es: 'NPC #{n}' },

	// Touch control button labels. Joystick handles WASD + Sprint at rim;
	// Tap-on-canvas = jump while on foot. Buttons are context-aware: F
	// (vehicle/interact), E (talk), and vehicle-mode keys appear only
	// when relevant.
	'touch.action':        { en: 'F',                      de: 'F',                           es: 'F' },
	'touch.talk':          { en: 'E',                      de: 'E',                           es: 'E' },
	'touch.brake':         { en: 'BRK',                    de: 'BRK',                         es: 'BRK' },
	'touch.up':            { en: '↑',                      de: '↑',                           es: '↑' },
	'touch.down':          { en: '↓',                      de: '↓',                           es: '↓' },
	'touch.view':          { en: 'V',                      de: 'V',                           es: 'V' },
	'touch.seat':          { en: 'X',                      de: 'X',                           es: 'X' },
	'touch.yawLeft':       { en: '↺',                      de: '↺',                           es: '↺' },
	'touch.yawRight':      { en: '↻',                      de: '↻',                           es: '↻' },

	// Controls overlay header
	'controls.header':     { en: 'Controls:',              de: 'Steuerung:',                  es: 'Controles:' },

	// Action descriptions used in updateControls() across Character / Vehicle / Camera
	'controls.movement':         { en: 'Movement',                de: 'Bewegung',                  es: 'Movimiento' },
	'controls.sprint':           { en: 'Sprint',                  de: 'Sprinten',                  es: 'Sprint' },
	'controls.jump':             { en: 'Jump',                    de: 'Springen',                  es: 'Saltar' },
	'controls.enterVehicle':     { en: 'Enter vehicle',           de: 'Fahrzeug betreten',         es: 'Entrar al vehículo' },
	'controls.exitVehicle':      { en: 'Exit vehicle',            de: 'Fahrzeug verlassen',        es: 'Salir del vehículo' },
	'controls.switchSeats':      { en: 'Switch seats',            de: 'Sitzwechsel',               es: 'Cambiar de asiento' },
	'controls.spawnBall':        { en: 'Spawn a ball',            de: 'Ball spawnen',              es: 'Generar bola' },
	'controls.slowMotion':       { en: 'Toggle slow motion',      de: 'Zeitlupe umschalten',       es: 'Alternar cámara lenta' },
	'controls.viewDistance':     { en: 'Cycle view distance',     de: 'Kamera-Abstand wechseln',   es: 'Cambiar distancia de cámara' },
	'controls.respawn':          { en: 'Respawn',                 de: 'Respawn',                   es: 'Reaparecer' },
	'controls.freeCamera':       { en: 'Free camera',             de: 'Freie Kamera',              es: 'Cámara libre' },
	'controls.freeCameraExit':   { en: 'Exit free camera mode',   de: 'Freie Kamera verlassen',    es: 'Salir de la cámara libre' },
	'controls.moveAround':       { en: 'Move around',             de: 'Bewegen',                   es: 'Moverse' },
	'controls.moveUpDown':       { en: 'Move up / down',          de: 'Hoch / runter',             es: 'Subir / bajar' },
	'controls.speedUp':          { en: 'Speed up',                de: 'Schneller',                 es: 'Acelerar' },
	'controls.accelBrake':       { en: 'Accelerate, Brake / Reverse', de: 'Gas, Bremse / Rückwärts', es: 'Acelerar, frenar / marcha atrás' },
	'controls.steering':         { en: 'Steering',                de: 'Lenkung',                   es: 'Dirección' },
	'controls.handbrake':        { en: 'Handbrake',               de: 'Handbremse',                es: 'Freno de mano' },
	'controls.viewSelect':       { en: 'View select',             de: 'Ansicht wechseln',          es: 'Cambiar vista' },
	'controls.accelReverse':     { en: 'Accelerate / Reverse',    de: 'Gas / Rückwärts',           es: 'Acelerar / marcha atrás' },
	'controls.ascend':           { en: 'Ascend',                  de: 'Steigen',                   es: 'Ascender' },
	'controls.descend':          { en: 'Descend',                 de: 'Sinken',                    es: 'Descender' },
	'controls.pitch':            { en: 'Pitch',                   de: 'Nicken',                    es: 'Cabeceo' },
	'controls.yaw':              { en: 'Yaw',                     de: 'Gieren',                    es: 'Guiñada' },
	'controls.roll':             { en: 'Roll',                    de: 'Rollen',                    es: 'Alabeo' },
	'controls.accelerate':       { en: 'Accelerate',              de: 'Beschleunigen',             es: 'Acelerar' },
	'controls.decelerate':       { en: 'Decelerate',              de: 'Verzögern',                 es: 'Decelerar' },
	'controls.elevators':        { en: 'Elevators',               de: 'Höhenruder',                es: 'Elevadores' },
	'controls.ailerons':         { en: 'Ailerons',                de: 'Querruder',                 es: 'Alerones' },
	'controls.rudderSteering':   { en: 'Rudder / Steering',       de: 'Seitenruder / Lenkung',     es: 'Timón / dirección' },
	'controls.brake':            { en: 'Brake',                   de: 'Bremse',                    es: 'Frenar' },
	'controls.blastOff':         { en: 'Blast off',               de: 'Abheben',                   es: 'Despegar' },

	// NPC roles + dialog content. Anna / Ben / Carla / Dieter
	'npc.anna.role':       { en: 'Path Walker',                   de: 'Pfadläuferin',              es: 'Caminante' },
	'npc.anna.greet.text': { en: 'Hi there! Ben and I take turns walking this loop - it\'s a good way to keep an eye on the spawn area.',
	                         de: 'Hallo! Ben und ich laufen diese Runde abwechselnd - gute Art, den Spawn-Bereich im Auge zu behalten.',
	                         es: '¡Hola! Ben y yo nos turnamos para hacer este recorrido - una buena forma de vigilar la zona de aparición.' },
	'npc.anna.greet.c0':   { en: "What's here to see?",            de: 'Was gibt\'s hier zu sehen?', es: '¿Qué hay para ver?' },
	'npc.anna.greet.c1':   { en: 'Why are you walking in circles?', de: 'Warum läufst du im Kreis?', es: '¿Por qué caminas en círculos?' },
	'npc.anna.greet.c2':   { en: 'See you around.',                de: 'Bis später.',                es: 'Hasta luego.' },
	'npc.anna.tour.text':  { en: 'Cars are parked behind you, the helipad is over the hill, the boats sit at the dock east of here, and the rocketship lives on the island.',
	                         de: 'Die Autos stehen hinter dir, der Helipad ist über dem Hügel, die Boote liegen am Dock östlich von hier, und die Rakete steht auf der Insel.',
	                         es: 'Los autos están detrás de ti, el helipuerto está pasando la colina, los botes en el muelle al este, y el cohete vive en la isla.' },
	'npc.anna.tour.c0':    { en: 'Why are you walking in circles?', de: 'Warum läufst du im Kreis?', es: '¿Por qué caminas en círculos?' },
	'npc.anna.tour.c1':    { en: 'Thanks!',                        de: 'Danke!',                     es: '¡Gracias!' },
	'npc.anna.why.text':   { en: "I'm a path-following NPC. There are four invisible nodes around this area and I just walk between them. Ben does the same in reverse.",
	                         de: 'Ich bin ein Pfad-folgender NPC. Es gibt vier unsichtbare Knoten hier, und ich laufe zwischen ihnen. Ben macht dasselbe rückwärts.',
	                         es: 'Soy un NPC que sigue un camino. Hay cuatro nodos invisibles aquí, y camino entre ellos. Ben hace lo mismo al revés.' },
	'npc.anna.why.c0':     { en: "What's here to see?",            de: 'Was gibt\'s hier zu sehen?', es: '¿Qué hay para ver?' },
	'npc.anna.why.c1':     { en: 'Got it.',                        de: 'Verstanden.',                es: 'Entendido.' },

	'npc.ben.role':        { en: 'Path Walker',                   de: 'Pfadläufer',                 es: 'Caminante' },
	'npc.ben.greet.text':  { en: "Hey. If you bumped into Anna she'll have told you about the loop - same deal here, just the other way around.",
	                         de: 'Hi. Wenn du Anna getroffen hast, kennst du die Runde schon - bei mir das Gleiche, nur andersrum.',
	                         es: 'Hola. Si te cruzaste con Anna ya te habrá hablado del recorrido - lo mismo aquí, pero al revés.' },
	'npc.ben.greet.c0':    { en: 'Any tips for the races?',        de: 'Tipps für die Rennen?',      es: '¿Algún consejo para las carreras?' },
	'npc.ben.greet.c1':    { en: 'Tell me about the rocket.',      de: 'Erzähl mir von der Rakete.', es: 'Cuéntame sobre el cohete.' },
	'npc.ben.greet.c2':    { en: 'See you around.',                de: 'Bis später.',                es: 'Hasta luego.' },
	'npc.ben.races.text':  { en: 'Oval and Figure-8 are car races. The Tunnel is faster but the curves bite. Boat Race uses the marina - get in a boat and drive over the start.',
	                         de: 'Oval und Figure-8 sind Auto-Rennen. Der Tunnel ist schneller, aber die Kurven sind heftig. Beim Boot-Rennen geht\'s in der Marina los - rein ins Boot und über die Startlinie.',
	                         es: 'Óvalo y Figura-8 son carreras de autos. El Túnel es más rápido pero las curvas muerden. La Carrera de Botes usa la marina - sube a un bote y cruza la salida.' },
	'npc.ben.races.c0':    { en: 'Tell me about the rocket.',      de: 'Erzähl mir von der Rakete.', es: 'Cuéntame sobre el cohete.' },
	'npc.ben.races.c1':    { en: 'Cool, thanks.',                  de: 'Cool, danke.',               es: 'Genial, gracias.' },
	'npc.ben.rocket.text': { en: 'It launches you to the moon. Get in, press Space to start the countdown, and a planet picker shows up at apogee. Lunar gravity is real - be careful when you walk around up there.',
	                         de: 'Sie bringt dich zum Mond. Einsteigen, Leertaste drücken zum Start, und am Apogäum erscheint die Planeten-Auswahl. Mondschwerkraft ist real - sei dort oben vorsichtig beim Laufen.',
	                         es: 'Te lleva a la luna. Sube, pulsa Espacio para iniciar la cuenta atrás, y aparecerá el selector de planeta en el apogeo. La gravedad lunar es real - cuidado al caminar allí arriba.' },
	'npc.ben.rocket.c0':   { en: 'Any tips for the races?',        de: 'Tipps für die Rennen?',      es: '¿Algún consejo para las carreras?' },
	'npc.ben.rocket.c1':   { en: 'Got it.',                        de: 'Verstanden.',                es: 'Entendido.' },

	'npc.carla.role':      { en: 'Greeter',                       de: 'Begrüßerin',                 es: 'Recepcionista' },
	'npc.carla.greet.text': { en: 'Welcome to Sketchbook! Press Esc anytime if you need a pause menu - Resume, Settings, Restart, Reload.',
	                          de: 'Willkommen bei Sketchbook! Drück jederzeit Esc für das Pause-Menü - Fortsetzen, Einstellungen, Neustart, Neu laden.',
	                          es: '¡Bienvenido a Sketchbook! Pulsa Esc cuando quieras para el menú de pausa - Reanudar, Ajustes, Reiniciar, Recargar.' },
	'npc.carla.greet.c0':  { en: 'How do I drive a car?',          de: 'Wie fahre ich ein Auto?',    es: '¿Cómo conduzco un auto?' },
	'npc.carla.greet.c1':  { en: 'How do the controls work?',      de: 'Wie funktioniert die Steuerung?', es: '¿Cómo funcionan los controles?' },
	'npc.carla.greet.c2':  { en: 'Bye!',                           de: 'Tschüss!',                   es: '¡Adiós!' },
	'npc.carla.cars.text': { en: 'Walk up to a vehicle, press F to enter, then WASD to drive. Press F again to leave. Same goes for boats, helis and the rocket - Shift makes air vehicles boost.',
	                         de: 'Geh zu einem Fahrzeug, drück F zum Einsteigen, dann WASD zum Fahren. F drückt dich wieder raus. Bei Booten, Helis und der Rakete genauso - Shift gibt Luftfahrzeugen Schub.',
	                         es: 'Acércate a un vehículo, pulsa F para entrar, luego WASD para conducir. Pulsa F otra vez para salir. Igual con botes, helis y el cohete - Shift da empuje a los vehículos aéreos.' },
	'npc.carla.cars.c0':   { en: 'How do the controls work?',      de: 'Wie funktioniert die Steuerung?', es: '¿Cómo funcionan los controles?' },
	'npc.carla.cars.c1':   { en: 'Got it.',                        de: 'Verstanden.',                es: 'Entendido.' },
	'npc.carla.controls.text': { en: 'WASD moves you, Space jumps, Shift sprints. Z toggles the on-screen control hint. Shift+C is the free camera; T teleports you there.',
	                             de: 'WASD bewegt dich, Space springt, Shift sprintet. Z schaltet den Steuerungs-Hinweis um. Shift+C ist die freie Kamera; T teleportiert dich dorthin.',
	                             es: 'WASD te mueve, Espacio salta, Shift esprinta. Z alterna la ayuda de controles en pantalla. Shift+C es la cámara libre; T te teletransporta allí.' },
	'npc.carla.controls.c0': { en: 'How do I drive a car?',        de: 'Wie fahre ich ein Auto?',    es: '¿Cómo conduzco un auto?' },
	'npc.carla.controls.c1': { en: 'Thanks!',                      de: 'Danke!',                     es: '¡Gracias!' },

	'npc.dieter.role':     { en: 'Mechanic',                      de: 'Mechaniker',                 es: 'Mecánico' },
	'npc.dieter.greet.text': { en: 'You can tune the cars from the Vehicles folder in the right-hand debug panel - friction, suspension, engine force. Changes apply to anything you spawn next.',
	                           de: 'Du kannst die Autos im Vehicles-Ordner im rechten Debug-Panel tunen - Reibung, Federung, Motorkraft. Änderungen gelten für alles, was du danach spawnst.',
	                           es: 'Puedes afinar los autos desde la carpeta Vehicles del panel de debug derecho - fricción, suspensión, fuerza del motor. Los cambios se aplican a lo que aparezca después.' },
	'npc.dieter.greet.c0': { en: 'What can I tune exactly?',       de: 'Was kann ich genau einstellen?', es: '¿Qué puedo ajustar exactamente?' },
	'npc.dieter.greet.c1': { en: "What's in the World folder?",    de: 'Was steckt im World-Ordner?', es: '¿Qué hay en la carpeta World?' },
	'npc.dieter.greet.c2': { en: 'Cool, thanks.',                  de: 'Cool, danke.',               es: 'Genial, gracias.' },
	'npc.dieter.tuning.text': { en: 'Friction Slip, Suspension Stiffness, Max Suspension, Damping Compression, Damping Relaxation, and Engine Force. Crank Engine Force up if you want to launch off the ramps.',
	                            de: 'Friction Slip, Suspension Stiffness, Max Suspension, Damping Compression, Damping Relaxation und Engine Force. Dreh Engine Force hoch, wenn du von den Rampen abheben willst.',
	                            es: 'Friction Slip, Suspension Stiffness, Max Suspension, Damping Compression, Damping Relaxation, y Engine Force. Sube Engine Force si quieres despegar desde las rampas.' },
	'npc.dieter.tuning.c0': { en: "What's in the World folder?",   de: 'Was steckt im World-Ordner?', es: '¿Qué hay en la carpeta World?' },
	'npc.dieter.tuning.c1': { en: 'Got it.',                       de: 'Verstanden.',                es: 'Entendido.' },
	'npc.dieter.world.text': { en: 'Time scale, sun position, day/night cycle, gravity scale (0–2x), free-cam speed. Plus a Reset button if you mess everything up.',
	                           de: 'Zeitskala, Sonnenstand, Tag-/Nachtzyklus, Schwerkraft-Skala (0–2x), Free-Cam-Geschwindigkeit. Plus ein Reset-Knopf, falls du alles versaust.',
	                           es: 'Escala de tiempo, posición del sol, ciclo día/noche, escala de gravedad (0–2x), velocidad de cámara libre. Y un botón de Reset si lo arruinas todo.' },
	'npc.dieter.world.c0': { en: 'What can I tune exactly?',       de: 'Was kann ich genau einstellen?', es: '¿Qué puedo ajustar exactamente?' },
	'npc.dieter.world.c1': { en: 'Thanks!',                        de: 'Danke!',                     es: '¡Gracias!' },
};

function readStored(): Locale | null
{
	if (typeof window === 'undefined') return null;
	const stored = window.localStorage.getItem(STORAGE_KEY);
	if (stored === 'en' || stored === 'de' || stored === 'es') return stored;
	return null;
}

let current: Locale = readStored() ?? DEFAULT_LOCALE;

export function getLocale(): Locale
{
	return current;
}

export function setLocale(locale: Locale): void
{
	current = locale;
	if (typeof window !== 'undefined')
	{
		window.localStorage.setItem(STORAGE_KEY, locale);
	}
}

export function hasStoredLocale(): boolean
{
	return readStored() !== null;
}

// Translate. Falls back to English if a key is missing for the active
// locale (catches half-translated keys silently). Variables are
// substituted by simple {name} replacement.
export function t(key: string, vars?: { [k: string]: string }): string
{
	const map = TRANSLATIONS[key];
	if (map === undefined) return key;
	let str = map[current] ?? map.en;
	if (vars !== undefined)
	{
		for (const k in vars)
		{
			str = str.replace(`{${k}}`, vars[k]);
		}
	}
	return str;
}
