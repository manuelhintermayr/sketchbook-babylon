import * as THREE from 'three';
import { ISpawnPoint } from '../../interfaces/ISpawnPoint';
import { World } from '../World';
import { Character } from '../../characters/Character';
import { FollowPath } from '../../characters/character_ai/FollowPath';
import { FollowTarget } from '../../characters/character_ai/FollowTarget';
import { RandomBehaviour } from '../../characters/character_ai/RandomBehaviour';
import { LoadingManager } from '../../core/LoadingManager';
import * as Utils from '../../core/FunctionLibrary';
import { attachNameLabel } from '../ui/NameLabel';
import { ProximityPrompt } from '../ProximityPrompt';
import { Dialog } from '../ui/DialogBox';
import { t } from '../../i18n';

let anonymousNpcCounter = 1;

// Static "multiplayer-style" NPC. Spawns the same boxman model the
// player uses but never calls takeControl(), so the character settles
// into Idle and stays put. Useful for populating scenarios with
// background figures that look alive but aren't networked.
//
// If the marker carries userData.first_node, the NPC instead gets a
// FollowPath behaviour rooted at that node - same convention as the AI
// vehicle drivers already use, so an NPC can wander a path without any
// extra plumbing.
//
// If a dialog (and optional role) is attached, a ProximityPrompt is
// created next to the NPC that opens the DialogBox on E-press.
export class NPCSpawnPoint implements ISpawnPoint
{
	private object: THREE.Object3D;
	private firstAINode: string | undefined;
	private dialog: Dialog | undefined;
	private role: string | undefined;

	constructor(object: THREE.Object3D, options?: { dialog?: Dialog; role?: string })
	{
		this.object = object;
		if (typeof object.userData.first_node === 'string')
		{
			this.firstAINode = object.userData.first_node;
		}
		this.dialog = options?.dialog;
		this.role = options?.role;
	}

	public spawn(loadingManager: LoadingManager, world: World): void
	{
		loadingManager.loadGLTF('build/assets/boxman.glb', (model) =>
		{
			const npc = new Character(model);

			const worldPos = new THREE.Vector3();
			this.object.getWorldPosition(worldPos);
			npc.setPosition(worldPos.x, worldPos.y, worldPos.z);

			const forward = Utils.getForward(this.object);
			npc.setOrientation(forward, true);

			world.add(npc);

			// Name tag - userData.name from the marker if authored,
			// otherwise auto-numbered NPC#1/NPC#2/… so the player can
			// still distinguish them.
			const tag = (typeof this.object.userData.name === 'string' && this.object.userData.name.length > 0)
				? this.object.userData.name
				: t('prompt.npcAnonymous', { n: String(anonymousNpcCounter++) });
			attachNameLabel(npc, tag, false, { feature: 'Labels' });

			// ProximityPrompt anchored to the NPC - moves with them so a
			// walking NPC's interaction zone keeps up. Reads the role
			// from constructor options (used as the portrait subtitle).
			if (this.dialog !== undefined)
			{
				const dialog = this.dialog;
				if (this.role !== undefined)
				{
					for (const id in dialog.nodes)
					{
						if (dialog.nodes[id].role === undefined) dialog.nodes[id].role = this.role;
					}
				}
				const prompt = new ProximityPrompt(
					() => npc.position.clone(),
					{
						text: t('prompt.talkTo', { name: tag }),
						touchText: t('prompt.talkTo.touch', { name: tag }),
						maxInteractDistance: 1.5,
						dialog,
						targetCharacter: npc,
					},
				);
				prompt.addToWorld(world);
			}

			// Path-following NPC. Speed parameter mirrors the AI vehicle
			// drivers - see VehicleSpawnPoint where it picks 10 too.
			if (this.firstAINode !== undefined)
			{
				const node = this.findNode(world, this.firstAINode);
				if (node !== null) npc.setBehaviour(new FollowPath(node, 5));
				else console.error('NPC path node ' + this.firstAINode + ' not found.');
			}
			else if (this.object.userData.behaviour === 'random')
			{
				// Wander randomly - same Random AI swift502 v0.1+ used for
				// the example "John" NPC.
				npc.setBehaviour(new RandomBehaviour());
			}
			else if (this.object.userData.behaviour === 'follow')
			{
				// Follow the player - swift502's FollowCharacter behaviour
				// for the example "Bob" NPC. Resolved lazily on the first
				// update tick because the player may spawn after this NPC.
				const placeholder = new THREE.Object3D();
				const followBehaviour = new FollowTarget(placeholder, 2);
				npc.setBehaviour(followBehaviour);
				const tick = (): void =>
				{
					const player = world.characters.find((c) => c.isPlayer);
					if (player !== undefined)
					{
						followBehaviour.setTarget(player);
						world.unregisterUpdatable(stepper);
					}
				};
				const stepper = { updateOrder: 5, update: tick };
				world.registerUpdatable(stepper);
			}
		});
	}

	private findNode(world: World, nodeName: string): any
	{
		for (const path of world.paths)
		{
			for (const key in path.nodes)
			{
				if (Object.prototype.hasOwnProperty.call(path.nodes, key))
				{
					const n = path.nodes[key];
					if (n.object.name === nodeName) return n;
				}
			}
		}
		return null;
	}
}
