import type { BrickCode } from './bricks';

/** Pictograms and a tiny font for the level generator.
 *
 *  Shapes are drawn with roles rather than brick codes, so the same heart can
 *  be built out of different materials as the campaign hardens:
 *
 *    `#` body     the outline and mass of the figure
 *    `@` core     what sits inside it — the idea of the shape
 *    `*` charge   explosive: fuses, hearts' bombs, eyes that go off
 *    `x` wall     indestructible, used sparingly for eyes and frames
 *    `.` empty
 *
 *  Each glyph names its own skin, because the point is not decoration: a heart
 *  whose core regenerates around a bomb plays differently from a bomb whose
 *  fuse is a line of charges, and both read at a glance. */

export type GlyphSkin = {
  body: BrickCode;
  core: BrickCode;
  charge: BrickCode;
};

export interface Glyph {
  name: string;
  art: string[];
  skin: GlyphSkin;
  /** True when the shape reads the same in both directions, which lets the
   *  whole field be mirrored around it. Words never can be. */
  mirror?: boolean;
  /** Drawn in single-cell strokes rather than solid mass — runes and letters.
   *  These need more empty space around them or the filler swallows them. */
  thin?: boolean;
  /** What the shape is about, shown in the level's name. */
  idea: string;
}

/** Hearts, skulls and bombs, drawn twelve columns wide — the full width of the
 *  field. An odd-width shape can never sit centred in an even grid: the spare
 *  column always lands on one side and the picture reads as shifted. Every row
 *  here is a palindrome, so each figure is symmetric and the whole field can be
 *  mirrored around it. */
export const GLYPHS: Glyph[] = [
  {
    name: 'Сердце',
    idea: 'сердцевина регенерирует, внутри заряд',
    mirror: true,
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: [
      '.###....###.',
      '###@@..@@###',
      '##@@@@@@@@##',
      '##@@*@@*@@##',
      '.##########.',
      '..########..',
      '...######...',
      '....####....',
      '.....##.....',
    ],
  },
  {
    name: 'Бомба',
    idea: 'два фитиля сходятся в корпус',
    mirror: true,
    skin: { body: 't', core: 'e', charge: 'e' },
    art: [
      '.....**.....',
      '....*..*....',
      '...*....*...',
      '..########..',
      '.##########.',
      '##@@@@@@@@##',
      '##@@@@@@@@##',
      '.##########.',
      '..########..',
    ],
  },
  {
    name: 'Череп',
    idea: 'глазницы не бьются, челюсть взрывается',
    mirror: true,
    skin: { body: 'n', core: 'x', charge: 'e' },
    art: [
      '..########..',
      '.##########.',
      '##@@@..@@@##',
      '##@@@..@@@##',
      '############',
      '.###****###.',
      '..########..',
      '...#.##.#...',
    ],
  },
  {
    name: 'Захватчик',
    idea: 'классический пришелец с начинкой',
    mirror: true,
    skin: { body: 't', core: 'g', charge: 'e' },
    art: [
      '..#......#..',
      '...#....#...',
      '..########..',
      '.##.####.##.',
      '###@####@###',
      '#.########.#',
      '#.#......#.#',
      '...##..##...',
    ],
  },
  {
    name: 'Звезда',
    idea: 'ядро под слоем брони',
    mirror: true,
    skin: { body: 's', core: 'g', charge: 'e' },
    art: [
      '.....##.....',
      '....####....',
      '#####**#####',
      '.####@@####.',
      '..########..',
      '...######...',
      '..##....##..',
      '.##......##.',
    ],
  },
  {
    name: 'Смайл',
    idea: 'глаза регенерируют, улыбка взрывная',
    mirror: true,
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: [
      '..########..',
      '.##########.',
      '##@@####@@##',
      '##@@####@@##',
      '############',
      '.#*######*#.',
      '..#******#..',
      '...######...',
    ],
  },
  {
    name: 'Стрела',
    idea: 'наконечник взрывается, древко держит',
    mirror: true,
    skin: { body: 't', core: 's', charge: 'e' },
    art: [
      '.....**.....',
      '....****....',
      '...######...',
      '..########..',
      '.####**####.',
      '....@@@@....',
      '....@@@@....',
      '....@@@@....',
    ],
  },
  {
    name: 'Призрак',
    idea: 'сквозь него не пройти, глаза золотые',
    mirror: true,
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: [
      '..########..',
      '.##########.',
      '##@@####@@##',
      '##@@####@@##',
      '############',
      '############',
      '##**####**##',
      '#.##.##.##.#',
    ],
  },
  {
    name: 'Реактор',
    idea: 'кольцо брони вокруг живого ядра',
    mirror: true,
    skin: { body: 's', core: 'r', charge: 'e' },
    art: [
      '...######...',
      '..##....##..',
      '.##..**..##.',
      '##..@@@@..##',
      '##.@@@@@@.##',
      '##..@@@@..##',
      '.##..**..##.',
      '..##....##..',
      '...######...',
    ],
  },
  {
    name: 'Мина',
    idea: 'шипы наружу, заряд внутри',
    mirror: true,
    skin: { body: 's', core: 'e', charge: 'e' },
    art: [
      '..#..##..#..',
      '...#.##.#...',
      '..########..',
      '.#@@@@@@@@#.',
      '#.@@@@@@@@.#',
      '.#@@@@@@@@#.',
      '..########..',
      '...#.##.#...',
    ],
  },
];

