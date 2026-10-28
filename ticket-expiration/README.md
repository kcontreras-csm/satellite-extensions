# Ticket Expiration

A Satellite extension (`ticket-expiration`) for OrgCS. It puts a clock next to the notification bell in the Salesforce
header. The badge counts the open cases you own whose next follow-up is overdue (red), or due within a day (orange)
when nothing is overdue. Click it to see every case with the cadence it falls under, what to do next, and when.

Case lists show it too: in My Open Cases (and any other list view or related list with your cases in it), each of
your case numbers gets a pill with the due time, red when late ("3d late"), orange within a day ("in 5h"), green
otherwise ("in 2d"). Hover it for the next step, the rule and the exact due date.

So do your case pages: a pill in front of Follow ("Follow-up 3d late"), same colours and tooltip. Click it to open
the panel with that case highlighted.

Either can be turned off under Settings > Extensions > Ticket Expiration (Show due times in case lists, Show the
follow-up on your case pages).

## The cadence

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

All the numbers can be changed under Settings > Extensions > Ticket Expiration, along with whether weekends count
(by default they do, so a Friday update on a 2-day cadence is due on Sunday) and whether you get a notification when
a case becomes overdue.

## Where the dates come from

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

## Notes

- Case numbers in the panel open the case. Lightning normally routes the link into a console tab; if it ever reloads
  the page instead, that is the browser following the link because Lightning didn't take it.
- If the header can't be found, the clock shows up as a floating button in the bottom-right corner instead.
- `followup-core.js` holds the rules as plain functions, so they can be tested with Node.
- Errors and console output appear under Settings > Extensions > Logs.
