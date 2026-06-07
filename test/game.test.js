import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction, legalActions, viewFor, _internals } from '../server/game.js';

const P3 = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];

test('createGame deals hands and sets trump', () => {
  const g = createGame(P3, { deckSize: 36, handSize: 6 });
  assert.equal(g.players.length, 3);
  for (const p of g.players) assert.equal(p.hand.length, 6);
  assert.equal(g.deck.length, 18);
  assert.ok(['S', 'H', 'D', 'C'].includes(g.trumpSuit));
});

test('canBeat respects suit, rank and trumps', () => {
  const g = createGame(P3, { deckSize: 36, handSize: 6 });
  g.trumpSuit = 'S';
  const { canBeat } = _internals;
  assert.equal(canBeat('7H', '9H', g), true);
  assert.equal(canBeat('9H', '7H', g), false);
  assert.equal(canBeat('7H', '6S', g), true);
  assert.equal(canBeat('7S', '6H', g), false);
  assert.equal(canBeat('7S', '9S', g), true);
});

test('roles: left=primary opener, right=secondary', () => {
  const g = createGame(P3, { deckSize: 36, handSize: 6 });
  // defender is index 1's neighbour setup; verify primary is before defender, secondary after
  const D = g.defenderIndex;
  assert.equal(g.primaryIndex, (D + g.players.length - 1) % g.players.length);
  assert.equal(g.secondaryIndex, (D + 1) % g.players.length);
  assert.equal(g.priorityIndex, g.primaryIndex);
});

test('left priority: secondary cannot attack until primary is Done', () => {
  const g = createGame(P3, { deckSize: 36, handSize: 6 });
  g.trumpSuit = 'S';
  g.defenderIndex = 1; setRoles(g);
  g.players[0].hand = ['7H', '7D']; // primary (left)
  g.players[1].hand = ['9H', '9D']; // defender (keeps a spare card)
  g.players[2].hand = ['7C'];       // secondary (right)
  g.deck = [];

  // opener attacks
  assert.ok(applyAction(g, 'a', { type: 'attack', cards: ['7H'] }).ok);
  // C (secondary) cannot attack while undefended / not their priority
  assert.deepEqual(legalActions(g, 'c'), []);
  // defender beats
  assert.ok(applyAction(g, 'b', { type: 'defend', attackIndex: 0, card: '9H' }).ok);
  // now primary has priority; secondary still cannot act
  assert.deepEqual(legalActions(g, 'c'), []);
  assert.ok(legalActions(g, 'a').includes('done'));
  // primary says done -> secondary may now attack
  assert.ok(applyAction(g, 'a', { type: 'done' }).ok);
  assert.ok(legalActions(g, 'c').includes('attack'));
});

function setRoles(g) {
  const n = g.players.length;
  g.primaryIndex = (g.defenderIndex + n - 1) % n;
  g.secondaryIndex = (g.defenderIndex + 1) % n === g.primaryIndex ? -1 : (g.defenderIndex + 1) % n;
  g.priorityIndex = g.primaryIndex;
}

test('transfer moves defence to the next player', () => {
  const g = createGame(P3, { deckSize: 36, handSize: 6 });
  g.trumpSuit = 'S';
  g.defenderIndex = 1; setRoles(g);
  g.players[0].hand = ['7H'];
  g.players[1].hand = ['7D', '9H'];
  g.players[2].hand = ['8C', '8D', '9C'];
  g.deck = [];
  assert.ok(applyAction(g, 'a', { type: 'attack', cards: ['7H'] }).ok);
  assert.ok(legalActions(g, 'b').includes('transfer'));
  assert.ok(applyAction(g, 'b', { type: 'transfer', cards: ['7D'] }).ok);
  assert.equal(g.defenderIndex, 2);
  assert.equal(g.table.length, 2);
});

test('viewFor hides other hands and exposes turn info', () => {
  const g = createGame(P3, { deckSize: 36, handSize: 6 });
  const v = viewFor(g, 'a');
  assert.ok(Array.isArray(v.players.find((p) => p.id === 'a').hand));
  assert.equal(v.players.find((p) => p.id === 'b').hand, undefined);
  assert.ok(v.toActId);
  assert.ok(v.primaryId);
});
