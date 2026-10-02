// Case Page Declutter v2.1: collapsible sidebar cards (vertical) and
// collapsible sidebars (horizontal). Collapsed items keep their names, and
// every choice is remembered across cases, console tabs and reloads.

const TEMPLATE_SELECTOR = 'flexipage-record-home-three-col-template-desktop2';
const REGION_SELECTOR = 'flexipage-component2[slot="leftsidebar"], flexipage-component2[slot="rightsidebar"]';
const CARDS_KEY = 'collapsedCards';
const COLUMNS_KEY = 'collapsedColumns';
const BAR_ATTR = 'data-sat-collapse-bar';
const COL_ATTR = 'data-sat-column-toggle';
const HIDDEN_ATTR = 'data-sat-collapsed-child';
const STRIP_ATTR = 'data-sat-strip';
const STRIP_WIDTH = 48;
const SVG_NS = 'http://www.w3.org/2000/svg';

let collapsedCards = {};
let collapsedColumns = {};

// ---- storage ------------------------------------------------------------

async function loadJSON(key) {
  try {
    const raw = await satellite.storage.get(key);
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (e) {
    return {};
  }
}

function saveJSON(key, value) {
  try {
    Promise.resolve(satellite.storage.set(key, JSON.stringify(value))).catch(() => {});
  } catch (e) { /* storage unavailable: state lasts until reload */ }
}

function toggleFlag(store, key, storeKey) {
  if (store[key]) delete store[key];
  else store[key] = true;
  saveJSON(storeKey, store);
  scan(); // also updates other console tabs
}

// ---- DOM helpers (native shadow roots or synthetic shadow) --------------

const px = value => parseFloat(value) || 0;

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

function deepFirst(root, selector, accept = () => true) {
  const queue = [root];
  while (queue.length) {
    const scope = queue.shift();
    for (const el of scope.querySelectorAll(selector)) if (accept(el)) return el;
    if (scope.shadowRoot) queue.push(scope.shadowRoot);
    for (const el of scope.querySelectorAll('*')) if (el.shadowRoot) queue.push(el.shadowRoot);
  }
  return null;
}

function deepText(node) {
  if (node.nodeType === 3) return node.data;
  if (node.nodeType !== 1 && node.nodeType !== 11) return '';
  if (node.nodeType === 1) {
    if (['style', 'script', 'template'].includes(node.localName)) return '';
    const cls = node.classList;
    if (cls.contains('slds-assistive-text') || cls.contains('assistiveText')) return '';
  }
  let text = '';
  if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) text += deepText(child);
  for (const child of node.childNodes) text += deepText(child);
  return text;
}

function isShown(el, stopAt) {
  for (let n = el; n && n !== stopAt; n = n.parentNode?.nodeType === 11 ? n.parentNode.host : n.parentNode) {
    if (n.nodeType !== 1 || n.hasAttribute(HIDDEN_ATTR)) continue;
    if (n.hidden || n.classList.contains('slds-hide') || n.classList.contains('slds-assistive-text')) return false;
    const cs = getComputedStyle(n);
    if (cs.display === 'none' || cs.visibility === 'hidden') return false;
  }
  return true;
}

// Hide every child of parent except keep (our own button).
function setChildrenHidden(parent, keep, hidden) {
  for (const child of parent.children) {
    if (child === keep) continue;
    if (hidden) {
      if (!child.hasAttribute(HIDDEN_ATTR) || child.style.getPropertyValue('display') !== 'none') {
        child.setAttribute(HIDDEN_ATTR, '');
        child.style.setProperty('display', 'none', 'important');
      }
    } else if (child.hasAttribute(HIDDEN_ATTR)) {
      child.removeAttribute(HIDDEN_ATTR);
      child.style.removeProperty('display');
    }
  }
}

function svgIcon(d) {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '0 0 20 20');
  svg.setAttribute('width', '12');
  svg.setAttribute('height', '12');
  svg.setAttribute('aria-hidden', 'true');
  svg.style.cssText = 'flex:none;transition:transform .15s ease;';
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', d);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', 'currentColor');
  path.setAttribute('stroke-width', '2.2');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(path);
  return svg;
}

const CHEVRON = 'M7 4l6 6-6 6';                       // ›
const DOUBLE_CHEVRON = 'M10 5l-5 5 5 5M15 5l-5 5 5 5'; // «

// ---- card names and looks -----------------------------------------------

