// Customer Sentiment Analysis
// Ported from the Chrome extension "Customer Sentiment Analysis" 0.3.0 by Jaydeep Godara (MIT, see LICENSE).
// On Case and Contact pages it adds a small indicator on the right edge, colored by the contact's recent survey
// scores, with a pop-up of those surveys and recent escalations. Records come from satellite.salesforce.query, which
// runs the same SOQL as the Chrome version, signed in as you, without the page ever seeing your session.

const TAG = '[customer-sentiment]';
let SCORE = null;
let ERROR = null;
let generation = 0;

const ERROR_ICON =
  '<svg viewBox="0 0 24 24" width="100%" height="100%" aria-hidden="true">' +
  '<path d="M12 2.5 23 21.5H1Z" fill="#fff" stroke="red" stroke-width="2.5" stroke-linejoin="round"/>' +
  '<path d="M12 9v6.5" stroke="#000" stroke-width="2.6" stroke-linecap="round"/>' +
  '<circle cx="12" cy="18.6" r="1.4"/></svg>';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => `&#${c.charCodeAt(0)};`);
const isId = id => /^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id || '');

// Lightning is a single-page app, so watch the address instead of waiting for a reload.
let lastURL = null;
setInterval(() => {
  if (location.href === lastURL) return;
  lastURL = location.href;
  initIndicator();
}, 500);

async function initIndicator() {
  const run = ++generation;
  clearIndicator();
  const contactId = getCurrentRecordId('Contact');
  const caseId = contactId ? null : getCurrentRecordId('Case');
  if (!contactId && !caseId) return;
  try {
    const score = await getSurveyDetails(contactId || await getCaseContactId(caseId));
    if (run === generation) updateButton(score, null);
  } catch (error) {
    console.error(TAG, error);
    if (run === generation) updateButton(null, error);
  }
}

function getCurrentRecordId(objectName) {
  const match = new RegExp('/' + objectName + '/+(\\w+)/view').exec(location.pathname);
  return match && isId(match[1]) ? match[1] : null;
}

async function getCaseContactId(caseId) {
  const result = await satellite.salesforce.query(
    `SELECT Id, CaseNumber, Subject, ContactId FROM Case WHERE Id = '${caseId}' LIMIT 1`);
  if (!result.records.length) throw new Error(`Case ${caseId} was not found or you can't see it.`);
  return result.records[0].ContactId;
}

async function getSurveyDetails(contactId) {
  // A case without a contact has no history to show.
  if (!isId(contactId)) return summarize([], []);
  const [surveyResult, caseResult] = await Promise.all([
    satellite.salesforce.query(
      'SELECT Id, Case__c, Case__r.CaseNumber, Customer_Effort_Score__c, Technical_Support_Satisfaction_Score__c, CreatedDate ' +
      `FROM Survey_Results__c WHERE Contact__c = '${contactId}' ORDER BY CreatedDate DESC LIMIT 5`),
    satellite.salesforce.query(
      'SELECT Id, CaseNumber, Management_Escalation_Count__c, Age_days__c, CreatedDate ' +
      `FROM Case WHERE ContactId = '${contactId}' ORDER BY CreatedDate DESC LIMIT 10`),
  ]);
  return summarize(surveyResult.records, caseResult.records);
}

function summarize(surveys, cases) {
  const scores = surveys.map(s => s.Technical_Support_Satisfaction_Score__c).filter(Boolean);
  const escalationInfo = cases.filter(c => c.Management_Escalation_Count__c);
  const sum = values => values.reduce((total, value) => total + value, 0);
  return {
    averageScore: scores.length ? sum(scores) / scores.length : null,
    latestScore: surveys[0]?.Technical_Support_Satisfaction_Score__c ?? null,
    scoreList: surveys,
    averageAge: cases.length ? sum(cases.map(c => c.Age_days__c || 0)) / cases.length : null,
    totalCases: cases.length,
    totalEscalations: sum(escalationInfo.map(c => c.Management_Escalation_Count__c)),
    escalationInfo,
  };
}

