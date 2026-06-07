import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction } from '../server/game.js';
import { chooseBotAction } from '../server/bot.js';

function playOut(players, options) {
  const g = createGame(players, options);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 20000) {
    let acted = false;
    for (const p of g.players) {
      const act = chooseBotAction(g, p.id);
      if (act) {
        const r = applyAction(g, p.id, act);
        assert.ok(r.ok, `illegal bot move ${JSON.stringify(act)} (${r.error})`);
        acted = true;
        break;
      }
    }
    if (!acted) break;
  }
  return { g, guard };
}

test('all-bot games terminate for 2..12 players (with jokers)', () => {
  for (let n = 2; n <= 12; n++) {
    const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true }));
    for (let trial = 0; trial < 6; trial++) {
      const { g, guard } = playOut(players, { deckSize: 52, handSize: 6, jokers: true });
      assert.equal(g.phase, 'finished', `n=${n} trial=${trial} did not finish (guard=${guard})`);
      assert.ok(guard < 20000, `n=${n} possible loop`);
    }
  }
});

test('all-bot games terminate across deck/hand configs', () => {
  const configs = [
    { deckSize: 36, handSize: 6 },
    { deckSize: 52, handSize: 8 },
    { deckSize: 24, handSize: 5 },
    { deckSize: 36, handSize: 4 },
  ];
  for (const c of configs) {
    for (const n of [2, 3, 5, 8]) {
      const players = Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true }));
      for (let trial = 0; trial < 4; trial++) {
        const { g } = playOut(players, { ...c, jokers: true });
        assert.equal(g.phase, 'finished', `config ${JSON.stringify(c)} n=${n} did not finish`);
      }
    }
  }
});

test('card conservation: total cards constant through a game', () => {
  const players = Array.from({ length: 5 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, isBot: true }));
  const g = createGame(players, { deckSize: 52, handSize: 6, jokers: true });
  const total = () => g.deck.length + g.discardCount
    + g.players.reduce((s, p) => s + p.hand.length, 0)
    + g.table.reduce((s, t) => s + 1 + (t.defense ? 1 : 0), 0);
  const start = total();
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 20000) {
    let acted = false;
    for (const p of g.players) {
      const act = chooseBotAction(g, p.id);
      if (act) { assert.ok(applyAction(g, p.id, act).ok); acted = true; break; }
    }
    assert.equal(total(), start, 'card count must stay constant');
    if (!acted) break;
  }
  assert.equal(g.phase, 'finished');
});