function nameOf(region) {
  let name = '';

  const tablist = deepFirst(region, '[role="tablist"]', el => isShown(el, region));
  if (tablist) {
    const labels = [...tablist.querySelectorAll('[role="tab"]')]
      .map(tab => (tab.dataset.label || tab.textContent || '').trim())
      .filter(Boolean);
    name = [...new Set(labels)].join(' · ');
  }

  if (!name) {
    const heading = deepFirst(
      region,
      '.slds-card__header-title, .accordionheader, h2, [role="heading"]',
      el => isShown(el, region) && deepText(el).trim()
    );
    if (heading) name = deepText(heading);
  }

  return name.replace(/\s+/g, ' ').trim().slice(0, 80);
}

const DEFAULT_LOOK = {
  background: '#fff',
  radius: '1rem',
  shadow: '0 0 0 1px rgba(0,0,0,.06), 0 2px 2px rgba(0,0,0,.05)',
  color: '#181818',
};

function cardLook(region) {
  const card = deepFirst(region, '.slds-tabs_card, article.slds-card, .slds-card');
  if (!card) return DEFAULT_LOOK;
  const cs = getComputedStyle(card);
  const transparent = cs.backgroundColor === 'rgba(0, 0, 0, 0)' || cs.backgroundColor === 'transparent';
  return {
    background: transparent ? DEFAULT_LOOK.background : cs.backgroundColor,
    radius: cs.borderRadius !== '0px' ? cs.borderRadius : DEFAULT_LOOK.radius,
    shadow: cs.boxShadow !== 'none' ? cs.boxShadow : DEFAULT_LOOK.shadow,
    color: cs.color || DEFAULT_LOOK.color,
  };
}

const looks = new WeakMap(); // card bar -> look copied from its card

// ---- vertical: collapsible cards ----------------------------------------

const BUTTON_BASE = 'display:flex;align-items:center;width:100%;box-sizing:border-box;border:0;cursor:pointer;text-align:left;font:inherit;line-height:1.3;';

function makeBar(region, name, key) {
  const bar = document.createElement('button');
  bar.type = 'button';
  bar.setAttribute(BAR_ATTR, '');
  bar.dataset.satKey = key;
  bar.dataset.satName = name;

  const label = document.createElement('span');
  label.textContent = name;
  label.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
  bar.append(svgIcon(CHEVRON), label);

  bar.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleFlag(collapsedCards, key, CARDS_KEY);
  });

  looks.set(bar, cardLook(region));
  return bar;
}

function styleBar(bar, collapsed) {
  const state = collapsed ? 'collapsed' : 'expanded';
  if (bar.dataset.satState === state) return;
  bar.dataset.satState = state;
  bar.setAttribute('aria-expanded', String(!collapsed));
  bar.title = collapsed ? 'Expand' : 'Collapse';

  const look = looks.get(bar) || DEFAULT_LOOK;
  bar.style.cssText = BUTTON_BASE + 'gap:8px;' + (collapsed
    ? `margin:0;padding:14px 16px;background:${look.background};border-radius:${look.radius};box-shadow:${look.shadow};color:${look.color};font-size:14px;font-weight:600;`
    : 'margin:0 0 4px;padding:2px 12px;background:transparent;color:#5c5c5c;font-size:12px;font-weight:600;');
  bar.firstChild.style.transform = collapsed ? 'rotate(0deg)' : 'rotate(90deg)';
}

function enhance(region) {
  let bar = region.querySelector(`:scope > [${BAR_ATTR}]`);
  if (!bar) {
    const name = nameOf(region);
    if (!name) return; // still loading, or a component with nothing to show
    const key = `${region.dataset.componentId || ''}|${name.replace(/\s*\(\d+\+?\)/g, '').trim()}`;
    bar = makeBar(region, name, key);
    region.prepend(bar);
  }
  const collapsed = !!collapsedCards[bar.dataset.satKey];
  styleBar(bar, collapsed);
  setChildrenHidden(region, bar, collapsed);
}

// ---- horizontal: collapsible sidebars -----------------------------------

const templates = new Map(); // template -> { parts, ro, sig }

function partsOf(template) {
  const scope = template.shadowRoot || template;
  const container = scope.querySelector('.main-container');
  const main = scope.querySelector('.main-col');
  if (!container || !main) return null;
  return {
    container,
    main,
    grouping: main.parentElement !== container ? main.parentElement : null,
    left: scope.querySelector('.left-col'),
    right: scope.querySelector('.right-col'),
  };
}

