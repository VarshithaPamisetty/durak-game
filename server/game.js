// Durak game engine — Perevodnoy (transfer) variant.
// Pure logic, no I/O. State is a plain object so it can be serialized/sent to clients.

const SUITS = ['S', 'H', 'D', 'C']; // Spades, Hearts, Diamonds, Clubs
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };

// Rank order low -> high. We slice from the front to shrink the deck.
const FULL_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function ranksForDeck(deckSize) {
  // 52 -> all; 36 -> 6..A; 24 -> 9..A; 20 -> 10..A
  const map = { 52: 0, 36: 4, 24: 7, 20: 8 };
  const start = map[deckSize] ?? 4;
  return FULL_RANKS.slice(start);
}

export function cardId(rank, suit) {
  return `${rank}${suit}`;
}

export function parseCard(id) {
  const suit = id.slice(-1);
  const rank = id.slice(0, -1);
  return { rank, suit };
}

function rankValue(rank, ranks) {
  return ranks.indexOf(rank);
}

function shuffle(array, rng = Math.random) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Create a fresh game.
 * @param {Array<{id,name}>} players
 * @param {object} options { deckSize, handSize, maxAttacks }
 */
export function createGame(players, options = {}) {
  const deckSize = options.deckSize ?? 36;
  const handSize = options.handSize ?? 6;
  const maxAttacks = options.maxAttacks ?? 6;
  const ranks = ranksForDeck(deckSize);

  // Build and shuffle deck.
  let deck = [];
  for (const suit of SUITS) {
    for (const rank of ranks) deck.push(cardId(rank, suit));
  }
  deck = shuffle(deck);

  // Trump is the bottom card; it is drawn last.
  const trumpCard = deck[0];
  const trumpSuit = parseCard(trumpCard).suit;

  const state = {
    deckSize,
    handSize,
    maxAttacks,
    ranks,
    trumpSuit,
    trumpCard, // shown under the deck until drawn
    // Deck order: we draw from the END; trumpCard sits at index 0 so it goes last.
    deck,
    discardCount: 0,
    players: players.map((p) => ({ id: p.id, name: p.name, hand: [], out: false })),
    table: [], // [{ attack: cardId, defense: cardId | null }]
    attackerIndex: 0,
    defenderIndex: 1,
    passed: [], // ids of attackers who have said "Done" for the current table
    phase: 'playing', // 'playing' | 'finished'
    loserId: null,
    log: [],
  };

  // Deal hands.
  for (let r = 0; r < handSize; r++) {
    for (const player of state.players) {
      player.hand.push(state.deck.pop());
    }
  }
  sortHands(state);

  // First attacker: lowest trump holder, else player 0.
  state.attackerIndex = lowestTrumpHolder(state);
  state.defenderIndex = nextActiveIndex(state, state.attackerIndex);
  state.log.push(`Trump is ${SUIT_SYMBOL[trumpSuit]}. ${state.players[state.attackerIndex].name} attacks first.`);
  return state;
}

function sortHands(state) {
  for (const p of state.players) {
    p.hand.sort((a, b) => {
      const ca = parseCard(a), cb = parseCard(b);
      const ta = ca.suit === state.trumpSuit, tb = cb.suit === state.trumpSuit;
      if (ta !== tb) return ta ? 1 : -1; // trumps to the right
      if (ca.suit !== cb.suit) return SUITS.indexOf(ca.suit) - SUITS.indexOf(cb.suit);
      return rankValue(ca.rank, state.ranks) - rankValue(cb.rank, state.ranks);
    });
  }
}

function lowestTrumpHolder(state) {
  let best = null, bestIdx = 0;
  state.players.forEach((p, idx) => {
    for (const c of p.hand) {
      const { rank, suit } = parseCard(c);
      if (suit === state.trumpSuit) {
        const v = rankValue(rank, state.ranks);
        if (best === null || v < best) { best = v; bestIdx = idx; }
      }
    }
  });
  return bestIdx;
}

// ---- turn helpers ----

function activeCount(state) {
  return state.players.filter((p) => !p.out).length;
}

