import type { Language } from '../preferences';
import type { PonderScene } from './format.mts';
import type { PonderPickingBlock } from './picking.mts';

const pumpParts: Record<string, { en: [string, string]; cs: [string, string] }> = {
  'create:mechanical_pump': {
    en: ['Mechanical Pump', 'Uses rotational power to move fluid through the connected pipes. Higher rotation speed increases throughput.'],
    cs: ['Mechanická pumpa', 'Využívá otáčky k čerpání kapaliny připojeným potrubím. Vyšší otáčky zvyšují průtok.'],
  },
  'create:fluid_pipe': {
    en: ['Fluid Pipe', 'Carries fluid between the pump, the branches of the network, and the tanks.'],
    cs: ['Potrubí na kapaliny', 'Vede kapalinu mezi pumpou, větvemi sítě a nádržemi.'],
  },
  'create:glass_fluid_pipe': {
    en: ['Glass Fluid Pipe', 'The transparent part of the pipe lets you see which fluid is moving through the network.'],
    cs: ['Průhledné potrubí', 'Průhlednou částí potrubí je vidět, jaká kapalina právě protéká sítí.'],
  },
  'create:fluid_tank': {
    en: ['Fluid Tank', 'Stores fluid. The scene uses the tanks to compare how quickly different pipe setups fill.'],
    cs: ['Nádrž na kapaliny', 'Uchovává kapalinu. Ve scéně nádrže ukazují, jak rychle je různá zapojení naplní.'],
  },
  'create:shaft': {
    en: ['Shaft', 'Transfers rotation to the mechanical pump or between connected gears.'],
    cs: ['Hřídel', 'Přenáší otáčky k pumpě nebo mezi připojenými ozubenými koly.'],
  },
  'create:cogwheel': {
    en: ['Cogwheel', 'Transfers rotation between axes. Paired with a large cogwheel, it changes the speed delivered to the pump.'],
    cs: ['Ozubené kolo', 'Přenáší otáčky mezi osami. Ve spojení s velkým kolem mění otáčky přiváděné k pumpě.'],
  },
  'create:large_cogwheel': {
    en: ['Large Cogwheel', 'Forms a gear ratio with the smaller cogwheel so the two machines can run at different speeds.'],
    cs: ['Velké ozubené kolo', 'S menším kolem vytváří převod, takže připojené stroje mohou běžet různou rychlostí.'],
  },
};

export function ponderPartFilter(scene: Pick<PonderScene, 'schematic' | 'items'>) {
  const items = new Set(scene.items);
  const namespace = scene.schematic.slice(0, scene.schematic.indexOf(':'));
  const isSceneBlock = (id: string) => namespace !== 'minecraft' && !!namespace && id.startsWith(namespace + ':');
  return ({ block, item }: Pick<PonderPickingBlock, 'block' | 'item'>) =>
    scene.schematic === 'create:mechanical_pump/speed'
      ? Object.hasOwn(pumpParts, block)
      : isSceneBlock(block) || items.has(block) || (item !== undefined && (isSceneBlock(item) || items.has(item)));
}

export function ponderPart(block: string, language: Language, explain = false) {
  const entry = pumpParts[block];
  if (entry) {
    const [name, description] = entry[language === 'cs' ? 'cs' : 'en'];
    return [name, explain ? description : undefined] as const;
  }
  const name = block.split(':').at(-1)!.replaceAll('_', ' ');
  return [name.charAt(0).toUpperCase() + name.slice(1)] as const;
}
