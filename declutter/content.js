// Case Page Declutter v1.2.1: hides the Target Orgs card and the Information Hub
// panel, then gives the freed right-column space to the middle column.

const DEFAULTS = {
  hideTargetOrgs: true,
  hideInformationHub: true,
  collapseRightColumn: true,
  debug: false,
};

const RULES = [
  { setting: 'hideTargetOrgs', selector: 'r2d2-r2d2_targets_component' },
  { setting: 'hideInformationHub', selector: '[data-label="Information Hub"], c-dre-notification-center' },
];

let config = { ...DEFAULTS };

async function loadConfig() {
  try {
    for (const key of Object.keys(DEFAULTS)) {
      const value = await satellite.settings.get(key);
      if (typeof value === 'boolean') config[key] = value;
    }
  } catch (e) {
    // Settings unavailable: keep defaults.
  }
}

// ---- DOM helpers (native shadow roots or synthetic shadow) --------------

const observedRoots = new WeakSet();
const observer = new MutationObserver(schedule);

function observe(root) {
  if (observedRoots.has(root)) return;
  observedRoots.add(root);
  observer.observe(root, { childList: true, subtree: true });
}

function collectRoots() {
  const roots = [document];
  for (let i = 0; i < roots.length; i++) {
    observe(roots[i]);
    for (const el of roots[i].querySelectorAll('*')) {
      if (el.shadowRoot) roots.push(el.shadowRoot);
    }
  }
  return roots;
}

function regionOf(el) {
  let node = el;
  while (node) {
    if (node.nodeType === 1 && node.localName === 'flexipage-component2' && node.hasAttribute('slot')) {
      return node;
    }
    const parent = node.parentNode;
    node = parent && parent.nodeType === 11 ? parent.host : parent;
  }
  return null;
}

// ---- hide / show cards --------------------------------------------------

const hidden = new Set();

function hide(el) {
  if (el.style.getPropertyValue('display') !== 'none') {
    el.style.setProperty('display', 'none', 'important');
  }
  hidden.add(el);
}

function show(el) {
  el.style.removeProperty('display');
  hidden.delete(el);
}

// ---- is anything left in the right column? ------------------------------

const MEDIA = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'input', 'textarea', 'select', 'button']);
const SKIP = new Set(['style', 'script', 'template', 'link', 'meta']);

// Layout-independent, so it still works while the column is collapsed.
function hasVisibleContent(root) {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop();
    if (node.nodeType === 3) {
      if (node.data.trim()) return true;
      continue;
    }
    if (node.nodeType === 1) {
      if (SKIP.has(node.localName) || node.hidden) continue;
      const cls = node.classList;
      if (cls.contains('slds-hide') || cls.contains('slds-assistive-text') || cls.contains('assistiveText')) continue;
      const cs = getComputedStyle(node);
      if (cs.display === 'none' || cs.visibility === 'hidden') continue;
      if (MEDIA.has(node.localName)) return true;
      if (node.shadowRoot) stack.push(...node.shadowRoot.childNodes);
    }
    if (node.childNodes) stack.push(...node.childNodes);
  }
  return false;
}

function itemState(item) {
  if (hidden.has(item)) return 'hidden';
  return hasVisibleContent(item) ? 'content' : 'blank';
}

// ---- give the right column's space to the middle column -----------------

const layouts = new Map(); // template -> { parts, ro }

function partsOf(template) {
  // Works with native shadow DOM and with LWC synthetic shadow (plain DOM).
  const scope = template.shadowRoot || template;
  const container = scope.querySelector('.main-container');
  const main = scope.querySelector('.main-col');
  const right = scope.querySelector('.right-col');
  if (!container || !main || !right) return null;
  const grouping = main.parentElement !== container ? main.parentElement : null;
  return { container, grouping, main, right };
}

function rightItems(template, parts) {
  const slot = parts.right.querySelector('slot[name]') || parts.right.querySelector('slot');
  const assigned = slot ? slot.assignedElements() : [];
  if (assigned.length) return assigned;                                   // native shadow DOM
  return [...parts.right.querySelectorAll('flexipage-component2[slot]')]; // synthetic shadow
}

function innerRight(el) {
  const cs = getComputedStyle(el);
  return el.getBoundingClientRect().right
    - (parseFloat(cs.paddingRight) || 0)
    - (parseFloat(cs.borderRightWidth) || 0);
}

function stretchTo(el, targetRight) {
  const rect = el.getBoundingClientRect();
  if (!rect.width) return;
  const cs = getComputedStyle(el);
  const delta = targetRight - (parseFloat(cs.marginRight) || 0) - rect.right;
  if (Math.abs(delta) < 1) return;
  const base = cs.boxSizing === 'border-box' ? rect.width : parseFloat(cs.width);
  const width = `${Math.max(0, Math.round(base + delta))}px`;
  el.style.setProperty('width', width, 'important');
  el.style.setProperty('max-width', 'none', 'important');
  el.style.setProperty('flex', `0 0 ${width}`, 'important');
}