// ------------------------------------------------------------------- runes --

/** Elder Futhark, five columns by seven — two of them side by side with a gap
 *  fill the field exactly. A pair reads as an inscription rather than a
 *  picture, which is what the campaign wanted and the race did not: smileys
 *  belong at a table, runes belong on a wall.
 *
 *  Their materials follow their meaning rather than their looks. Ice is steel,
 *  hail is explosive, need regenerates, wealth is gold. */
export interface Rune {
  name: string;
  meaning: string;
  art: string[];
  skin: GlyphSkin;
}

export const RUNES: Rune[] = [
  {
    name: 'Феху',
    meaning: 'скот, богатство',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: ['#...#', '#..#.', '#.#.#', '##.#.', '#.#..', '#....', '#....'],
  },
  {
    name: 'Уруз',
    meaning: 'тур, дикая сила',
    skin: { body: 't', core: 's', charge: 'e' },
    art: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#'],
  },
  {
    name: 'Турисаз',
    meaning: 'шип, великан',
    skin: { body: 's', core: 'e', charge: 'e' },
    art: ['#....', '##...', '#@#..', '#@#..', '##...', '#....', '#....'],
  },
  {
    name: 'Ансуз',
    meaning: 'бог, слово',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: ['#..#.', '#.#..', '##...', '#..#.', '#.#..', '##...', '#....'],
  },
  {
    name: 'Райдо',
    meaning: 'дорога, путь',
    skin: { body: 't', core: 'n', charge: 'e' },
    art: ['###..', '#..#.', '#..#.', '###..', '#.#..', '#..#.', '#...#'],
  },
  {
    name: 'Кеназ',
    meaning: 'факел',
    skin: { body: 'n', core: 'e', charge: 'e' },
    art: ['...#.', '..#..', '.#...', '@....', '.#...', '..#..', '...#.'],
  },
  {
    name: 'Гебо',
    meaning: 'дар',
    skin: { body: 'g', core: 'g', charge: 'e' },
    art: ['#...#', '.#.#.', '..@..', '.#.#.', '#...#', '.....', '.....'],
  },
  {
    name: 'Вуньо',
    meaning: 'радость',
    skin: { body: 'n', core: 'p', charge: 'e' },
    art: ['#.##.', '#@..#', '#.##.', '#....', '#....', '#....', '#....'],
  },
  {
    name: 'Хагалаз',
    meaning: 'град, разрушение',
    skin: { body: 't', core: 'e', charge: 'e' },
    art: ['#...#', '#...#', '#@@@#', '#...#', '#...#', '#...#', '#...#'],
  },
  {
    name: 'Наутиз',
    meaning: 'нужда',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: ['..#..', '..#..', '.@#..', '@@#..', '..#..', '..#..', '..#..'],
  },
  {
    name: 'Иса',
    meaning: 'лёд',
    skin: { body: 's', core: 's', charge: 'e' },
    art: ['..#..', '..#..', '..@..', '..#..', '..@..', '..#..', '..#..'],
  },
  {
    name: 'Йера',
    meaning: 'год, урожай',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: ['.##..', '#..#.', '.#.@.', '..#..', '.@.#.', '#..#.', '.##..'],
  },
  {
    name: 'Соулу',
    meaning: 'солнце',
    skin: { body: 'g', core: 'e', charge: 'e' },
    art: ['..##.', '.##..', '.#...', '..@..', '...#.', '..##.', '.##..'],
  },
  {
    name: 'Тейваз',
    meaning: 'победа',
    skin: { body: 't', core: 'g', charge: 'e' },
    art: ['..#..', '.###.', '##@##', '..#..', '..#..', '..#..', '..#..'],
  },
  {
    name: 'Беркана',
    meaning: 'берёза, рост',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: ['##...', '#@#..', '#@#..', '##...', '#@#..', '#@#..', '##...'],
  },
  {
    name: 'Манназ',
    meaning: 'человек',
    skin: { body: 't', core: 'p', charge: 'e' },
    art: ['#...#', '##.##', '#@#@#', '#...#', '#...#', '#...#', '#...#'],
  },
  {
    name: 'Лагуз',
    meaning: 'вода',
    skin: { body: 'n', core: 's', charge: 'e' },
    art: ['#.##.', '#@#..', '#....', '#....', '#....', '#....', '#....'],
  },
  {
    name: 'Ингваз',
    meaning: 'семя',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: ['..#..', '.#.#.', '#.@.#', '#...#', '#.@.#', '.#.#.', '..#..'],
  },
  {
    name: 'Отала',
    meaning: 'наследие',
    skin: { body: 's', core: 'g', charge: 'e' },
    art: ['..#..', '.#.#.', '#.@.#', '.#.#.', '..#..', '.#.#.', '#...#'],
  },
  {
    name: 'Дагаз',
    meaning: 'рассвет',
    skin: { body: 'n', core: 'e', charge: 'e' },
    art: ['#...#', '##.##', '#.@.#', '#.#.#', '#.@.#', '##.##', '#...#'],
  },
  {
    name: 'Альгиз',
    meaning: 'защита',
    skin: { body: 's', core: 'x', charge: 'e' },
    art: ['#.@.#', '.#@#.', '..#..', '..#..', '..#..', '..#..', '..#..'],
  },
];

