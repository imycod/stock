const fs = require('fs');
const path = require('path');
fs.mkdirSync('public-small', { recursive: true });

const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>主板小盘筛选</title>
  <link rel="stylesheet" href="/style.css" />
</head>
<body>
  <header class="top">
    <div>
      <h1>主板小盘筛选</h1>
      <p class="sub">独立服务 · 端口 3010 · 与行情看板 3009 隔离</p>
    </div>
    <div class="top-actions">
      <span id="jobStatus" class="badge">空闲</span>
      <button id="btnRefresh" class="btn">刷新数据</button>
    </div>
  </header>

  <nav class="tabs">
    <button class="tab active" data-tab="result">筛选结果</button>
    <button class="tab" data-tab="config">配置参数</button>
  </nav>

  <main>
    <section id="tab-result" class="panel active">
      <div class="filters">
        <label>名称/代码
          <input id="filterQ" type="search" placeholder="如 603400 / 华之杰" />
        </label>
        <label>盈利阶段
          <select id="filterStage">
            <option value="">全部</option>
            <option>盈利阶段</option>
            <option>扭亏阶段</option>
            <option>减亏阶段</option>
            <option>转亏阶段</option>
            <option>亏损阶段</option>
            <option>数据不足</option>
          </select>
        </label>
        <label>持股集中度
          <select id="filterFocus">
            <option value="">全部</option>
            <option>非常集中</option>
            <option>较集中</option>
            <option>较分散</option>
            <option>非常分散</option>
          </select>
        </label>
        <button id="btnFilter" class="btn btn-secondary">筛选</button>
      </div>
      <div id="stats" class="stats">尚未加载数据。可点「刷新数据」或到「配置参数」保存后重新抓取。</div>
      <div class="table-wrap">
        <table id="resultTable">
          <thead>
            <tr>
              <th>代码</th>
              <th>名称</th>
              <th>盈利阶段</th>
              <th>持股集中度</th>
              <th>股东户数</th>
              <th>前十大%</th>
              <th>市值(亿)</th>
              <th>股本(亿)</th>
              <th>财务摘要</th>
              <th>主营产品</th>
              <th>合作方</th>
              <th>ST</th>
              <th>ST实施日</th>
              <th>ST原因</th>
              <th>预计摘帽</th>
            </tr>
          </thead>
          <tbody></tbody>
        </table>
      </div>
    </section>

    <section id="tab-config" class="panel">
      <form id="configForm" class="config-form">
        <div class="grid">
          <label>总股本上限(亿股)<input name="maxTotalSharesYi" type="number" step="0.1" /></label>
          <label>总市值上限(亿元)<input name="maxMarketCapYi" type="number" step="1" /></label>
          <label>股东户数上限<input name="maxHolders" type="number" step="1000" /></label>
          <label>前十大持股下限(%)<input name="minTop10Ratio" type="number" step="1" /></label>
          <label>量能放大倍数<input name="volumeExpandRatio" type="number" step="0.1" /></label>
          <label>现价/年内均价上限<input name="maxPriceVsYearAvg" type="number" step="0.05" /></label>
          <label>现价/年内低点上限<input name="maxPriceVsYearLow" type="number" step="0.05" /></label>
          <label>换手抬升阈值(%)<input name="turnoverJumpTo" type="number" step="0.1" /></label>
          <label class="check"><input name="includeST" type="checkbox" /> 包含 ST/*ST</label>
        </div>
        <p class="hint">保存后会按新参数重新抓取，并自动回到「筛选结果」。默认包含 ST，并补充 ST 实施日/原因/预计摘帽信息。</p>
        <div class="form-actions">
          <button type="submit" class="btn">保存并重新抓取</button>
          <button type="button" id="btnSaveOnly" class="btn btn-secondary">仅保存参数</button>
        </div>
      </form>
    </section>
  </main>

  <div id="loading" class="loading hidden">
    <div class="loading-card">
      <div class="spinner"></div>
      <div id="loadingText">正在筛选…</div>
    </div>
  </div>

  <script src="/app.js"></script>
</body>
</html>`;

const css = `:root {
  --bg: #f3f1eb;
  --card: #fffdf8;
  --ink: #1d1a16;
  --muted: #6d655c;
  --line: #ddd4c6;
  --accent: #0f6a5a;
  --accent-2: #b45309;
  --danger: #b42318;
}
* { box-sizing: border-box; }
body {
  margin: 0;
  font-family: "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
  color: var(--ink);
  background:
    radial-gradient(1000px 420px at 10% -10%, #dceee8 0%, transparent 60%),
    radial-gradient(900px 380px at 100% 0%, #f7e7d2 0%, transparent 55%),
    var(--bg);
  min-height: 100vh;
}
.top {
  display: flex;
  justify-content: space-between;
  gap: 16px;
  align-items: flex-end;
  padding: 24px 28px 8px;
}
.top h1 { margin: 0; font-size: 28px; letter-spacing: 0.02em; }
.sub { margin: 6px 0 0; color: var(--muted); font-size: 13px; }
.top-actions { display: flex; gap: 10px; align-items: center; }
.tabs {
  display: flex;
  gap: 8px;
  padding: 8px 28px 0;
  border-bottom: 1px solid var(--line);
}
.tab {
  border: 0;
  background: transparent;
  padding: 10px 14px;
  cursor: pointer;
  color: var(--muted);
  border-bottom: 2px solid transparent;
  font-size: 14px;
}
.tab.active {
  color: var(--accent);
  border-bottom-color: var(--accent);
  font-weight: 600;
}
main { padding: 16px 28px 40px; }
.panel { display: none; }
.panel.active { display: block; }
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: end;
  margin-bottom: 12px;
}
.filters label, .config-form label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  font-size: 12px;
  color: var(--muted);
}
input, select {
  min-width: 160px;
  border: 1px solid var(--line);
  background: #fff;
  border-radius: 8px;
  padding: 8px 10px;
  color: var(--ink);
  font-size: 14px;
}
label.check {
  flex-direction: row;
  align-items: center;
  gap: 8px;
  margin-top: 22px;
}
label.check input { min-width: auto; }
.btn {
  border: 0;
  background: var(--accent);
  color: #fff;
  border-radius: 8px;
  padding: 9px 14px;
  cursor: pointer;
  font-size: 14px;
}
.btn:hover { filter: brightness(1.05); }
.btn-secondary { background: #4b5563; }
.badge {
  display: inline-flex;
  align-items: center;
  border-radius: 999px;
  padding: 4px 10px;
  font-size: 12px;
  background: #e8efeC;
  color: var(--accent);
}
.badge.running { background: #fff4e5; color: var(--accent-2); }
.badge.error { background: #fee4e2; color: var(--danger); }
.stats {
  margin: 8px 0 12px;
  color: var(--muted);
  font-size: 13px;
  line-height: 1.5;
}
.table-wrap {
  overflow: auto;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--card);
  max-height: calc(100vh - 250px);
}
table {
  border-collapse: collapse;
  width: 100%;
  min-width: 1400px;
  font-size: 13px;
}
th, td {
  border-bottom: 1px solid var(--line);
  padding: 8px 10px;
  text-align: left;
  vertical-align: top;
}
th {
  position: sticky;
  top: 0;
  background: #f7f3ea;
  z-index: 1;
  white-space: nowrap;
}
td.clip {
  max-width: 220px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.stage-盈利阶段 { color: #067647; font-weight: 600; }
.stage-扭亏阶段 { color: #b54708; font-weight: 600; }
.stage-亏损阶段, .stage-转亏阶段 { color: #b42318; font-weight: 600; }
.stage-减亏阶段 { color: #87531a; font-weight: 600; }
.st-yes { color: var(--danger); font-weight: 600; }
.config-form {
  max-width: 920px;
  background: var(--card);
  border: 1px solid var(--line);
  border-radius: 12px;
  padding: 20px;
}
.grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
  gap: 14px;
}
.hint { color: var(--muted); font-size: 13px; line-height: 1.6; }
.form-actions { display: flex; gap: 10px; margin-top: 8px; }
.loading {
  position: fixed; inset: 0;
  background: rgba(29,26,22,.28);
  display: flex; align-items: center; justify-content: center;
  z-index: 50;
}
.loading.hidden { display: none; }
.loading-card {
  background: #fff;
  border-radius: 12px;
  padding: 20px 24px;
  min-width: 240px;
  text-align: center;
  box-shadow: 0 10px 40px rgba(0,0,0,.15);
}
.spinner {
  width: 28px; height: 28px; margin: 0 auto 10px;
  border: 3px solid #dbe5e1;
  border-top-color: var(--accent);
  border-radius: 50%;
  animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
`;

const js = `const $ = (s) => document.querySelector(s);

const state = {
  polling: null,
};

function showTab(name) {
  document.querySelectorAll('.tab').forEach((el) => {
    el.classList.toggle('active', el.dataset.tab === name);
  });
  document.querySelectorAll('.panel').forEach((el) => {
    el.classList.toggle('active', el.id === 'tab-' + name);
  });
}

function setLoading(on, text) {
  $('#loading').classList.toggle('hidden', !on);
  if (text) $('#loadingText').textContent = text;
}

function setBadge(status, text) {
  const el = $('#jobStatus');
  el.className = 'badge' + (status === 'running' ? ' running' : status === 'error' ? ' error' : '');
  el.textContent = text || status;
}

function fmt(n, d = 2) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  return Number(n).toFixed(d);
}

function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

async function api(url, opts) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...opts,
  });
  const data = await res.json();
  if (!res.ok || data.ok === false) throw new Error(data.error || res.statusText);
  return data;
}

function fillConfigForm(cfg) {
  const form = $('#configForm');
  form.maxTotalSharesYi.value = cfg.maxTotalSharesYi;
  form.maxMarketCapYi.value = cfg.maxMarketCapYi;
  form.maxHolders.value = cfg.maxHolders;
  form.minTop10Ratio.value = cfg.minTop10Ratio;
  form.volumeExpandRatio.value = cfg.volumeExpandRatio;
  form.maxPriceVsYearAvg.value = cfg.maxPriceVsYearAvg;
  form.maxPriceVsYearLow.value = cfg.maxPriceVsYearLow;
  form.turnoverJumpTo.value = cfg.turnoverJumpTo;
  form.includeST.checked = cfg.includeST !== false;
}

function readConfigForm() {
  const form = $('#configForm');
  return {
    maxTotalSharesYi: Number(form.maxTotalSharesYi.value),
    maxMarketCapYi: Number(form.maxMarketCapYi.value),
    maxHolders: Number(form.maxHolders.value),
    minTop10Ratio: Number(form.minTop10Ratio.value),
    volumeExpandRatio: Number(form.volumeExpandRatio.value),
    maxPriceVsYearAvg: Number(form.maxPriceVsYearAvg.value),
    maxPriceVsYearLow: Number(form.maxPriceVsYearLow.value),
    turnoverJumpTo: Number(form.turnoverJumpTo.value),
    includeST: form.includeST.checked,
  };
}

function renderRows(rows) {
  const tbody = $('#resultTable tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="15">无匹配结果</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const stageCls = 'stage-' + (r.profitStage || '');
      return \`<tr>
        <td>\${escapeHtml(r.code)}</td>
        <td>\${escapeHtml(r.name)}</td>
        <td class="\${stageCls}">\${escapeHtml(r.profitStage)}</td>
        <td>\${escapeHtml(r.holdFocus)}</td>
        <td>\${r.holderNum ?? ''}</td>
        <td>\${fmt(r.top10Ratio, 1)}</td>
        <td>\${fmt(r.marketCapYi)}</td>
        <td>\${fmt(r.totalSharesYi)}</td>
        <td class="clip" title="\${escapeHtml(r.financeSummary)}">\${escapeHtml(r.financeSummary)}</td>
        <td class="clip" title="\${escapeHtml(r.mainProducts)}">\${escapeHtml(r.mainProducts)}</td>
        <td class="clip" title="\${escapeHtml(r.partners)}">\${escapeHtml(r.partners)}</td>
        <td class="\${r.isST ? 'st-yes' : ''}">\${r.isST ? escapeHtml(r.stType || '是') : ''}</td>
        <td>\${escapeHtml(r.stDate)}</td>
        <td class="clip" title="\${escapeHtml(r.stReason)}">\${escapeHtml(r.stReason)}</td>
        <td class="clip" title="\${escapeHtml(r.stRemoveEstimate)}">\${escapeHtml(r.stRemoveEstimate)}</td>
      </tr>\`;
    })
    .join('');
}

async function loadResult() {
  const q = $('#filterQ').value.trim();
  const stage = $('#filterStage').value;
  const focus = $('#filterFocus').value;
  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (stage) params.set('stage', stage);
  if (focus) params.set('focus', focus);
  const data = await api('/api/screen/result?' + params.toString());
  if (data.empty) {
    $('#stats').textContent = '尚无缓存结果，请点击「刷新数据」开始抓取。';
    renderRows([]);
    return data;
  }
  const st = data.stats || {};
  const stages = st.stageCount
    ? Object.entries(st.stageCount).map(([k, v]) => k + v).join(' / ')
    : '';
  $('#stats').textContent =
    \`共 \${data.total}/\${data.allTotal} 只 · 生成于 \${new Date(data.generatedAt).toLocaleString('zh-CN')} · ST \${st.stCount || 0} · \${stages}\`;
  renderRows(data.rows);
  return data;
}

async function pollUntilDone() {
  setLoading(true, '正在筛选…');
  setBadge('running', '筛选中');
  if (state.polling) clearInterval(state.polling);
  return new Promise((resolve, reject) => {
    state.polling = setInterval(async () => {
      try {
        const s = await api('/api/screen/status');
        const p = s.job.progress || {};
        const msg = p.message || p.stage || '筛选中';
        const prog =
          p.total > 0 ? \` \${p.done || 0}/\${p.total}\` : '';
        setLoading(true, msg + prog);
        setBadge('running', '筛选中');
        if (s.job.status === 'done') {
          clearInterval(state.polling);
          state.polling = null;
          setLoading(false);
          setBadge('idle', '完成');
          resolve(s);
        } else if (s.job.status === 'error') {
          clearInterval(state.polling);
          state.polling = null;
          setLoading(false);
          setBadge('error', '失败');
          reject(new Error(s.job.error || '筛选失败'));
        }
      } catch (e) {
        clearInterval(state.polling);
        state.polling = null;
        setLoading(false);
        setBadge('error', '失败');
        reject(e);
      }
    }, 1200);
  });
}

async function runScreenAndShow() {
  await api('/api/screen/run', { method: 'POST', body: '{}' });
  await pollUntilDone();
  showTab('result');
  await loadResult();
}

async function init() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => showTab(btn.dataset.tab));
  });
  $('#btnFilter').addEventListener('click', () => loadResult().catch(alert));
  $('#filterQ').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadResult().catch(alert);
  });
  $('#btnRefresh').addEventListener('click', () => {
    runScreenAndShow().catch((e) => alert(e.message));
  });

  const cfg = await api('/api/config');
  fillConfigForm(cfg.config);

  $('#configForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ ...readConfigForm(), run: true }),
      });
      await pollUntilDone();
      showTab('result');
      await loadResult();
    } catch (err) {
      alert(err.message);
    }
  });

  $('#btnSaveOnly').addEventListener('click', async () => {
    try {
      await api('/api/config', {
        method: 'POST',
        body: JSON.stringify({ ...readConfigForm(), run: false }),
      });
      alert('参数已保存');
    } catch (err) {
      alert(err.message);
    }
  });

  const status = await api('/api/screen/status');
  if (status.job.status === 'running') {
    await pollUntilDone().catch(() => {});
  }
  await loadResult();
  if (status.hasResult) setBadge('idle', '已有缓存');
  else setBadge('idle', '空闲');
}

init().catch((e) => {
  console.error(e);
  $('#stats').textContent = '初始化失败: ' + e.message;
});
`;

fs.writeFileSync(path.join('public-small', 'index.html'), html, 'utf8');
fs.writeFileSync(path.join('public-small', 'style.css'), css, 'utf8');
fs.writeFileSync(path.join('public-small', 'app.js'), js, 'utf8');
console.log('public-small written');
