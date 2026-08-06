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
  /** What the shape is about, shown in the level's name. */
  idea: string;
}

/** Hearts, skulls and bombs. Eleven columns wide at most, so they centre in a
 *  twelve-column field with a margin. */
export const GLYPHS: Glyph[] = [
  {
    name: 'Сердце',
    idea: 'сердцевина регенерирует, внутри заряд',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: [
      '.###...###.',
      '##@@#.#@@##',
      '##@@@#@@@##',
      '###**@**###',
      '.#########.',
      '..#######..',
      '...#####...',
      '....###....',
      '.....#.....',
    ],
  },
  {
    name: 'Бомба',
    idea: 'фитиль из зарядов уходит в корпус',
    skin: { body: 't', core: 'e', charge: 'e' },
    art: [
      '........*..',
      '.......*...',
      '......*....',
      '...#####...',
      '..#######..',
      '.##@@@@@##.',
      '.##@@@@@##.',
      '..#######..',
      '...#####...',
    ],
  },
  {
    name: 'Череп',
    idea: 'глазницы не бьются, челюсть взрывается',
    skin: { body: 'n', core: 'x', charge: 'e' },
    art: [
      '..#######..',
      '.#########.',
      '##@@#.#@@##',
      '##@@#.#@@##',
      '###########',
      '.###***###.',
      '..#######..',
      '...#.#.#...',
    ],
  },
  {
    name: 'Захватчик',
    idea: 'классический пришелец с начинкой',
    skin: { body: 't', core: 'g', charge: 'e' },
    art: [
      '..#.....#..',
      '...#...#...',
      '..#######..',
      '.##.###.##.',
      '###@###@###',
      '#.#######.#',
      '#.#.....#.#',
      '...##.##...',
    ],
  },
  {
    name: 'Звезда',
    idea: 'ядро под слоем брони',
    skin: { body: 's', core: 'g', charge: 'e' },
    art: [
      '.....#.....',
      '....###....',
      '#####*#####',
      '.####@####.',
      '..#######..',
      '...#####...',
      '..##...##..',
      '.##.....##.',
    ],
  },
  {
    name: 'Смайл',
    idea: 'глаза регенерируют, улыбка взрывная',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: [
      '..#######..',
      '.#########.',
      '##@#####@##',
      '##@#####@##',
      '###########',
      '##*#####*##',
      '.#*******#.',
      '..#######..',
    ],
  },
  {
    name: 'Стрела',
    idea: 'наконечник взрывается, древко держит',
    skin: { body: 't', core: 's', charge: 'e' },
    art: [
      '.....*.....',
      '....***....',
      '...#####...',
      '..#######..',
      '.####*####.',
      '....@@@....',
      '....@@@....',
      '....@@@....',
    ],
  },
  {
    name: 'Призрак',
    idea: 'сквозь него не пройти, глаза золотые',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: [
      '..#######..',
      '.#########.',
      '##@###@####',
      '##@###@####',
      '###########',
      '###*###*###',
      '###########',
      '#.##.##.##.',
    ],
  },
  {
    name: 'Реактор',
    idea: 'кольцо брони вокруг живого ядра',
    skin: { body: 's', core: 'r', charge: 'e' },
    art: [
      '...#####...',
      '..##...##..',
      '.##..*..##.',
      '##..@@@..##',
      '##.@@@@@.##',
      '##..@@@..##',
      '.##..*..##.',
      '..##...##..',
      '...#####...',
    ],
  },
  {
    name: 'Мина',
    idea: 'шипы наружу, заряд внутри',
    skin: { body: 's', core: 'e', charge: 'e' },
    art: [
      '..#..#..#..',
      '...#.#.#...',
      '..#######..',
      '.#@@@@@@@#.',
      '#.@@@@@@@.#',
      '.#@@@@@@@#.',
      '..#######..',
      '...#.#.#...',
    ],
  },
];

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
    art: art.map((row, i) => (i === 2 ? row.replace(/#/g, '@') : row)),
  };
}
