// Durak engine — transfer variant, neighbour-only left-priority attacking,
// load-the-taker, 2 jokers (colour defence + push-the-rest), N players.

const SUITS = ['S', 'H', 'D', 'C'];
const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const FULL_RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
export const RED_JOKER = 'RJ';
export const BLACK_JOKER = 'BJ';

function ranksForDeck(deckSize) {
  const map = { 52: 0, 36: 4, 24: 7, 20: 8 };
  return FULL_RANKS.slice(map[deckSize] ?? 4);
}

export function isJoker(id) { return id === RED_JOKER || id === BLACK_JOKER; }
export function cardId(rank, suit) { return `${rank}${suit}`; }
export function parseCard(id) { return { rank: id.slice(0, -1), suit: id.slice(-1) }; }
export function cardColor(id) {
  if (id === RED_JOKER) return 'red';
  if (id === BLACK_JOKER) return 'black';
  const s = id.slice(-1);
  return (s === 'H' || s === 'D') ? 'red' : 'black';
}
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
  const useJokers = options.jokers !== false; // jokers on by default
  const ranks = ranksForDeck(deckSize);

  let deck = [];
  for (const suit of SUITS) for (const rank of ranks) deck.push(cardId(rank, suit));
  if (useJokers) deck.push(RED_JOKER, BLACK_JOKER);
  deck = shuffle(deck);

  // The trump (bottom) card must not be a joker.
  if (isJoker(deck[0])) {
    const swap = deck.findIndex((c) => !isJoker(c));
    if (swap > 0) { [deck[0], deck[swap]] = [deck[swap], deck[0]]; }
  }
  const trumpCard = deck[0];
  const trumpSuit = parseCard(trumpCard).suit;

  // Adaptive hand size: every player must get a full hand from the deck.
  const n = players.length;
  const requested = options.handSize ?? 6;
  const handSize = Math.max(1, Math.min(requested, Math.floor(deck.length / n)));
  const maxAttacks = Math.min(options.maxAttacks ?? 6, handSize);

  const state = {
    deckSize, handSize, maxAttacks, ranks, trumpSuit, trumpCard, useJokers,
    deck,
    discardCount: 0,
    players: players.map((p) => ({ id: p.id, name: p.name, isBot: !!p.isBot, hand: [], out: false })),
    table: [],
    defenderIndex: 1,
    primaryIndex: 0,
    secondaryIndex: -1,
    priorityIndex: 0,
    takeMode: false,
    jokerUsed: false,
    noPlay: 0,
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
  normalizeTurn(state);
  return state;
}

function sortHands(state) {
  for (const p of state.players) {
    p.hand.sort((a, b) => {
      const ja = isJoker(a), jb = isJoker(b);
      if (ja || jb) {
        if (ja && jb) return a === RED_JOKER ? -1 : 1;
        return ja ? 1 : -1; // jokers to the far right
      }
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
      if (isJoker(c)) continue;
      const { rank, suit } = parseCard(c);
      if (suit === state.trumpSuit) {
        const v = rankValue(rank, state.ranks);
        if (best === null || v < best) { best = v; bestIdx = idx; }
      }
    }
  });
  return bestIdx;
}

// ---- seats ----
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
  state.jokerUsed = false;
}

function indexOfId(state, id) { return state.players.findIndex((p) => p.id === id); }

// ---- rules ----
function canBeat(attack, defense, state) {
  if (isJoker(defense)) return cardColor(defense) === cardColor(attack); // colour match
  if (isJoker(attack)) return false; // jokers are never attacked, but guard anyway
  const a = parseCard(attack), d = parseCard(defense);
  const aT = a.suit === state.trumpSuit, dT = d.suit === state.trumpSuit;
  if (aT) return dT && rankValue(d.rank, state.ranks) > rankValue(a.rank, state.ranks);
  if (dT) return true;
  return d.suit === a.suit && rankValue(d.rank, state.ranks) > rankValue(a.rank, state.ranks);
}
function tableRanks(state) {
  const set = new Set();
  for (const pair of state.table) {
    if (!isJoker(pair.attack)) set.add(parseCard(pair.attack).rank);
    if (pair.defense && !isJoker(pair.defense)) set.add(parseCard(pair.defense).rank);
  }
  return set;
}
function undefendedCount(state) { return state.table.filter((p) => !p.defense).length; }
function hasNonJoker(p) { return p.hand.some((c) => !isJoker(c)); }