function nextActiveIndex(state, from) {
  const n = state.players.length;
  for (let step = 1; step <= n; step++) {
    const idx = (from + step) % n;
    if (!state.players[idx].out) return idx;
  }
  return from;
}

function canBeat(attack, defense, state) {
  const a = parseCard(attack), d = parseCard(defense);
  const aTrump = a.suit === state.trumpSuit;
  const dTrump = d.suit === state.trumpSuit;
  if (aTrump) return dTrump && rankValue(d.rank, state.ranks) > rankValue(a.rank, state.ranks);
  if (dTrump) return true; // any trump beats a non-trump
  return d.suit === a.suit && rankValue(d.rank, state.ranks) > rankValue(a.rank, state.ranks);
}

function tableRanks(state) {
  const set = new Set();
  for (const pair of state.table) {
    set.add(parseCard(pair.attack).rank);
    if (pair.defense) set.add(parseCard(pair.defense).rank);
  }
  return set;
}

function undefendedCount(state) {
  return state.table.filter((p) => !p.defense).length;
}

function player(state, id) {
  return state.players.find((p) => p.id === id);
}
function indexOfId(state, id) {
  return state.players.findIndex((p) => p.id === id);
}

// ---- legal actions ----
// Returns the set of actions available to a given player id right now.
export function legalActions(state, id) {
  const actions = [];
  if (state.phase !== 'playing') return actions;
  const idx = indexOfId(state, id);
  if (idx < 0 || state.players[idx].out) return actions;

  const isDefender = idx === state.defenderIndex;
  const defender = state.players[state.defenderIndex];

  if (isDefender) {
    const undef = state.table.filter((p) => !p.defense);
    if (undef.length > 0) {
      actions.push('defend');
      actions.push('take');
      // Transfer: only before any defense, all attacks same rank, defender holds that rank,
      // and there is a valid next defender with enough cards.
      if (canTransfer(state, id)) actions.push('transfer');
    }
  } else {
    // Attacker / thrower.
    const noDefensesYet = state.table.every((p) => !p.defense);
    if (state.table.length === 0) {
      if (idx === state.attackerIndex) actions.push('attack');
    } else {
      // throw-in allowed if room remains and player holds a matching rank
      if (canThrowIn(state, id)) actions.push('attack');
      // "Done" only meaningful once everything on the table is currently beaten
      if (undefendedCount(state) === 0 && !state.passed.includes(id)) actions.push('done');
    }
  }
  return actions;
}

function canThrowIn(state, id) {
  const p = player(state, id);
  if (!p || p.hand.length === 0) return false;
  if (state.table.length === 0) return false;
  const defender = state.players[state.defenderIndex];
  // cannot exceed maxAttacks, and undefended cards cannot exceed defender's hand
  if (state.table.length >= state.maxAttacks) return false;
  if (undefendedCount(state) >= defender.hand.length) return false;
  const ranks = tableRanks(state);
  return p.hand.some((c) => ranks.has(parseCard(c).rank));
}

function canTransfer(state, id) {
  if (state.table.length === 0) return false;
  if (!state.table.every((p) => !p.defense)) return false; // no beats yet
  const attackRanks = new Set(state.table.map((p) => parseCard(p.attack).rank));
  if (attackRanks.size !== 1) return false;
  const rank = [...attackRanks][0];
  const p = player(state, id);
  if (!p.hand.some((c) => parseCard(c).rank === rank)) return false;
  // next defender must have enough cards to beat the (grown) attack
  const nextIdx = nextActiveIndex(state, state.defenderIndex);
  if (nextIdx === state.defenderIndex) return false;
  const nextDef = state.players[nextIdx];
  // after transferring one card, attack count becomes table.length + 1
  return nextDef.hand.length >= state.table.length + 1;
}

// ---- apply actions ----
// action: { type, cards?: [], attackIndex?, card? }
// Returns { ok, error?, events? }. Mutates state on success.
export function applyAction(state, id, action) {
  if (state.phase !== 'playing') return fail('Game is over.');
  const idx = indexOfId(state, id);
  if (idx < 0) return fail('Unknown player.');
  if (state.players[idx].out) return fail('You are already out.');

  switch (action.type) {
    case 'attack': return doAttack(state, id, action);
    case 'defend': return doDefend(state, id, action);
    case 'transfer': return doTransfer(state, id, action);
    case 'take': return doTake(state, id);
    case 'done': return doDone(state, id);
    default: return fail('Unknown action.');
  }
}

