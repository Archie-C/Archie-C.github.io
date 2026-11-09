'use strict';
// The server selects and orders one best attempt per browser for this metric.
const rocketLeaderboardBody = document.getElementById('leaderboard-body');
const rocketLeaderboardOrder = document.getElementById('leaderboard-order');
let leaderboardRequest = 0;
function leaderboardMessage(message) {
  rocketLeaderboardBody.replaceChildren();
  const cell = rocketLeaderboardBody.insertRow().insertCell();
  cell.colSpan = 6;
  cell.textContent = message;
}
function renderRocketLeaderboard(entries) {
  if (!entries.length) { leaderboardMessage('No submissions with this metric yet.'); return; }
  rocketLeaderboardBody.replaceChildren();
  const number = (value, suffix = '', digits = 1) =>
    typeof value === 'number' && Number.isFinite(value) ? value.toFixed(digits) + suffix : '–';
  entries.forEach((entry, index) => {
    const metrics = entry.metrics || {}, row = rocketLeaderboardBody.insertRow();
    if (entry.is_current_browser === true) row.classList.add('own');
    [index + 1, entry.name, number(metrics.score), number(metrics.landing_success_pct, '%'), number(metrics.macro_f1, '', 4),
      number(typeof metrics.accuracy === 'number' ? metrics.accuracy * 100 : null, '%')]
      .forEach((value, column) => {
        const cell = row.insertCell();
        cell.textContent = value;
        if (column === 1 && entry.is_current_browser === true) {
          const badge = document.createElement('span');
          badge.className = 'own-badge';
          badge.textContent = 'you';
          cell.appendChild(badge);
        }
      });
  });
}
window.loadRocketLeaderboard = async () => {
  const request = ++leaderboardRequest, metric = rocketLeaderboardOrder.value;
  leaderboardMessage('Loading leaderboard…');
  try {
    const entries = [];
    for (let offset = 0;; offset += 500) {
      const url = new URL('https://sjoybqjjvhafnsobouzl.supabase.co/functions/v1/score-rocket');
      url.searchParams.set('metric', metric);
      url.searchParams.set('browser_id', getBrowserId());
      url.searchParams.set('offset', String(offset));
      const response = await fetch(url);
      if (!response.ok) throw Error('Leaderboard request failed');
      const data = await response.json();
      if (data.grouping !== 'best-per-browser-v1' || data.metric !== metric || !Array.isArray(data.leaderboard)) {
        throw Error('The scoring function needs updating.');
      }
      entries.push(...data.leaderboard);
      if (data.leaderboard.length < 500) break;
    }
    if (request === leaderboardRequest) renderRocketLeaderboard(entries);
  } catch (_) {
    if (request === leaderboardRequest) leaderboardMessage('Best-per-browser leaderboard is unavailable.');
  }
};
rocketLeaderboardOrder.addEventListener('change', () => window.loadRocketLeaderboard());
window.loadRocketLeaderboard();