// can attacker idx add a card now?
function hasAddable(state, idx, takeMode) {
  if (idx < 0) return false;
  const p = state.players[idx];
  if (!p || p.out || p.hand.length === 0) return false;
  if (state.table.length === 0) return idx === state.primaryIndex && hasNonJoker(p);
  if (state.table.length >= state.maxAttacks) return false;
  if (!takeMode && state.players[state.defenderIndex].hand.length < 1) return false;
  const ranks = tableRanks(state);
  return p.hand.some((c) => !isJoker(c) && ranks.has(parseCard(c).rank));
}

// who can open this bout (primary, else secondary if primary can't)
function effectiveOpener(state) {
  const prim = state.primaryIndex;
  if (prim >= 0 && !state.players[prim].out && hasNonJoker(state.players[prim])) return prim;
  const sec = state.secondaryIndex;
  if (sec >= 0 && !state.players[sec].out && hasNonJoker(state.players[sec])) return sec;
  return -1;
}

function canTransfer(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex || state.takeMode) return false;
  if (state.table.length === 0) return false;
  if (!state.table.every((p) => !p.defense)) return false;
  if (state.table.some((p) => isJoker(p.attack))) return false;
  const attackRanks = new Set(state.table.map((p) => parseCard(p.attack).rank));
  if (attackRanks.size !== 1) return false;
  const rank = [...attackRanks][0];
  const p = state.players[idx];
  if (!p.hand.some((c) => !isJoker(c) && parseCard(c).rank === rank)) return false;
  const nextIdx = nextActiveIndex(state, state.defenderIndex);
  if (nextIdx === state.defenderIndex) return false;
  return state.players[nextIdx].hand.length >= state.table.length + 1;
}

function canJokerDefend(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex || state.takeMode) return false;
  const p = state.players[idx];
  const jokers = p.hand.filter(isJoker);
  if (jokers.length === 0) return false;
  return state.table.some((pair) => !pair.defense && jokers.some((j) => cardColor(j) === cardColor(pair.attack)));
}

// ---- legal actions ----
export function legalActions(state, id) {
  if (state.phase !== 'playing') return [];
  const idx = indexOfId(state, id);
  if (idx < 0 || state.players[idx].out) return [];

  if (state.takeMode) {
    if (idx === state.defenderIndex) return [];
    if (idx !== state.primaryIndex && idx !== state.secondaryIndex) return [];
    if (idx !== state.priorityIndex) return [];
    const acts = ['done'];
    if (hasAddable(state, idx, true)) acts.unshift('attack');
    return acts;
  }

  if (idx === state.defenderIndex) {
    if (undefendedCount(state) > 0) {
      const acts = ['defend', 'take'];
      if (canTransfer(state, id)) acts.push('transfer');
      if (canJokerDefend(state, id)) acts.push('jokerdefend');
      if (state.jokerUsed) acts.push('done'); // finish: push the rest to the previous player
      return acts;
    }
    if (state.jokerUsed && state.table.length > 0) return ['done'];
    return [];
  }

  if (idx !== state.primaryIndex && idx !== state.secondaryIndex) return [];
  if (state.table.length === 0) return idx === effectiveOpener(state) ? ['attack'] : [];
  if (undefendedCount(state) > 0) return [];
  if (idx !== state.priorityIndex) return [];
  const acts = ['done'];
  if (hasAddable(state, idx, false)) acts.unshift('attack');
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
    case 'jokerdefend': res = doJokerDefend(state, id, action); break;
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
  if (cards.some(isJoker)) return fail('Jokers cannot attack.');
  if (!cards.every((c) => p.hand.includes(c))) return fail('You do not hold those cards.');
  const defender = state.players[state.defenderIndex];

  if (state.takeMode) {
    if (idx !== state.priorityIndex) return fail('Not your turn to add.');
    const ranks = tableRanks(state);
    if (!cards.every((c) => ranks.has(parseCard(c).rank))) return fail('Cards must match a rank on the table.');
    if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum.');
  } else if (state.table.length === 0) {
    if (idx !== effectiveOpener(state)) return fail('It is not your attack.');
    const ranks = new Set(cards.map((c) => parseCard(c).rank));
    if (ranks.size !== 1) return fail('Opening attack must be one rank.');
    if (cards.length > defender.hand.length) return fail('Too many cards for the defender.');
    if (cards.length > state.maxAttacks) return fail('Exceeds maximum.');
  } else {
    if (undefendedCount(state) > 0) return fail('Wait for the defender.');
    if (idx !== state.priorityIndex) return fail('It is not your turn to attack.');
    const ranks = tableRanks(state);
    if (!cards.every((c) => ranks.has(parseCard(c).rank))) return fail('Cards must match a rank on the table.');
    if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum.');
    if (cards.length > defender.hand.length) return fail('Defender cannot cover that many cards.');
  }

  for (const c of cards) {
    p.hand.splice(p.hand.indexOf(c), 1);
    state.table.push({ attack: c, defense: null, by: id });
  }
  state.noPlay = 0;
  state.log.push(`${p.name}: ${cards.map(fmt).join(' ')}`);
  return { ok: true };
}

