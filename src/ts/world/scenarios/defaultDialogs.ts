import { Dialog } from '../ui/DialogBox';
import { t, getLocale, Locale } from '../../i18n';

// Hand-written conversation trees for the four programmatically-injected
// NPCs at the Inthenew default spawn (Anna, Ben, Carla, Dieter). Loaded
// from World.injectDefaultSceneNPCs.
//
// Translatable: text + choice labels resolve via i18n at lookup time.
// Cached by locale - getDefaultDialogs() is called once per scenario
// launch, but a stable language across launches reuses the same tree
// instead of rebuilding ~36 t() lookups + four nested object literals
// each time. Cache invalidates the moment the player picks a new
// language at the title screen.

type DialogMap = { [name: string]: { role: string; dialog: Dialog } };

let cache: { locale: Locale; dialogs: DialogMap } | null = null;

export function getDefaultDialogs(): DialogMap
{
	const locale = getLocale();
	if (cache !== null && cache.locale === locale) return cache.dialogs;

	const dialogs: DialogMap = build();
	cache = { locale, dialogs };
	return dialogs;
}

function build(): DialogMap
{
	return {
		Anna:
		{
			role: t('npc.anna.role'),
			dialog:
			{
				start: 'greet',
				nodes:
				{
					greet:
					{
						speaker: 'Anna',
						text: t('npc.anna.greet.text'),
						choices:
						[
							{ label: t('npc.anna.greet.c0'), next: 'tour' },
							{ label: t('npc.anna.greet.c1'), next: 'why' },
							{ label: t('npc.anna.greet.c2'), next: 'end' },
						],
					},
					tour:
					{
						speaker: 'Anna',
						text: t('npc.anna.tour.text'),
						choices:
						[
							{ label: t('npc.anna.tour.c0'), next: 'why' },
							{ label: t('npc.anna.tour.c1'), next: 'end' },
						],
					},
					why:
					{
						speaker: 'Anna',
						text: t('npc.anna.why.text'),
						choices:
						[
							{ label: t('npc.anna.why.c0'), next: 'tour' },
							{ label: t('npc.anna.why.c1'), next: 'end' },
						],
					},
				},
			},
		},
		Ben:
		{
			role: t('npc.ben.role'),
			dialog:
			{
				start: 'greet',
				nodes:
				{
					greet:
					{
						speaker: 'Ben',
						text: t('npc.ben.greet.text'),
						choices:
						[
							{ label: t('npc.ben.greet.c0'), next: 'races' },
							{ label: t('npc.ben.greet.c1'), next: 'rocket' },
							{ label: t('npc.ben.greet.c2'), next: 'end' },
						],
					},
					races:
					{
						speaker: 'Ben',
						text: t('npc.ben.races.text'),
						choices:
						[
							{ label: t('npc.ben.races.c0'), next: 'rocket' },
							{ label: t('npc.ben.races.c1'), next: 'end' },
						],
					},
					rocket:
					{
						speaker: 'Ben',
						text: t('npc.ben.rocket.text'),
						choices:
						[
							{ label: t('npc.ben.rocket.c0'), next: 'races' },
							{ label: t('npc.ben.rocket.c1'), next: 'end' },
						],
					},
				},
			},
		},
		Carla:
		{
			role: t('npc.carla.role'),
			dialog:
			{
				start: 'greet',
				nodes:
				{
					greet:
					{
						speaker: 'Carla',
						text: t('npc.carla.greet.text'),
						choices:
						[
							{ label: t('npc.carla.greet.c0'), next: 'cars' },
							{ label: t('npc.carla.greet.c1'), next: 'controls' },
							{ label: t('npc.carla.greet.c2'), next: 'end' },
						],
					},
					cars:
					{
						speaker: 'Carla',
						text: t('npc.carla.cars.text'),
						choices:
						[
							{ label: t('npc.carla.cars.c0'), next: 'controls' },
							{ label: t('npc.carla.cars.c1'), next: 'end' },
						],
					},
					controls:
					{
						speaker: 'Carla',
						text: t('npc.carla.controls.text'),
						choices:
						[
							{ label: t('npc.carla.controls.c0'), next: 'cars' },
							{ label: t('npc.carla.controls.c1'), next: 'end' },
						],
					},
				},
			},
		},
		Dieter:
		{
			role: t('npc.dieter.role'),
			dialog:
			{
				start: 'greet',
				nodes:
				{
					greet:
					{
						speaker: 'Dieter',
						text: t('npc.dieter.greet.text'),
						choices:
						[
							{ label: t('npc.dieter.greet.c0'), next: 'tuning' },
							{ label: t('npc.dieter.greet.c1'), next: 'world' },
							{ label: t('npc.dieter.greet.c2'), next: 'end' },
						],
					},
					tuning:
					{
						speaker: 'Dieter',
						text: t('npc.dieter.tuning.text'),
						choices:
						[
							{ label: t('npc.dieter.tuning.c0'), next: 'world' },
							{ label: t('npc.dieter.tuning.c1'), next: 'end' },
						],
					},
					world:
					{
						speaker: 'Dieter',
						text: t('npc.dieter.world.text'),
						choices:
						[
							{ label: t('npc.dieter.world.c0'), next: 'tuning' },
							{ label: t('npc.dieter.world.c1'), next: 'end' },
						],
					},
				},
			},
		},
	};
}
