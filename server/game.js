// Durak engine — Perevodnoy (transfer) variant with neighbour-only,
// left-priority attacking.
//
// Turn model (one actor at a time):
//   - Defender D is attacked only by their two neighbours:
//       primary L = player before D (the opener, has priority)
//       secondary R = player after D (may attack only after L yields)
//   - While there are undefended cards, it's D's turn (defend / take / transfer).
//   - When the table is fully defended, the priority attacker may add matching
//     cards or press Done. Priority starts at L; if L is Done it passes to R;
//     if R is also Done (or nobody can add) the bout ends.
//   - Every time D beats the table clean, priority snaps back to L.

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const FULL_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function ranksForDeck(deckSize) {
  const map = { 52: 0, 36: 4, 24: 7, 20: 8 };
  return FULL_RANKS.slice(map[deckSize] ?? 4);
}

export function cardId(rank, suit) { return `${rank}${suit}`; }
export function parseCard(id) { return { rank: id.slice(0, -1), suit: id.slice(-1) }; }
function rankValue(rank, ranks) { return ranks.indexOf(rank); }

function shuffle(array, rng = Math.random) {
  const a = array.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function createGame(players, options = {}) {
  const deckSize = options.deckSize ?? 36;
  const handSize = options.handSize ?? 6;
  const maxAttacks = options.maxAttacks ?? 6;
  const ranks = ranksForDeck(deckSize);

  let deck = [];
  for (const suit of SUITS) for (const rank of ranks) deck.push(cardId(rank, suit));
  deck = shuffle(deck);

  const trumpCard = deck[0];
  const trumpSuit = parseCard(trumpCard).suit;

  const state = {
    deckSize, handSize, maxAttacks, ranks, trumpSuit, trumpCard,
    deck,
    discardCount: 0,
    players: players.map((p) => ({ id: p.id, name: p.name, isBot: !!p.isBot, hand: [], out: false })),
    table: [],
    defenderIndex: 1,
    primaryIndex: 0,    // L — opener / priority
    secondaryIndex: -1, // R — other neighbour
    priorityIndex: 0,   // who may add right now (when fully defended)
    phase: 'playing',
    loserId: null,
    log: [],
  };

  for (let r = 0; r < handSize; r++) for (const p of state.players) p.hand.push(state.deck.pop());
  sortHands(state);

  const opener = lowestTrumpHolder(state);
  state.defenderIndex = nextActiveIndex(state, opener);
  setRoles(state);
  state.log.push(`Trump ${SUIT_SYMBOL[trumpSuit]}. ${state.players[opener].name} attacks ${state.players[state.defenderIndex].name}.`);
  return state;
}

function sortHands(state) {
  for (const p of state.players) {
    p.hand.sort((a, b) => {
      const ca = parseCard(a), cb = parseCard(b);
      const ta = ca.suit === state.trumpSuit, tb = cb.suit === state.trumpSuit;
      if (ta !== tb) return ta ? 1 : -1;
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

// ---- seat helpers ----
function nextActiveIndex(state, from) {
  const n = state.players.length;
  for (let s = 1; s <= n; s++) { const i = (from + s) % n; if (!state.players[i].out) return i; }
  return from;
}
function prevActiveIndex(state, from) {
  const n = state.players.length;
  for (let s = 1; s <= n; s++) { const i = (from - s + n) % n; if (!state.players[i].out) return i; }
  return from;
}
function activeCount(state) { return state.players.filter((p) => !p.out).length; }

function setRoles(state) {
  state.primaryIndex = prevActiveIndex(state, state.defenderIndex);
  const sec = nextActiveIndex(state, state.defenderIndex);
  state.secondaryIndex = sec === state.primaryIndex ? -1 : sec;
  state.priorityIndex = state.primaryIndex;
}

function indexOfId(state, id) { return state.players.findIndex((p) => p.id === id); }
function playerById(state, id) { return state.players.find((p) => p.id === id); }

// ---- rules ----
function canBeat(attack, defense, state) {
  const a = parseCard(attack), d = parseCard(defense);
  const aT = a.suit === state.trumpSuit, dT = d.suit === state.trumpSuit;
  if (aT) return dT && rankValue(d.rank, state.ranks) > rankValue(a.rank, state.ranks);
  if (dT) return true;
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
function undefendedCount(state) { return state.table.filter((p) => !p.defense).length; }

// Can this attacker add at least one card right now (table fully defended)?
function hasAddable(state, idx) {
  if (idx < 0) return false;
  const p = state.players[idx];
  if (!p || p.out || p.hand.length === 0) return false;
  if (state.table.length === 0) return idx === state.primaryIndex; // only opener opens
  if (state.table.length >= state.maxAttacks) return false;
  const defender = state.players[state.defenderIndex];
  if (defender.hand.length < 1) return false; // nothing to defend with
  const ranks = tableRanks(state);
  return p.hand.some((c) => ranks.has(parseCard(c).rank));
}

function canTransfer(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return false;
  if (state.table.length === 0) return false;
  if (!state.table.every((p) => !p.defense)) return false;
  const attackRanks = new Set(state.table.map((p) => parseCard(p.attack).rank));
  if (attackRanks.size !== 1) return false;
  const rank = [...attackRanks][0];
  const p = state.players[idx];
  if (!p.hand.some((c) => parseCard(c).rank === rank)) return false;
  const nextIdx = nextActiveIndex(state, state.defenderIndex);
  if (nextIdx === state.defenderIndex) return false;
  return state.players[nextIdx].hand.length >= state.table.length + 1;
}

// ---- legal actions ----
export function legalActions(state, id) {
  if (state.phase !== 'playing') return [];
  const idx = indexOfId(state, id);
  if (idx < 0 || state.players[idx].out) return [];

  if (idx === state.defenderIndex) {
    if (undefendedCount(state) > 0) {
      const acts = ['defend', 'take'];
      if (canTransfer(state, id)) acts.push('transfer');
      return acts;
    }
    return [];
  }

  // attacker side
  if (idx !== state.primaryIndex && idx !== state.secondaryIndex) return [];
  if (state.table.length === 0) return idx === state.primaryIndex ? ['attack'] : [];
  if (undefendedCount(state) > 0) return []; // wait for defender
  if (idx !== state.priorityIndex) return [];
  const acts = ['done'];
  if (hasAddable(state, idx)) acts.unshift('attack');
  return acts;
}

// ---- apply ----
export function applyAction(state, id, action) {
  if (state.phase !== 'playing') return fail('Game is over.');
  const idx = indexOfId(state, id);
  if (idx < 0) return fail('Unknown player.');
  if (state.players[idx].out) return fail('You are out.');

  let res;
  switch (action.type) {
    case 'attack': res = doAttack(state, id, action); break;
    case 'defend': res = doDefend(state, id, action); break;
    case 'transfer': res = doTransfer(state, id, action); break;
    case 'take': res = doTake(state, id); break;
    case 'done': res = doDone(state, id); break;
    default: return fail('Unknown action.');
  }
  if (res.ok) { normalizeTurn(state); checkEnd(state); }
  return res;
}

function fail(error) { return { ok: false, error }; }

function doAttack(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx === state.defenderIndex) return fail('Defender cannot attack.');
  if (idx !== state.primaryIndex && idx !== state.secondaryIndex) return fail('Only neighbours can attack.');
  const p = state.players[idx];
  const cards = action.cards || [];
  if (cards.length === 0) return fail('No cards selected.');
  if (!cards.every((c) => p.hand.includes(c))) return fail('You do not hold those cards.');
  const defender = state.players[state.defenderIndex];

  if (state.table.length === 0) {
    if (idx !== state.primaryIndex) return fail('Only the left player opens the attack.');
    const ranks = new Set(cards.map((c) => parseCard(c).rank));
    if (ranks.size !== 1) return fail('Opening attack must be one rank.');
    if (cards.length > defender.hand.length) return fail('Too many cards for the defender to beat.');
    if (cards.length > state.maxAttacks) return fail('Exceeds maximum attack cards.');
  } else {
    if (undefendedCount(state) > 0) return fail('Wait for the defender.');
    if (idx !== state.priorityIndex) return fail('It is not your turn to attack.');
    const ranks = tableRanks(state);
    if (!cards.every((c) => ranks.has(parseCard(c).rank))) return fail('Cards must match a rank on the table.');
    if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum attack cards.');
    if (cards.length > defender.hand.length) return fail('Defender cannot cover that many cards.');
  }

  for (const c of cards) {
    p.hand.splice(p.hand.indexOf(c), 1);
    state.table.push({ attack: c, defense: null, by: id });
  }
  state.log.push(`${p.name}: ${cards.map(fmt).join(' ')}`);
  return { ok: true };
}

function doDefend(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return fail('Only the defender can defend.');
  const p = state.players[idx];
  const { attackIndex, card } = action;
  const pair = state.table[attackIndex];
  if (!pair) return fail('No such attack card.');
  if (pair.defense) return fail('Already beaten.');
  if (!p.hand.includes(card)) return fail('You do not hold that card.');
  if (!canBeat(pair.attack, card, state)) return fail('That card cannot beat the attack.');

  p.hand.splice(p.hand.indexOf(card), 1);
  pair.defense = card;
  state.log.push(`${p.name} beats ${fmt(pair.attack)} with ${fmt(card)}`);
  // Cleared the table → priority returns to the left player.
  if (undefendedCount(state) === 0) state.priorityIndex = state.primaryIndex;
  return { ok: true };
}

function doTransfer(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return fail('Only the defender can transfer.');
  if (!canTransfer(state, id)) return fail('Transfer is not allowed now.');
  const p = state.players[idx];
  const cards = action.cards || [];
  const rank = parseCard(state.table[0].attack).rank;
  if (cards.length === 0) return fail('Select matching card(s) to transfer.');
  if (!cards.every((c) => p.hand.includes(c) && parseCard(c).rank === rank)) {
    return fail('Transfer cards must match the attack rank.');
  }
  if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum attack cards.');
  const nextIdx = nextActiveIndex(state, state.defenderIndex);
  if (state.players[nextIdx].hand.length < state.table.length + cards.length) {
    return fail('Next player cannot cover that many cards.');
  }
  for (const c of cards) {
    p.hand.splice(p.hand.indexOf(c), 1);
    state.table.push({ attack: c, defense: null, by: id });
  }
  state.log.push(`${p.name} transfers to ${state.players[nextIdx].name}`);
  state.defenderIndex = nextIdx;
  setRoles(state);
  return { ok: true };
}

function doTake(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex) return fail('Only the defender can take.');
  if (state.table.length === 0) return fail('Nothing to take.');
  const p = state.players[idx];
  for (const pair of state.table) { p.hand.push(pair.attack); if (pair.defense) p.hand.push(pair.defense); }
  state.log.push(`${p.name} takes the cards`);
  state.table = [];
  endBout(state, true);
  return { ok: true };
}

function doDone(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.priorityIndex) return fail('It is not your turn.');
  if (state.table.length === 0 || undefendedCount(state) > 0) return fail('Nothing to finish yet.');
  if (idx === state.primaryIndex && state.secondaryIndex !== -1) {
    state.priorityIndex = state.secondaryIndex; // yield to the right player
    return { ok: true };
  }
  resolveDefense(state);
  return { ok: true };
}

function resolveDefense(state) {
  state.discardCount += state.table.reduce((n, pair) => n + 1 + (pair.defense ? 1 : 0), 0);
  state.log.push('Defended — cards discarded.');
  state.table = [];
  endBout(state, false);
}

// After the table is fully defended, skip attackers who cannot add and
// resolve the bout if nobody can.
function normalizeTurn(state) {
  if (state.phase !== 'playing') return;
  if (state.table.length === 0 || undefendedCount(state) > 0) return;
  let guard = 0;
  while (guard++ < 6) {
    const holder = state.priorityIndex;
    if (hasAddable(state, holder)) return; // wait for their decision
    if (holder === state.primaryIndex && state.secondaryIndex !== -1) {
      state.priorityIndex = state.secondaryIndex;
      continue;
    }
    resolveDefense(state); // nobody can add → defence stands
    return;
  }
}

function endBout(state, defenderTook) {
  refill(state);
  updateOut(state);
  if (activeCount(state) <= 1) return; // game will be finalised by checkEnd
  let newAttacker;
  if (defenderTook) newAttacker = nextActiveIndex(state, state.defenderIndex);
  else newAttacker = state.players[state.defenderIndex].out ? nextActiveIndex(state, state.defenderIndex) : state.defenderIndex;
  state.defenderIndex = nextActiveIndex(state, newAttacker);
  setRoles(state);
}

function refill(state) {
  const order = [];
  const n = state.players.length;
  const start = state.primaryIndex;
  for (let s = 0; s < n; s++) {
    const i = (start + s) % n;
    if (i !== state.defenderIndex && !state.players[i].out) order.push(i);
  }
  if (!state.players[state.defenderIndex].out) order.push(state.defenderIndex);
  for (const i of order) {
    const p = state.players[i];
    while (p.hand.length < state.handSize && state.deck.length > 0) p.hand.push(state.deck.pop());
  }
  sortHands(state);
}

function updateOut(state) {
  if (state.deck.length === 0) for (const p of state.players) if (p.hand.length === 0) p.out = true;
}

function checkEnd(state) {
  if (state.phase !== 'playing') return;
  if (state.deck.length === 0) {
    const withCards = state.players.filter((p) => p.hand.length > 0);
    if (withCards.length <= 1) {
      state.phase = 'finished';
      state.loserId = withCards.length === 1 ? withCards[0].id : null;
      state.log.push(withCards.length === 1 ? `${withCards[0].name} is the Durak!` : `Draw — no Durak!`);
    }
  }
}

function fmt(c) { const { rank, suit } = parseCard(c); return `${rank}${SUIT_SYMBOL[suit]}`; }

// ---- view ----
export function viewFor(state, id) {
  const undef = undefendedCount(state);
  let toActId;
  if (state.phase !== 'playing') toActId = null;
  else if (undef > 0) toActId = state.players[state.defenderIndex].id;
  else if (state.table.length === 0) toActId = state.players[state.primaryIndex].id;
  else toActId = state.players[state.priorityIndex]?.id;

  return {
    deckSize: state.deckSize,
    handSize: state.handSize,
    trumpSuit: state.trumpSuit,
    trumpCard: state.trumpCard,
    deckCount: state.deck.length,
    discardCount: state.discardCount,
    table: state.table.map((p) => ({ attack: p.attack, defense: p.defense })),
    phase: state.phase,
    loserId: state.loserId,
    defenderId: state.players[state.defenderIndex]?.id,
    primaryId: state.players[state.primaryIndex]?.id,
    secondaryId: state.secondaryIndex >= 0 ? state.players[state.secondaryIndex]?.id : null,
    priorityId: state.players[state.priorityIndex]?.id,
    toActId,
    you: id,
    yourActions: legalActions(state, id),
    log: state.log.slice(-12),
    players: state.players.map((p) => ({
      id: p.id, name: p.name, isBot: p.isBot, out: p.out,
      handCount: p.hand.length,
      hand: p.id === id ? p.hand : undefined,
    })),
  };
}

export const _internals = { canBeat, canTransfer, ranksForDeck, hasAddable, undefendedCount, SUIT_SYMBOL };
