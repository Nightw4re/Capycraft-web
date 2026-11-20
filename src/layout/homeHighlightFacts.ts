import islands from '../../assets/capybara-snow-islands.png';
import type { Language } from '../preferences';

type FactCopy = { title: string; body: string };
type Fact = Record<Language, FactCopy> & {
  id: string;
  image: { src: string; className?: string };
};

const winterCapybara = { src: islands, className: 'home-highlight-winter-capybara' };

export const homeHighlightFacts: readonly Fact[] = [
  {
    id: 'largest-rodent',
    image: winterCapybara,
    cs: {
      title: 'Největší hlodavec na světě',
      body: 'Dospělá kapybara může měřit až 130 centimetrů a vážit skoro 80 kilogramů. Mezi její příbuzné patří morčata.',
    },
    en: {
      title: 'The world’s largest rodent',
      body: 'An adult capybara can grow up to 130 centimeters long and weigh nearly 80 kilograms. Its relatives include guinea pigs.',
    },
  },
  {
    id: 'swimming',
    image: winterCapybara,
    cs: {
      title: 'Nad hladinou jen oči, uši a nos',
      body: 'Kapybara má oči, uši a nozdry vysoko na hlavě. Může tedy sledovat okolí, poslouchat a dýchat, i když má skoro celé tělo pod vodou. Při plavání jí pomáhají částečné plovací blány mezi prsty.',
    },
    en: {
      title: 'Just eyes, ears, and nose above water',
      body: 'A capybara’s eyes, ears, and nostrils sit high on its head. It can see, hear, and breathe with almost its whole body underwater. The partial webbing between its toes helps it swim.',
    },
  },
  {
    id: 'herds',
    image: winterCapybara,
    cs: {
      title: 'V partě je bezpečněji',
      body: 'Kapybary obvykle žijí ve skupinách kolem deseti jedinců. Když se drží pohromadě, může víc dospělých hlídat okolí a včas si všimnout nebezpečí pro mláďata.',
    },
    en: {
      title: 'Safer in a group',
      body: 'Capybaras usually live in groups of around ten. Staying together means more adults can keep watch and spot danger to the young.',
    },
  },
  {
    id: 'growing-teeth',
    image: winterCapybara,
    cs: {
      title: 'Zuby jí rostou celý život',
      body: 'Kapybara předními zuby ukusuje trávu a vodní rostliny. Při pastvě se zuby postupně obrušují a jejich růst opotřebení vyrovnává.',
    },
    en: {
      title: 'Teeth that keep growing',
      body: 'A capybara uses its front teeth to clip grass and aquatic plants. Grazing gradually wears these teeth down, and they keep growing to replace what wears away.',
    },
  },
  {
    id: 'digestion',
    image: winterCapybara,
    cs: {
      title: 'Proč kapybara jí vlastní bobky?',
      body: 'Tráva je plná vlákniny, kterou kapybaře pomáhají rozkládat mikrobi ve slepém střevě. Kapybara pak znovu sní měkkou část trusu, které se říká cekotrof. Při druhém průchodu trávicím traktem tak získá další živiny, třeba bílkoviny vytvořené těmito mikroby.',
    },
    en: {
      title: 'Why do capybaras eat their own poop?',
      body: 'Grass is full of fiber, and microbes in the capybara’s cecum help break it down. The capybara then eats a soft type of dropping called a cecotrope. That second trip through the gut lets it absorb more nutrients, including protein made by those microbes.',
    },
  },
  {
    id: 'wombat',
    image: winterCapybara,
    cs: {
      title: 'Kdo má bobky jako z Minecraftu?',
      body: 'Kostkované bobky jsou specialita vombata obecného. Jeho střevo má místa s různou pružností. Když se stěna stahuje, tyto rozdíly vytvarují hrany kostek. Běžné kapybaří bobky jsou oválné.',
    },
    en: {
      title: 'Which animal poops Minecraft cubes?',
      body: 'Cube-shaped poop is a specialty of the bare-nosed wombat. Some parts of its intestine stretch more easily than others. As the gut contracts, those differences help shape the corners of the cubes. A capybara’s regular droppings are oval.',
    },
  },
  {
    id: 'blink',
    image: winterCapybara,
    cs: {
      title: 'Přistihneš ji při mrknutí?',
      body: 'Naše zimní kapybara v levém dolním rohu občas mrkne. Zkus ji při tom přistihnout, až se příště podíváš k lucerně.',
    },
    en: {
      title: 'Can you catch it blinking?',
      body: 'Our winter capybara in the bottom-left corner blinks every now and then. See if you can catch it the next time you look over at the lantern.',
    },
  },
];
