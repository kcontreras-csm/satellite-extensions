// Ticket Expiration: a clock in the OrgCS header that counts the open cases you own whose next follow-up is due.
// Clicking it lists every case with the cadence it falls under, what to do next and by when. Case lists (My Open
// Cases and the like) get a pill with the due time next to each case number, and your case pages one next to Follow.
// The rules live in followup-core.js; this file queries the cases, draws the button, panel and pills, and sends
// notifications.
// Cases come from one read-only SOQL query (satellite.salesforce.query, signed in as you), refreshed every few
// minutes and when the panel opens. Errors and console output appear in Settings > Extensions > Logs.

const TAG = '[ticket-expiration]';
const Core = globalThis.TicketExpirationCore;
const REFRESH_MS = 5 * 60e3;
const TICK_MS = 60e3;
const STALE_MS = 30e3;
const NOTIFIED_KEY = 'notified';
const CASE_PATH = /\/lightning\/r\/(?:Case\/)?(500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)(?:\/|$)/;
const LINK_ID = /\/(500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)(?:[/?#]|$)/;
const HOST_ATTR = 'data-ticket-expiration';
const PILL_ATTR = 'data-ticket-expiration-pill';
const CASE_ATTR = 'data-ticket-expiration-case';
const PILL_MS = 400;
// Buttons that save something the rules read (a comment, an email, a status) and Lightning's own refresh buttons.
const SAVE_LABEL = /^(save\b.*|send|share|post|comment|submit|update|mark\b.*)$/i;
const REFRESH_LABEL = /^refresh\b/i;
const ACTIONABLE = 'button, [role="button"], a, input[type="submit"], input[type="button"]';
const SAVE_DELAYS = [2500, 8000];

// USING SCOPE Mine is "cases I own", the same as the My Open Cases list view.
const SOQL =
  'SELECT Id, CaseNumber, Subject, Status, Priority, Severity_Level__c, IsEscalated, OwnerId, CreatedDate, ' +
  'Owner_Assigned_Date__c, Last_Support_Update__c, Last_Public_Activity_DateTime__c, Account.Name, ' +
  '(SELECT CreatedDate, IsPublished, CreatedById FROM CaseComments ORDER BY CreatedDate DESC LIMIT 30), ' +
  '(SELECT MessageDate, Incoming FROM EmailMessages ORDER BY MessageDate DESC LIMIT 30), ' +
  "(SELECT CreatedDate, NewValue FROM Histories WHERE Field = 'Status' ORDER BY CreatedDate DESC LIMIT 5), " +
  '(SELECT GUSText__c, GUS_Work__r.Name, Work_Record_Type__c, Work_Status__c FROM Case_Relationships__r) ' +
  'FROM Case USING SCOPE Mine WHERE IsClosed = false ORDER BY CaseNumber LIMIT 200';

const CLOCK =
  '<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>';

const CSS = `
  :host { all: initial; }
  * { box-sizing: border-box; }
  .panel {
    position: fixed; z-index: 2147483000; width: min(500px, calc(100vw - 16px)); display: flex; flex-direction: column;
    background: #fff; color: #181818; border: 1px solid #e5e5e5; border-radius: 12px; box-shadow: 0 8px 32px rgba(0, 0, 0, .2);
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  }
  header { display: flex; align-items: center; gap: 4px; padding: 10px 12px 10px 16px; border-bottom: 1px solid #e5e5e5; }
  h2 { flex: 1; margin: 0; font-size: 15px; font-weight: 600; }
  header button { width: 28px; height: 28px; padding: 0; border: 0; border-radius: 6px; background: none; color: #747474; font: 18px/1 inherit; cursor: pointer; }
  header button:hover { background: #f3f3f3; color: #181818; }
  .summary { padding: 8px 16px; border-bottom: 1px solid #f3f3f3; color: #444; font-size: 12px; }
  .summary b.overdue { color: #ba0517; }
  .summary b.soon { color: #a96404; }
  .list { flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain; }
  h3, summary { margin: 0; padding: 10px 16px 4px; color: #747474; font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; }
  summary { cursor: pointer; }
  ul { margin: 0; padding: 0; list-style: none; }
  .row { padding: 8px 16px 8px 13px; border-left: 3px solid transparent; }
  .row + .row { border-top: 1px solid #f3f3f3; }
  .row.overdue { border-left-color: #ba0517; }
  .row.soon { border-left-color: #dd7a01; }
  .row.later { border-left-color: #2e844a; }
  .row.current { background: #eef4ff; }
  .top { display: flex; align-items: baseline; gap: 8px; }
  .num { color: #0176d3; font-weight: 600; text-decoration: none; }
  .num:hover { text-decoration: underline; }
  .subject { flex: 1; min-width: 0; overflow: hidden; color: #444; text-overflow: ellipsis; white-space: nowrap; }
  .account { color: #747474; }
  .due { font-weight: 600; white-space: nowrap; }
  .overdue .due { color: #ba0517; }
  .soon .due { color: #a96404; }
  .later .due { color: #2e844a; }
  .action { margin-top: 2px; }
  .meta { margin-top: 2px; color: #747474; font-size: 12px; }
  .chip { display: inline-block; padding: 0 6px; border-radius: 9px; background: #f3f3f3; color: #444; }
  .chip.high { background: #feded8; color: #8e030f; }
  .chip.si { background: #ece1f9; color: #481a54; }
  .chip.waiting { background: #e5f0fb; color: #014486; }
  .chip.working { background: #ebf7e6; color: #194e31; }
  .flag { color: #0176d3; font-weight: 600; }
  .empty, .error { margin: 0; padding: 16px; color: #747474; }
  .error { color: #ba0517; }
  footer { padding: 6px 16px 10px; border-top: 1px solid #e5e5e5; color: #747474; font-size: 12px; }
  footer summary { padding: 4px 0; font-size: 12px; font-weight: 400; letter-spacing: 0; text-transform: none; }
  footer ul { padding: 2px 0 4px 16px; list-style: disc; }
  footer li { margin: 2px 0; }`;

const PANEL = `
  <section class="panel" role="dialog" aria-label="Case follow-ups">
    <header>
      <h2>Case follow-ups</h2>
      <button type="button" class="refresh" title="Refresh" aria-label="Refresh">↻</button>
      <button type="button" class="close" title="Close" aria-label="Close">×</button>
    </header>
    <div class="summary" role="status"></div>
    <div class="list"></div>
    <footer><details><summary class="updated"></summary><ul class="rules"></ul></details></footer>
  </section>`;

// The pills sit inside Lightning's shadow roots, where style.css doesn't reach, so they carry their own styles.
const PILL_CSS = 'display:inline-block;margin-left:6px;padding:0 6px;border-radius:9px;vertical-align:middle;' +
  "white-space:nowrap;cursor:default;font:600 11px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
const PILL_COLORS = {
  overdue: 'background:#feded8;color:#8e030f;',
  soon: 'background:#fef1d6;color:#8c4b02;',
  later: 'background:#ebf7e6;color:#194e31;',
};
// Sized like the Follow button it sits next to.
const CASE_PILL_CSS = 'display:inline-flex;align-items:center;gap:6px;align-self:center;height:32px;margin:0 8px 0 0;' +
  'padding:0 12px;border:1px solid;border-radius:16px;cursor:pointer;white-space:nowrap;' +
  "font:600 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
const CASE_PILL_BORDERS = { overdue: 'border-color:#f8b9b0;', soon: 'border-color:#f9d38a;', later: 'border-color:#b6e0a6;' };

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
const state = { cases: [], items: [], options: {}, fetchedAt: 0, error: null, laterOpen: null };
let loading = null;

// MARK: Time

function span(ms) {
  const minutes = Math.round(Math.abs(ms) / 60e3);
  if (minutes < 60) return `${Math.max(1, minutes)} min`;
  const hours = Math.round(minutes / 60);
  return hours < 48 ? `${hours} h` : `${Math.floor(minutes / 1440)} d`;
}
const short = ms => span(ms).replace(/ (min|h|d)$/, (_, unit) => unit[0]);
const ago = (t, now) => (t == null ? 'never' : `${span(now - t)} ago`);
const dueText = (item, now) => (item.due <= now ? `overdue ${span(now - item.due)}` : `due in ${span(item.due - now)}`);
const dateText = t => new Date(t).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const cadence = days => (days === 1 ? 'daily' : `every ${days} days`);

// MARK: Data

async function loadOptions() {
  const s = await satellite.settings.getAll();
  const D = Core.DEFAULTS;
  const days = (value, fallback) => (Number(value) > 0 ? Number(value) : fallback);
  state.options = {
    highPriority: s.highPriority === 'sev123' ? 'sev123' : 'sev12',
    workingDays: days(s.workingDays, D.workingDays),
    waitingDays: days(s.waitingDays, D.waitingDays),
    closeWarningDays: days(s.closeWarningDays, D.closeWarningDays),
    siDays: days(s.siDays, D.siDays),
    idleDays: days(s.idleDays, D.idleDays),
    skipWeekends: s.skipWeekends === true,
    notify: s.notify !== false,
    listPills: s.listPills !== false,
    casePill: s.casePill !== false,
  };
}

function refresh() {
  loading ||= load().finally(() => { loading = null; update(); });
  update();
  return loading;
}

async function load() {
  try {
    state.cases = (await satellite.salesforce.query(SOQL)).records;
    state.error = null;
    state.fetchedAt = Date.now();
  } catch (error) {
    console.error(TAG, error);
    state.error = error;
    return;
  }
  state.items = Core.evaluateAll(state.cases, state.options);
  notifyOverdue().catch(error => console.warn(TAG, 'notify', error));
}

function update() {
  if (state.fetchedAt) state.items = Core.evaluateAll(state.cases, state.options);
  updateButton();
  render();
  schedulePills();
}

// One notification per case and due date, so it isn't repeated every refresh or on every OrgCS page.
async function notifyOverdue() {
  if (!state.options.notify) return;
  let seen = {};
  try { seen = JSON.parse(await satellite.storage.get(NOTIFIED_KEY)) || {}; } catch (e) { /* none yet */ }
  const overdue = state.items.filter(i => i.state === 'overdue');
  const fresh = overdue.filter(i => seen[i.id] !== i.due);
  await satellite.storage.set(NOTIFIED_KEY, JSON.stringify(Object.fromEntries(overdue.map(i => [i.id, i.due]))));
  if (!fresh.length) return;
  const title = fresh.length === 1 ? `Case ${fresh[0].number} needs a follow-up` : `${fresh.length} cases need a follow-up`;
  const lines = fresh.slice(0, 3).map(i => `${i.number}: ${i.action}`);
  if (fresh.length > 3) lines.push(`and ${fresh.length - 3} more`);
  satellite.notify(title, lines.join('\n')).catch(error => console.warn(TAG, 'notify', error));
}

const currentId = () => CASE_PATH.exec(location.pathname)?.[1] || null;
const sameId = (a, b) => !!a && !!b && a.slice(0, 15) === b.slice(0, 15);

// MARK: Header button

const button = document.createElement('button');
button.type = 'button';
button.className = 'slds-button slds-button_icon slds-global-actions__item-action ticket-expiration-button';
button.innerHTML = CLOCK + '<span class="ticket-expiration-badge" hidden></span>';
button.setAttribute('aria-expanded', 'false');
button.title = 'Case follow-ups';
button.addEventListener('click', () => (isOpen() ? closePanel() : openPanel()));
const headerItem = document.createElement('li');
headerItem.className = 'slds-global-actions__item ticket-expiration-item';
const floating = document.createElement('div');
floating.className = 'ticket-expiration-floating';
const startedAt = Date.now();

// The header re-renders now and then, so this runs every second and puts the button back.
function mountButton() {
  const actions = document.querySelector('ul.slds-global-actions');
  if (actions) {
    if (button.parentNode !== headerItem) headerItem.append(button);
    if (headerItem.parentNode !== actions) {
      actions.insertBefore(headerItem, actions.querySelector(':scope > .slds-global-actions__item_notification'));
    }
    floating.remove();
  } else if (!floating.isConnected && Date.now() - startedAt > 10e3) {
    floating.append(button);
    document.body.append(floating);
  }
}

function updateButton() {
  const count = key => state.items.filter(i => i.state === key).length;
  const overdue = count('overdue');
  const soon = count('soon');
  // A failed refresh keeps the last counts; only a first load that failed shows "!".
  const failed = !!state.error && !state.fetchedAt;
  const badge = button.querySelector('.ticket-expiration-badge');
  badge.hidden = !failed && !overdue && !soon;
  badge.textContent = failed ? '!' : String(overdue || soon);
  badge.classList.toggle('soon', !failed && !overdue);
  const current = state.items.find(i => sameId(i.id, currentId()));
  const summary = failed ? 'couldn’t load your cases'
    : state.fetchedAt ? `${overdue} overdue, ${soon} due within a day` : 'loading';
  button.title = `Case follow-ups: ${summary}` + (current ? `\nThis case: ${dueText(current, Date.now())}` : '');
  button.setAttribute('aria-label', button.title);
}

// MARK: Panel

const host = document.createElement('div');
host.setAttribute(HOST_ATTR, '');
const root = host.attachShadow({ mode: 'open' });
root.innerHTML = `<style>${CSS}</style>${PANEL}`;
const panel = root.querySelector('.panel');
const list = root.querySelector('.list');
root.querySelector('.close').addEventListener('click', () => closePanel());
root.querySelector('.refresh').addEventListener('click', () => refresh());
list.addEventListener('click', event => {
  const link = event.target.closest('a.num');
  if (!link || event.button || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  event.stopPropagation();
  openCase(link.getAttribute('href'));
  closePanel();
});

const isOpen = () => host.isConnected;

function openPanel() {
  document.body.append(host);
  button.setAttribute('aria-expanded', 'true');
  place();
  render();
  list.querySelector('.row.current')?.scrollIntoView?.({ block: 'nearest' });
  if (Date.now() - state.fetchedAt > STALE_MS) refresh();
  addEventListener('pointerdown', onOutside, true);
  addEventListener('keydown', onKey, true);
  addEventListener('resize', place);
}

function closePanel() {
  host.remove();
  button.setAttribute('aria-expanded', 'false');
  removeEventListener('pointerdown', onOutside, true);
  removeEventListener('keydown', onKey, true);
  removeEventListener('resize', place);
}

// The header button and the case page pill toggle the panel themselves.
function onOutside(event) {
  const path = event.composedPath();
  if (!path.some(node => node === host || node === button || node.hasAttribute?.(CASE_ATTR))) closePanel();
}

function onKey(event) {
  if (event.key === 'Escape') closePanel();
}

// Under the button, or above it when it sits low (the floating fallback).
function place() {
  const r = button.getBoundingClientRect();
  panel.style.right = `${Math.max(8, innerWidth - r.right)}px`;
  const below = r.top < innerHeight / 2;
  panel.style.top = below ? `${r.bottom + 8}px` : '';
  panel.style.bottom = below ? '' : `${innerHeight - r.top + 8}px`;
  panel.style.maxHeight = `${Math.min(680, (below ? innerHeight - r.bottom : r.top) - 24)}px`;
}

// Lightning routes ordinary links itself (in the console they open a tab). The click is replayed on a link outside
// the panel's shadow root so its handler sees it; if nothing handles it, the browser simply navigates.
function openCase(href) {
  const link = document.createElement('a');
  link.href = href;
  link.hidden = true;
  document.body.append(link);
  link.click();
  link.remove();
}

function render() {
  if (!isOpen()) return;
  const now = Date.now();
  const count = key => state.items.filter(i => i.state === key).length;
  const [overdue, soon, later] = ['overdue', 'soon', 'later'].map(count);
  root.querySelector('.summary').innerHTML = state.fetchedAt
    ? `<b class="overdue">${overdue} overdue</b> · <b class="soon">${soon} due within a day</b> · ${later} on track`
    : 'Open cases you own';

  const scroll = list.scrollTop;
  if (state.error && !state.fetchedAt) {
    list.innerHTML = `<p class="error">Couldn’t load your cases: ${esc(state.error.message || state.error)}<br>More in Settings &gt; Extensions &gt; Logs.</p>`;
  } else if (!state.fetchedAt) {
    list.innerHTML = '<p class="empty">Loading your open cases…</p>';
  } else if (!state.items.length) {
    list.innerHTML = '<p class="empty">You have no open cases.</p>';
  } else {
    const rows = key => state.items.filter(i => i.state === key).map(i => row(i, now)).join('');
    // Collapsed when something needs you, unless the case you're on is in there.
    const laterOpen = state.laterOpen ?? (!(overdue || soon) || state.items.some(i => i.state === 'later' && sameId(i.id, currentId())));
    list.innerHTML =
      (overdue ? `<h3>Overdue (${overdue})</h3><ul>${rows('overdue')}</ul>` : '') +
      (soon ? `<h3>Due within a day (${soon})</h3><ul>${rows('soon')}</ul>` : '') +
      (later ? `<details${laterOpen ? ' open' : ''}><summary>On track (${later})</summary><ul>${rows('later')}</ul></details>` : '');
    // Rendering it open fires a toggle too; only remember the ones that change what was rendered.
    list.querySelector('details')?.addEventListener('toggle', event => {
      if (event.target.open !== laterOpen) state.laterOpen = event.target.open;
    });
  }
  list.scrollTop = scroll;

  const updated = state.error ? `Refresh failed: ${state.error.message || state.error}`
    : loading ? 'Refreshing…' : state.fetchedAt ? `Updated ${ago(state.fetchedAt, now)}` : '';
  root.querySelector('.updated').textContent = `${updated} · How due dates work`;
  root.querySelector('.rules').innerHTML = rules().map(text => `<li>${esc(text)}</li>`).join('');
}

function row(item, now) {
  const meta = [
    `<span class="chip ${esc(item.rule.key)}">${esc(item.rule.label)} · ${cadence(item.rule.every)}</span>`,
    `last update ${ago(item.lastTouch, now)}`,
    `due ${esc(dateText(item.due))}`,
  ];
  if (item.replied) meta.push(`<span class="flag">Customer ${item.lastPublic ? 'replied' : 'wrote'} ${ago(item.lastCustomer, now)}</span>`);
  return `<li class="row ${item.state}${sameId(item.id, currentId()) ? ' current' : ''}">
      <div class="top">
        <a class="num" href="/lightning/r/Case/${esc(item.id)}/view">${esc(item.number)}</a>
        <span class="subject" title="${esc(item.subject)}">${esc(item.subject)}${item.account ? ` <span class="account">· ${esc(item.account)}</span>` : ''}</span>
        <span class="due">${esc(dueText(item, now))}</span>
      </div>
      <div class="action">${esc(item.action)}</div>
      <div class="meta">${meta.join(' · ')}</div>
    </li>`;
}

function rules() {
  const o = state.options;
  return [
    `High priority (${o.highPriority === 'sev123' ? 'Severity 1 to 3' : 'Severity 1 and 2'}, or escalated): daily.`,
    `Open Structured Investigation: a note ${cadence(o.siDays)} confirming it is active and the customer knows the status.`,
    `Need More Information: follow up with the customer ${cadence(o.waitingDays)}. After ${o.closeWarningDays} days without a reply, warn that the case closes in 48 hours (a follow-up from the day before counts); close it 48 hours after the warning, and not before day ${o.closeWarningDays + 2}.`,
    `Working and New: an update ${cadence(o.workingDays)}, progress or a documented blocker.`,
    `Any other status: activity at least ${cadence(o.idleDays)}.`,
    'A customer reply moves the due date to one day after it.',
    'Your comments and notes count as updates, as do emails you send. The highest rule that applies wins.',
    o.skipWeekends ? 'Weekends are skipped.' : 'Days are calendar days, weekends included.',
  ];
}

// MARK: Pills in case lists and case pages

// Every link in a table row whose text is one of your case numbers gets a pill: My Open Cases, other case list
// views, related lists. When the link carries a record Id it has to match too, so a subject like "Reopen case
// 474519956" doesn't get one. Your case pages get a bigger one in front of Follow.
const observed = new WeakSet();
const observer = new MutationObserver(schedulePills);
let pillTimer = 0;
let pillsShown = false;

const parentOf = node => (node.parentNode?.nodeType === 11 ? node.parentNode.host : node.parentNode);
const visible = el => el.getClientRects().length > 0;
const linkId = link => LINK_ID.exec(link.getAttribute('href') || '')?.[1] || link.dataset.recordid || null;

function composedClosest(el, selector) {
  for (let node = el; node; node = parentOf(node)) if (node.nodeType === 1 && node.matches(selector)) return node;
  return null;
}

// Every shadow root on the page, each observed so re-rendered rows get their pill back.
function collectRoots() {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    if (!observed.has(roots[i])) {
      observed.add(roots[i]);
      observer.observe(roots[i], { childList: true, subtree: true });
    }
    for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot && !el.hasAttribute(HOST_ATTR)) roots.push(el.shadowRoot);
  }
  return roots;
}

function schedulePills() {
  if (pillTimer) return;
  pillTimer = setTimeout(() => {
    pillTimer = 0;
    paintPills();
  }, PILL_MS);
}

function paintPills() {
  if (!state.items.length && !pillsShown) return;
  const now = Date.now();
  const byNumber = new Map(state.options.listPills ? state.items.map(i => [i.number, i]) : []);
  const roots = collectRoots();
  const kept = new Set();
  for (const root of roots) {
    if (byNumber.size) {
      for (const link of root.querySelectorAll('a')) {
        const item = byNumber.get(normalize(link.textContent)) || byNumber.get(link.getAttribute('title'));
        if (!item || (linkId(link) && !sameId(linkId(link), item.id)) || !composedClosest(link, 'tr, [role="row"]')) continue;
        let pill = link.nextElementSibling;
        if (!pill?.hasAttribute(PILL_ATTR)) {
          pill = document.createElement('span');
          pill.setAttribute(PILL_ATTR, '');
          link.after(pill);
        }
        paintPill(pill, item, now, false);
        kept.add(pill);
      }
    }
    if (state.options.casePill) {
      for (const highlights of root.querySelectorAll('records-highlights2')) {
        const pill = paintCasePage(highlights, now);
        if (pill) kept.add(pill);
      }
    }
  }
  for (const root of roots) {
    for (const pill of root.querySelectorAll(`[${PILL_ATTR}], [${CASE_ATTR}]`)) if (!kept.has(pill)) pill.remove();
  }
  pillsShown = kept.size > 0;
}

// The console keeps every open tab's case page around, hidden. Only the one on screen is the case in the address
// bar; the others keep the pill they got while they were in front, and it is brought up to date when they are again.
function paintCasePage(highlights, now) {
  // Case panels only, recognised by their subject component (as Fake Swarm and Case Page Declutter do).
  if (!highlights.querySelector('support-output-case-subject-field')) return null;
  const scope = highlights.shadowRoot || highlights;
  const existing = scope.querySelector(`[${CASE_ATTR}]`);
  const id = currentId();
  if (!visible(highlights) || !id) return existing;
  const item = state.items.find(i => sameId(i.id, id));
  const follow = [...scope.querySelectorAll('.forceActionsContainer button')]
    .find(b => /^(un)?follow(ing)?$/i.test(normalize(b.textContent)));
  if (!item || !follow) return null;
  // In front of Follow: Fake Swarm keeps its button right after it.
  const container = follow.closest('.forceActionsContainer');
  if (!container) return null;
  let slot = follow;
  while (slot.parentElement && slot.parentElement !== container) slot = slot.parentElement;
  let pill = existing;
  if (!pill) {
    pill = document.createElement('button');
    pill.type = 'button';
    pill.setAttribute(CASE_ATTR, '');
    pill.addEventListener('click', () => (isOpen() ? closePanel() : openPanel()));
  }
  if (pill.nextElementSibling !== slot) slot.before(pill);
  paintPill(pill, item, now, true);
  return pill;
}

// Only what changed is written, so the observer doesn't wake itself up.
function paintPill(pill, item, now, onCase) {
  const when = item.due <= now ? `${short(now - item.due)} late` : `in ${short(item.due - now)}`;
  const due = dueText(item, now);
  const lines = [
    `${due[0].toUpperCase()}${due.slice(1)}: ${item.action}`,
    `${item.rule.label} · ${cadence(item.rule.every)} · due ${dateText(item.due)}`,
  ];
  if (item.replied) lines.push(`Customer ${item.lastPublic ? 'replied' : 'wrote'} ${ago(item.lastCustomer, now)}`);
  if (onCase) lines.push('Click for all your follow-ups.');
  const text = onCase ? `Follow-up ${when}` : when;
  const title = lines.join('\n');
  if (pill.textContent !== text) pill.textContent = text;
  if (pill.title !== title) {
    pill.title = title;
    if (onCase) pill.setAttribute('aria-label', title);
  }
  if (pill.dataset.state !== item.state) {
    pill.dataset.state = item.state;
    pill.style.cssText = (onCase ? CASE_PILL_CSS + CASE_PILL_BORDERS[item.state] : PILL_CSS) + PILL_COLORS[item.state];
  }
}

// MARK: Refresh after you save

// Posting a comment, sending an email or changing the status doesn't reload the page, so a click on a button like
// that refreshes the cases a moment later (and once more, for slow saves). Lightning's own refresh buttons (the list
// view's, "Refresh this feed") refresh them right away.
let refreshTimers = [];

function refreshSoon(delays) {
  refreshTimers.forEach(clearTimeout);
  refreshTimers = delays.map(ms => setTimeout(refresh, ms));
}

function onPageClick(event) {
  const path = event.composedPath();
  if (path.some(node => node === host || node === button || node.hasAttribute?.(CASE_ATTR))) return;
  const target = path.find(node => node.nodeType === 1 && node.matches(ACTIONABLE));
  // Tabs like "Post" and "Email" only switch the publisher.
  if (!target || target.getAttribute('role') === 'tab' || target.closest('[role="tablist"]')) return;
  const label = normalize(target.textContent || target.getAttribute('aria-label') || target.getAttribute('title') || target.value);
  if (REFRESH_LABEL.test(label)) refreshSoon([0]);
  else if (SAVE_LABEL.test(label)) refreshSoon(SAVE_DELAYS);
}

// MARK: Start

if (window.top === window) {
  await loadOptions();
  satellite.settings.onChange(async () => {
    await loadOptions();
    update();
  });
  mountButton();
  let lastHref = location.href;
  setInterval(() => {
    mountButton();
    if (location.href === lastHref) return;
    lastHref = location.href;
    update();
  }, 1000);
  setInterval(() => (Date.now() - state.fetchedAt >= REFRESH_MS ? refresh() : update()), TICK_MS);
  addEventListener('click', onPageClick, true);
  refresh();
}