function doDefend(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex || state.takeMode) return fail('Cannot defend now.');
  const p = state.players[idx];
  const { attackIndex, card } = action;
  if (isJoker(card)) return fail('Use the joker move to defend with a joker.');
  const pair = state.table[attackIndex];
  if (!pair) return fail('No such attack card.');
  if (pair.defense) return fail('Already beaten.');
  if (!p.hand.includes(card)) return fail('You do not hold that card.');
  if (!canBeat(pair.attack, card, state)) return fail('That card cannot beat the attack.');
  p.hand.splice(p.hand.indexOf(card), 1);
  pair.defense = card;
  state.log.push(`${p.name} beats ${fmt(pair.attack)} with ${fmt(card)}`);
  if (undefendedCount(state) === 0) state.priorityIndex = state.primaryIndex;
  return { ok: true };
}

// Joker defends one matching-colour card. The bout does NOT end yet — the defender
// may beat/joker more cards, and then presses Done to push the rest to the previous
// player and end the bout.
function doJokerDefend(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex || state.takeMode) return fail('Cannot defend now.');
  const p = state.players[idx];
  const { attackIndex, card } = action;
  if (!isJoker(card)) return fail('That is not a joker.');
  if (!p.hand.includes(card)) return fail('You do not hold that joker.');
  const pair = state.table[attackIndex];
  if (!pair || pair.defense) return fail('Pick an undefended card.');
  if (cardColor(card) !== cardColor(pair.attack)) return fail('Joker colour must match the card.');

  p.hand.splice(p.hand.indexOf(card), 1);
  pair.defense = card;
  state.jokerUsed = true;
  state.log.push(`${p.name} jokers ${fmt(pair.attack)}`);
  return { ok: true };
}

// Defender finishes after using a joker: undefended cards go to the previous player.
function finalizeJoker(state) {
  const recipient = state.players[state.primaryIndex];
  const pushed = [];
  for (const pr of state.table) { if (!pr.defense) { recipient.hand.push(pr.attack); pushed.push(pr.attack); } }
  state.discardCount += state.table.filter((pr) => pr.defense).reduce((nn) => nn + 2, 0);
  state.table = [];
  sortHands(state);
  state.log.push(`${state.players[state.defenderIndex].name} finishes${pushed.length ? ` — ${pushed.length} card(s) to ${recipient.name}` : ''}`);
  endBout(state, false);
}

function doTransfer(state, id, action) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex || state.takeMode) return fail('Cannot transfer now.');
  if (!canTransfer(state, id)) return fail('Transfer is not allowed now.');
  const p = state.players[idx];
  const cards = action.cards || [];
  const rank = parseCard(state.table[0].attack).rank;
  if (cards.length === 0) return fail('Select matching card(s).');
  if (!cards.every((c) => !isJoker(c) && p.hand.includes(c) && parseCard(c).rank === rank)) {
    return fail('Transfer cards must match the attack rank.');
  }
  if (state.table.length + cards.length > state.maxAttacks) return fail('Exceeds maximum.');
  const nextIdx = nextActiveIndex(state, state.defenderIndex);
  if (state.players[nextIdx].hand.length < state.table.length + cards.length) {
    return fail('Next player cannot cover that many cards.');
  }
  for (const c of cards) { p.hand.splice(p.hand.indexOf(c), 1); state.table.push({ attack: c, defense: null, by: id }); }
  state.log.push(`${p.name} transfers to ${state.players[nextIdx].name}`);
  state.defenderIndex = nextIdx;
  setRoles(state);
  return { ok: true };
}

function doTake(state, id) {
  const idx = indexOfId(state, id);
  if (idx !== state.defenderIndex || state.takeMode) return fail('Cannot take now.');
  if (state.table.length === 0) return fail('Nothing to take.');
  // Enter loading mode: neighbours may pile on more before the pickup.
  state.takeMode = true;
  state.priorityIndex = state.primaryIndex;
  state.log.push(`${state.players[idx].name} is taking — neighbours may add cards.`);
  return { ok: true };
}

function finalizeTake(state) {
  const taker = state.players[state.defenderIndex];
  for (const pair of state.table) { taker.hand.push(pair.attack); if (pair.defense) taker.hand.push(pair.defense); }
  state.table = [];
  state.takeMode = false;
  sortHands(state);
  state.log.push(`${taker.name} picks up the cards.`);
  endBout(state, true);
}

