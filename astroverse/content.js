// Astroverse — a small global chat room in a floating bubble.
// Everyone shares one room: a channel on Satella, the relay orgcs-remote uses (satella.js is a copy of
// orgcs-remote/satella.js; keep them the same). Satella only relays live messages, so each page keeps the
// recent ones in storage. Messages carry your OrgCS user name unless you post anonymously; Satella proves
// each sender's key, which is how your own messages are recognized.
// The ⚙︎ menu tweaks font size, roundness, notifications and anonymity (also in Settings > Extensions).
// Drag the bubble (or the panel header) to move it; the position is remembered.

if (window.top !== window) return;
if (document.getElementById('astroverse-chat')) return;

const CHANNEL = 'astroverse.global';
const IDENTITY_KEY = 'satellaIdentity';
const MAX_MESSAGES = 100;
const MAX_LENGTH = 1000;
const BUBBLE = 44;
const EDGE = 8;

const config = { fontSize: 11, roundness: 100, notifications: true, anonymous: false, ...(await satellite.settings.getAll()) };
let open = (await satellite.storage.get('open')) === true;
let lastRead = (await satellite.storage.get('lastRead')) || 0;
let position = (await satellite.storage.get('position')) || null;
let messages = (await satellite.storage.get('history')) || [];
let seen = new Set(messages.map((m) => m.id));
let status = 'connecting';
let myName = '';
let myKey = '';
let client = null;

// The signed-in OrgCS user. Users can only see their own login sessions, and each one links to the user.
async function orgcsUserName() {
  const queries = [
    'SELECT Users.Name FROM AuthSession WHERE IsCurrent = true LIMIT 1',
    'SELECT Users.Name FROM AuthSession ORDER BY CreatedDate DESC LIMIT 1',
  ];
  for (const soql of queries) {
    try {
      const { records } = await satellite.salesforce.query(soql);
      const name = records[0] && records[0].Users && records[0].Users.Name;
      if (name) return name;
    } catch (error) {
      console.warn('[astroverse] could not look up the OrgCS user', error);
    }
  }
  return '';
}

// ---- UI -----------------------------------------------------------------

