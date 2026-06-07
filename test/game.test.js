import { test } from 'node:test';
import assert from 'node:assert';
import { createGame, applyAction, legalActions, viewFor, isJoker, cardColor, RED_JOKER, BLACK_JOKER, _internals } from '../server/game.js';

const P = (n) => Array.from({ length: n }, (_, i) => ({ id: 'p' + i, name: 'P' + i }));

function setRoles(g, defenderIndex) {
  const n = g.players.length;
  g.defenderIndex = defenderIndex;
  g.primaryIndex = (defenderIndex + n - 1) % n;
  const sec = (defenderIndex + 1) % n;
  g.secondaryIndex = sec === g.primaryIndex ? -1 : sec;
  g.priorityIndex = g.primaryIndex;
  g.takeMode = false;
}

test('deck includes 2 jokers and trump is never a joker', () => {
  for (let i = 0; i < 50; i++) {
    const g = createGame(P(4), { deckSize: 52, handSize: 6, jokers: true });
    const all = [...g.deck, ...g.players.flatMap((p) => p.hand)];
    assert.ok(all.includes(RED_JOKER) && all.includes(BLACK_JOKER), 'both jokers present');
    assert.equal(isJoker(g.trumpCard), false, 'trump not a joker');
  }
});

test('adaptive hand size fits the deck for many players', () => {
  const g = createGame(P(10), { deckSize: 52, handSize: 6, jokers: true });
  // 54 cards / 10 players -> 5 each
  assert.equal(g.handSize, 5);
  for (const p of g.players) assert.equal(p.hand.length, 5);
  assert.equal(g.deck.length, 54 - 50);
});

test('jokers cannot attack', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1);
  g.trumpSuit = 'S';
  g.players[0].hand = [RED_JOKER, '7H'];
  g.players[1].hand = ['9H', '9D'];
  g.players[2].hand = ['8C'];
  g.deck = [];
  const bad = applyAction(g, 'p0', { type: 'attack', cards: [RED_JOKER] });
  assert.equal(bad.ok, false);
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['7H'] }).ok);
});

test('joker defends one, then Done pushes the rest to the previous player', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1); // defender p1, primary p0, secondary p2
  g.trumpSuit = 'S';
  g.players[0].hand = ['6C', '6D']; // opener
  g.players[1].hand = [BLACK_JOKER, 'AS']; // defender holds black joker
  g.players[2].hand = ['6S', '7C', '8C'];
  g.deck = ['2H', '2D', '2C', '2S', '3H', '3D'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['6C', '6D'] }).ok);
  assert.equal(g.table.length, 2);
  assert.ok(legalActions(g, 'p1').includes('jokerdefend'));
  // black joker beats the black 6C, but does NOT end the bout yet
  assert.ok(applyAction(g, 'p1', { type: 'jokerdefend', attackIndex: 0, card: BLACK_JOKER }).ok);
  assert.equal(g.table.length, 2, 'bout still going after joker');
  assert.equal(g.jokerUsed, true);
  assert.ok(legalActions(g, 'p1').includes('done'), 'defender can now finish');
  // attackers cannot act while a joker is in play
  assert.deepEqual(legalActions(g, 'p2'), []);
  const beforeP0 = g.players[0].hand.length;
  // Done pushes the still-undefended 6D to the previous player (p0) and ends the bout
  assert.ok(applyAction(g, 'p1', { type: 'done' }).ok);
  assert.ok(g.players[0].hand.includes('6D'), 'remaining card pushed to previous player');
  assert.equal(g.table.length, 0, 'bout ended');
});

test('joker colour mismatch is rejected', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  setRoles(g, 1);
  g.trumpSuit = 'S';
  g.players[0].hand = ['6H']; // red attack
  g.players[1].hand = [BLACK_JOKER, 'AS'];
  g.players[2].hand = ['7C'];
  g.deck = ['2H', '2D'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['6H'] }).ok);
  const r = applyAction(g, 'p1', { type: 'jokerdefend', attackIndex: 0, card: BLACK_JOKER });
  assert.equal(r.ok, false, 'black joker cannot beat a red card');
});

test('load-the-taker: only neighbours add, then taker picks up all', () => {
  const g = createGame(P(4), { deckSize: 52, handSize: 6 });
  setRoles(g, 1); // defender p1, primary p0, secondary p2; p3 is across (cannot add)
  g.trumpSuit = 'S';
  g.players[0].hand = ['6C', '6D'];
  g.players[1].hand = ['9S'];           // defender, will take
  g.players[2].hand = ['6H', '6S'];     // secondary can add 6s (keeps a spare)
  g.players[3].hand = ['7D'];           // across — must NOT be allowed to add
  g.deck = ['2H', '2D', '2C', '3H', '3D', '3C', '4H', '4D'];
  assert.ok(applyAction(g, 'p0', { type: 'attack', cards: ['6C'] }).ok);
  assert.ok(applyAction(g, 'p1', { type: 'take' }).ok);
  assert.equal(g.takeMode, true);
  assert.deepEqual(legalActions(g, 'p3'), [], 'across player cannot load');
  // primary done -> secondary may add
  assert.ok(applyAction(g, 'p0', { type: 'done' }).ok);
  assert.ok(legalActions(g, 'p2').includes('attack'));
  assert.ok(applyAction(g, 'p2', { type: 'attack', cards: ['6H'] }).ok);
  assert.ok(applyAction(g, 'p2', { type: 'done' }).ok);
  // taker should have picked up the 6C and 6H
  assert.ok(g.players[1].hand.includes('6C') && g.players[1].hand.includes('6H'));
  assert.equal(g.takeMode, false);
});

test('canBeat colour rules for jokers', () => {
  const g = createGame(P(2), { deckSize: 36, handSize: 6 });
  g.trumpSuit = 'S';
  const { canBeat } = _internals;
  assert.equal(canBeat('6C', BLACK_JOKER, g), true);
  assert.equal(canBeat('6S', BLACK_JOKER, g), true);
  assert.equal(canBeat('6H', BLACK_JOKER, g), false);
  assert.equal(canBeat('6H', RED_JOKER, g), true);
  assert.equal(canBeat('6C', RED_JOKER, g), false);
});

test('viewFor hides hands and exposes takeMode/turn info', () => {
  const g = createGame(P(3), { deckSize: 36, handSize: 6 });
  const v = viewFor(g, 'p0');
  assert.ok(Array.isArray(v.players.find((p) => p.id === 'p0').hand));
  assert.equal(v.players.find((p) => p.id === 'p1').hand, undefined);
  assert.equal(typeof v.takeMode, 'boolean');
  assert.ok('toActId' in v);
});
