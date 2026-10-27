// Follow-up rules for open cases, from the team's cadence:
//   Working: an update every 2 days, progress or a documented blocker.
//   Need More Information: follow up with the customer every 3 days; after 7 days without a reply, warn that the case
//   closes in 48 hours; then close it.
//   Open Structured Investigation: a note every 3-4 days confirming the SI is active and the customer knows the status.
//   High priority: daily, no exceptions.
//   Anything else: no activity for more than 3 days is a warning sign.
// Pure functions over the records the content script queries. No DOM, network or storage, so Node can test them.
(() => {
  'use strict';
  const HOUR = 3600e3;
  const DAY = 24 * HOUR;

  const DEFAULTS = {
    workingDays: 2, waitingDays: 3, closeWarningDays: 7, closeWarningHours: 48, siDays: 3, idleDays: 3,
    replyDays: 1, highPriority: 'sev12', skipWeekends: false,
  };
  const ACTIVE = new Set(['New', 'Working', 'In Progress', 'Escalated', 'Qualification']);
  // "Waiting on Customer - OOO" is left out on purpose: no closure warnings while the customer is away.
  const WAITING = new Set(['Need More Information', 'More Information Needed', 'Waiting on Customer']);
  const CLOSED_WORK = /^(closed|completed|rejected|duplicate|never|not a bug|not reproducible|inactive|deferred|fixed)\b/i;

  // Salesforce writes offsets as +0000, which Safari's Date does not parse.
  const time = value => {
    if (!value) return null;
    const t = Date.parse(String(value).replace(/([+-]\d\d)(\d\d)$/, '$1:$2'));
    return Number.isFinite(t) ? t : null;
  };
  const records = related => related?.records || [];
  const latest = values => values.reduce((max, t) => (t != null && (max == null || t > max) ? t : max), null);

  function addDays(t, days, skipWeekends) {
    if (!skipWeekends) return t + days * DAY;
    const d = new Date(t);
    const weekend = () => d.getDay() === 0 || d.getDay() === 6;
    for (let left = Math.floor(days); left > 0;) {
      d.setDate(d.getDate() + 1);
      if (!weekend()) left--;
    }
    d.setTime(d.getTime() + (days % 1) * DAY);
    while (weekend()) d.setDate(d.getDate() + 1);
    return d.getTime();
  }

  function isHighPriority(c, mode) {
    if (c.IsEscalated || c.Status === 'Escalated' || ['Emergency', 'High'].includes(c.Priority)) return true;
    const level = /^Level (\d)/.exec(c.Severity_Level__c || '');
    return !!level && Number(level[1]) <= (mode === 'sev123' ? 3 : 2);
  }

  // Open GUS Investigations linked to the case, by work number (W-...).
  function openInvestigations(c) {
    const names = records(c.Case_Relationships__r)
      .filter(r => r.Work_Record_Type__c === 'Investigation' && !CLOSED_WORK.test(r.Work_Status__c || ''))
      .map(r => r.GUS_Work__r?.Name || r.GUSText__c || 'SI');
    return [...new Set(names)];
  }

  // When each side last spoke. Only the owner's comments and notes count as your touches; integration users and
  // other engineers don't. Last_Support_Update__c is the last public support comment, whoever wrote it, and
  // Last_Public_Activity_DateTime__c is the last comment the customer posted.
  function activity(c) {
    const comments = records(c.CaseComments).filter(x => x.CreatedById === c.OwnerId);
    const emails = records(c.EmailMessages);
    const publicTouches = [
      ...comments.filter(x => x.IsPublished).map(x => time(x.CreatedDate)),
      ...emails.filter(e => !e.Incoming).map(e => time(e.MessageDate)),
      time(c.Last_Support_Update__c),
    ].filter(t => t != null).sort((a, b) => a - b);
    const assigned = time(c.Owner_Assigned_Date__c) ?? time(c.CreatedDate);
    const statusChanges = records(c.Histories).filter(h => h.NewValue === c.Status).map(h => time(h.CreatedDate));
    return {
      lastTouch: latest([...comments.map(x => time(x.CreatedDate)), ...publicTouches, assigned]),
      lastPublic: latest(publicTouches),
      publicTouches,
      lastCustomer: latest([...emails.filter(e => e.Incoming).map(e => time(e.MessageDate)), time(c.Last_Public_Activity_DateTime__c)]),
      statusSince: latest(statusChanges),
    };
  }

  function evaluate(c, options = {}, now = Date.now()) {
    const o = { ...DEFAULTS, ...options };
    const add = (t, days) => addDays(t, days, o.skipWeekends);
    const a = activity(c);
    const investigations = openInvestigations(c);
    const replied = a.lastCustomer != null && a.lastCustomer > (a.lastPublic ?? -Infinity);
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    let rule, due, action, silentDays = null;

    if (isHighPriority(c, o.highPriority)) {
      rule = { key: 'high', label: c.IsEscalated || c.Status === 'Escalated' ? 'Escalated' : 'High priority', every: 1 };
      due = add(a.lastTouch, 1);
      action = 'Daily follow-up, no exceptions: post today’s update';
    } else if (investigations.length) {
      rule = { key: 'si', label: 'Structured Investigation', every: o.siDays };
      due = add(a.lastTouch, o.siDays);
      action = `Add a note confirming ${investigations.join(', ')} is still active and the customer knows the status`;
    } else if (WAITING.has(c.Status) && replied) {
      rule = { key: 'waiting', label: 'Need More Info', every: o.waitingDays };
      due = add(a.lastCustomer, o.replyDays);
      action = 'The customer replied: answer them and move the case back to Working';
    } else if (WAITING.has(c.Status)) {
      rule = { key: 'waiting', label: 'Need More Info', every: o.waitingDays };
      // The silence starts when the case went to waiting or the customer last wrote, whichever is later.
      const silentSince = latest([a.lastCustomer, a.statusSince]) ?? a.publicTouches[0] ?? a.lastTouch;
      silentDays = Math.max(0, Math.floor((now - silentSince) / DAY));
      const warnAt = add(silentSince, o.closeWarningDays);
      const warning = a.publicTouches.find(t => t >= warnAt);
      if (warning) {
        due = warning + o.closeWarningHours * HOUR;
        action = due <= now
          ? `No reply ${o.closeWarningHours} hours after the closure warning: close the case`
          : 'Closure warning sent: close the case if the customer still doesn’t reply';
      } else {
        const next = add(a.lastPublic ?? silentSince, o.waitingDays);
        // Once day 7 has passed, the next message is the warning, even when a follow-up was missed before it.
        if (next >= warnAt || now >= warnAt) {
          due = Math.min(next, warnAt);
          action = `${plural(o.closeWarningDays, 'day')} without a reply: tell the customer the case closes in ${o.closeWarningHours} hours without one`;
        } else {
          due = next;
          action = 'Follow up with the customer' + (silentDays ? ` (${plural(silentDays, 'day')} without a reply)` : '');
        }
      }
    } else if (ACTIVE.has(c.Status)) {
      rule = { key: 'working', label: c.Status, every: o.workingDays };
      due = add(a.lastTouch, o.workingDays);
      action = 'Update the case: progress, or a documented blocker';
    } else {
      rule = { key: 'idle', label: c.Status, every: o.idleDays };
      due = add(a.lastTouch, o.idleDays);
      action = 'Give the case a clear next step: no activity for more than 3 days is a warning sign';
    }
    // A customer who wrote since your last public update shouldn't wait for the regular cadence.
    if (replied && rule.key !== 'waiting') due = Math.min(due, add(a.lastCustomer, o.replyDays));

    return {
      id: c.Id, number: c.CaseNumber, subject: c.Subject || '', account: c.Account?.Name || '',
      status: c.Status, severity: c.Severity_Level__c || '',
      rule, due, action, state: due <= now ? 'overdue' : due - now <= DAY ? 'soon' : 'later',
      lastTouch: a.lastTouch, lastPublic: a.lastPublic, lastCustomer: a.lastCustomer, replied, silentDays, investigations,
    };
  }

  const evaluateAll = (cases, options, now = Date.now()) =>
    cases.map(c => evaluate(c, options, now)).sort((x, y) => x.due - y.due);

  const core = { DEFAULTS, HOUR, DAY, time, addDays, isHighPriority, openInvestigations, activity, evaluate, evaluateAll };
  globalThis.TicketExpirationCore = core;
  if (typeof module !== 'undefined' && module.exports) module.exports = core;
})();
