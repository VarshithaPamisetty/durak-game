import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction } from '../server/game.js';
import { chooseBotAction } from '../server/bot.js';

function playOut(players, options) {
  const g = createGame(players, options);
  let guard = 0;
  while (g.phase === 'playing' && guard++ < 5000) {
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

test('2-player all-bot game terminates legally', () => {
  const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const { g } = playOut(players, { deckSize: 36, handSize: 6 });
  assert.equal(g.phase, 'finished');
});

test('various configs all terminate', () => {
  const configs = [
    { n: 3, deckSize: 36, handSize: 6 },
    { n: 4, deckSize: 52, handSize: 6 },
    { n: 2, deckSize: 24, handSize: 5 },
    { n: 6, deckSize: 52, handSize: 8 },
  ];
  for (const c of configs) {
    const players = Array.from({ length: c.n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));
    // run a few times since deals are random
    for (let trial = 0; trial < 5; trial++) {
      const { g } = playOut(players, { deckSize: c.deckSize, handSize: c.handSize });
      assert.equal(g.phase, 'finished', `config ${JSON.stringify(c)} did not finish`);
    }
  }
});
