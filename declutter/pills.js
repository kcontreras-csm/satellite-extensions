// Case Page Declutter: the follow-up pill (followup.js) and the "No summary" pill (summary.js) right after the case
// number in case lists (My Open Cases, closed case list views, related lists), on one line. The case number never
// shrinks: when the column is too narrow the pills are cut off instead, and widening the column shows them in full.
// Nothing is added to the table itself, so Lightning's column sizing and resizing keep working.
// The other scripts hand their pills over with DeclutterPills.set(); this one draws them.
(() => {
  const GROUP_ATTR = 'data-sat-flags';
  const LINK_ATTR = 'data-sat-flags-link';
  const ORDER = ['followup', 'summary']; // left to right
  const PAINT_MS = 400;
  const LINK_ID = /\/(500[a-zA-Z0-9]{12}(?:[a-zA-Z0-9]{3})?)(?:[/?#]|$)/;
  // They sit inside Lightning's shadow roots, where stylesheets don't reach, so they carry their own styles.
  const PILL_CSS = 'display:inline-block;flex:none;padding:0 6px;border-radius:9px;white-space:nowrap;cursor:default;' +
    "font:600 11px/18px -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
  // Shrinks and clips before the case number does.
  const GROUP_CSS = 'display:inline-flex;gap:4px;align-items:center;flex:0 1 auto;min-width:0;max-width:100%;' +
    'margin-left:6px;overflow:hidden;vertical-align:middle;white-space:nowrap;';
  // Lightning truncates the case number link itself (slds-truncate, sometimes in a flex row); this keeps it whole.
  const LINK_PROPS = { 'flex-shrink': '0', 'max-width': 'none', overflow: 'visible' };

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  const sameId = (a, b) => !!a && !!b && a.slice(0, 15) === b.slice(0, 15);
  const parentOf = node => (node.parentNode?.nodeType === 11 ? node.parentNode.host : node.parentNode);
  const linkId = link => LINK_ID.exec(link.getAttribute('href') || '')?.[1] || link.dataset.recordid || null;

  // source -> Map(case number -> { id, text, title, style })
  const sources = new Map();
  const signatures = new Map();
  let shown = false;

  globalThis.DeclutterPills = {
    set(source, pills) {
      // followup.js hands its pills over on every page change; only a change needs a repaint.
      const signature = JSON.stringify([...pills]);
      if (signatures.get(source) === signature) return;
      signatures.set(source, signature);
      sources.set(source, pills);
      schedule();
    },
  };

  function pillsFor(link) {
    const number = normalize(link.textContent);
    const title = link.getAttribute('title');
    const id = linkId(link);
    const found = [];
    for (const source of ORDER) {
      const map = sources.get(source);
      const pill = map?.get(number) || map?.get(title);
      // A link that carries a record Id has to match too, so a subject that mentions a case number gets nothing.
      if (pill && !(id && !sameId(id, pill.id))) found.push(pill);
    }
    return found;
  }

  function composedClosest(el, selector) {
    for (let node = el; node; node = parentOf(node)) if (node.nodeType === 1 && node.matches(selector)) return node;
    return null;
  }

  // ---- DOM helpers (native shadow roots or synthetic shadow) ------------

  const observedRoots = new WeakSet();
  const observer = new MutationObserver(schedule);

  function collectRoots() {
    const roots = [document];
    for (let i = 0; i < roots.length; i++) {
      if (!observedRoots.has(roots[i])) {
        observedRoots.add(roots[i]);
        observer.observe(roots[i], { childList: true, subtree: true });
      }
      for (const el of roots[i].querySelectorAll('*')) if (el.shadowRoot) roots.push(el.shadowRoot);
    }
    return roots;
  }

  // ---- drawing ----------------------------------------------------------

  // Only what changed is written, so the observer doesn't wake itself up.
  function fill(group, pills) {
    const signature = JSON.stringify(pills.map(p => [p.text, p.title, p.style]));
    if (group.dataset.satSignature === signature) return;
    group.dataset.satSignature = signature;
    group.title = pills.map(p => p.title).join('\n\n'); // the whole story, even for pills that are cut off
    group.replaceChildren(...pills.map(p => {
      const pill = document.createElement('span');
      pill.setAttribute('role', 'note');
      pill.style.cssText = PILL_CSS + p.style;
      pill.textContent = p.text;
      pill.title = p.title;
      pill.setAttribute('aria-label', p.title);
      return pill;
    }));
  }

  function protect(link) {
    if (link.hasAttribute(LINK_ATTR)) return;
    link.setAttribute(LINK_ATTR, '');
    for (const [prop, value] of Object.entries(LINK_PROPS)) link.style.setProperty(prop, value);
  }

  function release(link) {
    link.removeAttribute(LINK_ATTR);
    for (const prop of Object.keys(LINK_PROPS)) link.style.removeProperty(prop);
  }

  function paint() {
    const any = [...sources.values()].some(map => map.size);
    if (!any && !shown) return;
    const roots = collectRoots();
    const kept = new Set();

    if (any) {
      for (const root of roots) {
        for (const link of root.querySelectorAll('a')) {
          const pills = pillsFor(link);
          if (!pills.length || !composedClosest(link, 'tr, [role="row"]')) continue;
          let group = link.nextElementSibling;
          if (!group?.hasAttribute(GROUP_ATTR)) {
            group = document.createElement('span');
            group.setAttribute(GROUP_ATTR, '');
            group.style.cssText = GROUP_CSS;
            link.after(group);
          }
          fill(group, pills);
          protect(link);
          kept.add(group);
          kept.add(link);
        }
      }
    }

    for (const root of roots) {
      for (const group of root.querySelectorAll(`[${GROUP_ATTR}]`)) if (!kept.has(group)) group.remove();
      for (const link of root.querySelectorAll(`[${LINK_ATTR}]`)) if (!kept.has(link)) release(link);
    }
    shown = kept.size > 0;
  }

  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; paint(); }, PAINT_MS);
  }

  if (window.top === window) setInterval(schedule, 3000);
})();
