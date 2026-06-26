'use strict';

const SUIT_SYMBOL = { S: '♠', H: '♥', D: '♦', C: '♣' };
const RED_SUITS = new Set(['H', 'D']);
const AVATAR_COLORS = ['#bf6068', '#4f8c74', '#c2a04e', '#5a7c98', '#8a78a4', '#bc8556', '#5b9aa0', '#a86d83'];

const SS = {
  ws: null,
  connected: false,
  playerId: null,
  code: null,
  name: '',
  view: null,
  room: null,
  selected: new Set(),
  soundOn: true,
  prevHand: new Set(),      // cards held last render (animate only newly drawn)
  prevTableCards: new Set(),// table cards last render (animate only new)
  endShown: false,
};

// ---------- persistence ----------
function saveSession() {
  if (SS.code && SS.playerId) {
    localStorage.setItem('durak.session', JSON.stringify({ code: SS.code, playerId: SS.playerId, name: SS.name }));
  }
}
function clearSession() { localStorage.removeItem('durak.session'); }
function loadSession() {
  try { return JSON.parse(localStorage.getItem('durak.session') || 'null'); } catch { return null; }
}

// ---------- connection ----------
function connect() {
  return new Promise((resolve) => {
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(`${proto}://${location.host}`);
    SS.ws = ws;
    ws.onopen = () => { SS.connected = true; updateConn(); resolve(); };
    ws.onmessage = (e) => handle(JSON.parse(e.data));
    ws.onclose = () => {
      SS.connected = false; updateConn();
      // try to reconnect & rejoin if we were in a room
      setTimeout(async () => {
        if (SS.code && SS.playerId) {
          await connect();
          send('rejoin', { code: SS.code, playerId: SS.playerId });
        }
      }, 1200);
    };
    ws.onerror = () => {};
  });
}

function send(type, payload = {}) {
  if (SS.ws && SS.ws.readyState === WebSocket.OPEN) SS.ws.send(JSON.stringify({ type, ...payload }));
}

function handle(msg) {
  switch (msg.type) {
    case 'joined':
      SS.playerId = msg.playerId; SS.code = msg.code;
      if (msg.you) SS.name = msg.you.name;
      saveSession();
      break;
    case 'lobby':
      SS.room = msg.room; SS.view = null; SS.endShown = false;
      renderLobby(); showScreen('lobby');
      break;
    case 'state':
      SS.room = msg.room; SS.view = msg.view;
      pruneSelection();
      showScreen('game'); renderGame();
      break;
    case 'session-invalid':
      clearSession(); SS.code = null; SS.playerId = null;
      showScreen('home');
      break;
    case 'error':
      sound('error'); toast(msg.message, 'warn');
      break;
  }
}

function updateConn() {
  const cls = SS.connected ? 'on' : 'off';
  ['conn-dot-home', 'conn-dot'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.className = 'conn-dot ' + cls;
  });
  const t = document.getElementById('conn-text-home');
  if (t) t.textContent = SS.connected ? 'connected' : 'reconnecting…';
}

// ---------- screens ----------
function showScreen(name) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
}

// ---------- toasts ----------
let toastTimer = 0;
function toast(message, kind = 'info', ms = 2600) {
  const host = document.getElementById('toast-host');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.classList.add('out');
    setTimeout(() => el.remove(), 320);
  }, ms);
}

// ---------- sound (WebAudio, no assets) ----------
let actx = null;
function sound(kind) {
  if (!SS.soundOn) return;
  try {
    actx = actx || new (window.AudioContext || window.webkitAudioContext)();
    const now = actx.currentTime;
    const notes = {
      select: [[660, 0.05]],
      deal:   [[420, 0.05]],
      play:   [[520, 0.07]],
      beat:   [[700, 0.08], [900, 0.06]],
      take:   [[300, 0.12]],
      win:    [[523, 0.1], [659, 0.1], [784, 0.16]],
      lose:   [[300, 0.16], [220, 0.22]],
      error:  [[200, 0.12]],
      join:   [[600, 0.06], [800, 0.06]],
    }[kind] || [[500, 0.05]];
    let t = now;
    for (const [freq, dur] of notes) {
      const osc = actx.createOscillator();
      const gain = actx.createGain();
      osc.type = 'triangle';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(gain).connect(actx.destination);
      osc.start(t); osc.stop(t + dur + 0.02);
      t += dur;
    }
  } catch {}
}
function setSound(on) {
  SS.soundOn = on;
  localStorage.setItem('durak.sound', on ? '1' : '0');
  ['sound-toggle', 'sound-toggle-home'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.textContent = on ? '🔊' : '🔇';
  });
}

