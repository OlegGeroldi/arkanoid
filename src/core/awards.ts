import { Rng } from './rng';

/** One-off, real-world flavor awards read out once the whole party is over —
 *  not per round (that would repeat constantly and go stale fast), just once
 *  at the very end, based on final standings. Pure content + a deterministic
 *  pick, same discipline as everything else in `core/`: every screen derives
 *  the identical result from the same match seed, no extra wire message
 *  needed. `{target}` in a `RUNNER_UP_AWARDS` entry is replaced with the
 *  second-to-last racer's name by whoever renders it. */

export const CHAMPION_AWARDS: string[] = [
  'Sole control of the music for the next 15 minutes',
  'Gets to overturn one rival debuff, no questions asked, once tonight',
  'First pick of the comfiest seat',
  'Officially declared "Brain of the Evening" — everyone must address them as "Your Brainliness" at least once',
  'May declare the next hangout a bonus one — and picks the time',
  'Gets a joke crown (build it from whatever is on hand) for the rest of the night',
  'Writes the warm-up question for everyone next time',
  'May skip one turn once, with no point loss',
  'Hosts the awards ceremony if there is a next hangout',
  'May give one player a hint next round',
  'Everyone toasts the champion — with whatever is around',
  'Gets an honorary certificate "for services to fun" (draw it on a napkin)',
  'May claim the best seat in the room',
  'Declared host of the evening — gets served tea/coffee first',
  'May once rule any disputed answer correct, no reason given',
];

/** `{target}` = the racer ranked second-to-last. */
export const RUNNER_UP_AWARDS: string[] = [
  'Takes {target}\'s pen for the rest of the night',
  'Swaps seats with {target}',
  'Gives {target} a joke nickname for the rest of the night',
  'May once call "miss" on any answer from {target}, even a correct one',
  '{target} must call 2nd place "boss" for the rest of the night',
  'Swaps an accessory with {target} for one round (hat, glasses — whatever is around)',
  'Picks the next song instead of {target}',
  '{target} brings 2nd place tea or water',
  'Takes {target}\'s best candy from the bowl',
  'Assigns {target} one silly "homework" task for next round',
  '{target} must sincerely compliment 2nd place out loud, once',
  'Gets {target}\'s vote in the next disputed question',
  '{target} must impersonate the champion in a joke interview',
  'Takes {target}\'s spot in line for the next round',
  'May take one banked booster from {target}, no reason given',
];

export const LAST_PLACE_AWARDS: string[] = [
  'Buys everyone a small snack from the vending machine',
  'Reads the next question aloud in a news-anchor voice',
  'Answers with gestures only for one round',
  'Gives a toast in the champion\'s honor',
  'Names the party, for the record',
  'Does a victory dance as if they won',
  'Hands out joke titles to everyone at the end of the night',
  'Must answer only with a question, once tonight',
  'Delivers an impromptu speech praising the champion',
  'Collects the cups/trash after the game',
  'Invents their own penalty for the next game',
  'Serves tea or water to everyone else',
  'Must smile in every photo taken tonight',
  'Gets the joke title "Spirit of the Evening"',
  'Keeps the evening\'s chronicle — writes down the funniest moments',
];

export interface MatchAwards {
  championId: string;
  championText: string;
  lastId: string;
  lastText: string;
  /** Only set once there are at least 4 racers — with fewer, "2nd place" and
   *  "second-to-last" would be the same person. */
  runnerUp?: { runnerUpId: string; targetId: string; text: string };
}

/** `rankedIds` — every racer's id, best score first. Deterministic: the same
 *  seed and the same final ranking always draws the same set of lines,
 *  everywhere — nobody (host included) picks these by hand, they just fall
 *  out of the match's own seed once it's over. */
export function pickMatchAwards(seed: number, rankedIds: string[]): MatchAwards | null {
  if (rankedIds.length < 2) return null;
  const rng = new Rng((seed ^ 0x41776430) >>> 0);
  const championId = rankedIds[0];
  const lastId = rankedIds[rankedIds.length - 1];
  const championText = rng.pick(CHAMPION_AWARDS);
  const lastText = rng.pick(LAST_PLACE_AWARDS);
  const runnerUp =
    rankedIds.length >= 4
      ? { runnerUpId: rankedIds[1], targetId: rankedIds[rankedIds.length - 2], text: rng.pick(RUNNER_UP_AWARDS) }
      : undefined;
  return { championId, championText, lastId, lastText, runnerUp };
}