const host = document.createElement('div');
host.id = 'astroverse-chat';
host.style.cssText = 'all:initial!important;position:fixed!important;z-index:2147483000!important;width:44px!important;height:44px!important;';
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `
  <style>
    /* Font and color go on the panel and bubble: the host's inline "all: initial !important" beats :host rules. */
    :host { --r: 1; --fs: 11px; --bg: #13141f; --bg2: #1a1b2a; --line: #262840; --fg: #d7d9e8; --muted: #7d8099; --accent: #8b7bff; }
    .panel, .bubble { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; font-size: var(--fs); line-height: 1.45;
      color: var(--fg); -webkit-font-smoothing: antialiased; }
    * { box-sizing: border-box; font: inherit; color: inherit; }
    .bubble { position: relative; width: 44px; height: 44px; border-radius: calc(var(--r) * 50%); border: 0; cursor: grab; touch-action: none;
      color: #fff; font-size: 21px !important; line-height: 1; box-shadow: 0 0 0 1px #ffffff1a inset, 0 6px 20px #0d0a3a55;
      background: radial-gradient(circle at 32% 28%, #9a8cff, #5b46e0 48%, #1d1450); transition: transform .12s, filter .12s; }
    .bubble:hover { filter: brightness(1.12); transform: scale(1.04); }
    .badge { position: absolute; top: -3px; right: -3px; min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
      background: #ff4d6a; color: #fff; font-size: 10px !important; font-weight: 700; line-height: 16px; text-align: center; box-shadow: 0 0 0 2px #fff; }
    .dragging, .dragging * { cursor: grabbing !important; user-select: none; }
    .panel { position: absolute; width: 360px; height: 460px; display: flex; flex-direction: column; overflow: hidden;
      background: var(--bg); border: 1px solid var(--line); border-radius: calc(var(--r) * 14px); box-shadow: 0 16px 48px #05061366; }
    .panel.up { bottom: 54px; } .panel.down { top: 54px; } .panel.left { left: 0; } .panel.right { right: 0; }
    header { display: flex; align-items: center; gap: 7px; height: 36px; padding: 0 6px 0 12px; border-bottom: 1px solid var(--line);
      cursor: grab; touch-action: none; user-select: none; }
    header .title { flex: 1; font-weight: 650; letter-spacing: .01em; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    header .chan { color: var(--muted); font-weight: 500; margin-left: 4px; }
    header .dot { width: 6px; height: 6px; border-radius: 50%; background: #565970; flex: none; }
    header .dot.live { background: #46d98a; box-shadow: 0 0 6px #46d98a99; }
    header button { border: 0; background: transparent; color: var(--muted); cursor: pointer; width: 24px; height: 24px; padding: 0;
      font-size: 12px; border-radius: calc(var(--r) * 6px); }
    header button:hover, header button.on { background: var(--bg2); color: var(--fg); }
    .log { flex: 1; overflow-y: auto; padding: 6px 0 8px; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
    .empty { height: 100%; display: flex; align-items: center; justify-content: center; color: var(--muted); text-align: center; padding: 0 24px; }
    .day { display: flex; align-items: center; gap: 8px; margin: 8px 12px 2px; color: var(--muted); font-size: .86em;
      text-transform: uppercase; letter-spacing: .06em; }
    .day::before, .day::after { content: ""; flex: 1; height: 1px; background: var(--line); }
    .msg { padding: 1px 12px; }
    .msg.first { margin-top: 6px; }
    .msg:hover { background: var(--bg2); }
    .who { display: flex; align-items: baseline; gap: 6px; }
    .name { font-weight: 650; }
    .you { font-size: .82em; color: var(--muted); border: 1px solid var(--line); border-radius: 4px; padding: 0 3px; }
    .time { font-size: .86em; color: var(--muted); }
    .text { color: var(--fg); white-space: pre-wrap; overflow-wrap: anywhere; }
    form { display: flex; align-items: flex-end; gap: 6px; margin: 0 8px 8px; padding: 5px 5px 5px 10px; background: var(--bg2);
      border: 1px solid var(--line); border-radius: calc(var(--r) * 10px); }
    form:focus-within { border-color: #4a4378; }
    .draft { flex: 1; min-width: 0; max-height: 84px; padding: 3px 0; border: 0; outline: none; resize: none; background: transparent;
      color: var(--fg); line-height: 1.45; }
    .draft::placeholder { color: var(--muted); }
    form button { flex: none; width: 24px; height: 24px; padding: 0; border: 0; border-radius: calc(var(--r) * 7px); background: var(--accent);
      color: #fff; font-size: 13px; font-weight: 700; cursor: pointer; }
    form button:disabled { background: var(--line); color: var(--muted); cursor: default; }
    .prefs { flex: 1; overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
    .prefs h3 { margin: 0; font-size: .9em; font-weight: 700; text-transform: uppercase; letter-spacing: .06em; color: var(--muted); }
    .prefs label { display: flex; align-items: flex-start; gap: 8px; cursor: pointer; }
    .prefs label.range { flex-direction: column; gap: 6px; cursor: default; }
    .prefs input[type=checkbox] { margin: 2px 0 0; accent-color: var(--accent); }
    .prefs input[type=range] { width: 100%; accent-color: var(--accent); }
    .prefs small { display: block; color: var(--muted); font-size: .9em; }
    .prefs .reset-position { align-self: flex-start; padding: 5px 10px; border: 1px solid var(--line); border-radius: calc(var(--r) * 8px);
      background: var(--bg2); color: var(--fg); cursor: pointer; }
    .prefs .reset-position:hover { border-color: #4a4378; }
    [hidden] { display: none !important; }
  </style>
  <div class="panel" hidden>
    <header>
      <span class="dot"></span>
      <span class="title">astroverse<span class="chan">#global</span></span>
      <button class="prefs-btn" title="Settings" aria-label="Chat settings">⚙︎</button>
      <button class="close" title="Minimize" aria-label="Minimize chat">✕</button>
    </header>
    <div class="prefs" hidden>
      <h3>Settings</h3>
      <label><input type="checkbox" class="pref-anonymous">
        <span>Post anonymously<small class="anon-hint"></small></span></label>
      <label><input type="checkbox" class="pref-notifications">
        <span>Notify me about new messages<small>When the chat is closed or Satellite is in the background.</small></span></label>
      <label class="range"><span>Font size <small class="fs-value"></small></span>
        <input type="range" class="pref-fontsize" min="9" max="15" step="0.5"></label>
      <label class="range"><span>Roundness <small class="round-value"></small></span>
        <input type="range" class="pref-roundness" min="0" max="100" step="5"></label>
      <button class="reset-position">Reset bubble position</button>
    </div>
    <div class="log" role="log" aria-live="polite"></div>
    <form>
      <textarea class="draft" rows="1" maxlength="${MAX_LENGTH}" placeholder="Message #global" aria-label="Message"></textarea>
      <button type="submit" title="Send (Enter)" aria-label="Send">↑</button>
    </form>
  </div>
  <button class="bubble" aria-label="Open Astroverse chat" title="Astroverse chat">🪐<span class="badge" hidden></span></button>
`;
document.body.appendChild(host);

