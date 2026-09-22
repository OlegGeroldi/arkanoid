import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { join } from 'node:path';
import { AVATARS, BOT } from './constants.js';

export class AccountError extends Error {}

const hashPin = (pin, salt) => scryptSync(pin, salt, 32).toString('hex');
const pub = (a) => ({ id: a.id, name: a.name, avatar: a.avatar, stats: { ...a.stats } });

export async function createAccountStore(dir) {
  const file = join(dir, 'players.json');
  let accounts = [];
  try {
    accounts = JSON.parse(await readFile(file, 'utf8')).accounts ?? [];
  } catch (err) {
    if (err.code !== 'ENOENT') throw err;
  }

  async function save() {
    await mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    await writeFile(tmp, JSON.stringify({ accounts }, null, 2), 'utf8');
    await rename(tmp, file);
  }

  return {
    list: () => accounts.map(pub),

    async register({ name, avatar, pin }) {
      const clean = String(name ?? '').trim();
      if (clean.length < 1 || clean.length > 16) throw new AccountError('Name must be 1–16 characters.');
      if (clean.toLowerCase() === BOT.name.toLowerCase()) throw new AccountError('That name belongs to the bot.');
      if (accounts.some((a) => a.name.toLowerCase() === clean.toLowerCase())) throw new AccountError('That name is taken.');
      if (!/^\d{4}$/.test(String(pin ?? ''))) throw new AccountError('PIN must be exactly 4 digits.');
      const salt = randomBytes(16).toString('hex');
      const acc = {
        id: `u${randomBytes(6).toString('hex')}`,
        name: clean,
        avatar: AVATARS.includes(avatar) ? avatar : AVATARS[0],
        salt,
        hash: hashPin(String(pin), salt),
        stats: { matches: 0, wins: 0, best: 0 },
        createdAt: Date.now(),
      };
      accounts.push(acc);
      await save();
      return pub(acc);
    },

    verify(id, pin) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc || !/^\d{4}$/.test(String(pin ?? ''))) return null;
      const ok = timingSafeEqual(Buffer.from(hashPin(String(pin), acc.salt), 'hex'), Buffer.from(acc.hash, 'hex'));
      return ok ? pub(acc) : null;
    },

    async recordMatch(id, { won, score }) {
      const acc = accounts.find((a) => a.id === id);
      if (!acc) return;
      acc.stats.matches += 1;
      if (won) acc.stats.wins += 1;
      acc.stats.best = Math.max(acc.stats.best, score);
      await save();
    },
  };
}
