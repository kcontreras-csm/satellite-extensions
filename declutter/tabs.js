// Case Page Declutter: adds "Close Other Tabs" and "Close All Tabs" to the
// menu of each console workspace tab, right under "Close Tab".
// Pinned tabs are never closed. Wrapped in its own scope so nothing here
// can clash with content.js.
(() => {
  const ITEM_ATTR = 'data-sat-tab-menu';
  const HEADER_SELECTOR = '.tabsetHeader.slds-context-bar';
  const TAB_SELECTOR = `${HEADER_SELECTOR} ul.tabBarItems > li.oneConsoleTabItem`;
  const ANY_TAB_SELECTOR = `${HEADER_SELECTOR} li.oneConsoleTabItem`; // includes pinned
  const CLOSE_LABEL = /^close(\s+tab)?$/i;
  const PORTAL_WINDOW_MS = 2000;
  const TRANSPARENT = new Set(['rgba(0, 0, 0, 0)', 'transparent', '']);

  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const tabsOf = () => [...document.querySelectorAll(TAB_SELECTOR)];
  const tabIdOf = li => li?.querySelector('a.tabHeader')?.dataset.tabid || '';
  const tabExists = id => tabsOf().some(li => tabIdOf(li) === id);
  const findAnyTab = id => [...document.querySelectorAll(ANY_TAB_SELECTOR)].find(li => tabIdOf(li) === id);

  async function waitFor(check, timeout) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      if (check()) return true;
      await sleep(50);
    }
    return check();
  }

  // A full press-and-release, for handlers that don't react to a bare click().
  function press(el) {
    const opts = { bubbles: true, cancelable: true, composed: true, view: window, button: 0 };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new MouseEvent('mousedown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.dispatchEvent(new MouseEvent('mouseup', opts));
    el.click();
  }

  // ---- closing ----------------------------------------------------------

  let busy = false;

  // keepId: the tab to leave open, or null to close everything (except pinned).
  async function closeTabs(keepId) {
    if (busy) return;
    busy = true;
    try {
      for (let guard = 0; guard < 200; guard++) {
        const target = tabsOf().find(li => tabIdOf(li) !== keepId);
        if (!target) break;

        const id = tabIdOf(target);
        const button = target.querySelector('.close button');
        if (!id || !button) break;

        press(button);
        // A tab with unsaved changes asks first: stop and leave the prompt to you.
        if (!(await waitFor(() => !tabExists(id), 2500))) break;
        await sleep(80);
      }
    } finally {
      busy = false;
    }
  }

  // ---- which tab a menu belongs to --------------------------------------

  let lastTab = null;
  let lastTabAt = 0;

  function remember(event) {
    const li = event.target instanceof Element ? event.target.closest('li.oneConsoleTabItem') : null;
    if (li) {
      lastTab = li;
      lastTabAt = Date.now();
    }
  }
  document.addEventListener('contextmenu', remember, true);
  document.addEventListener('mousedown', remember, true);

  const isWorkspaceTab = li => !!li && li.isConnected && !!li.closest(HEADER_SELECTOR);

  function ownerOf(menu, requireRecent) {
    const li = menu.closest('li.oneConsoleTabItem');
    if (li) return isWorkspaceTab(li) ? li : null; // subtab menus are left alone
    if (requireRecent && Date.now() - lastTabAt > PORTAL_WINDOW_MS) return null;
    return isWorkspaceTab(lastTab) ? lastTab : null;
  }

  // ---- hover highlight --------------------------------------------------

  // Learned from Salesforce's own items as you hover them.
  let hover = { on: 'a', color: '#f3f3f3' };
  const watchedMenus = new WeakSet();
  const suppressed = new Set();

  const anchorOf = li => li.querySelector('a, [role="menuitem"]') || li;

  function paintOf(li, menuBg) {
    for (const [on, el] of [['a', anchorOf(li)], ['li', li]]) {
      const color = getComputedStyle(el).backgroundColor;
      if (!TRANSPARENT.has(color) && color !== menuBg) return { on, color };
    }
    return null;
  }

  function watchMenu(menu) {
    if (watchedMenus.has(menu)) return;
    watchedMenus.add(menu);
    menu.addEventListener('mouseover', event => {
      const li = event.target instanceof Element ? event.target.closest('li') : null;
      if (!li || li.hasAttribute(ITEM_ATTR) || !menu.contains(li)) return;
      requestAnimationFrame(() => {
        const paint = paintOf(li, getComputedStyle(menu).backgroundColor);
        if (paint) hover = paint;
      });
    });
  }

  function highlight(item, on) {
    const target = hover.on === 'li' ? item : anchorOf(item);
    if (on) {
      target.style.setProperty('background-color', hover.color, 'important');
      // Clear a highlight Salesforce left on one of its own items.
      for (const li of item.parentElement?.children || []) {
        if (li.hasAttribute(ITEM_ATTR)) continue;
        for (const el of new Set([li, anchorOf(li)])) {
          if (getComputedStyle(el).backgroundColor === hover.color) {
            el.style.setProperty('background-color', 'transparent', 'important');
            suppressed.add(el);
          }
        }
      }
    } else {
      target.style.removeProperty('background-color');
      for (const el of suppressed) el.style.removeProperty('background-color');
      suppressed.clear();
    }
  }

  // ---- menu items -------------------------------------------------------

  function isCloseItem(li) {
    if ([li, ...li.querySelectorAll('[title]')].some(el => CLOSE_LABEL.test((el.title || '').trim()))) return true;
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      if (CLOSE_LABEL.test(n.data.trim())) return true;
    }
    return false;
  }

  function dismiss(menu, ownerId) {
    const trigger = findAnyTab(ownerId)?.querySelector('button[aria-expanded="true"]');
    if (trigger) {
      trigger.click();
      return;
    }
    if (menu?.isConnected && menu.getClientRects().length) {
      menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }));
    }
  }

  let lastRunAt = 0;

  function run(item) {
    const now = Date.now();
    if (now - lastRunAt < 600) return; // press and click both land here
    lastRunAt = now;

    const menu = item.closest('[role="menu"]');
    const ownerId = tabIdOf(menu && ownerOf(menu, false)) || item.dataset.satOwner || '';
    const keepId = item.dataset.satAction === 'others' ? ownerId : null;
    if (keepId === '') return; // "others" but we can't tell which tab: do nothing

    // Let Salesforce finish handling the press before we touch the menu.
    setTimeout(() => {
      dismiss(menu, ownerId);
      closeTabs(keepId);
    }, 0);
  }

  // Copy the native "Close Tab" item so ours look identical, then strip
  // anything that could make Salesforce treat it as "Close Tab".
  function makeItem(template, label, action, ownerId) {
    const li = template.cloneNode(true);
    for (const el of [li, ...li.querySelectorAll('*')]) {
      for (const attr of [...el.attributes]) {
        if (attr.name === 'id' || attr.name.startsWith('data-') ||
            attr.name === 'aria-describedby' || attr.name === 'aria-controls') {
          el.removeAttribute(attr.name);
        }
      }
      if (el.hasAttribute('title')) el.setAttribute('title', label);
      if (el.hasAttribute('aria-label')) el.setAttribute('aria-label', label);
      el.style?.removeProperty('background-color');
    }

    const texts = [];
    const walker = document.createTreeWalker(li, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (n.data.trim()) texts.push(n);
    const labelNode = texts.find(n => CLOSE_LABEL.test(n.data.trim())) || texts[0];
    for (const n of texts) n.data = n === labelNode ? label : '';
    if (!labelNode) anchorOf(li).append(label);

    li.setAttribute(ITEM_ATTR, '');
    li.dataset.satAction = action;
    li.dataset.satOwner = ownerId;

    li.addEventListener('mousedown', event => {
      if (event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      run(li);
    });
    li.addEventListener('mouseup', event => event.stopPropagation());
    li.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      run(li);
    });
    li.addEventListener('keydown', event => {
      if (event.key !== 'Enter' && event.key !== ' ') return;
      event.preventDefault();
      event.stopPropagation();
      run(li);
    });
    li.addEventListener('mouseenter', () => highlight(li, true));
    li.addEventListener('mouseleave', () => highlight(li, false));
    return li;
  }

  function enhanceMenu(menu) {
    watchMenu(menu);

    const ours = [...menu.querySelectorAll(`[${ITEM_ATTR}]`)];
    const closeLi = [...menu.querySelectorAll('li')]
      .find(li => !li.closest(`[${ITEM_ATTR}]`) && isCloseItem(li));

    if (!closeLi) {
      ours.forEach(el => el.remove());
      return;
    }

    // Already in place: just keep the owning tab up to date.
    if (ours.length === 2 && closeLi.nextElementSibling === ours[0] && ours[0].nextElementSibling === ours[1]) {
      const id = tabIdOf(ownerOf(menu, false));
      if (id) for (const el of ours) if (el.dataset.satOwner !== id) el.dataset.satOwner = id;
      return;
    }

    ours.forEach(el => el.remove());
    const owner = ownerOf(menu, true);
    if (!owner) return;
    const id = tabIdOf(owner);
    closeLi.after(
      makeItem(closeLi, 'Close Other Tabs', 'others', id),
      makeItem(closeLi, 'Close All Tabs', 'all', id),
    );
  }

  function scanMenus() {
    for (const menu of document.querySelectorAll('[role="menu"]')) {
      if (!menu.querySelector('li') || !menu.getClientRects().length) continue;
      enhanceMenu(menu);
    }
  }

  new MutationObserver(scanMenus).observe(document.body, { childList: true, subtree: true });
  scanMenus();
})();