const $ = (selector) => root.querySelector(selector);
const panel = $('.panel'), log = $('.log'), form = $('form'), draft = $('.draft'), prefs = $('.prefs'), bubble = $('.bubble');

// ---- Position & dragging ------------------------------------------------

function clamp(x, y) {
  return {
    x: Math.min(Math.max(EDGE, x), window.innerWidth - BUBBLE - EDGE),
    y: Math.min(Math.max(EDGE, y), window.innerHeight - BUBBLE - EDGE),
  };
}

function place() {
  const { x, y } = clamp(position ? position.x : 16, position ? position.y : window.innerHeight - BUBBLE - 56);
  host.style.setProperty('left', x + 'px', 'important');
  host.style.setProperty('top', y + 'px', 'important');
  // Open the panel toward the side with more room.
  const up = y + BUBBLE / 2 > window.innerHeight / 2;
  const right = x + BUBBLE / 2 > window.innerWidth / 2;
  panel.classList.toggle('up', up);
  panel.classList.toggle('down', !up);
  panel.classList.toggle('right', right);
  panel.classList.toggle('left', !right);
}

let dragMoved = false;

function makeDraggable(handle) {
  handle.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 || (handle !== bubble && event.target.closest('button'))) return;
    const start = { x: event.clientX, y: event.clientY };
    const origin = host.getBoundingClientRect();
    dragMoved = false;
    handle.setPointerCapture(event.pointerId);

    const move = (e) => {
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      if (!dragMoved && Math.hypot(dx, dy) < 4) return;
      dragMoved = true;
      panel.classList.add('dragging');
      position = clamp(origin.left + dx, origin.top + dy);
      place();
    };
    const end = async () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', end);
      handle.removeEventListener('pointercancel', end);
      panel.classList.remove('dragging');
      if (dragMoved) await satellite.storage.set('position', position);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', end);
    handle.addEventListener('pointercancel', end);
  });
}

makeDraggable(bubble);
makeDraggable($('header'));
window.addEventListener('resize', place);
place();

async function resetPosition() {
  position = null;
  await satellite.storage.remove('position');
  place();
}

// ---- Rendering ----------------------------------------------------------

function isMine(m) {
  return Boolean(myKey) && m.sender === myKey;
}

function postName() {
  return config.anonymous ? '' : myName;
}

function render() {
  panel.hidden = !open;
  const showPrefs = !prefs.hidden;
  log.hidden = form.hidden = showPrefs;
  $('.prefs-btn').classList.toggle('on', showPrefs);
  host.style.setProperty('--r', String(Math.min(100, Math.max(0, Number(config.roundness) || 0)) / 100));
  host.style.setProperty('--fs', Math.min(15, Math.max(9, Number(config.fontSize) || 11)) + 'px');
  $('.dot').classList.toggle('live', status === 'online');
  $('.dot').title = { online: 'Connected to Satella', connecting: 'Connecting…', blocked: 'Blocked by the page' }[status] || 'Offline, retrying';
  $('.title').title = postName() ? 'Chatting as ' + postName() : 'Chatting anonymously';
  form.querySelector('button').disabled = status !== 'online';
  const unread = open ? 0 : messages.filter((m) => m.time > lastRead && !isMine(m)).length;
  $('.badge').hidden = unread === 0;
  $('.badge').textContent = unread > 99 ? '99+' : String(unread);
}

const GROUP_GAP = 5 * 60 * 1000;