/** Two runes with a gap between them: five plus two plus five is exactly the
 *  width of the field. A pair is never a palindrome, so the level keeps its
 *  scatter rather than being mirrored. */
export function runeGlyph(a: Rune, b: Rune): Glyph {
  const art = Array.from({ length: 7 }, (_, r) => `${a.art[r]}..${b.art[r]}`);
  return {
    name: `${a.name} · ${b.name}`,
    idea: `${a.meaning} и ${b.meaning}`,
    skin: a.skin,
    mirror: false,
    thin: true,
    art,
  };
}

// -------------------------------------------------------------------- font --

/** Three by five, which is exactly what fits three letters across a twelve
 *  column field with a gap between them. */
const FONT: Record<string, string[]> = {
  A: ['###', '#.#', '###', '#.#', '#.#'],
  B: ['##.', '#.#', '##.', '#.#', '##.'],
  C: ['###', '#..', '#..', '#..', '###'],
  D: ['##.', '#.#', '#.#', '#.#', '##.'],
  E: ['###', '#..', '##.', '#..', '###'],
  G: ['###', '#..', '#.#', '#.#', '###'],
  H: ['#.#', '#.#', '###', '#.#', '#.#'],
  K: ['#.#', '#.#', '##.', '#.#', '#.#'],
  L: ['#..', '#..', '#..', '#..', '###'],
  N: ['#.#', '###', '###', '###', '#.#'],
  O: ['###', '#.#', '#.#', '#.#', '###'],
  P: ['###', '#.#', '###', '#..', '#..'],
  R: ['###', '#.#', '###', '##.', '#.#'],
  S: ['###', '#..', '###', '..#', '###'],
  T: ['###', '.#.', '.#.', '.#.', '.#.'],
  U: ['#.#', '#.#', '#.#', '#.#', '###'],
  X: ['#.#', '#.#', '.#.', '#.#', '#.#'],
  Y: ['#.#', '#.#', '.#.', '.#.', '.#.'],
  Z: ['###', '..#', '.#.', '#..', '###'],
  '0': ['###', '#.#', '#.#', '#.#', '###'],
  '3': ['###', '..#', '.##', '..#', '###'],
  '4': ['#.#', '#.#', '###', '..#', '..#'],
  '!': ['.#.', '.#.', '.#.', '...', '.#.'],
};

/** Short enough to fit, rude enough to be worth reading. */
export const WORDS: { text: string; idea: string; skin: GlyphSkin }[] = [
  { text: 'DOH', idea: 'имя того, кто ждёт на сотом', skin: { body: 's', core: 'e', charge: 'e' } },
  { text: 'NEO', idea: 'вывеска станции', skin: { body: 't', core: 'g', charge: 'e' } },
  { text: 'SOS', idea: 'кто-то звал на помощь', skin: { body: 'n', core: 'r', charge: 'e' } },
  { text: '404', idea: 'сектор не найден', skin: { body: 't', core: 'x', charge: 'e' } },
  { text: 'XP!', idea: 'обещание отдела кадров', skin: { body: 'g', core: 'g', charge: 'e' } },
  { text: 'GG', idea: 'кто-то уже сдался', skin: { body: 'n', core: 'e', charge: 'e' } },
  { text: 'TNT', idea: 'маркировка склада', skin: { body: 't', core: 'e', charge: 'e' } },
  { text: 'OK', idea: 'подпись неразборчива', skin: { body: 'n', core: 'g', charge: 'e' } },
  { text: 'ZZZ', idea: 'ночная смена', skin: { body: 'n', core: 'r', charge: 'e' } },
  { text: 'HP', idea: 'то, чего вечно не хватает', skin: { body: 'n', core: 'r', charge: 'e' } },
];

/** Renders a word as glyph art. Letters the font does not know are skipped
 *  rather than drawn as holes. */
export function wordArt(text: string): string[] {
  const letters = [...text.toUpperCase()].map((ch) => FONT[ch]).filter((a): a is string[] => !!a);
  if (!letters.length) return [];
  return Array.from({ length: 5 }, (_, row) => letters.map((l) => l[row]).join('.'));
}

/** The centre row of a word gets its core material, so a word is not just an
 *  outline: it has a seam through it that plays differently. */
export function wordGlyph(entry: (typeof WORDS)[number]): Glyph {
  const art = wordArt(entry.text);
  return {
    name: entry.text,
    idea: entry.idea,
    skin: entry.skin,
    mirror: false,
    thin: true,
    art: art.map((row, i) => (i === 2 ? row.replace(/#/g, '@') : row)),
  };
}