function columnRegions(col) {
  const slot = col.querySelector('slot[name]') || col.querySelector('slot');
  const assigned = slot ? slot.assignedElements() : [];
  if (assigned.length) return assigned;                        // native shadow DOM
  return [...col.querySelectorAll('flexipage-component2[slot]')]; // synthetic shadow
}

function columnLook(col) {
  for (const region of columnRegions(col)) {
    const bar = region.querySelector(`:scope > [${BAR_ATTR}]`);
    if (bar && looks.has(bar)) return looks.get(bar);
  }
  return DEFAULT_LOOK;
}

function makeColumnToggle(side) {
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.setAttribute(COL_ATTR, side);

  const text = document.createElement('span');
  text.textContent = 'Collapse';
  const names = document.createElement('span');
  names.style.cssText = 'writing-mode:vertical-rl;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-height:60vh;';
  toggle.append(svgIcon(DOUBLE_CHEVRON), text, names);

  toggle.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    toggleFlag(collapsedColumns, side, COLUMNS_KEY);
  });
  return toggle;
}

function styleColumnToggle(toggle, side, collapsed, look) {
  const state = collapsed ? 'collapsed' : 'expanded';
  if (toggle.dataset.satState === state) return false;
  toggle.dataset.satState = state;
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.title = collapsed ? 'Expand sidebar' : 'Collapse sidebar';

  const [icon, text, names] = toggle.children;
  toggle.style.cssText = BUTTON_BASE + 'font-size:12px;font-weight:600;' + (collapsed
    ? `flex-direction:column;gap:10px;margin:0;padding:12px 0;background:${look.background};border-radius:${look.radius};box-shadow:${look.shadow};color:${look.color};`
    : `flex-direction:${side === 'left' ? 'row' : 'row-reverse'};justify-content:flex-end;gap:4px;margin:0 0 4px;padding:2px 8px;background:transparent;color:#5c5c5c;`);
  text.style.display = collapsed ? 'none' : '';
  names.style.display = collapsed ? '' : 'none';

  // Left column: « to collapse, » to expand. Right column: the mirror image.
  const pointsLeft = (side === 'left') !== collapsed;
  icon.style.transform = pointsLeft ? '' : 'rotate(180deg)';
  return true;
}

const STRIP_STYLE = {
  width: `${STRIP_WIDTH}px`,
  'min-width': `${STRIP_WIDTH}px`,
  'max-width': `${STRIP_WIDTH}px`,
  flex: `0 0 ${STRIP_WIDTH}px`,
  'box-sizing': 'border-box',
  'padding-left': '6px',
  'padding-right': '6px',
};

function setStrip(col, on) {
  if (on) {
    if (col.hasAttribute(STRIP_ATTR) && col.style.getPropertyValue('width') === STRIP_STYLE.width) return;
    col.setAttribute(STRIP_ATTR, '');
    for (const [prop, value] of Object.entries(STRIP_STYLE)) col.style.setProperty(prop, value, 'important');
  } else if (col.hasAttribute(STRIP_ATTR)) {
    col.removeAttribute(STRIP_ATTR);
    for (const prop of Object.keys(STRIP_STYLE)) col.style.removeProperty(prop);
  }
}

function syncColumn(col, side) {
  let changed = false;
  let toggle = col.querySelector(`:scope > [${COL_ATTR}]`);
  if (!toggle) {
    toggle = makeColumnToggle(side);
    col.prepend(toggle);
    changed = true;
  }

  const collapsed = !!collapsedColumns[side];
  if (styleColumnToggle(toggle, side, collapsed, columnLook(col))) changed = true;

  const names = columnRegions(col)
    .map(region => region.querySelector(`:scope > [${BAR_ATTR}]`)?.dataset.satName)
    .filter(Boolean)
    .join(' · ') || 'Sidebar';
  const label = toggle.children[2];
  if (label.textContent !== names) label.textContent = names;

  setChildrenHidden(col, toggle, collapsed);
  setStrip(col, collapsed);
  return changed;
}

// Give the space freed by collapsed sidebars to the middle column.
const GROW_PROPS = ['width', 'min-width', 'max-width', 'flex'];

function clearWidth(el) {
  for (const prop of GROW_PROPS) el.style.removeProperty(prop);
}

