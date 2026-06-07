// Durak bot for the all-players-Done closing model.
import { legalActions, parseCard, isJoker, cardColor, _internals } from './game.js';
const { canBeat } = _internals;

function rankVal(state, rank) { return state.ranks.indexOf(rank); }
function cardCost(state, card) {
  if (isJoker(card)) return 1000;
  const { rank, suit } = parseCard(card);
  return rankVal(state, rank) + (suit === state.trumpSuit ? 100 : 0);
}

export function chooseBotAction(state, id) {
  if (state.phase !== 'playing') return null;
  const actions = legalActions(state, id);
  if (actions.length === 0) return null;
  const idx = state.players.findIndex((p) => p.id === id);
  const me = state.players[idx];

  // Defender (not taking)
  if (idx === state.defenderIndex && !state.takeMode) {
    const undef = state.table.map((pair, i) => ({ pair, i })).filter((x) => !x.pair.defense);
    if (undef.length === 0) return actions.includes('done') ? { type: 'done' } : null;
    let best = null;
    for (const { pair, i } of undef) {
      const opts = me.hand.filter((c) => !isJoker(c) && canBeat(pair.attack, c, state)).sort((a, b) => cardCost(state, a) - cardCost(state, b));
      if (opts.length) { const cost = cardCost(state, opts[0]); if (!best || cost < best.cost) best = { attackIndex: i, card: opts[0], cost }; }
    }
    if (best) return { type: 'defend', attackIndex: best.attackIndex, card: best.card };
    if (actions.includes('jokerdefend')) {
      const jokers = me.hand.filter(isJoker);
      for (const { pair, i } of undef) { const j = jokers.find((jj) => cardColor(jj) === cardColor(pair.attack)); if (j) return { type: 'jokerdefend', attackIndex: i, card: j }; }
    }
    if (actions.includes('done')) return { type: 'done' }; // finish joker
    return { type: 'take' };
  }

  // Opening
  if (!state.takeMode && state.table.length === 0) {
    if (actions.includes('attack')) {
      const card = me.hand.filter((c) => !isJoker(c)).sort((a, b) => cardCost(state, a) - cardCost(state, b))[0];
      if (card) return { type: 'attack', cards: [card] };
    }
    return null;
  }

  // Closing phase: maybe add (if it's our priority), else confirm Done.
  if (actions.includes('attack')) {
    const ranks = new Set();
    for (const pair of state.table) { if (!isJoker(pair.attack)) ranks.add(parseCard(pair.attack).rank); if (pair.defense && !isJoker(pair.defense)) ranks.add(parseCard(pair.defense).rank); }
    const throwable = me.hand.filter((c) => !isJoker(c) && ranks.has(parseCard(c).rank) && parseCard(c).suit !== state.trumpSuit).sort((a, b) => cardCost(state, a) - cardCost(state, b));
    const defender = state.players[state.defenderIndex];
    if (throwable.length && (state.takeMode || defender.hand.length <= 2 || Math.random() < 0.4)) {
      return { type: 'attack', cards: [throwable[0]] };
    }
  }
  if (actions.includes('done')) return { type: 'done' };
  return null;
}

const BOT_NAMES = ['Botvinnik', 'Robo', 'Botley', 'Circuit', 'Pixel', 'Domino', 'Jester', 'Ace-9000', 'Vega', 'Nimbus', 'Quark', 'Echo'];
export function botName(existingNames) {
  const used = new Set(existingNames);
  const free = BOT_NAMES.filter((n) => !used.has('🤖 ' + n));
  const base = free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot' + (Math.floor(Math.random() * 900) + 100);
  return '🤖 ' + base;
}
