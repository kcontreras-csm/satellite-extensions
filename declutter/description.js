// Case Page Declutter: shows the case Description in the highlights panel,
// under Global Case # / Org62 Case Link / Severity / Success Plan / Opened.
// Wrapped in its own scope so nothing here can clash with the other scripts.
(() => {
  const BLOCK_ATTR = 'data-sat-description';
  const LINK_ATTR = 'data-sat-link';
  const GROWN_ATTR = 'data-sat-grown';
  const CLAMP_LINES = 3;
  const GAP = 16; // space between the description and the card below
  const TEXT_PROPS = ['color', 'font-family', 'font-size', 'font-weight', 'line-height', 'letter-spacing', 'text-transform'];

  const px = value => parseFloat(value) || 0;

  // ---- DOM helpers (native shadow roots or synthetic shadow) ------------

  const observedRoots = new WeakSet();
  const observer = new MutationObserver(schedule);

  function observe(root) {
    if (observedRoots.has(root)) return;
    observedRoots.add(root);
    observer.observe(root, { childList: true, subtree: true, characterData: true });
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

  const scopeOf = el => el.shadowRoot || el;
  const parentOf = n => (n.parentNode?.nodeType === 11 ? n.parentNode.host : n.parentNode);

  function deepFirst(root, selector) {
    const queue = [root];
    while (queue.length) {
      const scope = queue.shift();
      const hit = scope.querySelector(selector);
      if (hit) return hit;
      if (scope.shadowRoot) queue.push(scope.shadowRoot);
      for (const el of scope.querySelectorAll('*')) if (el.shadowRoot) queue.push(el.shadowRoot);
    }
    return null;
  }

  function composedClosest(el, selector) {
    for (let n = el; n; n = parentOf(n)) {
      if (n.nodeType === 1 && n.matches(selector)) return n;
    }
    return null;
  }

  function deepText(node) {
    if (node.nodeType === 3) return node.data;
    if (node.nodeType !== 1 && node.nodeType !== 11) return '';
    if (node.nodeType === 1 && ['style', 'script', 'template'].includes(node.localName)) return '';
    let text = '';
    if (node.shadowRoot) for (const child of node.shadowRoot.childNodes) text += deepText(child);
    for (const child of node.childNodes) text += deepText(child);
    return text;
  }

  function copyText(from, to) {
    const cs = getComputedStyle(from);
    for (const prop of TEXT_PROPS) to.style.setProperty(prop, cs.getPropertyValue(prop));
  }

  // ---- where the description comes from --------------------------------

  const sources = new WeakMap(); // highlights panel -> formatted description

  function findSourceIn(page) {
    let wrapper = deepFirst(page, 'support-case-description-field-wrapper');
    if (!wrapper) {
      const marker = deepFirst(page, '[data-target-selection-name="sfdc:RecordField.Case.Description"]');
      const item = marker && composedClosest(marker, 'records-record-layout-item');
      wrapper = item?.querySelector('[slot="outputField"]') || null;
    }
    if (!wrapper) return null;
    return deepFirst(wrapper, 'lightning-formatted-text, lightning-formatted-rich-text') || wrapper;
  }

  function findSource(highlights) {
    const cached = sources.get(highlights);
    if (cached?.isConnected) return cached;
    const page = composedClosest(highlights, 'one-record-home-flexipage2');
    const source = page && findSourceIn(page);
    if (source) sources.set(highlights, source);
    return source;
  }

  // ---- making the panel fit the description ----------------------------

  const owners = new WeakMap();  // block -> highlights panel
  const fitKeys = new WeakMap(); // block -> what it was last fitted for

  function regionOf(block) {
    const highlights = owners.get(block);
    return highlights ? composedClosest(highlights, 'flexipage-component2') : null;
  }

  // Wrappers between the description and the page-level component.
  function chainOf(block, region) {
    const chain = [];
    for (let n = parentOf(block); n && n.nodeType === 1; n = parentOf(n)) {
      chain.push(n);
      if (n === region) break;
    }
    return chain;
  }

  function nextTop(region) {
    for (let n = region.nextElementSibling; n; n = n.nextElementSibling) {
      const r = n.getBoundingClientRect();
      if (r.height > 0) return r.top;
    }
    return null;
  }

  function setHeight(el, borderBoxHeight) {
    const cs = getComputedStyle(el);
    const extra = cs.boxSizing === 'border-box'
      ? 0
      : px(cs.paddingTop) + px(cs.paddingBottom) + px(cs.borderTopWidth) + px(cs.borderBottomWidth);
    el.setAttribute(GROWN_ATTR, '');
    el.style.setProperty('height', `${Math.ceil(borderBoxHeight - extra)}px`, 'important');
    el.style.setProperty('max-height', 'none', 'important');
  }

  function fit(block) {
    if (!block.getClientRects().length) return false; // background console tab
    const region = regionOf(block);
    if (!region) return false;
    const chain = chainOf(block, region);

    // Start again from Salesforce's own sizes.
    for (const n of chain) {
      if (n.hasAttribute(GROWN_ATTR)) {
        n.removeAttribute(GROWN_ATTR);
        n.style.removeProperty('height');
        n.style.removeProperty('max-height');
      }
    }
    block.style.removeProperty('margin-bottom');

    for (let attempt = 0; attempt < 3; attempt++) {
      // Grow any fixed-height wrapper that's too short to contain the description.
      const target = block.getBoundingClientRect().bottom + GAP;
      for (const n of chain) {
        const r = n.getBoundingClientRect();
        if (r.height > 0 && r.bottom < target - 0.5) setHeight(n, r.height + (target - r.bottom));
      }
      // If the next card still overlaps it, push that card down as well.
      const top = nextTop(region);
      const deficit = top == null ? 0 : block.getBoundingClientRect().bottom + GAP - top;
      if (deficit <= 0.5) break;
      block.style.setProperty('margin-bottom', `${Math.ceil(px(getComputedStyle(block).marginBottom) + deficit)}px`);
    }
    return true;
  }

  function maybeFit(block, force = false) {
    const rect = block.getBoundingClientRect();
    if (!rect.width) return;
    const key = `${Math.round(rect.width)}|${signatures.get(block)}|${block.dataset.satExpanded}`;

    if (!force && fitKeys.get(block) === key) {
      // Same content and width: only re-fit if Salesforce undid our sizing.
      const region = regionOf(block);
      const top = region && nextTop(region);
      if (top == null || top >= rect.bottom + GAP - 1) return;
    }
    if (fit(block)) fitKeys.set(block, key);
  }

  // ---- the description block --------------------------------------------

  const linkColors = new WeakMap(); // block -> link colour
  const signatures = new WeakMap(); // block -> text currently shown

  function styleRefs(highlights) {
    const item = deepFirst(highlights, 'records-highlights-details-item');
    const scope = item && scopeOf(item);
    return {
      label: scope?.querySelector('.slds-text-title') || null,
      value: scope?.querySelector('.fieldComponent') || null,
      link: deepFirst(highlights, `a[href]:not([${LINK_ATTR}])`),
    };
  }

  function setClamp(value, expanded) {
    value.style.setProperty('display', expanded ? 'block' : '-webkit-box');
    value.style.setProperty('-webkit-box-orient', 'vertical');
    value.style.setProperty('-webkit-line-clamp', expanded ? 'unset' : String(CLAMP_LINES));
    value.style.setProperty('overflow', 'hidden');
  }

  function makeBlock(highlights) {
    const refs = styleRefs(highlights);
    const block = document.createElement('div');
    block.setAttribute(BLOCK_ATTR, '');
    block.style.cssText = 'margin-top:.75rem;max-width:100%;';

    const label = document.createElement('p');
    label.textContent = 'Description';
    if (refs.label) copyText(refs.label, label);
    label.style.setProperty('margin', '0 0 .125rem');
    label.style.setProperty('overflow', 'visible');

    const value = document.createElement('div');
    if (refs.value) copyText(refs.value, value);
    value.style.setProperty('white-space', 'pre-line');
    value.style.setProperty('overflow-wrap', 'anywhere');
    setClamp(value, false);

    const linkColor = refs.link ? getComputedStyle(refs.link).color : '#0b5cab';
    const more = document.createElement('button');
    more.type = 'button';
    more.textContent = 'Show more';
    more.style.cssText = `display:none;margin:.25rem 0 0;padding:0;border:0;background:none;cursor:pointer;font:inherit;font-size:.8125rem;color:${linkColor};`;
    more.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      const expanded = block.dataset.satExpanded !== '1';
      block.dataset.satExpanded = expanded ? '1' : '';
      setClamp(value, expanded);
      updateMore(block);
      maybeFit(block, true);
    });

    block.append(label, value, more);
    linkColors.set(block, linkColor);
    owners.set(block, highlights);
    return block;
  }

  function fill(block, source) {
    const text = deepText(source).trim();
    if (signatures.get(block) === text) return;
    signatures.set(block, text);

    const value = block.children[1];
    const clones = [...scopeOf(source).childNodes]
      .filter(n => !(n.nodeType === 1 && ['style', 'script', 'template'].includes(n.localName)))
      .map(n => n.cloneNode(true));
    value.replaceChildren(...clones);

    const linkColor = linkColors.get(block);
    for (const a of value.querySelectorAll('a')) {
      a.setAttribute(LINK_ATTR, '');
      a.style.color = linkColor;
      a.target = '_blank';
      a.rel = 'noopener';
    }
    block.style.display = text ? '' : 'none';
  }

  function updateMore(block) {
    if (!block.getClientRects().length) return;
    const [, value, more] = block.children;
    const expanded = block.dataset.satExpanded === '1';
    const clamped = value.scrollHeight > value.clientHeight + 1;
    const display = expanded || clamped ? '' : 'none';
    const label = expanded ? 'Show less' : 'Show more';
    if (more.style.display !== display) more.style.display = display;
    if (more.textContent !== label) more.textContent = label;
  }

  function enhance(highlights) {
    const scope = scopeOf(highlights);
    const row = scope.querySelector('.secondaryFields');
    if (!row) return;
    const source = findSource(highlights);
    if (!source) return;

    let block = scope.querySelector(`[${BLOCK_ATTR}]`);
    if (!block) block = makeBlock(highlights);

    let moved = false;
    if (row.nextElementSibling !== block) {
      row.after(block);
      moved = true;
    }

    fill(block, source);
    updateMore(block);
    maybeFit(block, moved);
  }

  // ---- main scan --------------------------------------------------------

  function scan() {
    for (const root of collectRoots()) {
      for (const highlights of root.querySelectorAll('records-highlights2')) enhance(highlights);
    }
  }

  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; scan(); }, 150);
  }

  scan();
  setInterval(scan, 3000);
  window.addEventListener('resize', schedule);
})();