// A steady color per sender, so people are easy to tell apart.
function nameColor(m) {
  const seed = m.sender || m.name || '';
  let hash = 0;
  for (const c of seed) hash = (hash * 31 + c.charCodeAt(0)) >>> 0;
  return `hsl(${hash % 360} 70% 74%)`;
}

function dayLabel(ms) {
  const date = new Date(ms);
  const today = new Date();
  const yesterday = new Date(today.getTime() - 86400000);
  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' });
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderLog() {
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
  log.replaceChildren();
  if (!messages.length) {
    log.append(el('div', 'empty', status === 'online' ? "It's quiet out here. Say hi 🛰"
      : status === 'blocked' ? "This page's security policy blocks the Satella relay." : 'Connecting to Satella…'));
    return;
  }
  let previous = null;
  for (const m of messages) {
    if (!previous || new Date(previous.time).toDateString() !== new Date(m.time).toDateString()) {
      log.append(el('div', 'day', dayLabel(m.time)));
      previous = null;
    }
    const grouped = previous && previous.sender === m.sender && previous.name === m.name && m.time - previous.time < GROUP_GAP;
    const row = el('div', 'msg' + (grouped ? '' : ' first'));
    row.title = new Date(m.time).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    if (!grouped) {
      const who = el('div', 'who');
      const name = el('span', 'name', m.name || 'anonymous');
      name.style.color = nameColor(m);
      who.append(name);
      if (isMine(m)) who.append(el('span', 'you', 'you'));
      who.append(el('span', 'time', formatTime(m.time)));
      row.append(who);
    }
    row.append(el('div', 'text', m.text));
    log.append(row);
    previous = m;
  }
  if (atBottom || open) log.scrollTop = log.scrollHeight;
}

function formatTime(ms) {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

async function markRead() {
  const newest = messages.length ? messages[messages.length - 1].time : 0;
  if (newest > lastRead) {
    lastRead = newest;
    await satellite.storage.set('lastRead', lastRead);
  }
}

async function setOpen(value) {
  open = value;
  await satellite.storage.set('open', open);
  if (open) await markRead();
  render();
  if (open) { renderLog(); if (prefs.hidden) draft.focus(); }
}

bubble.addEventListener('click', () => {
  if (dragMoved) { dragMoved = false; return; } // a drag, not a click
  setOpen(!open);
});
bubble.addEventListener('dblclick', resetPosition); // double-click puts it back in the corner
$('.close').addEventListener('click', () => setOpen(false));

// ---- Settings menu ------------------------------------------------------

function syncPrefs() {
  $('.pref-anonymous').checked = Boolean(config.anonymous);
  $('.pref-notifications').checked = Boolean(config.notifications);
  $('.pref-roundness').value = String(config.roundness);
  $('.round-value').textContent = config.roundness + '%';
  $('.pref-fontsize').value = String(config.fontSize);
  $('.fs-value').textContent = config.fontSize + 'px';
  $('.anon-hint').textContent = config.anonymous
    ? 'Your messages have no name.'
    : myName ? 'Unchecked: messages show as ' + myName + '.' : "Your OrgCS name couldn't be looked up, so messages have no name.";
}

async function savePref(key, value) {
  config[key] = value; // set first so the onChange echo is a no-op
  syncPrefs();
  render();
  await satellite.settings.set(key, value);
}

$('.prefs-btn').addEventListener('click', () => {
  prefs.hidden = !prefs.hidden;
  syncPrefs();
  render();
  if (prefs.hidden) { renderLog(); draft.focus(); }
});
$('.pref-anonymous').addEventListener('change', (e) => savePref('anonymous', e.target.checked));
$('.pref-notifications').addEventListener('change', (e) => savePref('notifications', e.target.checked));
$('.pref-roundness').addEventListener('input', (e) => {
  config.roundness = Number(e.target.value);
  syncPrefs();
  render();
});
$('.pref-roundness').addEventListener('change', (e) => savePref('roundness', Number(e.target.value)));
$('.pref-fontsize').addEventListener('input', (e) => {
  config.fontSize = Number(e.target.value);
  syncPrefs();
  render();
});
$('.pref-fontsize').addEventListener('change', (e) => savePref('fontSize', Number(e.target.value)));
$('.reset-position').addEventListener('click', resetPosition);

satellite.settings.onChange((key, value) => {
  if (config[key] === value) return;
  config[key] = value;
  syncPrefs();
  render();
});

// ---- Sending ------------------------------------------------------------

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const text = draft.value.trim().slice(0, MAX_LENGTH);
  if (!text || !client) return;
  const message = { v: 1, id: crypto.randomUUID(), name: postName(), text, time: Date.now() };
  if (!client.send(CHANNEL, JSON.stringify(message))) {
    draft.placeholder = 'Not connected — try again';
    setTimeout(() => { draft.placeholder = 'Message #global'; }, 3000);
    return;
  }
  draft.value = '';
  fitDraft();
  addMessage({ ...message, sender: myKey }); // Satella echoes it back too; the id dedupes it
  draft.focus();
});

