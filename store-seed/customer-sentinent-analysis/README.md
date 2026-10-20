# Customer Sentiment Analysis

A Satellite extension (`customer-sentinent-analysis`), ported from the Chrome extension
[Customer Sentiment Indicator](https://github.com/JaydeepGo/Customer-Sentiment-Indicator-Extension) 0.3.0
by Jaydeep Godara (MIT, see `LICENSE`).

On OrgCS **Case** and **Contact** pages, a small box on the right edge shows how the customer feels, based on the
contact's last 5 surveys (`Case > Contact > Survey_Results__c`) and last 10 cases. It is hidden on other pages.

| Color | Score (Technical Support Satisfaction) |
|---|---|
| Green | 5, Very Satisfied |
| Yellow | above 3, Satisfied |
| Red | 3 or less, Not at All Satisfied |
| Black | no survey history |
| Warning sign | something went wrong (the pop-up says what) |

The big box is the average, the small square in its corner is the latest survey, and an orange square means one of
the last 10 cases was escalated. Click the box for the survey, escalation and TTR details.

## Requirements

Needs a Satellite build with the `salesforce` permission (`satellite.salesforce.query`). An older Satellite rejects
the manifest with "unknown permission". It reads data as you, through your OrgCS sign-in (`orgcs.my.salesforce.com`).

## Changes from the Chrome version

- Salesforce data comes from `satellite.salesforce.query` instead of jsforce plus the `sid` cookie. Satellite runs the
  query natively, so the session never reaches the page; the SOQL is unchanged.
- Navigation is detected by watching the address (Lightning is a single-page app) instead of a background worker.
- The error icon is drawn inline instead of `images/error.png`, and record values are escaped before display.
- Cases without a contact, and surveys without a case, show "no data" instead of failing.

## Developing

Saving a file reloads the extension and its pages. `console.log` output and errors appear under
Settings > Extensions > Logs; Safari > Develop > (your Mac) > Satellite opens the web inspector.
`.satellite/` holds editor type definitions and the manifest schema.