function fail(error) { return { ok: false, error }; }

function doAttack(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx === state.defenderIndex) return fail('Defender cannot attack.');
  const p = state.players[idx];
  const cards = action.cards || [];
  if (cards.length === 0) return fail('No cards selected.');
  if (!cards.every((c) => p.hand.includes(c))) return fail('You do not hold those cards.');

  const defender = state.players[state.defenderIndex];

  if (state.table.length === 0) {
    // initial attack — must be the designated attacker, all same rank
    if (idx !== state.attackerIndex) return fail('It is not your attack.');
    const ranks = new Set(cards.map((c) => parseCard(c).rank));
    if (ranks.size !== 1) return fail('Opening attack must be a single rank.');
    if (cards.length > defender.hand.length) return fail('Too many cards for the defender to beat.');
    if (cards.length > state.maxAttacks) return fail('Exceeds maximum attack cards.');
  } else {
    // throw-in — ranks must already be on the table
    const ranks = tableRanks(state);
    if (!cards.every((c) => ranks.has(parseCard(c).rank))) {
      return fail('Throw-in must match a rank already on the table.');
    }
    if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum attack cards.');
    if (undefendedCount(state) + cards.length > defender.hand.length) {
      return fail('Defender does not have enough cards to beat that.');
    }
  }

  for (const c of cards) {
    p.hand.splice(p.hand.indexOf(c), 1);
    state.table.push({ attack: c, defense: null });
  }
  state.passed = []; // new cards reset the "done" votes
  state.log.push(`${p.name} plays ${cards.map(fmt).join(', ')}.`);
  return checkAndAdvance(state, { ok: true });
}

function doDefend(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return fail('Only the defender can defend.');
  const p = state.players[idx];
  const { attackIndex, card } = action;
  const pair = state.table[attackIndex];
  if (!pair) return fail('No such attack card.');
  if (pair.defense) return fail('That card is already beaten.');
  if (!p.hand.includes(card)) return fail('You do not hold that card.');
  if (!canBeat(pair.attack, card, state)) return fail('That card cannot beat the attack.');

  p.hand.splice(p.hand.indexOf(card), 1);
  pair.defense = card;
  state.passed = [];
  state.log.push(`${p.name} beats ${fmt(pair.attack)} with ${fmt(card)}.`);
  return checkAndAdvance(state, { ok: true });
}

function doTransfer(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return fail('Only the defender can transfer.');
  if (!canTransfer(state, id)) return fail('Transfer is not allowed right now.');
  const p = state.players[idx];
  const cards = action.cards || [];
  const rank = parseCard(state.table[0].attack).rank;
  if (cards.length === 0) return fail('Select matching card(s) to transfer.');
  if (!cards.every((c) => p.hand.includes(c) && parseCard(c).rank === rank)) {
    return fail('Transfer cards must match the attack rank.');
  }
  if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum attack cards.');

  // next defender must survive the grown attack
  const nextIdx = nextActiveIndex(state, state.defenderIndex);
  const nextDef = state.players[nextIdx];
  if (nextDef.hand.length < state.table.length + cards.length) {
    return fail('Next player cannot cover that many cards.');
  }

  for (const c of cards) {
    p.hand.splice(p.hand.indexOf(c), 1);
    state.table.push({ attack: c, defense: null });
  }
  // roles shift: current defender becomes an attacker, defense moves on
  state.defenderIndex = nextIdx;
  state.passed = [];
  state.log.push(`${p.name} transfers to ${nextDef.name}.`);
  return checkAndAdvance(state, { ok: true });
}

function doTake(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return fail('Only the defender can take.');
  const p = state.players[idx];
  if (state.table.length === 0) return fail('Nothing to take.');
  for (const pair of state.table) {
    p.hand.push(pair.attack);
    if (pair.defense) p.hand.push(pair.defense);
  }
  state.log.push(`${p.name} picks up the cards.`);
  state.table = [];
  // defender took -> they are skipped; attacker is the player after the defender
  endBout(state, { defenderTook: true });
  return checkAndAdvance(state, { ok: true });
}