// ---------- avatar ----------
function avatarColor(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}
function avatarEl(name, id, cls = '') {
  const a = document.createElement('div');
  a.className = 'avatar ' + cls;
  a.style.background = avatarColor(id);
  a.textContent = (name || '?').trim().charAt(0).toUpperCase();
  return a;
}

// ---------- home ----------
function initHome() {
  // restore prefs
  const savedSound = localStorage.getItem('durak.sound');
  setSound(savedSound !== '0');
  const savedName = localStorage.getItem('durak.name');
  if (savedName) document.getElementById('home-name').value = savedName;

  document.querySelectorAll('.tab').forEach((tab) => {
    tab.onclick = () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.tab-body').forEach((b) => b.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('tab-' + tab.dataset.tab).classList.add('active');
    };
  });

  const pl = document.getElementById('opt-players');
  const hand = document.getElementById('opt-hand');
  hand.oninput = () => (document.getElementById('lbl-hand').textContent = hand.value);

  document.getElementById('btn-create').onclick = async () => {
    const name = nameVal();
    if (!name) return homeErr('Enter your name first.');
    await ensureConnected();
    send('create', { name, maxPlayers: +pl.value, handSize: +hand.value, deckSize: +document.getElementById('opt-deck').value });
    sound('join');
  };
  document.getElementById('btn-join').onclick = async () => {
    const name = nameVal();
    const code = document.getElementById('join-code').value.trim().toUpperCase();
    if (!name) return homeErr('Enter your name first.');
    if (code.length !== 4) return homeErr('Room code is 4 letters.');
    await ensureConnected();
    send('join', { name, code });
    sound('join');
  };

  document.getElementById('sound-toggle-home').onclick = () => setSound(!SS.soundOn);
  document.getElementById('sound-toggle').onclick = () => setSound(!SS.soundOn);
}

function nameVal() {
  const n = document.getElementById('home-name').value.trim();
  if (n) { SS.name = n; localStorage.setItem('durak.name', n); }
  return n;
}
function homeErr(m) {
  const el = document.getElementById('home-error');
  el.textContent = m;
  setTimeout(() => { if (el.textContent === m) el.textContent = ''; }, 4000);
}

async function ensureConnected() {
  if (!SS.ws || SS.ws.readyState !== WebSocket.OPEN) await connect();
}

// ---------- lobby ----------
function renderLobby() {
  const r = SS.room;
  document.getElementById('lobby-code').textContent = r.code;
  const o = r.options;
  document.getElementById('lobby-rules').textContent =
    `${o.deckSize}-card deck · ${o.handSize} cards each · up to ${o.maxPlayers} players · transfers on`;

  const list = document.getElementById('lobby-players');
  list.innerHTML = '';
  const isHost = SS.playerId === r.hostId;
  r.players.forEach((p) => {
    const li = document.createElement('li');
    li.appendChild(avatarEl(p.isBot ? 'B' : p.name, p.id));
    const nm = document.createElement('span');
    nm.className = 'pname';
    nm.textContent = p.name + (p.id === SS.playerId ? ' (you)' : '');
    li.appendChild(nm);
    if (p.id === r.hostId) {
      const h = document.createElement('span'); h.className = 'host'; h.textContent = 'HOST'; li.appendChild(h);
    } else if (p.isBot) {
      const tag = document.createElement('span'); tag.className = 'host bot-tag'; tag.textContent = 'BOT'; li.appendChild(tag);
      if (isHost) {
        const rm = document.createElement('button');
        rm.className = 'rm-bot'; rm.textContent = '✕'; rm.title = 'Remove bot';
        rm.onclick = () => { send('removebot', { playerId: p.id }); sound('select'); };
        li.appendChild(rm);
      }
    } else if (!p.connected) {
      const o2 = document.createElement('span'); o2.className = 'off-tag'; o2.textContent = 'offline'; li.appendChild(o2);
    }
    list.appendChild(li);
  });

  const addBotBtn = document.getElementById('btn-addbot');
  const roomFull = r.players.length >= r.options.maxPlayers;
  addBotBtn.style.display = isHost && !roomFull ? 'block' : 'none';

  const startBtn = document.getElementById('btn-start');
  startBtn.style.display = isHost ? 'block' : 'none';
  startBtn.disabled = r.players.length < 2;
  document.getElementById('lobby-note').textContent = isHost
    ? (r.players.length < 2 ? 'Waiting for at least one more player…' : 'Everyone in? Press start!')
    : 'Waiting for the host to start…';
}

