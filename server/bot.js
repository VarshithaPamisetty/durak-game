// Simple Durak bot AI. Picks one legal action at a time; the server calls this
// repeatedly (with a small delay) until the bot has nothing left to do.
import { legalActions, parseCard, _internals } from './game.js';

const { canBeat } = _internals;

function rankVal(state, rank) { return state.ranks.indexOf(rank); }

// Lower is "cheaper". Trumps are valued far higher so the bot saves them.
function cardCost(state, card) {
  const { rank, suit } = parseCard(card);
  return rankVal(state, rank) + (suit === state.trumpSuit ? 100 : 0);
}

/**
 * Returns a single action object for the bot, or null if it should wait.
 */
export function chooseBotAction(state, id) {
  if (state.phase !== 'playing') return null;
  const actions = legalActions(state, id);
  if (actions.length === 0) return null;

  const idx = state.players.findIndex((p) => p.id === id);
  const me = state.players[idx];
  const isDefender = idx === state.defenderIndex;

  if (isDefender) {
    const undef = state.table
      .map((pair, i) => ({ pair, i }))
      .filter((x) => !x.pair.defense);

    if (undef.length === 0) return null;

    // Find the cheapest beat across all undefended attacks.
    let best = null;
    for (const { pair, i } of undef) {
      const options = me.hand
        .filter((c) => canBeat(pair.attack, c, state))
        .sort((a, b) => cardCost(state, a) - cardCost(state, b));
      if (options.length) {
        const cost = cardCost(state, options[0]);
        if (!best || cost < best.cost) best = { attackIndex: i, card: options[0], cost };
      }
    }
    // Defend if we can do so without spending a trump on a non-trump attack
    // unnecessarily; otherwise, if every remaining beat costs a high trump and
    // we're badly outmatched, just take.
    if (best) return { type: 'defend', attackIndex: best.attackIndex, card: best.card };
    return { type: 'take' };
  }

  // Attacker / thrower.
  if (state.table.length === 0) {
    if (actions.includes('attack')) {
      const card = me.hand.slice().sort((a, b) => cardCost(state, a) - cardCost(state, b))[0];
      return { type: 'attack', cards: [card] };
    }
    return null;
  }

  // There are cards on the table.
  if (actions.includes('done')) {
    // Everything is currently beaten. Occasionally pile on a cheap matching card,
    // otherwise end the bout.
    if (actions.includes('attack')) {
      const ranksOnTable = new Set();
      for (const pair of state.table) {
        ranksOnTable.add(parseCard(pair.attack).rank);
        if (pair.defense) ranksOnTable.add(parseCard(pair.defense).rank);
      }
      const throwable = me.hand
        .filter((c) => ranksOnTable.has(parseCard(c).rank) && parseCard(c).suit !== state.trumpSuit)
        .sort((a, b) => cardCost(state, a) - cardCost(state, b));
      if (throwable.length && Math.random() < 0.5) {
        return { type: 'attack', cards: [throwable[0]] };
      }
    }
    return { type: 'done' };
  }

  // Undefended cards remain but we're not the defender — wait for the defender.
  return null;
}

// Pick a fun bot name not already used in the room.
const BOT_NAMES = ['Botvinnik', 'Robo', 'Botley', 'Circuit', 'Pixel', 'Domino', 'Joker', 'Ace-9000'];
export function botName(existingNames) {
  const used = new Set(existingNames);
  const free = BOT_NAMES.filter((n) => !used.has('🤖 ' + n));
  const base = free.length ? free[Math.floor(Math.random() * free.length)] : 'Bot' + (Math.floor(Math.random() * 900) + 100);
  return '🤖 ' + base;
}