// MARK: Indicator

function updateButton(score, error) {
  clearIndicator();
  SCORE = score;
  ERROR = error;
  const rootEl = document.createElement('div');
  rootEl.id = 'sentiment-indicator';
  const indicatorElement = document.createElement('div');
  indicatorElement.className = 'sentiment-btn-avg';
  indicatorElement.tabIndex = 0;
  rootEl.appendChild(indicatorElement);
  document.body.appendChild(rootEl);
  indicatorElement.addEventListener('click', createPopUpScreen);

  if (error) {
    indicatorElement.classList.add('sentiment-btn-error');
    indicatorElement.insertAdjacentHTML('beforeend', ERROR_ICON);
    indicatorElement.title = 'Customer Sentiment Indicator (Something went wrong)';
    return;
  }
  const indicatorElementLast = document.createElement('div');
  indicatorElementLast.className = 'sentiment-btn-last';
  indicatorElementLast.tabIndex = 0;
  indicatorElement.appendChild(indicatorElementLast);
  fillColor(score.averageScore, indicatorElement, 'Overall Customer Survey');
  fillColor(score.latestScore, indicatorElementLast, 'Last Customer Survey');

  if (score.escalationInfo.length) {
    const indicatorElementEscalation = document.createElement('div');
    indicatorElementEscalation.className = 'sentiment-btn-escalation';
    indicatorElementEscalation.tabIndex = 0;
    indicatorElementEscalation.title = 'Recent Escalation Detected';
    indicatorElement.appendChild(indicatorElementEscalation);
  }
}

function fillColor(score, element, titleStringPrefix) {
  if (score == 5) {
    element.style.backgroundColor = 'Green';
    element.title = titleStringPrefix + ' - Very Satisfied';
  } else if (score > 3) {
    element.style.backgroundColor = '#FFCC00';
    element.title = titleStringPrefix + ' - Satisfied';
  } else if (score > 0.01) {
    element.style.backgroundColor = 'Red';
    element.title = titleStringPrefix + ' - Not at All Satisfied';
  } else {
    element.style.backgroundColor = 'Black';
    element.title = titleStringPrefix + ' - Not Enough Historical Data';
  }
}

function clearIndicator() {
  clearPopUpScreen();
  document.getElementById('sentiment-indicator')?.remove();
  SCORE = null;
  ERROR = null;
}

// MARK: Pop-up

function createPopUpScreen() {
  clearPopUpScreen();
  const popUp = document.createElement('div');
  popUp.id = 'sentiment-table-pop-up';

  const tableClose = document.createElement('div');
  tableClose.className = 'table-close-btn';
  tableClose.insertAdjacentHTML('beforeend', '<span class="white-border">[X]</span>');
  tableClose.addEventListener('click', clearPopUpScreen);
  popUp.appendChild(tableClose);

  const tableRoot = document.createElement('div');
  tableRoot.className = 'table-root';
  tableRoot.insertAdjacentHTML('beforeend', generateCustomerInfoTable(SCORE, ERROR));
  if (!ERROR) {
    tableRoot.insertAdjacentHTML('beforeend', '<br>' + generateSurveyTable(SCORE.scoreList));
    tableRoot.insertAdjacentHTML('beforeend', '<br>' + generateEscalationTable(SCORE.escalationInfo));
  }
  popUp.appendChild(tableRoot);

  document.getElementById('sentiment-indicator').appendChild(popUp);
  // Only listen while the pop-up is open, so Salesforce isn't affected otherwise.
  addEventListener('click', outsidePopupClick);
}

