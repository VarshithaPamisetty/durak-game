import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction, legalActions, viewFor, _internals } from '../server/game.js';

const players = [
  { id: 'a', name: 'A' },
  { id: 'b', name: 'B' },
  { id: 'c', name: 'C' },
];

test('createGame deals correct hands and sets trump', () => {
  const g = createGame(players, { deckSize: 36, handSize: 6 });
  assert.equal(g.players.length, 3);
  for (const p of g.players) assert.equal(p.hand.length, 6);
  // 36 - 18 dealt = 18 remaining
  assert.equal(g.deck.length, 18);
  assert.ok(['S', 'H', 'D', 'C'].includes(g.trumpSuit));
});

test('canBeat respects suit, rank and trumps', () => {
  const g = createGame(players, { deckSize: 36, handSize: 6 });
  g.trumpSuit = 'S';
  const { canBeat } = _internals;
  assert.equal(canBeat('7H', '9H', g), true);   // higher same suit
  assert.equal(canBeat('9H', '7H', g), false);  // lower same suit
  assert.equal(canBeat('7H', '6S', g), true);   // trump beats non-trump
  assert.equal(canBeat('7S', '6H', g), false);  // non-trump can't beat trump
  assert.equal(canBeat('7S', '9S', g), true);   // higher trump beats trump
});

test('full attack -> defend -> done discards cards', () => {
  const g = createGame(players, { deckSize: 36, handSize: 6 });
  // Force a deterministic setup.
  g.trumpSuit = 'S';
  g.attackerIndex = 0; g.defenderIndex = 1;
  g.players[0].hand = ['7H', '8D'];
  g.players[1].hand = ['9H', '10C'];
  g.players[2].hand = ['6C'];
  g.deck = []; // no refill, deck empty
  g.discardCount = 0;

  let r = applyAction(g, 'a', { type: 'attack', cards: ['7H'] });
  assert.ok(r.ok, r.error);
  r = applyAction(g, 'b', { type: 'defend', attackIndex: 0, card: '9H' });
  assert.ok(r.ok, r.error);
  // attacker says done; only one active attacker with cards (C also can be attacker)
  applyAction(g, 'a', { type: 'done' });
  applyAction(g, 'c', { type: 'done' });
  assert.equal(g.table.length, 0);
  assert.equal(g.discardCount, 2);
});

test('transfer moves defense to next player', () => {
  const g = createGame(players, { deckSize: 36, handSize: 6 });
  g.trumpSuit = 'S';
  g.attackerIndex = 0; g.defenderIndex = 1;
  g.players[0].hand = ['7H'];
  g.players[1].hand = ['7D', '9H'];
  g.players[2].hand = ['8C', '8D', '9C'];
  g.deck = [];

  let r = applyAction(g, 'a', { type: 'attack', cards: ['7H'] });
  assert.ok(r.ok, r.error);
  assert.ok(legalActions(g, 'b').includes('transfer'), 'B should be able to transfer a 7');
  r = applyAction(g, 'b', { type: 'transfer', cards: ['7D'] });
  assert.ok(r.ok, r.error);
  assert.equal(g.defenderIndex, 2, 'defender should now be C');
  assert.equal(g.table.length, 2);
});

test('viewFor hides other hands', () => {
  const g = createGame(players, { deckSize: 36, handSize: 6 });
  const view = viewFor(g, 'a');
  const me = view.players.find((p) => p.id === 'a');
  const other = view.players.find((p) => p.id === 'b');
  assert.ok(Array.isArray(me.hand));
  assert.equal(other.hand, undefined);
  assert.equal(other.handCount, 6);
});