function setWidth(el, borderBoxWidth) {
  const cs = getComputedStyle(el);
  const extra = cs.boxSizing === 'border-box'
    ? 0
    : px(cs.paddingLeft) + px(cs.paddingRight) + px(cs.borderLeftWidth) + px(cs.borderRightWidth);
  const width = `${Math.max(0, Math.floor(borderBoxWidth - extra))}px`;
  el.style.setProperty('width', width, 'important');
  el.style.setProperty('min-width', '0', 'important');
  el.style.setProperty('max-width', 'none', 'important');
  el.style.setProperty('flex', `0 0 ${width}`, 'important');
}

function rowKids(row) {
  const kids = [];
  for (const child of row.children) {
    const cs = getComputedStyle(child);
    if (cs.display === 'none' || cs.position === 'absolute' || cs.position === 'fixed') continue;
    if (cs.display === 'contents') kids.push(...rowKids(child));
    else kids.push(child);
  }
  return kids;
}

// In a horizontal row, hand all leftover width to `grower`.
function absorb(row, grower) {
  const kids = rowKids(row);
  const index = kids.indexOf(grower);
  if (index < 0) return;
  const rects = kids.map(kid => kid.getBoundingClientRect());
  if (rects.some(r => Math.abs(r.top - rects[0].top) > 2)) return; // stacked layout: leave it

  const rowStyle = getComputedStyle(row);
  const inner = row.getBoundingClientRect().width
    - px(rowStyle.paddingLeft) - px(rowStyle.paddingRight)
    - px(rowStyle.borderLeftWidth) - px(rowStyle.borderRightWidth);
  const gaps = px(rowStyle.columnGap) * (kids.length - 1);
  let used = 0;
  kids.forEach((kid, i) => {
    const cs = getComputedStyle(kid);
    used += rects[i].width + px(cs.marginLeft) + px(cs.marginRight);
  });

  const free = inner - gaps - used;
  if (Math.abs(free) >= 1) setWidth(grower, rects[index].width + free);
}

function layout({ container, grouping, main, left, right }) {
  for (const el of [grouping, main]) if (el) clearWidth(el);
  const anyCollapsed = (left && collapsedColumns.left) || (right && collapsedColumns.right);
  if (!anyCollapsed) return;                             // natural layout
  if (!container.getBoundingClientRect().width) return;  // background console tab

  if (grouping && getComputedStyle(grouping).display !== 'contents') {
    absorb(container, grouping);
    absorb(grouping, main);
  } else {
    absorb(container, main);
  }
}

function syncTemplate(template) {
  const parts = partsOf(template);
  if (!parts) return;

  let entry = templates.get(template);
  if (entry && ['container', 'main', 'left', 'right'].some(k => entry.parts[k] !== parts[k])) {
    entry.ro.disconnect(); // template re-rendered
    templates.delete(template);
    entry = null;
  }
  if (!entry) {
    let lastWidth = -1;
    const ro = new ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === lastWidth) return;
      lastWidth = width;
      layout(parts); // window resize, or a background tab becoming visible
    });
    entry = { parts, ro, sig: '' };
    templates.set(template, entry);
    ro.observe(parts.container);
  }

  let changed = false;
  if (parts.left && syncColumn(parts.left, 'left')) changed = true;
  if (parts.right && syncColumn(parts.right, 'right')) changed = true;

  const sig = `${!!collapsedColumns.left}|${!!collapsedColumns.right}`;
  if (changed || sig !== entry.sig) {
    entry.sig = sig;
    layout(parts);
  }
}

// ---- main scan ----------------------------------------------------------

function scan() {
  const roots = collectRoots();
  for (const root of roots) {
    for (const region of root.querySelectorAll(REGION_SELECTOR)) enhance(region);
  }
  for (const root of roots) {
    for (const template of root.querySelectorAll(TEMPLATE_SELECTOR)) syncTemplate(template);
  }
  for (const [template, entry] of templates) {
    if (!template.isConnected) {
      entry.ro.disconnect();
      templates.delete(template);
    }
  }
}

let timer = 0;
function schedule() {
  if (timer) return;
  timer = setTimeout(() => { timer = 0; scan(); }, 120);
}

// ---- start --------------------------------------------------------------

collapsedCards = await loadJSON(CARDS_KEY);
collapsedColumns = await loadJSON(COLUMNS_KEY);
scan();
setInterval(scan, 3000);