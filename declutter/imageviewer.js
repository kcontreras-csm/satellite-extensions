// Case Page Declutter: click an image in a case comment, feed post or email (Salesforce files: rtaImage,
// servlet.shepherd, FileDownload, pasted data: images) to open it in a viewer: zoom (wheel, pinch, +/-, double-click),
// pan by dragging, rotate, fit or actual size, previous/next through the images of the same post or email, copy the
// image or its link, download it, or open the original. Emails are shown in same-origin iframes, which are watched too.
// Images inside links or buttons (file cards, profile pictures) keep Salesforce's own behaviour; Cmd-click as well.
// Wrapped in its own scope so nothing here can clash with the other scripts.
(() => {
  const HOST_ATTR = 'data-sat-image-viewer';
  const MARK_ATTR = 'data-sat-zoomable';
  const MEDIA_SRC = /\/servlet\/rtaImage|\/sfc\/servlet\.shepherd\/|\/servlet\/servlet\.FileDownload|\.file\.force\.com\/|\.content\.force\.com\/|^data:image\//i;
  const MIN_SIZE = 24; // icons and spacers stay clickable as they are
  const MIN_SCALE = 0.05;
  const MAX_SCALE = 16;
  const STEP = 1.25;
  const GROUP = 'article, [role="article"], li';

  const CSS = `
    :host { all: initial; }
    * { box-sizing: border-box; }
    .viewer {
      position: fixed; inset: 0; z-index: 2147483600; display: flex; flex-direction: column;
      background: rgba(10, 10, 12, .92); color: #f3f3f3;
      font: 13px/1.4 -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    }
    .bar { display: flex; align-items: center; gap: 4px; padding: 8px 12px; background: rgba(0, 0, 0, .35); }
    .bar .title { flex: 1; min-width: 0; overflow: hidden; color: #c9c9c9; text-overflow: ellipsis; white-space: nowrap; }
    .bar .zoom { min-width: 48px; color: #c9c9c9; text-align: center; font-variant-numeric: tabular-nums; }
    .sep { width: 1px; height: 20px; margin: 0 6px; background: rgba(255, 255, 255, .2); }
    button {
      height: 30px; min-width: 30px; padding: 0 10px; border: 0; border-radius: 6px; background: none; color: inherit;
      font: inherit; cursor: pointer; white-space: nowrap;
    }
    button:hover { background: rgba(255, 255, 255, .14); }
    button:disabled { opacity: .35; cursor: default; background: none; }
    button.icon { padding: 0; font-size: 17px; }
    .stage { position: relative; flex: 1; overflow: hidden; cursor: grab; touch-action: none; }
    .stage.dragging { cursor: grabbing; }
    .stage img {
      position: absolute; left: 50%; top: 50%; max-width: none; max-height: none; transform-origin: center;
      user-select: none; -webkit-user-drag: none; image-rendering: auto; box-shadow: 0 4px 24px rgba(0, 0, 0, .5);
      background: repeating-conic-gradient(#ddd 0 25%, #fff 0 50%) 50% / 16px 16px;
    }
    .stage img.pixel { image-rendering: pixelated; }
    .nav {
      position: absolute; top: 50%; width: 44px; height: 64px; margin-top: -32px; border-radius: 8px;
      background: rgba(0, 0, 0, .35); font-size: 26px;
    }
    .nav.prev { left: 12px; }
    .nav.next { right: 12px; }
    .nav[hidden] { display: none; }
    .message { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); color: #c9c9c9; }
    .toast {
      position: absolute; left: 50%; bottom: 20px; transform: translateX(-50%); padding: 8px 14px; border-radius: 8px;
      background: rgba(0, 0, 0, .75); opacity: 0; transition: opacity .2s; pointer-events: none;
    }
    .toast.show { opacity: 1; }
    .hint { padding: 6px 12px; color: #9a9a9a; font-size: 12px; text-align: center; }`;

  const VIEWER = `
    <section class="viewer" role="dialog" aria-modal="true" aria-label="Image preview">
      <div class="bar">
        <span class="title"></span>
        <button type="button" class="icon" data-act="out" title="Zoom out (−)" aria-label="Zoom out">−</button>
        <span class="zoom" aria-live="polite"></span>
        <button type="button" class="icon" data-act="in" title="Zoom in (+)" aria-label="Zoom in">+</button>
        <button type="button" data-act="fit" title="Fit to window (0)">Fit</button>
        <button type="button" data-act="actual" title="Actual size (1)">1:1</button>
        <button type="button" class="icon" data-act="left" title="Rotate left (Shift+R)" aria-label="Rotate left">⟲</button>
        <button type="button" class="icon" data-act="right" title="Rotate right (R)" aria-label="Rotate right">⟳</button>
        <span class="sep"></span>
        <button type="button" data-act="copy" title="Copy image (⌘C)">Copy</button>
        <button type="button" data-act="link" title="Copy the image's address">Copy link</button>
        <button type="button" data-act="download" title="Download (⌘S)">Download</button>
        <button type="button" data-act="open" title="Open the original in a new tab">Open</button>
        <span class="sep"></span>
        <button type="button" class="icon" data-act="close" title="Close (Esc)" aria-label="Close">×</button>
      </div>
      <div class="stage">
        <img alt="" draggable="false">
        <p class="message" hidden></p>
        <button type="button" class="nav prev" data-act="prev" title="Previous (←)" aria-label="Previous image">‹</button>
        <button type="button" class="nav next" data-act="next" title="Next (→)" aria-label="Next image">›</button>
        <div class="toast" role="status"></div>
      </div>
      <div class="hint">Scroll or pinch to zoom · drag to move · double-click to switch between fit and 1:1</div>
    </section>`;

  let enabled = true;
  const parentOf = node => (node.parentNode?.nodeType === 11 ? node.parentNode.host : node.parentNode);
  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  // ---- which images ---------------------------------------------------------

  function composedClosest(el, selector) {
    for (let node = el; node; node = parentOf(node)) if (node.nodeType === 1 && node.matches(selector)) return node;
    return null;
  }

  // The full-size file, not a thumbnail rendition.
  function fullSource(img) {
    const src = img.currentSrc || img.src || '';
    try {
      const url = new URL(src, img.ownerDocument.baseURI);
      const version = url.searchParams.get('versionId');
      if (/renditionDownload/i.test(url.pathname) && version) {
        return `${url.origin}/sfc/servlet.shepherd/version/download/${version}`;
      }
      return url.href;
    } catch (error) {
      return src;
    }
  }

  function zoomable(img, path) {
    if (!enabled || img?.localName !== 'img' || img.getRootNode() === root) return false; // not the viewer's own
    if (!MEDIA_SRC.test(img.currentSrc || img.src || '')) return false;
    if (path && path.some(n => n !== img && n.nodeType === 1 && n.matches('a[href], button, [role="button"]'))) return false;
    const r = img.getBoundingClientRect();
    return r.width >= MIN_SIZE && r.height >= MIN_SIZE;
  }

  // Every image in the same post, comment or email, in page order, shadow roots included.
  function gallery(img) {
    const scope = img.ownerDocument !== document
      ? img.ownerDocument
      : composedClosest(img, 'article, [role="article"]') || composedClosest(img, GROUP) || img.getRootNode();
    const found = [];
    const visit = node => {
      for (const el of node.querySelectorAll('*')) {
        if (el.localName === 'img' && zoomable(el, composedPath(el))) found.push(el);
        if (el.shadowRoot) visit(el.shadowRoot);
      }
    };
    visit(scope.shadowRoot || scope);
    if (!found.includes(img)) found.unshift(img);
    return found;
  }

  function composedPath(el) {
    const path = [];
    for (let node = el; node; node = parentOf(node)) path.push(node);
    return path;
  }

  // ---- watching the page and its email iframes ---------------------------

  function onClick(event) {
    if (event.button || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    const path = event.composedPath();
    const img = path[0]?.localName === 'img' ? path[0] : null;
    if (!img || !zoomable(img, path)) return;
    event.preventDefault();
    event.stopPropagation();
    const images = gallery(img);
    open(images, images.indexOf(img));
  }

  // A zoom cursor tells you the image opens; set once per image.
  function onOver(event) {
    const img = event.composedPath()[0];
    if (img?.localName !== 'img' || img.hasAttribute(MARK_ATTR) || !zoomable(img, event.composedPath())) return;
    img.setAttribute(MARK_ATTR, '');
    img.style.cursor = 'zoom-in';
    if (!img.title) img.title = 'Click to preview';
  }

  const watched = new WeakSet();
  function watch(doc) {
    if (!doc || watched.has(doc)) return;
    watched.add(doc);
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('mouseover', onOver, true);
  }

  // Emails in the feed are same-origin iframes ("Email Preview"); others can't be read and are skipped.
  function scanFrames() {
    if (!enabled) return;
    const roots = [document];
    for (let i = 0; i < roots.length; i++) {
      for (const el of roots[i].querySelectorAll('*')) {
        if (el.shadowRoot && !el.hasAttribute(HOST_ATTR)) roots.push(el.shadowRoot);
        if (el.localName !== 'iframe') continue;
        try {
          watch(el.contentDocument);
        } catch (error) {
          /* another origin */
        }
      }
    }
  }

  // ---- the viewer -------------------------------------------------------

  const host = document.createElement('div');
  host.setAttribute(HOST_ATTR, '');
  const root = host.attachShadow({ mode: 'open' });
  root.innerHTML = `<style>${CSS}</style>${VIEWER}`;
  const stage = root.querySelector('.stage');
  const view = root.querySelector('.stage img');
  const message = root.querySelector('.message');
  const toastEl = root.querySelector('.toast');
  const $ = selector => root.querySelector(selector);

  const v = { images: [], index: 0, src: '', scale: 1, rotation: 0, x: 0, y: 0, fitted: true, moved: false, returnFocus: null };
  let toastTimer = 0;

  const isOpen = () => host.isConnected;
  const turned = () => v.rotation % 180 !== 0;

  function open(images, index) {
    v.images = images;
    v.returnFocus = document.activeElement;
    if (!isOpen()) {
      document.body.append(host);
      addEventListener('keydown', onKey, true);
      addEventListener('resize', onResize);
    }
    show(index);
    $('[data-act="close"]').focus();
  }

  function close() {
    host.remove();
    removeEventListener('keydown', onKey, true);
    removeEventListener('resize', onResize);
    view.removeAttribute('src');
    v.returnFocus?.focus?.();
  }

  function show(index) {
    v.index = (index + v.images.length) % v.images.length;
    const img = v.images[v.index];
    v.src = fullSource(img);
    v.rotation = 0;
    const name = img.alt || img.title?.replace(/^Click to preview$/, '') || '';
    $('.title').textContent = [v.images.length > 1 ? `${v.index + 1} of ${v.images.length}` : '', name]
      .filter(Boolean).join(' · ') || 'Image';
    const single = v.images.length < 2;
    root.querySelectorAll('.nav').forEach(b => { b.hidden = single; });
    message.hidden = false;
    message.textContent = 'Loading…';
    view.style.visibility = 'hidden';
    view.onload = () => {
      message.hidden = true;
      view.style.visibility = '';
      fit();
    };
    view.onerror = () => {
      // Fall back to what the page shows (a rendition may load where the original doesn't).
      const shown = img.currentSrc || img.src;
      if (view.src !== shown) {
        v.src = shown;
        view.src = shown;
        return;
      }
      message.textContent = 'This image couldn’t be loaded.';
    };
    view.src = v.src;
  }

  function size() {
    const w = view.naturalWidth || 1;
    const h = view.naturalHeight || 1;
    return turned() ? { w: h, h: w } : { w, h };
  }

  function fitScale() {
    const { w, h } = size();
    const r = stage.getBoundingClientRect();
    return Math.min(1, (r.width - 48) / w, (r.height - 48) / h);
  }

  function fit() {
    v.scale = clamp(fitScale(), MIN_SCALE, MAX_SCALE);
    v.x = 0;
    v.y = 0;
    v.fitted = true;
    apply();
  }

  function actual() {
    v.scale = 1;
    v.x = 0;
    v.y = 0;
    v.fitted = false;
    apply();
  }

  // Zooms around a point of the stage (its centre by default), so what's under the pointer stays put.
  function zoomTo(scale, cx = 0, cy = 0) {
    const next = clamp(scale, MIN_SCALE, MAX_SCALE);
    const k = next / v.scale;
    v.x = cx - (cx - v.x) * k;
    v.y = cy - (cy - v.y) * k;
    v.scale = next;
    v.fitted = false;
    apply();
  }

  function apply() {
    view.style.transform =
      `translate(-50%, -50%) translate(${v.x}px, ${v.y}px) rotate(${v.rotation}deg) scale(${v.scale})`;
    view.classList.toggle('pixel', v.scale >= 3);
    $('.zoom').textContent = `${Math.round(v.scale * 100)}%`;
  }

  function rotate(degrees) {
    v.rotation = (v.rotation + degrees + 360) % 360;
    if (v.fitted) fit();
    else apply();
  }

  function onResize() {
    if (v.fitted) fit();
  }

  function toast(text) {
    toastEl.textContent = text;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 1800);
  }

  // ---- copy, download, open -----------------------------------------------

  // A PNG of the image as shown (rotation included). Images from another site can't be drawn, so that throws.
  function pngBlob() {
    return new Promise((resolve, reject) => {
      const canvas = document.createElement('canvas');
      const w = view.naturalWidth;
      const h = view.naturalHeight;
      canvas.width = turned() ? h : w;
      canvas.height = turned() ? w : h;
      const ctx = canvas.getContext('2d');
      ctx.translate(canvas.width / 2, canvas.height / 2);
      ctx.rotate((v.rotation * Math.PI) / 180);
      ctx.drawImage(view, -w / 2, -h / 2);
      canvas.toBlob(blob => (blob ? resolve(blob) : reject(new Error('no image'))), 'image/png');
    });
  }

  async function copyImage() {
    if (!view.naturalWidth) return;
    try {
      // The promise goes straight into the ClipboardItem so Safari still counts the click as the gesture.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': pngBlob() })]);
      toast('Image copied');
    } catch (error) {
      console.warn('[declutter] image copy', error);
      toast('This image can’t be copied. Use Copy link instead.');
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(v.src);
      toast('Link copied');
    } catch (error) {
      console.warn('[declutter] link copy', error);
      toast('Couldn’t copy the link');
    }
  }

  function fileName(response, blob) {
    const disposition = response.headers.get('content-disposition') || '';
    const quoted = /filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i.exec(disposition);
    if (quoted) {
      try {
        return decodeURIComponent(quoted[1] || quoted[2]);
      } catch (error) {
        return quoted[1] || quoted[2];
      }
    }
    const id = /\b(068\w{12,15}|015\w{12,15}|0EM\w{12,15})\b/.exec(v.src)?.[1] || `image-${Date.now()}`;
    const ext = (blob.type.split('/')[1] || 'png').replace('jpeg', 'jpg').replace(/\+.*/, '');
    return `${id}.${ext}`;
  }

  async function download() {
    try {
      const response = await fetch(v.src, { credentials: 'include' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName(response, blob);
      root.append(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 60e3);
    } catch (error) {
      console.warn('[declutter] image download', error);
      toast('Couldn’t download it. Try Open instead.');
    }
  }

  function openOriginal() {
    window.open(v.src, '_blank', 'noopener');
  }

  // ---- input --------------------------------------------------------------

  const actions = {
    in: () => zoomTo(v.scale * STEP),
    out: () => zoomTo(v.scale / STEP),
    fit,
    actual,
    left: () => rotate(-90),
    right: () => rotate(90),
    copy: copyImage,
    link: copyLink,
    download,
    open: openOriginal,
    prev: () => show(v.index - 1),
    next: () => show(v.index + 1),
    close,
  };

  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-act]');
    if (button) actions[button.dataset.act]();
  });

  // Keys stay in the viewer, so Lightning's shortcuts don't fire behind it.
  function onKey(event) {
    const cmd = event.metaKey || event.ctrlKey;
    const keys = {
      Escape: close,
      ArrowLeft: actions.prev,
      ArrowRight: actions.next,
      '+': actions.in,
      '=': actions.in,
      '-': actions.out,
      '0': fit,
      '1': actual,
      r: actions.right,
      R: actions.left,
    };
    let action = null;
    if (cmd && event.key.toLowerCase() === 'c' && !String(getSelection())) action = copyImage;
    else if (cmd && event.key.toLowerCase() === 's') action = download;
    else if (!cmd && !event.altKey) action = keys[event.key];
    if (!action) return;
    if ((event.key === 'ArrowLeft' || event.key === 'ArrowRight') && v.images.length < 2) return;
    event.preventDefault();
    event.stopPropagation();
    action();
  }

  function stagePoint(event) {
    const r = stage.getBoundingClientRect();
    return { x: event.clientX - r.left - r.width / 2, y: event.clientY - r.top - r.height / 2 };
  }

  // A trackpad pinch arrives as a wheel event with ctrlKey and small deltas; a mouse wheel as larger ones.
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const p = stagePoint(event);
    const speed = event.ctrlKey ? 0.01 : 0.002;
    zoomTo(v.scale * Math.exp(-event.deltaY * speed), p.x, p.y);
  }, { passive: false });

  // Safari's own pinch events, when it sends them instead of wheel events.
  let gestureStart = 1;
  stage.addEventListener('gesturestart', event => { event.preventDefault(); gestureStart = v.scale; });
  stage.addEventListener('gesturechange', event => {
    event.preventDefault();
    const p = stagePoint(event);
    zoomTo(gestureStart * event.scale, p.x, p.y);
  });

  let drag = null;
  stage.addEventListener('pointerdown', event => {
    if (event.button || event.target.closest('button')) return;
    drag = { id: event.pointerId, x: event.clientX - v.x, y: event.clientY - v.y };
    stage.setPointerCapture(event.pointerId);
    stage.classList.add('dragging');
  });
  stage.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.id) return;
    v.x = event.clientX - drag.x;
    v.y = event.clientY - drag.y;
    v.fitted = false;
    apply();
  });
  const endDrag = () => {
    drag = null;
    stage.classList.remove('dragging');
  };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);

  stage.addEventListener('dblclick', event => {
    if (event.target.closest('button')) return;
    const p = stagePoint(event);
    if (v.fitted || v.scale < 1) zoomTo(1, p.x, p.y);
    else fit();
  });

  // Clicking the dark area around the image closes it, like most viewers. Pointer capture sends every click to the
  // stage, so where the press started is what counts.
  let backdrop = false;
  stage.addEventListener('pointerdown', event => {
    backdrop = event.target === stage;
    v.moved = false;
  });
  stage.addEventListener('pointermove', () => { if (drag) v.moved = true; });
  stage.addEventListener('click', () => {
    if (backdrop && !v.moved) close();
  });

  // ---- start --------------------------------------------------------------

  async function loadSetting() {
    try {
      const value = await satellite.settings.get('imageViewer');
      enabled = value == null ? true : Boolean(value);
    } catch (error) {
      console.error('[declutter] image viewer setting', error);
    }
    if (!enabled && isOpen()) close();
  }

  if (window.top !== window) return;
  satellite.settings.onChange(loadSetting);
  loadSetting();
  watch(document);
  scanFrames();
  setInterval(scanFrames, 2000);
})();
