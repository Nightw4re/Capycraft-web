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
    ja: {
      title: "世界最大のげっ歯類",
      body: "大人のカピバラは体長約130センチ、体重は80キロ近くになることもあります。モルモットはカピバラの仲間です。",
    },
    uk: {
      title: "Найбільший гризун у світі",
      body: "Доросла капібара може вирости до 130 сантиметрів завдовжки й важити майже 80 кілограмів. Серед її родичів — морські свинки.",
    },
    de: {
      title: "Das größte Nagetier der Welt",
      body: "Ein ausgewachsenes Capybara kann bis zu 130 Zentimeter lang und fast 80 Kilogramm schwer werden. Zu seinen Verwandten gehören die Meerschweinchen.",
    },
    fr: {
      title: "Le plus grand rongeur du monde",
      body: "Un capybara adulte peut mesurer jusqu’à 130 centimètres et peser près de 80 kilos. Les cochons d’Inde font partie de ses proches parents.",
    },
    es: {
      title: "El roedor más grande del mundo",
      body: "Un capibara adulto puede medir hasta 130 centímetros y pesar casi 80 kilos. Las cobayas están entre sus parientes.",
    },
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
    ja: {
      title: "水面の上には目と耳と鼻だけ",
      body: "カピバラの目、耳、鼻の穴は頭の高い位置にあります。体のほとんどが水に沈んでいても、周りを見たり音を聞いたり、息をしたりできます。指の間の小さな水かきが泳ぐのに役立ちます。",
    },
    uk: {
      title: "Над водою лише очі, вуха й ніс",
      body: "Очі, вуха й ніздрі капібари розташовані високо на голові. Вона бачить, чує й дихає, навіть коли майже все тіло під водою. Перетинки між пальцями допомагають їй плавати.",
    },
    de: {
      title: "Nur Augen, Ohren und Nase ragen aus dem Wasser",
      body: "Augen, Ohren und Nasenlöcher sitzen beim Capybara weit oben am Kopf. Es kann sehen, hören und atmen, wenn fast sein ganzer Körper unter Wasser ist. Kleine Schwimmhäute zwischen den Zehen helfen beim Schwimmen.",
    },
    fr: {
      title: "Seuls les yeux, les oreilles et le nez dépassent de l’eau",
      body: "Les yeux, les oreilles et les narines du capybara sont placés haut sur sa tête. Il peut voir, entendre et respirer même quand son corps est presque entièrement immergé. Ses doigts partiellement palmés l’aident à nager.",
    },
    es: {
      title: "Solo los ojos, las orejas y el hocico asoman del agua",
      body: "Los ojos, las orejas y las fosas nasales del capibara están en la parte alta de la cabeza. Puede ver, oír y respirar con casi todo el cuerpo sumergido. Las membranas parciales entre los dedos le ayudan a nadar.",
    },
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
    ja: {
      title: "群れで暮らすと安全",
      body: "カピバラはふつう10頭ほどの群れで暮らしています。まとまっていると、より多くの大人が見張り、子どもたちに迫る危険に早く気づけます。",
    },
    uk: {
      title: "У гурті безпечніше",
      body: "Капібари зазвичай живуть групами приблизно по десять особин. Разом більше дорослих можуть пильнувати й завчасно помічати небезпеку для малят.",
    },
    de: {
      title: "In der Gruppe ist es sicherer",
      body: "Capybaras leben meist in Gruppen von etwa zehn Tieren. So können mehr erwachsene Tiere Wache halten und Gefahren für die Jungen früh erkennen.",
    },
    fr: {
      title: "En groupe, on est plus en sécurité",
      body: "Les capybaras vivent généralement en groupes d’une dizaine d’individus. Ensemble, davantage d’adultes peuvent monter la garde et repérer les dangers pour les petits.",
    },
    es: {
      title: "En grupo están más seguros",
      body: "Los capibaras suelen vivir en grupos de unos diez individuos. Así, más adultos pueden vigilar y detectar peligros para las crías.",
    },
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
    ja: {
      title: "一生伸び続ける歯",
      body: "カピバラは前歯で草や水草をかみ切ります。草を食べるうちに歯はすり減りますが、伸び続けることでその分を補います。",
    },
    uk: {
      title: "Зуби ростуть усе життя",
      body: "Передніми зубами капібара зрізає траву й водні рослини. Під час випасу зуби поступово стираються, а ріст компенсує зношення.",
    },
    de: {
      title: "Zähne, die immer weiterwachsen",
      body: "Mit seinen Schneidezähnen beißt das Capybara Gras und Wasserpflanzen ab. Beim Weiden nutzen sich die Zähne ab. Weil sie ständig nachwachsen, gleichen sie den Verschleiß aus.",
    },
    fr: {
      title: "Des dents qui poussent toute la vie",
      body: "Le capybara coupe l’herbe et les plantes aquatiques avec ses incisives. Elles s’usent à force de brouter et continuent de pousser pour compenser cette usure.",
    },
    es: {
      title: "Dientes que crecen toda la vida",
      body: "El capibara corta hierba y plantas acuáticas con los incisivos. Los dientes se desgastan al pastar y siguen creciendo para compensar ese desgaste.",
    },
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
    ja: {
      title: "なぜ自分のふんを食べるの？",
      body: "草には食物繊維が多く、カピバラの盲腸にすむ微生物がその分解を助けます。カピバラは盲腸便と呼ばれる柔らかいふんを食べ直し、微生物が作ったタンパク質などの栄養をさらに吸収します。",
    },
    uk: {
      title: "Навіщо капібара їсть власний послід?",
      body: "Трава багата на клітковину, яку допомагають розщеплювати мікроорганізми в сліпій кишці капібари. Потім капібара з’їдає м’які випорожнення, які називають цекотрофами. Під час повторного травлення вона засвоює більше поживних речовин, зокрема білки, вироблені цими мікроорганізмами.",
    },
    de: {
      title: "Warum fressen Capybaras ihren eigenen Kot?",
      body: "Gras enthält viele Fasern, die Mikroorganismen im Blinddarm des Capybaras abbauen. Das Capybara frisst anschließend einen weichen Blinddarmkot. Beim zweiten Durchgang nimmt es weitere Nährstoffe auf, darunter von den Mikroorganismen gebildete Proteine.",
    },
    fr: {
      title: "Pourquoi les capybaras mangent-ils leurs crottes ?",
      body: "L’herbe est riche en fibres, que les microbes du cæcum aident à dégrader. Le capybara mange ensuite une déjection molle appelée cæcotrophe. Ce second passage lui permet d’absorber d’autres nutriments, dont des protéines produites par ces microbes.",
    },
    es: {
      title: "¿Por qué comen sus propios excrementos?",
      body: "La hierba contiene mucha fibra, que los microbios del ciego del capibara ayudan a descomponer. Después, el capibara ingiere un excremento blando llamado cecotrofo. Ese segundo paso por el intestino le permite absorber más nutrientes, incluidas proteínas producidas por esos microbios.",
    },
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
    ja: {
      title: "Minecraft みたいな四角いふんをする動物は？",
      body: "立方体のふんをするのはヒメウォンバットです。腸には伸びやすさの異なる部分があり、収縮するときにその違いが角を形作ります。カピバラの普通のふんは楕円形です。",
    },
    uk: {
      title: "Хто залишає кубики, як у Minecraft?",
      body: "Кубічні випорожнення — особливість звичайного вомбата. Деякі ділянки його кишківника розтягуються легше за інші. Коли кишківник скорочується, ці відмінності допомагають утворити кути кубиків. Звичайний послід капібари овальний.",
    },
    de: {
      title: "Welches Tier macht Würfel wie in Minecraft?",
      body: "Würfelförmiger Kot ist eine Besonderheit des Nacktnasenwombats. Manche Abschnitte seines Darms dehnen sich leichter als andere. Wenn sich der Darm zusammenzieht, helfen diese Unterschiede dabei, die Ecken zu formen. Capybaras hinterlassen gewöhnlich ovale Kotballen.",
    },
    fr: {
      title: "Quel animal fait des crottes en cubes comme dans Minecraft ?",
      body: "Les crottes cubiques sont la spécialité du wombat commun. Certaines parties de son intestin s’étirent plus facilement que d’autres. Lorsque l’intestin se contracte, ces différences aident à former les angles des cubes. Les crottes ordinaires du capybara sont ovales.",
    },
    es: {
      title: "¿Qué animal hace cubos como los de Minecraft?",
      body: "Las heces cúbicas son propias del wombat común. Algunas partes de su intestino se estiran más fácilmente que otras. Cuando el intestino se contrae, esas diferencias ayudan a formar las esquinas de los cubos. Los excrementos normales del capibara son ovalados.",
    },
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
    ja: {
      title: "まばたきの瞬間を見つけられる？",
      body: "左下にいる冬のカピバラは、ときどきまばたきします。次にランタンを見るときは、その瞬間を探してみてください。",
    },
    uk: {
      title: "Помітиш, як капібара кліпає?",
      body: "Наша зимова капібара в нижньому лівому куті час від часу кліпає. Наступного разу, коли поглянеш на ліхтар, спробуй це помітити.",
    },
    de: {
      title: "Erwischst du es beim Blinzeln?",
      body: "Unser Winter-Capybara unten links blinzelt ab und zu. Achte darauf, wenn du das nächste Mal zur Laterne schaust.",
    },
    fr: {
      title: "Arriverez-vous à le voir cligner des yeux ?",
      body: "Notre capybara d’hiver, en bas à gauche, cligne parfois des yeux. Essayez de le surprendre la prochaine fois que vous regarderez vers la lanterne.",
    },
    es: {
      title: "¿Puedes verlo parpadear?",
      body: "Nuestro capibara de invierno, abajo a la izquierda, parpadea de vez en cuando. Fíjate la próxima vez que mires hacia el farol.",
    },
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