// Keep only cards we still actually hold (prevents "you don't hold that card").
function pruneSelection() {
  const me = SS.view && SS.view.players.find((p) => p.id === SS.view.you);
  if (!me || !me.hand) { SS.selected.clear(); return; }
  const hand = new Set(me.hand);
  for (const c of [...SS.selected]) if (!hand.has(c)) SS.selected.delete(c);
}

// ---------- game ----------
function renderGame() {
  const v = SS.view;
  if (!v) return;

  document.getElementById('game-code').textContent = SS.code;
  const tb = document.getElementById('trump-badge');
  tb.className = 'trump-badge ' + (RED_SUITS.has(v.trumpSuit) ? 'red' : 'black');
  document.getElementById('tb-suit').textContent = SUIT_SYMBOL[v.trumpSuit];

  document.getElementById('deck-count').textContent = v.deckCount;
  document.getElementById('discard-count').textContent = v.discardCount;
  renderTrumpUnder(v);

  renderOpponents(v);
  renderTable(v);
  renderStatus(v);
  renderActions(v);
  renderHand(v);
  renderOverlay(v);
  renderLog(v);
}

function renderLog(v) {
  const el = document.getElementById('log');
  if (!el) return;
  el.innerHTML = (v.log || []).slice(-6).map((l) => `<div>${escapeHtml(l)}</div>`).join('');
  el.scrollTop = el.scrollHeight;
}

function renderTrumpUnder(v) {
  const slot = document.getElementById('trump-under');
  const deckPile = document.getElementById('deck-pile');
  slot.innerHTML = '';
  // Trump card is ALWAYS shown face-up; the face-down stack hides when the talon is empty.
  const c = cardEl(v.trumpCard); c.classList.add('trumpcard'); slot.appendChild(c);
  deckPile.classList.toggle('empty', v.deckCount === 0);
}

function renderOpponents(v) {
  const box = document.getElementById('opponents');
  box.innerHTML = '';
  // order others starting after me for a natural seating
  const others = v.players.filter((p) => p.id !== v.you);
  others.forEach((p) => {
    const div = document.createElement('div');
    let cls = 'opp';
    const isAtt = p.id === v.primaryId || p.id === v.secondaryId;
    const isDef = p.id === v.defenderId;
    const isDone = (v.donePlayers || []).includes(p.id);
    if (isAtt) cls += ' attacker';
    if (isDef) cls += ' defender';
    if (p.id === v.toActId && v.phase === 'playing') cls += ' turn';
    if (p.out) cls += ' out';
    div.className = cls;

    const head = document.createElement('div');
    head.className = 'opp-head';
    head.appendChild(avatarEl(p.isBot ? 'B' : p.name, p.id));
    const nm = document.createElement('span'); nm.className = 'name'; nm.textContent = p.name;
    head.appendChild(nm);
    div.appendChild(head);

    const mini = document.createElement('div'); mini.className = 'mini-cards';
    for (let i = 0; i < Math.min(p.handCount, 8); i++) {
      const m = document.createElement('span'); m.className = 'mini-card'; mini.appendChild(m);
    }
    div.appendChild(mini);

    const cards = document.createElement('div'); cards.className = 'cards';
    cards.textContent = p.out ? 'out' : `${p.handCount} card${p.handCount === 1 ? '' : 's'}`;
    div.appendChild(cards);

    const role = document.createElement('div'); role.className = 'role';
    role.textContent = isDef ? (v.takeMode ? 'Taking' : 'Defender') : isAtt ? 'Attacker' : '';
    div.appendChild(role);

    if (v.closing && isDone) { const t = document.createElement('span'); t.className = 'donecheck'; t.textContent = '✓'; div.appendChild(t); }
    if (!p.connected) { const d = document.createElement('span'); d.className = 'offdot'; div.appendChild(d); }
    box.appendChild(div);
  });
}