function generateSurveyTable(records) {
  const dateOptions = { year: 'numeric', month: 'long', day: 'numeric' };
  const rows = records.length
    ? records.map(survey => `<tr>
        <td class="sentiment-table-data"><a href="/${esc(survey.Id)}" target="_blank">${esc(new Date(survey.CreatedDate).toLocaleString('en-IN', dateOptions))}</a></td>
        <td class="sentiment-table-data">${survey.Case__c ? `<a href="/${esc(survey.Case__c)}" target="_blank">${esc(survey.Case__r?.CaseNumber)}</a>` : '-'}</td>
        <td class="sentiment-table-data">${esc(survey.Technical_Support_Satisfaction_Score__c || '-')}</td>
        <td class="sentiment-table-data">${esc(survey.Customer_Effort_Score__c || '-')}</td>
      </tr>`).join('')
    : `<tr><td class="sentiment-table-data" colspan="4" style="text-align: center;"><b>No Data Available for the customer.</b></td></tr>`;

  return `<div class="sentiment-table white-border">
      <div class="sentiment-table-heading">Survey Info:</div>
      <table class="sentiment-table-data">
        <tr>
          <th class="sentiment-table-data">Date</th>
          <th class="sentiment-table-data">Case Number</th>
          <th class="sentiment-table-data">Technical Score</th>
          <th class="sentiment-table-data">Customer Effort Score</th>
        </tr>
        ${rows}
      </table>
    </div>`;
}

function generateCustomerInfoTable(score, error) {
  const cases = score ? score.totalCases : 'n';
  const row = error
    ? `<tr><td class="sentiment-table-data" colspan="3" style="text-align: center; color: red;"><b>Connection Error, Please try again.</b><br>${esc(error.message || error)}<br>More in Settings &gt; Extensions &gt; Logs.</td></tr>`
    : `<tr>
        <td class="sentiment-table-data" title="Customer Avg CSAT based on last 5 surveys.">${score.averageScore ? score.averageScore.toFixed(2) : '-'}</td>
        <td class="sentiment-table-data" title="Customer Escalations in last ${cases} cases(Max 10).">${score.totalEscalations}/${score.totalCases}</td>
        <td class="sentiment-table-data" title="Customer TTR based on last ${cases} cases(Max 10).">${score.averageAge == null ? '-' : score.averageAge.toFixed(2)}</td>
      </tr>`;

  return `<div class="sentiment-table white-border">
      <div class="sentiment-table-heading">Customer Sentiment Summary:</div>
      <table class="sentiment-table-data">
        <tr>
          <th class="sentiment-table-data" title="Customer Avg CSAT based on last 5 surveys.">CSAT</th>
          <th class="sentiment-table-data" title="Customer Escalations in last ${cases} cases(Max 10).">Escalation</th>
          <th class="sentiment-table-data" title="Customer TTR based on last ${cases} cases(Max 10).">TTR</th>
        </tr>
        ${row}
      </table>
    </div>`;
}

function generateEscalationTable(records) {
  const rows = records.length
    ? records.map(c => `<tr>
        <td class="sentiment-table-data"><a href="/${esc(c.Id)}" target="_blank">${esc(c.CaseNumber)}</a></td>
        <td class="sentiment-table-data">${esc(c.Management_Escalation_Count__c)}</td>
      </tr>`).join('')
    : `<tr><td class="sentiment-table-data" colspan="2" style="text-align: center;"><b>No Escalations in last 10 cases</b></td></tr>`;

  return `<div class="sentiment-table white-border">
      <div class="sentiment-table-heading">Escalation Info:</div>
      <table class="sentiment-table-data">
        <tr>
          <th class="sentiment-table-data">Case Number</th>
          <th class="sentiment-table-data">Escalation Count</th>
        </tr>
        ${rows}
      </table>
    </div>`;
}

function clearPopUpScreen() {
  const tablePopUp = document.getElementById('sentiment-table-pop-up');
  if (tablePopUp) {
    tablePopUp.remove();
    removeEventListener('click', outsidePopupClick);
  }
}

function outsidePopupClick(event) {
  const button = document.getElementById('sentiment-indicator');
  if (button && !button.contains(event.target)) clearPopUpScreen();
}
