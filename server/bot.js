// Simple Durak bot for the neighbour-only, left-priority model.
// Returns one action at a time, or null if the bot should wait.
import { legalActions, parseCard, _internals } from './game.js';

const { canBeat } = _internals;

function rankVal(state, rank) { return state.ranks.indexOf(rank); }
function cardCost(state, card) {
  const { rank, suit } = parseCard(card);
  return rankVal(state, rank) + (suit === state.trumpSuit ? 100 : 0);
}

export function chooseBotAction(state, id) {
  if (state.phase !== 'playing') return null;
  const actions = legalActions(state, id);
  if (actions.length === 0) return null;

  const idx = state.players.findIndex((p) => p.id === id);
  const me = state.players[idx];

  // Defender
  if (idx === state.defenderIndex) {
    const undef = state.table.map((pair, i) => ({ pair, i })).filter((x) => !x.pair.defense);
    if (undef.length === 0) return null;
    let best = null;
    for (const { pair, i } of undef) {
      const opts = me.hand.filter((c) => canBeat(pair.attack, c, state)).sort((a, b) => cardCost(state, a) - cardCost(state, b));
      if (opts.length) {
        const cost = cardCost(state, opts[0]);
        if (!best || cost < best.cost) best = { attackIndex: i, card: opts[0], cost };
      }
    }
    if (best) return { type: 'defend', attackIndex: best.attackIndex, card: best.card };
    return { type: 'take' };
  }

  // Opener
  if (state.table.length === 0) {
    if (actions.includes('attack')) {
      const card = me.hand.slice().sort((a, b) => cardCost(state, a) - cardCost(state, b))[0];
      return { type: 'attack', cards: [card] };
    }
    return null;
  }

  // Priority attacker on a fully-defended table: maybe pile on, else Done.
  if (actions.includes('attack')) {
    const ranks = new Set();
    for (const pair of state.table) {
      ranks.add(parseCard(pair.attack).rank);
      if (pair.defense) ranks.add(parseCard(pair.defense).rank);
    }
    const throwable = me.hand
      .filter((c) => ranks.has(parseCard(c).rank) && parseCard(c).suit !== state.trumpSuit)
      .sort((a, b) => cardCost(state, a) - cardCost(state, b));
    const defender = state.players[state.defenderIndex];
    // Keep pressure while the defender is low on cards; otherwise often stop.
    if (throwable.length && (defender.hand.length <= 2 || Math.random() < 0.5)) {
      return { type: 'attack', cards: [throwable[0]] };
    }
  }
  if (actions.includes('done')) return { type: 'done' };
  return null;
}

const BOT_NAMES = ['Botvinnik', 'Robo', 'Botley', 'Circuit', 'Pixel', 'Domino', 'Joker', 'Ace-9000'];
export function botName(existingNames) {
  const used = new Set(existingNames);
  const free = BOT_NAMES.filter((n) => !used.has('🤖 ' + n));
  const base = free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot' + (Math.floor(Math.random() * 900) + 100);
  return '🤖 ' + base;
}
