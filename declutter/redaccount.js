// Case Page Declutter: a red "Red Account" chip at the start of the case
// header's buttons when the case's account had open red account issues when
// the case was created (Case.Open_Red_Account__c). Hover it for the account.
// Wrapped in its own scope so nothing here can clash with content.js.
(() => {
  const CHIP_ATTR = 'data-sat-red-account';
  const CASE_PATH = /\/lightning\/r\/Case\/(\w{15,18})\//;
  const RETRY_MS = 60e3;

  // Sized like the Follow button; it sits in Lightning's shadow roots, so it carries its own styles.
  const CHIP_CSS = 'display:inline-flex;align-items:center;gap:6px;align-self:center;flex:none;height:32px;' +
    'margin:0 8px 0 0;padding:0 12px;box-sizing:border-box;border:1px solid #8e030f;border-radius:16px;' +
    'background:#ba0517;color:#fff;white-space:nowrap;cursor:default;' +
    "font:700 13px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;";
  const FLAG_ICON = '<svg viewBox="0 0 20 20" width="12" height="12" aria-hidden="true" style="flex:none">' +
    '<path d="M4 18V3M4 3h10l-2 3.5L14 10H4" fill="currentColor" stroke="currentColor" stroke-width="2" ' +
    'stroke-linejoin="round" stroke-linecap="round"/></svg>';

  const currentId = () => CASE_PATH.exec(location.pathname)?.[1] || null;
  const key = id => id.slice(0, 15);
  const visible = el => el.getClientRects().length > 0;

  let enabled = true;

  // ---- data ---------------------------------------------------------------

  const cases = new Map(); // 15-character case Id -> { red, account } | { pending } | { failedAt }

  function lookup(id) {
    const entry = cases.get(key(id));
    if (entry && !entry.pending && !(entry.failedAt && Date.now() - entry.failedAt >= RETRY_MS)) return entry;
    if (!entry || entry.failedAt) fetchCase(id);
    return null;
  }

  async function fetchCase(id) {
    cases.set(key(id), { pending: true });
    try {
      const { records } = await satellite.salesforce.query(
        `SELECT Open_Red_Account__c, Account.Name FROM Case WHERE Id = '${id}'`
      );
      const record = records?.[0];
      cases.set(key(id), { red: !!record?.Open_Red_Account__c, account: record?.Account?.Name || '' });
    } catch (error) {
      cases.set(key(id), { failedAt: Date.now() });
      console.error('[declutter] red account lookup', error);
    }
    schedule();
  }

  // ---- chip ---------------------------------------------------------------

  function makeChip() {
    const chip = document.createElement('span');
    chip.setAttribute(CHIP_ATTR, '');
    chip.setAttribute('role', 'note');
    chip.style.cssText = CHIP_CSS;
    chip.innerHTML = `${FLAG_ICON}<span>Red Account</span>`;
    return chip;
  }

  // Only what changed is written, so the observer doesn't wake itself up.
  function paint(highlights, id) {
    // Case panels only, recognised by their subject component.
    if (!highlights.querySelector('support-output-case-subject-field[slot="primaryField"]')) return;
    const scope = highlights.shadowRoot || highlights;
    let chip = scope.querySelector(`[${CHIP_ATTR}]`);

    // Background console tabs keep the chip they got while they were in front.
    if (!visible(highlights)) return;
    const info = enabled && id ? lookup(id) : { red: false };
    if (!info) return; // still loading: leave the page as it is
    const container = scope.querySelector('.forceActionsContainer');
    if (!info.red || !container) {
      chip?.remove();
      return;
    }

    if (!chip) chip = makeChip();
    // First in the row, so it never competes with pills placed next to Follow.
    if (container.firstElementChild !== chip) container.prepend(chip);
    const title = `Red account${info.account ? `: ${info.account}` : ''}\n` +
      'The account had open red account issues when this case was created.';
    if (chip.title !== title) {
      chip.title = title;
      chip.setAttribute('aria-label', title);
    }
  }

  // ---- DOM helpers (native shadow roots or synthetic shadow) ------------

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

  // ---- main scan --------------------------------------------------------

  let wasCasePage = false;

  function scan() {
    const id = currentId();
    // Off a case page there is nothing to add, but chips may need removing once.
    if (!id && !wasCasePage) return;
    wasCasePage = !!id;
    for (const root of collectRoots()) {
      for (const highlights of root.querySelectorAll('records-highlights2')) paint(highlights, id);
    }
  }

  let timer = 0;
  function schedule() {
    if (timer) return;
    timer = setTimeout(() => { timer = 0; scan(); }, 150);
  }

  async function loadSetting() {
    try {
      const value = await satellite.settings.get('redAccountChip');
      enabled = value == null ? true : Boolean(value);
    } catch (error) {
      console.error('[declutter] red account setting', error);
    }
    wasCasePage = true; // repaint (or clear) whatever page is open
    scan();
  }

  satellite.settings.onChange(loadSetting);
  loadSetting();
  setInterval(scan, 3000);
})();