function doDone(state, id) {
  const idx = indexOfId(state, id);
  if (idx === state.defenderIndex && !state.takeMode) {
    if (!state.jokerUsed) return fail('Nothing to finish.');
    finalizeJoker(state);
    return { ok: true };
  }
  if (idx !== state.priorityIndex) return fail('It is not your turn.');
  if (state.takeMode) {
    if (state.table.length === 0) return fail('Nothing here.');
    if (idx === state.primaryIndex && state.secondaryIndex !== -1) { state.priorityIndex = state.secondaryIndex; return { ok: true }; }
    finalizeTake(state);
    return { ok: true };
  }
  if (state.table.length === 0 || undefendedCount(state) > 0) return fail('Nothing to finish yet.');
  if (idx === state.primaryIndex && state.secondaryIndex !== -1) { state.priorityIndex = state.secondaryIndex; return { ok: true }; }
  resolveDefense(state);
  return { ok: true };
}

function resolveDefense(state) {
  state.discardCount += state.table.reduce((nn, pair) => nn + 1 + (pair.defense ? 1 : 0), 0);
  state.log.push('Defended — cards discarded.');
  state.table = [];
  endBout(state, false);
}

function normalizeTurn(state) {
  if (state.phase !== 'playing') return;
  let guard = 0;
  while (guard++ < 40) {
    if (state.takeMode) {
      const holder = state.priorityIndex;
      if (hasAddable(state, holder, true)) return;
      if (holder === state.primaryIndex && state.secondaryIndex !== -1) { state.priorityIndex = state.secondaryIndex; continue; }
      finalizeTake(state);
      if (state.phase !== 'playing') return;
      continue; // new bout (table empty) — re-evaluate
    }
    if (state.table.length === 0) {
      const opener = effectiveOpener(state);
      if (opener !== -1) { state.priorityIndex = opener; return; }
      // nobody can open — rotate to the next defender; guard against a full empty loop
      state.noPlay++;
      if (state.noPlay > activeCount(state) + 1) { state.phase = 'finished'; state.loserId = null; return; }
      state.defenderIndex = nextActiveIndex(state, state.defenderIndex);
      setRoles(state);
      continue;
    }
    if (undefendedCount(state) > 0) return; // defender's turn
    // fully defended
    if (state.jokerUsed) return; // defender must Finish (push the rest)
    const holder = state.priorityIndex;
    if (hasAddable(state, holder, false)) return;
    if (holder === state.primaryIndex && state.secondaryIndex !== -1) { state.priorityIndex = state.secondaryIndex; continue; }
    resolveDefense(state);
    if (state.phase !== 'playing') return;
    continue;
  }
}

function endBout(state, defenderTook) {
  refill(state);
  updateOut(state);
  if (activeCount(state) <= 1) return;
  let newAttacker;
  if (defenderTook) newAttacker = nextActiveIndex(state, state.defenderIndex);
  else newAttacker = state.players[state.defenderIndex].out ? nextActiveIndex(state, state.defenderIndex) : state.defenderIndex;
  state.defenderIndex = nextActiveIndex(state, newAttacker);
  setRoles(state);
  state.takeMode = false;
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

function fmt(c) { if (isJoker(c)) return c === RED_JOKER ? '🃏R' : '🃏B'; const { rank, suit } = parseCard(c); return `${rank}${SUIT_SYMBOL[suit]}`; }

export function viewFor(state, id) {
  const undef = undefendedCount(state);
  let toActId;
  if (state.phase !== 'playing') toActId = null;
  else if (state.takeMode) toActId = state.players[state.priorityIndex]?.id;
  else if (undef > 0) toActId = state.players[state.defenderIndex].id;
  else if (state.jokerUsed && state.table.length > 0) toActId = state.players[state.defenderIndex].id;
  else if (state.table.length === 0) { const o = effectiveOpener(state); toActId = o >= 0 ? state.players[o].id : null; }
  else toActId = state.players[state.priorityIndex]?.id;

  return {
    deckSize: state.deckSize, handSize: state.handSize, trumpSuit: state.trumpSuit, trumpCard: state.trumpCard,
    deckCount: state.deck.length, discardCount: state.discardCount,
    table: state.table.map((p) => ({ attack: p.attack, defense: p.defense })),
    phase: state.phase, loserId: state.loserId,
    takeMode: state.takeMode,
    jokerUsed: state.jokerUsed,
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

export const _internals = { canBeat, canTransfer, canJokerDefend, hasAddable, undefendedCount, cardColor, isJoker, ranksForDeck, SUIT_SYMBOL };