function widen({ container, grouping, main }) {
  if (!container.getBoundingClientRect().width) return; // background console tab
  let bound = container;
  if (grouping && grouping.getBoundingClientRect().width) {
    stretchTo(grouping, innerRight(container));
    bound = grouping;
  }
  stretchTo(main, innerRight(bound));
}

function collapse(template, parts) {
  let state = layouts.get(template);
  if (state && (state.parts.main !== parts.main || state.parts.right !== parts.right)) {
    release(template); // template re-rendered
    state = null;
  }
  parts.right.style.setProperty('display', 'none', 'important');
  if (!state) {
    // Re-measure on window resize and when a background tab becomes visible.
    const ro = new ResizeObserver(() => widen(parts));
    ro.observe(parts.container);
    layouts.set(template, { parts, ro });
  }
  widen(parts);
}

function release(template) {
  const state = layouts.get(template);
  if (!state) return;
  state.ro.disconnect();
  const { right, main, grouping } = state.parts;
  right.style.removeProperty('display');
  for (const el of [main, grouping]) {
    if (!el) continue;
    for (const prop of ['width', 'max-width', 'flex']) el.style.removeProperty(prop);
  }
  layouts.delete(template);
}

// ---- debug panel --------------------------------------------------------

let debugBox = null;

function whyNoParts(template) {
  const scope = template.shadowRoot || template;
  const missing = ['.main-container', '.main-col', '.right-col'].filter(s => !scope.querySelector(s));
  const cols = [...scope.querySelectorAll('[class*="col"]')].slice(0, 8)
    .map(el => `  ${el.localName}.${[...el.classList].join('.')}`);
  return [
    `Columns not found (shadow root: ${template.shadowRoot ? 'yes' : 'no'})`,
    `Missing: ${missing.join(', ') || 'none'}`,
    ...cols,
  ].join('\n');
}

function describe(parts, items, states, collapsed) {
  const w = el => (el ? Math.round(el.getBoundingClientRect().width) : '-');
  const bound = parts.grouping && parts.grouping.getBoundingClientRect().width ? parts.grouping : parts.container;
  const gap = Math.round(innerRight(bound) - parts.main.getBoundingClientRect().right);
  const lines = [`Right column: ${items.length} item(s), collapsed: ${collapsed ? 'yes' : 'no'}`];
  items.forEach((item, i) => {
    const id = item.dataset.componentId || item.localName;
    const inner = item.firstElementChild?.localName;
    lines.push(`  ${states[i].padEnd(7)} ${id}${inner ? `  <${inner}>` : ''}`);
  });
  lines.push(`Widths: container ${w(parts.container)} | grouping ${w(parts.grouping)} | main ${w(parts.main)} | right ${w(parts.right)}`);
  lines.push(`Space right of main column: ${gap}px`);
  return lines.join('\n');
}

function renderDebug(report) {
  if (!config.debug) {
    debugBox?.remove();
    debugBox = null;
    return;
  }
  if (!debugBox) {
    debugBox = document.createElement('pre');
    debugBox.style.cssText = 'position:fixed;left:8px;bottom:48px;z-index:2147483647;max-width:560px;max-height:50vh;overflow:auto;margin:0;padding:8px 10px;background:rgba(0,0,0,.85);color:#eee;font:11px/1.45 ui-monospace,Menlo,monospace;border-radius:6px;white-space:pre-wrap;';
    document.body.appendChild(debugBox);
  }
  const text = report.join('\n\n') || 'Case Page Declutter: no three-column layout visible';
  if (debugBox.textContent !== text) debugBox.textContent = text;
}

// ---- main scan ----------------------------------------------------------

function scan() {
  const roots = collectRoots();

  const wanted = new Set();
  const selector = RULES.filter(r => config[r.setting]).map(r => r.selector).join(',');
  if (selector) {
    for (const root of roots) {
      for (const el of root.querySelectorAll(selector)) {
        wanted.add(regionOf(el) || el);
      }
    }
  }

  for (const el of [...hidden]) if (!wanted.has(el)) show(el);
  wanted.forEach(hide);

  const report = [];
  for (const root of roots) {
    for (const template of root.querySelectorAll('flexipage-record-home-three-col-template-desktop2')) {
      const parts = partsOf(template);
      if (!parts) {
        if (config.debug) report.push(whyNoParts(template));
        continue;
      }
      const items = rightItems(template, parts);
      const states = items.map(itemState);
      const empty = config.collapseRightColumn && states.includes('hidden') && !states.includes('content');
      if (empty) collapse(template, parts);
      else release(template);
      if (config.debug && parts.container.getBoundingClientRect().width) {
        report.push(describe(parts, items, states, empty));
      }
    }
  }

  for (const template of [...layouts.keys()]) {
    if (!template.isConnected) release(template);
  }

  renderDebug(report);
}

let timer = 0;
function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = 0; scan(); }, 120);
}

// ---- start --------------------------------------------------------------

try {
  satellite.settings.onChange(async () => { await loadConfig(); scan(); });
} catch (e) { /* no live settings updates */ }

await loadConfig();
scan();
setInterval(scan, 3000);