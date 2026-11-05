# Case Page Declutter

A Satellite extension (`declutter`) for OrgCS. On case pages it hides the Case icon and the "Support Console" app
name (and optionally the org logo), makes sidebar cards and columns collapsible, adds console tab controls, shows the
case description below the highlights, and flags red accounts with a chip in the case header. It also tracks your
follow-ups and flags cases whose case AI summary wasn't generated, described below. Everything can be turned off
under Settings > Extensions > Case Page Declutter.

## Image viewer

Click an image in a case comment, feed post or email (Salesforce files and pasted images) to open it full screen:

- **Zoom:** scroll or pinch, the − / + buttons or keys, double-click to switch between fit and actual size, `0` fit,
  `1` actual size. Zooming keeps the point under the pointer in place.
- **Move:** drag the image.
- **Rotate:** `R` right, `Shift+R` left.
- **Previous / next:** `←` / `→` through the other images of the same post or email.
- **Copy** the image (`⌘C`, as a PNG, rotation included) or **Copy link**, **Download** (`⌘S`), or **Open** the
  original in a new tab.
- **Close:** `Esc`, ×, or click the dark area around it.

Images inside links or buttons (file cards, profile pictures) keep Salesforce's own behaviour, and so does Cmd-click.
Emails are shown in iframes from the same site, which are watched too. Turn it off under Settings > Extensions > Case
Page Declutter (Open images in comments, posts and emails in a viewer).

## Pills in case lists

In case lists (My Open Cases, closed case list views, related lists), your case numbers get pills right after them,
on the same line:

- **The follow-up pill** (see below): the due time, red when late ("3d late"), orange within a day ("in 5h"), green
  otherwise ("in 2d"). Hover it for the next step, the rule and the exact due date.
- **"No summary"**: your cases in Solution Provided, and the ones closed in the last 30 days (setting), with no case
  comment (public or internal) or feed post that starts with `--CASE AI SUMMARY GENERATED--`.

The case number never shrinks. If the Case Number column is too narrow, the pills are cut off instead (hover them for
everything); drag the column wider once and Salesforce remembers it.

## Follow-ups

A clock next to the notification bell in the Salesforce header. The badge counts the open cases you own whose next
follow-up is overdue (red), or due within a day (orange) when nothing is overdue. Click it to see every case with the
cadence it falls under, what to do next, and when.

Your case pages get a pill in front of Follow ("Follow-up 3d late"), same colours and tooltip. Click it to open the
panel with that case highlighted.

### The cadence

From the team's follow-up practice. When several rules apply, the first one in this list wins:

| Case | Next follow-up |
| --- | --- |
| High priority: Severity Level 1–2, or escalated (setting: also Level 3) | Daily, no exceptions |
| An open Structured Investigation (a GUS Investigation linked to the case that isn't closed) | A note every 3 days confirming the SI is active and the customer knows the status |
| Need More Information / Waiting on Customer | Follow up with the customer every 3 days. After 7 days without a reply, warn that the case closes in 48 hours (a follow-up from day 6 on counts as that warning); close it 48 hours after the warning, and not before day 9 |
| Working, New, In Progress | An update every 2 days, progress or a documented blocker |
| Any other open status | Activity at least every 3 days |

If the customer wrote after your last public update, the case is due one day after their message. In Need More
Information, the next step becomes "answer them and move the case back to Working".

All the numbers can be changed under Settings > Extensions > Case Page Declutter, along with whether weekends count
(by default they do, so a Friday update on a 2-day cadence is due on Sunday) and whether you get a notification when
a case becomes overdue.

### Where the dates come from

One read-only SOQL query (`satellite.salesforce.query`, signed in as you) every 5 minutes, when you open the panel,
a few seconds after you click a button that saves (Save, Send, Share, Post, Comment, Submit, Update, Mark … Status),
and right away when you click one of Lightning's refresh buttons (the list view's, "Refresh this feed") or the
panel's ↻. So a comment you just posted shows up without reloading the page. It reads the cases you own (`USING SCOPE Mine`, the same as My Open Cases) with their comments, emails,
status history and GUS links:

- **Your updates:** comments and internal notes you wrote, emails sent from the case, and `Last_Support_Update__c`.
  Comments from integration users and other people don't count.
- **The customer:** incoming emails, and `Last_Public_Activity_DateTime__c` (the customer's last portal comment).
- **How long the customer has been silent:** from when the case moved to its current status, or the customer's last
  message, whichever is later. The closure warning is taken to be your first public update from day 6 on, so a
  reminder sent just before day 7 isn't asked for again an hour later.
- **Structured Investigation:** a `Case_Relationship__c` with work record type Investigation and a status that isn't
  closed, completed, duplicate and so on.

Nothing is written to Salesforce. The only thing stored is which overdue cases you were already notified about.

### Notes

- Case numbers in the panel open the case. Lightning normally routes the link into a console tab; if it ever reloads
  the page instead, that is the browser following the link because Lightning didn't take it.
- If the header can't be found, the clock shows up as a floating button in the bottom-right corner instead.
- Errors and console output appear under Settings > Extensions > Logs.

## Missing summary: where the data comes from

Two read-only SOQL queries, one for case comments and one for feed posts, every 5 minutes, a few seconds after you
click a button that saves (Save, Send, Post, Close, anything mentioning "summary"…), and right away when you click
Lightning's refresh buttons. Comment and post bodies can't be filtered in SOQL, so the last 100 of each per case are
fetched and checked in the page. If the feed can't be read, only comments are checked and a warning goes to the logs.

## Files

- `imageviewer.js` is the image viewer.
- `pills.js` draws the list pills; `followup.js` and `summary.js` hand it their pills.
- `followup-core.js` holds the follow-up rules as plain functions, so they can be tested with Node.
