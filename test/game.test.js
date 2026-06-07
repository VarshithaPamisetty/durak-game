import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction, legalActions, viewFor, isJoker, RED_JOKER, BLACK_JOKER, _internals } from '../server/game.js';

const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));

function setRoles(g, defenderIndex) {
  const n = g.players.length;
  g.defenderIndex = defenderIndex;
  g.primaryIndex = (defenderIndex + n - 1) % n;
  const sec = (defenderIndex + 1) % n;
  g.secondaryIndex = sec === g.primaryIndex ? -1 : sec;
  g.done = []; g.jokerUsed = false; g.takeMode = false; g.table = [];
}

test('deck has 2 jokers; trump never a joker; adaptive hand size', () => {
  const g = createGame(P(10), { deckSize: 52, handSize: 6 });
  assert.equal(g.handSize, 5);
  assert.equal(isJoker(g.trumpCard), false);
  const all = [...g.deck, ...g.players.flatMap((p) => p.hand)];
  assert.ok(all.includes(RED_JOKER) && all.includes(BLACK_JOKER));
});

test('closing a bout requires EVERY active player to press Done', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1); g.trumpSuit = 'S';
  g.players[0].hand = ['7H', '7S']; // primary
  g.players[1].hand = ['9H', '9D']; // defender
  g.players[2].hand = ['KC', 'KS']; // secondary
  g.deck = ['2H', '2D', '2C', '2S', '3H', '3D'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['7H'] }).ok);
  assert.ok(applyAction(g, 'p1', { type: 'defend', attackIndex: 0, card: '9H' }).ok);
  // closing — all three must confirm
  assert.ok(legalActions(g, 'p0').includes('done'));
  assert.ok(legalActions(g, 'p1').includes('done'));
  assert.ok(legalActions(g, 'p2').includes('done'));
  assert.ok(applyAction(g, 'p0', { type: 'done' }).ok);
  assert.equal(g.table.length, 1, 'not closed yet (p1,p2 pending)');
  assert.ok(applyAction(g, 'p2', { type: 'done' }).ok);
  assert.equal(g.table.length, 1, 'still not closed (p1 pending)');
  assert.ok(applyAction(g, 'p1', { type: 'done' }).ok);
  assert.equal(g.table.length, 0, 'closed when everyone confirmed');
});

test('left priority then right; right may add multiple cards at once', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1); g.trumpSuit = 'S';
  g.players[0].hand = ['7H', '9S']; // primary opens 7H, then can add a 9 but passes
  g.players[1].hand = ['9H', '9D', 'AS']; // defender
  g.players[2].hand = ['7C', '9C']; // secondary can add a 7 AND a 9 together
  g.deck = ['2H', '2C', '3H', '3C', '4H', '4C'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['7H'] }).ok);
  assert.ok(applyAction(g, 'p1', { type: 'defend', attackIndex: 0, card: '9H' }).ok);
  // p0 has priority to add; p2 cannot add yet
  assert.ok(legalActions(g, 'p0').includes('attack'));
  assert.equal(legalActions(g, 'p2').includes('attack'), false);
  assert.ok(applyAction(g, 'p0', { type: 'done' }).ok); // primary passes
  // now p2 may add, and can add both a 7 and a 9 at once
  assert.ok(legalActions(g, 'p2').includes('attack'));
  assert.ok(applyAction(g, 'p2', { type: 'attack', cards: ['7C', '9C'] }).ok);
  assert.equal(g.table.length, 3);
  assert.equal(_internals.undefendedCount(g), 2);
});

test('jokers cannot attack; joker beats by colour; two-step finish pushes rest', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1); g.trumpSuit = 'S';
  g.players[0].hand = ['6C', '6D'];
  g.players[1].hand = [BLACK_JOKER, 'AS'];
  g.players[2].hand = ['7C', '8C', '9C'];
  g.deck = ['2H', '2D', '2C', '2S', '3H', '3D'];
  assert.equal(applyAction(g, 'p0', { type: 'attack', cards: [BLACK_JOKER] }).ok, false);
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['6C', '6D'] }).ok);
  assert.ok(applyAction(g, 'p1', { type: 'jokerdefend', attackIndex: 0, card: BLACK_JOKER }).ok);
  assert.equal(g.table.length, 2, 'still going after joker');
  assert.ok(legalActions(g, 'p1').includes('done'));
  assert.ok(applyAction(g, 'p1', { type: 'done' }).ok); // finish
  assert.ok(g.players[0].hand.includes('6D'), 'undefended pushed to previous player');
  assert.equal(g.table.length, 0);
});

test('load-the-taker: neighbours add, all confirm, taker picks up all', () => {
  const g = createGame(P(4), { deckSize: 52, handSize: 6 });
  setRoles(g, 1); g.trumpSuit = 'S';
  g.players[0].hand = ['6C', '6D'];
  g.players[1].hand = ['9S'];   // defender takes
  g.players[2].hand = ['6H', '6S'];
  g.players[3].hand = ['7D'];   // across — cannot add
  g.deck = ['2H', '2D', '2C', '3H', '3D', '3C', '4H', '4D'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['6C'] }).ok);
  assert.ok(applyAction(g, 'p1', { type: 'take' }).ok);
  assert.equal(g.takeMode, true);
  assert.equal(legalActions(g, 'p3').includes('attack'), false, 'across cannot add');
  assert.ok(applyAction(g, 'p0', { type: 'done' }).ok);     // primary passes adding
  assert.ok(legalActions(g, 'p2').includes('attack'));
  assert.ok(applyAction(g, 'p2', { type: 'attack', cards: ['6H'] }).ok);
  // confirm by remaining players to finalize
  applyAction(g, 'p0', { type: 'done' });
  applyAction(g, 'p2', { type: 'done' });
  applyAction(g, 'p3', { type: 'done' });
  assert.equal(g.takeMode, false, 'take finalized after all confirmed');
  assert.ok(g.players[1].hand.includes('6C') && g.players[1].hand.includes('6H'));
});

test('trump of same rank can defend OR transfer', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1); g.trumpSuit = 'D';
  g.players[0].hand = ['7C'];
  g.players[1].hand = ['7D', '9S'];
  g.players[2].hand = ['KC', 'KS'];
  g.deck = ['2H', '2C', '3H', '3C', '4H', '4C'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['7C'] }).ok);
  const acts = legalActions(g, 'p1');
  assert.ok(acts.includes('transfer'));
  assert.ok(acts.includes('defend'));
  assert.ok(_internals.canBeat('7C', '7D', g));
});

test('viewFor exposes closing/pendingDone/adder and hides hands', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  const v = viewFor(g, 'p0');
  assert.ok(Array.isArray(v.players.find((p) => p.id === 'p0').hand));
  assert.equal(v.players.find((p) => p.id === 'p1').hand, undefined);
  assert.ok('closing' in v && 'pendingDone' in v && 'adderId' in v);
});