function fitDraft() {
  draft.style.height = 'auto';
  draft.style.height = Math.min(draft.scrollHeight, 84) + 'px';
}
draft.addEventListener('input', fitDraft);
draft.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    form.requestSubmit();
  }
});

// Lightning grabs some keystrokes globally; keep typing inside the chat.
for (const type of ['keydown', 'keyup', 'keypress']) host.addEventListener(type, (event) => event.stopPropagation());

// ---- Relay --------------------------------------------------------------

function addMessage(m) {
  if (!m.id || seen.has(m.id)) return;
  seen.add(m.id);
  messages.push(m);
  messages.sort((a, b) => a.time - b.time);
  if (messages.length > MAX_MESSAGES) messages = messages.slice(-MAX_MESSAGES);
  satellite.storage.set('history', messages);
  if (open) markRead();
  render();
  renderLog();
  maybeNotify(m);
}

// { v: 1, id, name, text, time } as JSON. The sender is the key Satella proved, not anything in the text.
function onRelay({ sender, text }) {
  let data;
  try { data = JSON.parse(text); } catch { return; }
  if (!data || data.v !== 1 || typeof data.id !== 'string' || typeof data.text !== 'string') return;
  const now = Date.now();
  addMessage({
    id: data.id.slice(0, 64),
    sender: sender || '',
    name: typeof data.name === 'string' ? data.name.slice(0, 80) : '',
    text: data.text.slice(0, MAX_LENGTH),
    // Trust the sender's clock only within a minute of ours.
    time: Number.isFinite(data.time) && Math.abs(data.time - now) < 60000 ? data.time : now,
  });
}

// For messages from others while the chat isn't in view. Several pages can run this script, so storage
// remembers the newest message notified about.
async function maybeNotify(m) {
  if (!config.notifications || isMine(m)) return;
  if (open && !document.hidden) return;
  const last = (await satellite.storage.get('lastNotified')) || 0;
  if (m.time <= last) return;
  await satellite.storage.set('lastNotified', m.time);
  satellite.notify('Astroverse · ' + (m.name || 'anonymous'), m.text.slice(0, 200)).catch(() => {});
}

function setStatus(state, detail) {
  status = state;
  if (state === 'online' && !detail) console.warn('[astroverse] Satella did not accept this page’s key.');
  if (state === 'offline') console.warn(`[astroverse] Satella offline (${detail}); retrying.`);
  render();
  renderLog();
}

// Salesforce's Content Security Policy may block the socket; retrying can't help until the page reloads.
document.addEventListener('securitypolicyviolation', (event) => {
  if (!String(event.blockedURI).startsWith(SatellaClient.HOST) || status === 'blocked') return;
  client?.stop();
  setStatus('blocked');
});

async function loadIdentity() {
  const read = async () => {
    try { return JSON.parse(await satellite.storage.get(IDENTITY_KEY)); } catch { return null; }
  };
  let jwk = await read();
  if (!jwk?.d || !jwk?.x) {
    await satellite.storage.set(IDENTITY_KEY, JSON.stringify(await SatellaClient.createIdentity()));
    jwk = await read(); // another OrgCS page may have made one at the same moment
  }
  return SatellaClient.loadIdentity(jwk);
}

render();
renderLog();
if (open) setOpen(true);

const [identity, name] = await Promise.all([loadIdentity(), orgcsUserName()]);
myKey = identity.publicKey;
myName = name;
syncPrefs();
render();
renderLog();
client = new SatellaClient.Client({ identity, channels: [CHANNEL], onRelay, onState: setStatus });
client.start();
