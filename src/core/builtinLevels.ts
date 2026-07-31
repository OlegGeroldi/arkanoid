import type { LevelData } from './level';
import { normalizeLevel } from './level';

/** Built-in campaign. Rows are 12 characters wide; see BRICK_KINDS for codes. */
const RAW: Omit<LevelData, 'id'>[] = [
  {
    name: 'Пробуждение',
    rows: [
      '............',
      '............',
      'nnnnnnnnnnnn',
      'nnnnnnnnnnnn',
      '.nnnnnnnnnn.',
      '..nnnnnnnn..',
    ],
    ballSpeed: 0.9,
  },
  {
    name: 'Ступени',
    rows: [
      '............',
      'nn..........',
      'nnnn........',
      'nnnntt......',
      '..nnnntt....',
      '....nnnntt..',
      '......nnnnpn',
      '........nnnn',
    ],
  },
  {
    name: 'Улей',
    rows: [
      '............',
      '.tt..tt..tt.',
      'tnntnnntnnt.',
      '.tt..tt..tt.',
      'tnntnnntnnt.',
      '.tt.gtt..tt.',
      'tnntnnntnnt.',
      '.tt..tt..tt.',
    ],
    ballSpeed: 1.05,
  },
  {
    name: 'Крепость',
    rows: [
      '............',
      'xxnnnnnnnnxx',
      'xnttttttttnx',
      'nts......stn',
      'nts.gppg.stn',
      'nts......stn',
      'xnttttttttnx',
      'xxnnnnnnnnxx',
    ],
    ballSpeed: 1.05,
  },
  {
    name: 'Фейерверк',
    rows: [
      '............',
      '..e......e..',
      '.nnn....nnn.',
      'nnnnn..nnnnn',
      '.nnn.ee.nnn.',
      '..n.nnnn.n..',
      '....nnnn....',
      '.....ee.....',
    ],
    ballSpeed: 1.1,
  },
  {
    name: 'Сад камней',
    rows: [
      '............',
      'rr.rr..rr.rr',
      '.tt..tt..tt.',
      'nn.gnn.nn.gn',
      '.tt..tt..tt.',
      'rr.rr..rr.rr',
      '....ppp.....',
      '.ssssssssss.',
    ],
    ballSpeed: 1.1,
  },
  {
    name: 'Сокровищница',
    rows: [
      '............',
      'ssssssssssss',
      's.gggggggg.s',
      's.gxxxxxxg.s',
      's.gx.pp.xg.s',
      's.gxxxxxxg.s',
      's.gggggggg.s',
      'ssssssssssss',
    ],
    ballSpeed: 1.15,
  },
  {
    name: 'Череп',
    rows: [
      '..ssssssss..',
      '.snnnnnnnns.',
      'snn.nnnn.nns',
      'sn..nnnn..ns',
      'snnnnnnnnnns',
      'snn.n..n.nns',
      '.sn.n..n.ns.',
      '..ssssssss..',
      '...e.gg.e...',
    ],
    ballSpeed: 1.2,
  },
  {
    name: 'Лабиринт',
    rows: [
      'xnnnnnnnnnnx',
      'x.x.x.x.x..x',
      'ntnrn.ntn.tn',
      'x.x.x.x.x..x',
      'nt.ntn.ntntn',
      'x..x.x.x.x.x',
      'ngn.ntn.nrn.',
      'x.x.x..x.x.x',
      'nnnnppnnnnnn',
    ],
    ballSpeed: 1.2,
  },
  {
    name: 'DOH',
    rows: [
      '...ssssss...',
      '..sxxxxxxs..',
      '.sxggggggxs.',
      'sxg.tt.tt.gx',
      'sxg.tt.tt.gx',
      'sxgggggggggx',
      'sxg.eeeeee.x',
      '.sxg.pppp.xs',
      '..sxxxxxxs..',
      '...ssssss...',
    ],
    ballSpeed: 1.25,
  },
];

export const BUILTIN_LEVELS: LevelData[] = RAW.map((raw, i) => {
  const level = normalizeLevel({ ...raw, id: `builtin-${i + 1}`, author: 'NEONOID' }, `builtin-${i + 1}`);
  if (!level) throw new Error(`built-in level ${i + 1} is malformed`);
  return level;
});