function renderTable(v) {
  const pairs = document.getElementById('table-pairs');
  const msg = document.getElementById('table-msg');
  pairs.innerHTML = '';
  const defending = v.you === v.defenderId && !v.takeMode && v.table.some((p) => !p.defense);
  const sel = SS.selected.size === 1 ? [...SS.selected][0] : null;
  const selJoker = sel && isJokerC(sel);

  const seen = new Set();
  v.table.forEach((pair, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'pair' + (pair.defense ? ' beaten' : '');
    const a = cardEl(pair.attack); a.classList.add('attack');
    if (!SS.prevTableCards.has(pair.attack)) a.classList.add('enter');
    wrap.appendChild(a);
    seen.add(pair.attack);
    if (pair.defense) {
      const d = cardEl(pair.defense); d.classList.add('defense');
      if (!SS.prevTableCards.has(pair.defense)) d.classList.add('enter');
      wrap.appendChild(d);
      seen.add(pair.defense);
    } else if (defending && sel) {
      const ok = selJoker ? cardColorC(sel) === cardColorC(pair.attack)
        : canBeatC(sel, pair.attack, v.trumpSuit, v.deckSize);
      if (ok) {
        wrap.classList.add('targetable');
        wrap.onclick = () => {
          const card = [...SS.selected][0];
          if (isJokerC(card)) send('action', { action: { type: 'jokerdefend', attackIndex: i, card } });
          else send('action', { action: { type: 'defend', attackIndex: i, card } });
          sound('beat');
        };
      } else {
        wrap.onclick = () => toast("That card can't beat this one", 'warn', 1400);
      }
    }
    pairs.appendChild(wrap);
  });
  SS.prevTableCards = seen;

  // table message
  if (v.takeMode) {
    msg.textContent = v.you === v.defenderId ? 'You are taking — collecting the cards…'
      : (v.you === v.adderId ? 'Load the taker — add matching cards, or Done'
        : 'Press Done to continue');
  } else if (v.table.length === 0) {
    msg.textContent = v.toActId === v.you ? 'Your attack — pick same-rank card(s), then Attack'
      : `${nameOf(v, v.toActId)} is about to attack…`;
  } else if (defending && selJoker) {
    msg.textContent = 'Tap a matching-colour card — then Finish to push the rest';
  } else if (defending && sel) {
    msg.textContent = 'Tap a glowing card to beat it';
  } else if (defending) {
    msg.textContent = 'Select a card from your hand to defend';
  } else if (v.closing) {
    msg.textContent = v.you === v.adderId ? 'Your turn — add cards or Done' : 'Press Done to close';
  } else {
    msg.textContent = '';
  }
}

function isDefenseSelection(v) {
  // a single selected card that is NOT part of a transfer move
  if (SS.selected.size !== 1) return false;
  const card = [...SS.selected][0];
  return !(v.yourActions.includes('transfer') && parseCard(card).rank === parseCard(v.table[0].attack).rank);
}

function renderStatus(v) {
  let txt = '';
  if (v.phase !== 'playing') { document.getElementById('status').textContent = ''; return; }
  const youDone = (v.donePlayers || []).includes(v.you);
  if (v.takeMode) {
    if (v.you === v.defenderId) txt = 'You are taking…';
    else if (v.you === v.adderId) txt = 'Load the taker — add a card or Done';
    else if (!youDone) txt = 'Press Done to continue';
    else txt = `Waiting — ${(v.pendingDone || []).length} to confirm`;
  } else if (v.you === v.defenderId && v.table.some((p) => !p.defense)) {
    if (v.jokerUsed) txt = 'Joker played — beat more, or Finish to push the rest';
    else txt = (v.yourActions || []).includes('jokerdefend')
      ? 'Defend — pick a card, or tap a Joker then a matching card'
      : 'Defend — pick a card to beat with';
  } else if (v.closing) {
    if (v.you === v.adderId) txt = 'Your turn — add cards or Done';
    else if (!youDone) txt = 'Press Done to close the attack';
    else txt = `Waiting for ${(v.pendingDone || []).length} player(s) to press Done`;
  } else if (v.table.length === 0 && v.you === v.toActId) {
    txt = 'Your attack';
  } else if (v.toActId && v.toActId !== v.you) {
    txt = `Waiting for ${nameOf(v, v.toActId)}…`;
  }
  document.getElementById('status').textContent = txt;
}

