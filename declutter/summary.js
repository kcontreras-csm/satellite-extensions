// Case Page Declutter: a red "No summary" pill after the case number in case lists (pills.js), for each of your cases
// where the case AI summary wasn't generated, that is, with no case comment (public or internal) or feed post that
// starts with "--CASE AI SUMMARY GENERATED--". It checks cases you own in Solution Provided and the ones closed in the
// last few days (setting). Comment and post bodies can't be filtered in SOQL, so they are read and checked here.
// Wrapped in its own scope so nothing here can clash with the other scripts.
(() => {
  const REFRESH_MS = 5 * 60e3;
  const MARKER = /^\s*-{2,}\s*case ai summary generated\s*-{2,}/i;
  const PILL_STYLE = 'background:#feded8;color:#8e030f;';
  const SAVE_LABEL = /^(save\b.*|send|share|post|comment|submit|update|mark\b.*|close\b.*)$/i;
  const REFRESH_LABEL = /^refresh\b/i;
  const ACTIONABLE = 'button, [role="button"], a, input[type="submit"], input[type="button"]';
  const SAVE_DELAYS = [2500, 8000];

  // USING SCOPE Mine is "cases I own", the same as My Open Cases.
  const where = closedDays =>
    closedDays > 0
      ? `(Status = 'Solution Provided' OR (IsClosed = true AND ClosedDate = LAST_N_DAYS:${closedDays}))`
      : "Status = 'Solution Provided'";
  const commentsSoql = closedDays =>
    'SELECT Id, CaseNumber, IsClosed, (SELECT CommentBody FROM CaseComments ORDER BY CreatedDate DESC LIMIT 100) ' +
    `FROM Case USING SCOPE Mine WHERE ${where(closedDays)} ORDER BY CreatedDate DESC LIMIT 200`;
  // Kept apart so a feed that can't be read doesn't hide the comments.
  const feedSoql = closedDays =>
    'SELECT Id, (SELECT Body FROM Feeds ORDER BY CreatedDate DESC LIMIT 100) ' +
    `FROM Case USING SCOPE Mine WHERE ${where(closedDays)} ORDER BY CreatedDate DESC LIMIT 200`;

  const normalize = value => String(value ?? '').replace(/\s+/g, ' ').trim();
  // Feed posts are rich text ("<p>--CASE AI SUMMARY GENERATED--</p>…").
  const plain = value => String(value ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ');
  const marked = (rows, field) => (rows?.records || []).some(r => MARKER.test(plain(r[field])));

  let enabled = true;
  let closedDays = 30;
  let fetchedAt = 0;
  let loading = null;

  const publish = pills => globalThis.DeclutterPills?.set('summary', pills);

  function pill(c) {
    const title = `${c.IsClosed ? 'Closed' : 'In Solution Provided'} without the case AI summary: ` +
      'no comment or post starts with --CASE AI SUMMARY GENERATED--.';
    return { id: c.Id, text: 'No summary', title, style: PILL_STYLE };
  }

  // ---- data ---------------------------------------------------------------

  function refresh() {
    if (!enabled) return null;
    loading ||= load().finally(() => { loading = null; });
    return loading;
  }

  async function load() {
    const [comments, feed] = await Promise.allSettled([
      satellite.salesforce.query(commentsSoql(closedDays)),
      satellite.salesforce.query(feedSoql(closedDays)),
    ]);
    if (comments.status === 'rejected') {
      console.error('[declutter] missing summary', comments.reason); // keep the last pills
      return;
    }
    if (feed.status === 'rejected') console.warn('[declutter] missing summary: feed posts not checked', feed.reason);
    const inFeed = new Set(feed.status === 'fulfilled'
      ? feed.value.records.filter(c => marked(c.Feeds, 'Body')).map(c => c.Id)
      : []);
    const pills = new Map();
    for (const c of comments.value.records) {
      if (!inFeed.has(c.Id) && !marked(c.CaseComments, 'CommentBody')) pills.set(c.CaseNumber, pill(c));
    }
    if (!enabled) return; // turned off while loading
    publish(pills);
    fetchedAt = Date.now();
  }

  // ---- refresh after you save ---------------------------------------------

  // Generating the summary or changing the status doesn't reload the list, so a click on a button like that
  // refreshes the cases a moment later (and once more, for slow saves). Lightning's refresh buttons do it right away.
  let refreshTimers = [];

  function refreshSoon(delays) {
    refreshTimers.forEach(clearTimeout);
    refreshTimers = delays.map(ms => setTimeout(refresh, ms));
  }

  function onPageClick(event) {
    if (!enabled) return;
    const target = event.composedPath().find(node => node.nodeType === 1 && node.matches(ACTIONABLE));
    if (!target || target.getAttribute('role') === 'tab' || target.closest('[role="tablist"]')) return;
    const label = normalize(target.textContent || target.getAttribute('aria-label') || target.getAttribute('title') || target.value);
    if (REFRESH_LABEL.test(label)) refreshSoon([0]);
    else if (SAVE_LABEL.test(label) || /summar/i.test(label)) refreshSoon(SAVE_DELAYS);
  }

  // ---- start --------------------------------------------------------------

  async function loadSettings() {
    try {
      const s = await satellite.settings.getAll();
      enabled = s.missingSummaryPill == null ? true : Boolean(s.missingSummaryPill);
      const days = Number(s.missingSummaryClosedDays);
      closedDays = Number.isFinite(days) && days >= 0 ? Math.min(365, Math.round(days)) : 30;
    } catch (error) {
      console.error('[declutter] missing summary setting', error);
    }
    if (enabled) {
      refresh();
    } else {
      publish(new Map());
      fetchedAt = 0;
    }
  }

  if (window.top !== window) return;
  satellite.settings.onChange(loadSettings);
  loadSettings();
  setInterval(() => (enabled && Date.now() - fetchedAt >= REFRESH_MS ? refresh() : null), 60e3);
  addEventListener('click', onPageClick, true);
})();
