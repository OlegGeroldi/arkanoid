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
    name: 'Heart',
    idea: 'the core regenerates, charge inside',
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
    name: 'Bomb',
    idea: 'two fuses meet at the body',
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
    name: 'Skull',
    idea: 'the eye sockets do not break, the jaw explodes',
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
    name: 'Invader',
    idea: 'a classic alien with a filling',
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
    name: 'Star',
    idea: 'a core under a layer of armor',
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
    name: 'Smiley',
    idea: 'the eyes regenerate, the smile is explosive',
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
    name: 'Arrow',
    idea: 'the head explodes, the shaft holds',
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
    name: 'Ghost',
    idea: 'you cannot pass through it, its eyes are gold',
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
    name: 'Reactor',
    idea: 'a ring of armor around a living core',
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
    name: 'Mine',
    idea: 'spikes outward, charge inside',
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
    name: 'Fehu',
    meaning: 'cattle, wealth',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: ['#...#', '#..#.', '#.#.#', '##.#.', '#.#..', '#....', '#....'],
  },
  {
    name: 'Uruz',
    meaning: 'aurochs, wild strength',
    skin: { body: 't', core: 's', charge: 'e' },
    art: ['####.', '#...#', '#...#', '#...#', '#...#', '#...#', '#...#'],
  },
  {
    name: 'Thurisaz',
    meaning: 'thorn, giant',
    skin: { body: 's', core: 'e', charge: 'e' },
    art: ['#....', '##...', '#@#..', '#@#..', '##...', '#....', '#....'],
  },
  {
    name: 'Ansuz',
    meaning: 'god, word',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: ['#..#.', '#.#..', '##...', '#..#.', '#.#..', '##...', '#....'],
  },
  {
    name: 'Raido',
    meaning: 'road, journey',
    skin: { body: 't', core: 'n', charge: 'e' },
    art: ['###..', '#..#.', '#..#.', '###..', '#.#..', '#..#.', '#...#'],
  },
  {
    name: 'Kenaz',
    meaning: 'torch',
    skin: { body: 'n', core: 'e', charge: 'e' },
    art: ['...#.', '..#..', '.#...', '@....', '.#...', '..#..', '...#.'],
  },
  {
    name: 'Gebo',
    meaning: 'gift',
    skin: { body: 'g', core: 'g', charge: 'e' },
    art: ['#...#', '.#.#.', '..@..', '.#.#.', '#...#', '.....', '.....'],
  },
  {
    name: 'Wunjo',
    meaning: 'joy',
    skin: { body: 'n', core: 'p', charge: 'e' },
    art: ['#.##.', '#@..#', '#.##.', '#....', '#....', '#....', '#....'],
  },
  {
    name: 'Hagalaz',
    meaning: 'hail, destruction',
    skin: { body: 't', core: 'e', charge: 'e' },
    art: ['#...#', '#...#', '#@@@#', '#...#', '#...#', '#...#', '#...#'],
  },
  {
    name: 'Nauthiz',
    meaning: 'need',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: ['..#..', '..#..', '.@#..', '@@#..', '..#..', '..#..', '..#..'],
  },
  {
    name: 'Isa',
    meaning: 'ice',
    skin: { body: 's', core: 's', charge: 'e' },
    art: ['..#..', '..#..', '..@..', '..#..', '..@..', '..#..', '..#..'],
  },
  {
    name: 'Jera',
    meaning: 'year, harvest',
    skin: { body: 'n', core: 'g', charge: 'e' },
    art: ['.##..', '#..#.', '.#.@.', '..#..', '.@.#.', '#..#.', '.##..'],
  },
  {
    name: 'Sowilo',
    meaning: 'sun',
    skin: { body: 'g', core: 'e', charge: 'e' },
    art: ['..##.', '.##..', '.#...', '..@..', '...#.', '..##.', '.##..'],
  },
  {
    name: 'Tiwaz',
    meaning: 'victory',
    skin: { body: 't', core: 'g', charge: 'e' },
    art: ['..#..', '.###.', '##@##', '..#..', '..#..', '..#..', '..#..'],
  },
  {
    name: 'Berkana',
    meaning: 'birch, growth',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: ['##...', '#@#..', '#@#..', '##...', '#@#..', '#@#..', '##...'],
  },
  {
    name: 'Mannaz',
    meaning: 'man',
    skin: { body: 't', core: 'p', charge: 'e' },
    art: ['#...#', '##.##', '#@#@#', '#...#', '#...#', '#...#', '#...#'],
  },
  {
    name: 'Laguz',
    meaning: 'water',
    skin: { body: 'n', core: 's', charge: 'e' },
    art: ['#.##.', '#@#..', '#....', '#....', '#....', '#....', '#....'],
  },
  {
    name: 'Ingwaz',
    meaning: 'seed',
    skin: { body: 'n', core: 'r', charge: 'e' },
    art: ['..#..', '.#.#.', '#.@.#', '#...#', '#.@.#', '.#.#.', '..#..'],
  },
  {
    name: 'Othala',
    meaning: 'heritage',
    skin: { body: 's', core: 'g', charge: 'e' },
    art: ['..#..', '.#.#.', '#.@.#', '.#.#.', '..#..', '.#.#.', '#...#'],
  },
  {
    name: 'Dagaz',
    meaning: 'dawn',
    skin: { body: 'n', core: 'e', charge: 'e' },
    art: ['#...#', '##.##', '#.@.#', '#.#.#', '#.@.#', '##.##', '#...#'],
  },
  {
    name: 'Algiz',
    meaning: 'protection',
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
    idea: `${a.meaning} and ${b.meaning}`,
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
  { text: 'DOH', idea: 'the name of the one waiting at the hundredth', skin: { body: 's', core: 'e', charge: 'e' } },
  { text: 'NEO', idea: 'a station sign', skin: { body: 't', core: 'g', charge: 'e' } },
  { text: 'SOS', idea: 'someone called for help', skin: { body: 'n', core: 'r', charge: 'e' } },
  { text: '404', idea: 'sector not found', skin: { body: 't', core: 'x', charge: 'e' } },
  { text: 'XP!', idea: 'a promise from HR', skin: { body: 'g', core: 'g', charge: 'e' } },
  { text: 'GG', idea: 'someone already gave up', skin: { body: 'n', core: 'e', charge: 'e' } },
  { text: 'TNT', idea: 'a warehouse marking', skin: { body: 't', core: 'e', charge: 'e' } },
  { text: 'OK', idea: 'a signature you cannot read', skin: { body: 'n', core: 'g', charge: 'e' } },
  { text: 'ZZZ', idea: 'the night shift', skin: { body: 'n', core: 'r', charge: 'e' } },
  { text: 'HP', idea: 'the thing you never have enough of', skin: { body: 'n', core: 'r', charge: 'e' } },
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