function renderActions(v) {
  const box = document.getElementById('actions');
  box.innerHTML = '';
  const acts = v.yourActions || [];
  const sel = [...SS.selected];

  if (acts.includes('attack')) {
    const isOpen = v.table.length === 0;
    addBtn(box, isOpen ? 'Attack' : 'Add card', 'act-primary', sel.length === 0, () => {
      send('action', { action: { type: 'attack', cards: sel } }); sound('play');
    });
  }
  if (acts.includes('transfer')) {
    addBtn(box, 'Transfer', 'act-warn', sel.length === 0, () => {
      send('action', { action: { type: 'transfer', cards: sel } }); sound('play');
    });
  }
  if (acts.includes('take')) {
    addBtn(box, 'Take', 'act-danger', false, () => {
      send('action', { action: { type: 'take' } }); sound('take');
    });
  }
  if (acts.includes('done')) {
    const amDef = v.you === v.defenderId && !v.takeMode;
    if (amDef && v.jokerUsed) {
      addBtn(box, 'Finish — push rest', 'act-warn', false, () => { send('action', { action: { type: 'done' } }); sound('beat'); });
    } else {
      const left = (v.pendingDone || []).length;
      const label = left > 1 ? `Done (${left} left)` : 'Done';
      addBtn(box, label, 'act-primary', false, () => { send('action', { action: { type: 'done' } }); sound('beat'); });
    }
  }
  if (sel.length > 0) {
    addBtn(box, 'Clear', 'act-plain', false, () => { SS.selected.clear(); renderGame(); });
  }
}

function addBtn(box, label, cls, disabled, onclick) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.classList.add(cls);
  b.disabled = disabled;
  b.onclick = onclick;
  box.appendChild(b);
}

function renderHand(v) {
  const hand = document.getElementById('hand');
  const me = v.players.find((p) => p.id === v.you);
  if (!me || !me.hand) { hand.innerHTML = ''; return; }

  const sig = me.hand.join(',');
  const grew = me.hand.some((c) => !SS.prevHand.has(c));

  const selCard = SS.selected.size ? [...SS.selected][0] : null;
  const selRank = selCard && !isJokerC(selCard) ? parseCard(selCard).rank : null;
  const defending = v.you === v.defenderId && v.table.some((p) => !p.defense);

  hand.innerHTML = '';
  me.hand.forEach((card) => {
    const el = cardEl(card);
    const { suit, rank } = parseCard(card);
    if (suit === v.trumpSuit) el.classList.add('trumpcard');
    if (SS.selected.has(card)) el.classList.add('selected');
    if (selRank && !defending && rank !== selRank && !SS.selected.has(card)) el.classList.add('dimmed');
    el.onclick = () => toggleSelect(card, v);
    hand.appendChild(el);
  });

  fitHand();
  SS.prevHand = new Set(me.hand);
  if (grew && SS.justDealt !== sig) { sound('deal'); SS.justDealt = sig; }
}

function fitHand() {
  const wrap = document.querySelector('.hand-wrap');
  const hand = document.getElementById('hand');
  const cards = [...hand.children];
  const n = cards.length;
  if (!n) return;
  const cw = cards[0].offsetWidth || 60;
  const avail = wrap.clientWidth - 40; // account for padding + edge breathing room
  const maxStep = cw * 0.62;           // comfortable spacing when there's room
  let step = n > 1 ? Math.min(maxStep, (avail - cw) / (n - 1)) : 0;
  step = Math.max(step, 14);           // never collapse to nothing
  cards.forEach((el, i) => { el.style.marginLeft = i === 0 ? '0px' : (step - cw) + 'px'; });
  const total = cw + (n - 1) * step;
  hand.style.justifyContent = total > avail ? 'flex-start' : 'center';
}
window.addEventListener('resize', () => { if (SS.view) fitHand(); });

function toggleSelect(card, v) {
  if (SS.selected.has(card)) { SS.selected.delete(card); sound('select'); renderGame(); return; }
  // Same-rank non-joker cards accumulate (for multi attacks/transfer); anything else resets.
  const rank = isJokerC(card) ? null : parseCard(card).rank;
  const mixed = [...SS.selected].some((c) => isJokerC(c) || isJokerC(card) || parseCard(c).rank !== rank);
  if (mixed) SS.selected.clear();
  SS.selected.add(card);
  sound('select');
  renderGame();
}

