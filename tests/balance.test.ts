// A rough model of a regular player, to keep the trip near the one-week target when numbers change.
// Four short sessions a day (tapping every prompt, buying the cheapest upgrade it can), offline between.
import { describe, expect, it } from 'vitest';
import {
  MAX_OFFLINE_SECONDS, UPGRADES, advance, arrived, autonomyLevel, buy, canBuy, canBuyCoffee, coffee, hurryTow,
  newGame, resolveTakeover, upgradeCost, type GameState,
} from '../src/game';

function session(s: GameState, minutes: number): GameState {
  for (let t = 0; t < minutes * 60; t += 2) {
    s = advance(s, 2, { dadHelps: true });
    if (s.takeover) s = resolveTakeover(s);
    while (s.crash) s = hurryTow(s);
    if (s.tiredness > 0.6 && canBuyCoffee(s)) s = coffee(s);
    for (;;) {
      const next = UPGRADES.filter((u) => canBuy(s, u.id)).sort((a, b) => upgradeCost(s, a.id) - upgradeCost(s, b.id))[0];
      if (!next) break;
      s = buy(s, next.id);
    }
  }
  return s;
}

describe('balance', () => {
  it('a regular player reaches the mountains in about a week, with full self driving near the end', () => {
    let s = newGame(0);
    const plan: [number, number][] = [[8, 10], [12.5, 10], [18, 15], [22, 10]]; // [hour, minutes]
    let now = 8;
    let day = 0;
    const levelAt: Record<number, number> = {};
    for (; day < 14 && !arrived(s); day++) {
      for (const [h, minutes] of plan) {
        const start = day * 24 + h;
        if (start > now) s = advance(s, Math.min((start - now) * 3600, MAX_OFFLINE_SECONDS));
        s = session(s, minutes);
        now = start + minutes / 60;
        levelAt[autonomyLevel(s.levels)] ??= s.odometer;
      }
    }
    expect(day).toBeGreaterThanOrEqual(5);
    expect(day).toBeLessThanOrEqual(9);
    expect(levelAt[5]).toBeGreaterThan(1200);
  });
});