function doDone(state, id) {
  if (state.table.length === 0) return fail('Nothing to resolve.');
  if (undefendedCount(state) > 0) return fail('There are still cards to beat.');
  if (indexOfId(state, id) === state.defenderIndex) return fail('Defender cannot pass.');
  if (!state.passed.includes(id)) state.passed.push(id);

  // every active attacker (non-defender, with cards) must have passed
  const pending = state.players.filter((p, i) =>
    !p.out && i !== state.defenderIndex && p.hand.length > 0 && !state.passed.includes(p.id));
  if (pending.length > 0) return { ok: true }; // wait for others

  // successful defense: cards to discard
  state.discardCount += state.table.reduce((n, pair) => n + 1 + (pair.defense ? 1 : 0), 0);
  state.log.push(`Defense successful — cards discarded.`);
  state.table = [];
  endBout(state, { defenderTook: false });
  return checkAndAdvance(state, { ok: true });
}

// Refill hands and rotate roles after a bout ends.
function endBout(state, { defenderTook }) {
  refill(state);
  updateOut(state);

  if (defenderTook) {
    // attacker = player after the defender
    const newAttacker = nextActiveIndex(state, state.defenderIndex);
    state.attackerIndex = newAttacker;
  } else {
    // defender successfully defended and becomes the next attacker
    state.attackerIndex = firstActiveFrom(state, state.defenderIndex);
  }
  state.defenderIndex = nextActiveIndex(state, state.attackerIndex);
  state.passed = [];
}

function firstActiveFrom(state, from) {
  if (!state.players[from].out) return from;
  return nextActiveIndex(state, from);
}

// Draw order: attacker first, then clockwise, defender last.
function refill(state) {
  const order = [];
  const n = state.players.length;
  for (let s = 0; s < n; s++) {
    const i = (state.attackerIndex + s) % n;
    if (i !== state.defenderIndex && !state.players[i].out) order.push(i);
  }
  if (!state.players[state.defenderIndex].out) order.push(state.defenderIndex);

  for (const i of order) {
    const p = state.players[i];
    while (p.hand.length < state.handSize && state.deck.length > 0) {
      p.hand.push(state.deck.pop());
    }
  }
  sortHands(state);
}

function updateOut(state) {
  // A player is out once the deck is empty and they hold no cards.
  if (state.deck.length === 0) {
    for (const p of state.players) {
      if (p.hand.length === 0) p.out = true;
    }
  }
}

function checkAndAdvance(state, result) {
  if (!result.ok) return result;
  // win/lose check
  if (state.deck.length === 0) {
    const withCards = state.players.filter((p) => p.hand.length > 0);
    if (withCards.length <= 1) {
      state.phase = 'finished';
      state.loserId = withCards.length === 1 ? withCards[0].id : null;
      state.log.push(withCards.length === 1
        ? `${withCards[0].name} is the Durak!`
        : `It's a draw — no Durak!`);
    }
  }
  return result;
}

function fmt(cardIdStr) {
  const { rank, suit } = parseCard(cardIdStr);
  return `${rank}${SUIT_SYMBOL[suit]}`;
}

// View tailored to one player: hide other hands (counts only), hide deck contents.
export function viewFor(state, id) {
  return {
    deckSize: state.deckSize,
    handSize: state.handSize,
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    deckCount: state.deck.length,
    discardCount: state.discardCount,
    table: state.table,
    phase: state.phase,
    loserId: state.loserId,
    attackerId: state.players[state.attackerIndex]?.id,
    defenderId: state.players[state.defenderIndex]?.id,
    you: id,
    yourActions: legalActions(state, id),
    log: state.log.slice(-12),
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      out: p.out,
      handCount: p.hand.length,
      hand: p.id === id ? p.hand : undefined,
    })),
  };
}

export const _internals = { canBeat, canTransfer, ranksForDeck, SUIT_SYMBOL };