function renderOverlay(v) {
  const ov = document.getElementById('overlay');
  if (v.phase !== 'finished') { ov.classList.remove('active'); hideConfetti(); SS.endShown = false; return; }
  ov.classList.add('active');
  const emoji = document.getElementById('overlay-emoji');
  const title = document.getElementById('overlay-title');
  const text = document.getElementById('overlay-text');

  if (v.loserId === v.you) {
    emoji.textContent = '✖'; emoji.style.color = '#c62b3c';
    title.textContent = 'You are the Durak'; text.textContent = 'Last one holding cards. Try again.';
    if (!SS.endShown) sound('lose');
  } else if (v.loserId) {
    emoji.textContent = '♛'; emoji.style.color = 'var(--gold)';
    title.textContent = 'You win'; text.textContent = `${nameOf(v, v.loserId)} is the Durak.`;
    if (!SS.endShown) { sound('win'); launchConfetti(); }
  } else {
    emoji.textContent = '='; emoji.style.color = 'var(--muted)';
    title.textContent = 'Draw'; text.textContent = 'No Durak this round.';
  }
  SS.endShown = true;
  const isHost = SS.room && SS.playerId === SS.room.hostId;
  document.getElementById('btn-rematch').style.display = isHost ? 'block' : 'none';
}

// ---------- card rendering ----------
const RANKS_BY_DECK = {
  52: ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
  36: ['6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'],
  24: ['9', '10', 'J', 'Q', 'K', 'A'],
  20: ['10', 'J', 'Q', 'K', 'A'],
};
// Pip positions (x%, y%) within the pip area; pips below the middle are flipped.
const PIPS = {
  '2': [[50, 6], [50, 94]],
  '3': [[50, 6], [50, 50], [50, 94]],
  '4': [[18, 8], [82, 8], [18, 92], [82, 92]],
  '5': [[18, 8], [82, 8], [50, 50], [18, 92], [82, 92]],
  '6': [[18, 8], [82, 8], [18, 50], [82, 50], [18, 92], [82, 92]],
  '7': [[18, 8], [82, 8], [50, 29], [18, 50], [82, 50], [18, 92], [82, 92]],
  '8': [[18, 8], [82, 8], [50, 29], [18, 50], [82, 50], [50, 71], [18, 92], [82, 92]],
  '9': [[18, 6], [82, 6], [18, 37], [82, 37], [50, 50], [18, 63], [82, 63], [18, 94], [82, 94]],
  '10': [[18, 6], [82, 6], [50, 21], [18, 37], [82, 37], [18, 63], [82, 63], [50, 79], [18, 94], [82, 94]],
};
function canBeatC(attack, defense, trumpSuit, deckSize) {
  if (isJokerC(defense)) return cardColorC(defense) === cardColorC(attack);
  if (isJokerC(attack)) return false;
  const ranks = RANKS_BY_DECK[deckSize] || RANKS_BY_DECK[36];
  const A = parseCard(attack), D = parseCard(defense);
  const aT = A.suit === trumpSuit, dT = D.suit === trumpSuit;
  if (aT) return dT && ranks.indexOf(D.rank) > ranks.indexOf(A.rank);
  if (dT) return true;
  return D.suit === A.suit && ranks.indexOf(D.rank) > ranks.indexOf(A.rank);
}
function isJokerC(id) { return id === 'RJ' || id === 'BJ'; }
function cardColorC(id) {
  if (id === 'RJ') return 'red';
  if (id === 'BJ') return 'black';
  const s = id.slice(-1);
  return (s === 'H' || s === 'D') ? 'red' : 'black';
}
function cardEl(id) {
  if (isJokerC(id)) {
    const el = document.createElement('div');
    const red = id === 'RJ';
    el.className = 'playing-card joker ' + (red ? 'jr' : 'jb');
    el.innerHTML = `<span class="ci tl">★</span><div class="pip-a">🃏</div><div class="jlabel">${red ? 'RED' : 'BLACK'}</div><span class="ci br">★</span>`;
    return el;
  }
  const { rank, suit } = parseCard(id);
  const el = document.createElement('div');
  el.className = 'playing-card' + (RED_SUITS.has(suit) ? ' red' : '');
  const sym = SUIT_SYMBOL[suit];
  const idx = `<span class="ci tl">${rank}<i>${sym}</i></span><span class="ci br">${rank}<i>${sym}</i></span>`;
  let center;
  if (rank === 'J' || rank === 'Q' || rank === 'K') {
    center = `<div class="court">${sym}<b>${rank}</b>${sym}</div>`;
  } else if (rank === 'A') {
    center = `<div class="pip-a">${sym}</div>`;
  } else {
    const pos = PIPS[rank] || [];
    center = '<div class="pips">' + pos.map(([x, y]) =>
      `<span class="pip" style="left:${x}%;top:${y}%${y > 50 ? ';transform:translate(-50%,-50%) rotate(180deg)' : ''}">${sym}</span>`).join('') + '</div>';
  }
  el.innerHTML = idx + center;
  return el;
}
function parseCard(id) { return { suit: id.slice(-1), rank: id.slice(0, -1) }; }
function nameOf(v, id) { const p = v.players.find((x) => x.id === id); return p ? p.name : '?'; }

// ---------- confetti ----------
let confettiRAF = 0;
function launchConfetti() {
  const cv = document.getElementById('confetti');
  cv.classList.add('active');
  const ctx = cv.getContext('2d');
  cv.width = innerWidth; cv.height = innerHeight;
  const N = 90;
  const COLORS = ['#f0cf76', '#c9a23f', '#f4f5f0', '#e8d9a0', '#ffffff'];
  const parts = Array.from({ length: N }, () => ({
    x: Math.random() * cv.width, y: -20 - Math.random() * cv.height,
    r: 4 + Math.random() * 5, c: COLORS[(Math.random() * COLORS.length) | 0],
    vy: 2 + Math.random() * 3, vx: -1 + Math.random() * 2, rot: Math.random() * 6, vr: -0.2 + Math.random() * 0.4,
  }));
  let frames = 0;
  cancelAnimationFrame(confettiRAF);
  (function loop() {
    ctx.clearRect(0, 0, cv.width, cv.height);
    parts.forEach((p) => {
      p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
      ctx.fillStyle = p.c; ctx.fillRect(-p.r / 2, -p.r / 2, p.r, p.r * 1.6); ctx.restore();
    });
    frames++;
    if (frames < 260) confettiRAF = requestAnimationFrame(loop); else hideConfetti();
  })();
}
function hideConfetti() {
  cancelAnimationFrame(confettiRAF);
  const cv = document.getElementById('confetti');
  cv.classList.remove('active');
  const ctx = cv.getContext('2d'); ctx && ctx.clearRect(0, 0, cv.width, cv.height);
}

// ---------- copy ----------
function copyCode() {
  if (!SS.code) return;
  const done = () => toast('Room code copied!', 'good', 1600);
  if (navigator.share) { navigator.share({ title: 'Durak', text: `Join my Durak game — room code ${SS.code}`, url: location.href }).catch(() => {}); return; }
  navigator.clipboard?.writeText(SS.code).then(done, () => toast(`Code: ${SS.code}`, 'info'));
}

// ---------- wire static buttons ----------
document.getElementById('btn-start').onclick = () => { send('start'); sound('deal'); };
document.getElementById('btn-addbot').onclick = () => { send('addbot'); sound('join'); };
document.getElementById('btn-rematch').onclick = () => { send('rematch'); SS.endShown = false; sound('deal'); };
document.getElementById('lobby-code').onclick = copyCode;
document.getElementById('game-code').onclick = copyCode;
document.getElementById('btn-leave-lobby').onclick = leave;
document.getElementById('btn-leave-game').onclick = leave;
function leave() {
  try { send('leave'); } catch {}
  clearSession();
  SS.code = null; SS.playerId = null; SS.view = null; SS.room = null;
  SS.selected.clear(); SS.prevHand = new Set(); SS.prevTableCards = new Set(); SS.endShown = false;
  hideConfetti();
  document.getElementById('overlay').classList.remove('active');
  showScreen('home');
}

// ---------- boot ----------
async function boot() {
  initHome();
  updateConn();
  await connect();
  const sess = loadSession();
  if (sess && sess.code && sess.playerId) {
    SS.code = sess.code; SS.playerId = sess.playerId; SS.name = sess.name || '';
    send('rejoin', { code: sess.code, playerId: sess.playerId });
  }
}
boot();

// Register service worker (enables install / "Add to Home Screen").
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
