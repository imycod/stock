const $ = (s) => document.querySelector(s);

const state = { polling: null, liveCode: null, liveTimer: null, liveIntervalSec: 60, liveRows: [] };

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

function fmtAmt(n) {
  if (n == null || n === '' || Number.isNaN(Number(n))) return '';
  const v = Number(n);
  const abs = Math.abs(v);
  if (abs >= 1e8) return (v / 1e8).toFixed(2) + '亿';
  if (abs >= 1e4) return (v / 1e4).toFixed(2) + '万';
  return v.toFixed(0);
}

function metric(label, value, cls) {
  return '<div class="m"><span class="k">' + escapeHtml(label) + '</span><span class="v ' + (cls || '') + '">' + escapeHtml(value) + '</span></div>';
}

function renderLiveBox(live, lhb, metaText) {
  const box = $('#liveBox');
  if (!box) return;
  if (!live) {
    box.classList.add('hidden');
    return;
  }
  box.classList.remove('hidden');
  $('#liveTitle').textContent = (live.code || '') + ' ' + (live.name || '') + ' · 实时指标';
  $('#liveMeta').textContent = metaText || ((live.tradeDate || '') + ' ' + (live.tradeTime || ''));
  const pct = live.pctChange;
  const pctCls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
  const pctText = pct == null ? '' : ((pct > 0 ? '+' : '') + fmt(pct, 2) + '%');
  $('#liveMetrics').innerHTML = [
    metric('最新价', fmt(live.price, 2), pctCls),
    metric('涨跌幅', pctText, pctCls),
    metric('成交量', fmtAmt(live.volume)),
    metric('成交额', fmtAmt(live.amount)),
    metric('换手率', live.turnoverRate != null ? fmt(live.turnoverRate, 2) + '%' : ''),
    metric('量比', fmt(live.volumeRatio, 2)),
    metric('振幅', live.amplitude != null ? fmt(live.amplitude, 2) + '%' : ''),
    metric('主力净流入', fmtAmt(live.mainNetInflow)),
    metric('大单净流入', fmtAmt(live.largeNetInflow)),
    metric('超大单净流入', fmtAmt(live.superLargeNetInflow)),
    metric('主动买', fmtAmt(live.activeBuyVolume)),
    metric('主动卖', fmtAmt(live.activeSellVolume)),
    metric('主买额', fmtAmt(live.mainBuy)),
    metric('主卖额', fmtAmt(live.mainSell)),
    metric('主净额', fmtAmt(live.mainNet)),
  ].join('');
  const rows = Array.isArray(lhb) ? lhb : [];
  $('#liveLhb').textContent = rows.length
    ? '龙虎榜: ' + rows.map((r) => (r.tradeDate || '') + ' 净买' + fmtAmt(r.netAmount) + (r.reason ? ' (' + r.reason + ')' : '')).join(' | ')
    : '龙虎榜: 暂无记录';
}

function stopLivePoll() {
  if (state.liveTimer) {
    clearInterval(state.liveTimer);
    state.liveTimer = null;
  }
}

function startLivePoll(code) {
  stopLivePoll();
  state.liveCode = code;
  const sec = Math.max(15, Number(state.liveIntervalSec) || 60);
  state.liveTimer = setInterval(() => {
    refreshLive(code).catch(() => {});
  }, sec * 1000);
}

async function refreshLive(code) {
  if (!code) return null;
  const data = await api('/api/live/latest?code=' + encodeURIComponent(code));
  if (data.config?.pollIntervalSec) state.liveIntervalSec = data.config.pollIntervalSec;
  renderLiveBox(data.live, data.lhb, (data.live?.tradeDate || '') + ' ' + (data.live?.tradeTime || '') + ' · 每' + state.liveIntervalSec + 's');
  return data;
}

function filterLiveRows(rows, q) {
  const needle = String(q || '').trim().toLowerCase();
  if (!needle) return rows || [];
  return (rows || []).filter((w) => {
    const code = String(w.code || '').toLowerCase();
    const name = String(w.name || '').toLowerCase();
    const liveName = String(w.live?.name || '').toLowerCase();
    return code.includes(needle) || name.includes(needle) || liveName.includes(needle);
  });
}

function applyLiveFilter() {
  const q = $('#liveFilterQ') ? $('#liveFilterQ').value : '';
  const filtered = filterLiveRows(state.liveRows, q);
  renderLiveWatchTable(filtered);
  const status = $('#livePollStatus');
  if (status && state.liveRows.length) {
    const base = status.textContent.replace(/\s*·\s*显示\s*\d+\/\d+.*$/, '');
    status.textContent = q.trim()
      ? base + ' · 显示 ' + filtered.length + '/' + state.liveRows.length
      : base;
  }
  return filtered;
}

function renderLiveWatchTable(rows) {
  const tbody = $('#liveTable tbody');
  if (!tbody) return;
  if (!rows.length) {
    const hasAll = (state.liveRows || []).length > 0;
    const tip = hasAll
      ? '无匹配监控标的，请调整名称/代码筛选'
      : '监控列表为空。检索股票或运行筛选后会自动加入。';
    tbody.innerHTML = '<tr><td colspan="15">' + tip + '</td></tr>';
    return;
  }
  tbody.innerHTML = rows.map((w) => {
    const L = w.live || {};
    const pct = L.pctChange;
    const pctCls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
    return '<tr>' +
      '<td>' + escapeHtml(w.code) + '</td>' +
      '<td>' + escapeHtml(w.name || '') + '</td>' +
      '<td>' + escapeHtml(w.source || '') + '</td>' +
      '<td class="' + pctCls + '">' + fmt(L.price, 2) + '</td>' +
      '<td class="' + pctCls + '">' + (pct == null ? '' : fmt(pct, 2)) + '</td>' +
      '<td>' + fmtAmt(L.volume) + '</td>' +
      '<td>' + fmtAmt(L.amount) + '</td>' +
      '<td>' + (L.turnoverRate != null ? fmt(L.turnoverRate, 2) : '') + '</td>' +
      '<td>' + fmt(L.volumeRatio, 2) + '</td>' +
      '<td>' + fmtAmt(L.mainNetInflow) + '</td>' +
      '<td>' + fmtAmt(L.activeBuyVolume) + '</td>' +
      '<td>' + fmtAmt(L.activeSellVolume) + '</td>' +
      '<td>' + fmtAmt(L.mainBuy) + '</td>' +
      '<td>' + fmtAmt(L.mainSell) + '</td>' +
      '<td>' + escapeHtml((L.tradeDate || '') + ' ' + (L.tradeTime || '')) + '</td>' +
      '</tr>';
  }).join('');
}

async function loadLiveWatchlist() {
  const data = await api('/api/live/watchlist');
  if (data.config?.pollIntervalSec) state.liveIntervalSec = data.config.pollIntervalSec;
  const st = await api('/api/live/status');
  const p = st.poll || {};
  state.liveRows = data.rows || [];
  $('#livePollStatus').textContent =
    '间隔 ' + state.liveIntervalSec + 's · 监控 ' + (p.stats?.watchCount ?? state.liveRows.length) +
    ' 只 · 快照 ' + (p.stats?.snapCount ?? '-') +
    ' · 交易时段 ' + (p.trading ? '是' : '否') +
    (p.finishedAt ? ' · 上次 ' + new Date(p.finishedAt).toLocaleTimeString('zh-CN') : '');
  applyLiveFilter();
  return data;
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

function renderMarket(m) {
  const box = $('#marketBox');
  if (!m) {
    box.className = 'market-box';
    box.textContent = '大盘：暂无';
    return;
  }
  const icon = m.weather === '太阳' ? '☀' : m.weather === '乌云下雨' ? '☔' : m.weather === '乌云' ? '☁' : '🌥';
  box.className =
    'market-box ' +
    (m.weather === '太阳' ? 'sun' : /乌云/.test(m.weather || '') ? 'rain' : 'cloud');
  box.innerHTML =
    icon +
    ' ' +
    escapeHtml(m.weather) +
    ' · ' +
    escapeHtml(m.indexName || '上证') +
    ' ' +
    escapeHtml(fmt(m.indexPrice, 2)) +
    ' (' +
    (m.indexPctChange > 0 ? '+' : '') +
    escapeHtml(fmt(m.indexPctChange, 2)) +
    '%)' +
    '<br/><span style="opacity:.8">' +
    escapeHtml(m.weatherLabel || '') +
    (m.indexVolShrink ? ' · 缩量' : '') +
    '</span>';
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
    tbody.innerHTML = '<tr><td colspan="23">无匹配结果</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const stageCls = 'stage-' + (r.profitStage || '');
      return `<tr>
        <td>${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td>${escapeHtml(r.industry)}</td>
        <td class="${stageCls}">${escapeHtml(r.profitStage)}</td>
        <td>${escapeHtml(r.holdFocus)}</td>
        <td>${r.holderNum ?? ''}</td>
        <td>${fmt(r.top10Ratio, 1)}</td>
        <td>${fmt(r.marketCapYi)}</td>
        <td>${r.employeeNum ?? ''}</td>
        <td>${escapeHtml(r.province)}</td>
        <td class="clip" title="${escapeHtml(r.financeSummary)}">${escapeHtml(r.financeSummary)}</td>
        <td class="clip" title="${escapeHtml(r.mainProducts)}">${escapeHtml(r.mainProducts)}</td>
        <td class="clip" title="${escapeHtml(r.partners)}">${escapeHtml(r.partners)}</td>
        <td class="clip" title="${escapeHtml(r.outboundInvest)}">${escapeHtml(r.outboundInvest)}</td>
        <td class="${r.isST ? 'yes' : ''}">${r.isST ? escapeHtml(r.stType || '是') : ''}</td>
        <td>${escapeHtml(r.stDate)}</td>
        <td class="clip" title="${escapeHtml(r.stReason)}">${escapeHtml(r.stReason)}</td>
        <td class="${r.justUncapped ? 'ok' : ''}">${escapeHtml(r.uncapLabel || (r.justUncapped ? '刚摘帽' : r.uncapDate ? '曾摘帽' : ''))}</td>
        <td title="${escapeHtml(r.uncapTitle)}">${escapeHtml(r.uncapDate)}</td>
        <td class="${r.hasAbnormal ? 'yes' : ''}">${r.hasAbnormal ? '有' : ''}</td>
        <td>${r.abnormalCount || ''}</td>
        <td>${escapeHtml(r.lastAbnormalDate)}</td>
        <td class="clip" title="${escapeHtml(r.abnormalSummary)}">${escapeHtml(r.abnormalSummary)}</td>
      </tr>`;
    })
    .join('');
}


function readCompoundFilters() {
  return {
    stage: $('#filterStage').value.trim(),
    focus: $('#filterFocus').value.trim(),
    uncapped: $('#filterUncapped').value,
    abnormal: $('#filterAbnormal').value,
  };
}

function hasCompoundFiltersClient(f) {
  return !!(f.stage || f.focus || f.uncapped === '1' || f.abnormal === '1');
}

async function runRemoteFilterAndShow() {
  const f = readCompoundFilters();
  if (!hasCompoundFiltersClient(f)) {
    throw new Error('请先选择盈利阶段/持股集中度/刚摘帽/异动');
  }
  setLoading(true, '本地无命中，正在远程扫描主板…');
  setBadge('running', '远程过滤');
  await api('/api/screen/remote-filter', {
    method: 'POST',
    body: JSON.stringify({
      stage: f.stage,
      focus: f.focus,
      uncapped: f.uncapped,
      abnormal: f.abnormal,
    }),
  });
  await pollUntilDone();
  const params = new URLSearchParams();
  if (f.stage) params.set('stage', f.stage);
  if (f.focus) params.set('focus', f.focus);
  if (f.uncapped) params.set('uncapped', f.uncapped);
  if (f.abnormal) params.set('abnormal', f.abnormal);
  const data = await api('/api/screen/remote-result?' + params.toString());
  renderMarket(data.market);
  if (data.empty || !(data.rows || []).length) {
    $('#stats').textContent = '远程扫描主板后仍无匹配结果';
    renderRows([]);
    setBadge('idle', '远程无命中');
    return data;
  }
  const st = data.stats || {};
  $('#stats').textContent =
    '远程主板过滤 ' +
    data.total +
    '/' +
    (data.allTotal || data.total) +
    ' 只 · 扫描主板约 ' +
    (st.mainBoard || '?') +
    ' · ' +
    new Date(data.generatedAt).toLocaleString('zh-CN') +
    (st.truncated ? ' · 已截断至上限' : '');
  renderRows(data.rows);
  setBadge('idle', '远程过滤');
  return data;
}

async function loadLocalResult() {
  const q = $('#filterQ').value.trim();
  const stage = $('#filterStage').value;
  const focus = $('#filterFocus').value;
  const uncapped = $('#filterUncapped').value;
  const abnormal = $('#filterAbnormal').value;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (stage) params.set('stage', stage);
  if (focus) params.set('focus', focus);
  if (uncapped) params.set('uncapped', uncapped);
  if (abnormal) params.set('abnormal', abnormal);

  const data = await api('/api/screen/result?' + params.toString());
  renderMarket(data.market);
  // 本地搜索不展示单票实时卡片（避免与远程混淆）
  if ($('#liveBox')) $('#liveBox').classList.add('hidden');
  stopLivePoll();

  if (data.empty) {
    $('#stats').textContent = '尚无缓存结果，请点击「刷新数据」开始抓取，或使用「远程搜索」。';
    renderRows([]);
    setBadge('idle', '无本地数据');
    return data;
  }

  const st = data.stats || {};
  const stages = st.stageCount
    ? Object.entries(st.stageCount).map(([k, v]) => k + v).join(' / ')
    : '';
  const uncapN = (data.rows || []).filter((r) => r.justUncapped).length;
  const abnN = (data.rows || []).filter((r) => r.hasAbnormal).length;
  $('#stats').textContent =
    '本地搜索 ' +
    data.total +
    '/' +
    data.allTotal +
    ' 只 · 生成于 ' +
    new Date(data.generatedAt).toLocaleString('zh-CN') +
    ' · ST ' +
    (st.stCount || 0) +
    ' · 刚摘帽 ' +
    uncapN +
    ' · 异动 ' +
    abnN +
    (stages ? ' · ' + stages : '') +
    (!(data.rows || []).length ? '（无命中，可点「远程搜索」）' : '');
  renderRows(data.rows || []);
  setBadge('idle', '本地搜索');
  return data;
}

async function loadRemoteSearch() {
  const q = $('#filterQ').value.trim();
  const stage = $('#filterStage').value;
  const focus = $('#filterFocus').value;
  const uncapped = $('#filterUncapped').value;
  const abnormal = $('#filterAbnormal').value;
  const compound = { stage, focus, uncapped, abnormal };

  // 有名称/代码：远程个股查询
  if (q) {
    setLoading(true, '正在远程查询 ' + q + ' ...');
    setBadge('running', '远程搜索');
    try {
      const data = await api('/api/stock/lookup?q=' + encodeURIComponent(q));
      setLoading(false);
      if (data.market) renderMarket(data.market);
      const r = data.row || (data.rows && data.rows[0]);
      $('#stats').textContent =
        '远程搜索: ' +
        (r ? r.code + ' ' + r.name : q) +
        (data.resolved && data.resolved.name && r && data.resolved.name !== r.name
          ? '（匹配 ' + data.resolved.name + '）'
          : '');
      renderRows(r ? [r] : []);
      if (data.live || data.lhb) {
        if (data.liveConfig?.pollIntervalSec) state.liveIntervalSec = data.liveConfig.pollIntervalSec;
        renderLiveBox(data.live, data.lhb);
        if (r?.code) startLivePoll(r.code);
      }
      setBadge('idle', '远程搜索');
      return data;
    } catch (e) {
      setLoading(false);
      setBadge('error', '远程失败');
      $('#stats').textContent = '远程搜索失败: ' + (e.message || e);
      renderRows([]);
      throw e;
    }
  }

  // 无代码时：用复合条件远程扫主板
  if (!hasCompoundFiltersClient(compound)) {
    alert('远程搜索请输入名称/代码，或选择盈利阶段/持股集中度/刚摘帽/异动');
    return null;
  }
  return runRemoteFilterAndShow();
}

async function loadResult() {
  // 兼容旧调用：默认本地搜索
  return loadLocalResult();
}

async function pollUntilDone() {
  setLoading(true, '处理中…');
  setBadge('running', '处理中');
  if (state.polling) clearInterval(state.polling);
  return new Promise((resolve, reject) => {
    state.polling = setInterval(async () => {
      try {
        const s = await api('/api/screen/status');
        const p = s.job.progress || {};
        const msg = p.message || p.stage || '处理中';
        const prog = p.total > 0 ? ' ' + (p.done || 0) + '/' + p.total : '';
        const kind = s.job.kind === 'remote-filter' ? '远程过滤' : '筛选中';
        setLoading(true, msg + prog);
        setBadge('running', kind);
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
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
      if (btn.dataset.tab === 'live') loadLiveWatchlist().catch(alert);
    });
  });
  $('#btnFilter').addEventListener('click', () => loadLocalResult().catch(alert));
  if ($('#btnRemoteSearch')) {
    $('#btnRemoteSearch').addEventListener('click', () => loadRemoteSearch().catch(alert));
  }
  if ($('#btnCollectNow')) {
    $('#btnCollectNow').addEventListener('click', async () => {
      if (!state.liveCode) return alert('请先查询一只股票');
      try {
        setLoading(true, '采集中…');
        await api('/api/live/collect', { method: 'POST', body: JSON.stringify({ code: state.liveCode, force: true }) });
        await refreshLive(state.liveCode);
      } catch (e) {
        alert(e.message);
      } finally {
        setLoading(false);
      }
    });
  }
  if ($('#btnLiveFilter')) {
    $('#btnLiveFilter').addEventListener('click', () => applyLiveFilter());
  }
  if ($('#liveFilterQ')) {
    $('#liveFilterQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') applyLiveFilter();
    });
    $('#liveFilterQ').addEventListener('input', () => applyLiveFilter());
  }
  if ($('#btnLiveRefresh')) {
    $('#btnLiveRefresh').addEventListener('click', () => loadLiveWatchlist().catch(alert));
  }
  if ($('#btnLiveCollectAll')) {
    $('#btnLiveCollectAll').addEventListener('click', async () => {
      try {
        setLoading(true, '全量采集中…');
        await api('/api/live/collect', { method: 'POST', body: JSON.stringify({ force: true }) });
        await loadLiveWatchlist();
      } catch (e) {
        alert(e.message);
      } finally {
        setLoading(false);
      }
    });
  }
  $('#filterQ').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') loadLocalResult().catch(alert);
  });
  $('#btnRefresh').addEventListener('click', () => {
    runScreenAndShow().catch((e) => alert(e.message));
  });

  const cfg = await api('/api/config');
  fillConfigForm(cfg.config);
  if (cfg.liveConfig?.pollIntervalSec) state.liveIntervalSec = cfg.liveConfig.pollIntervalSec;
  if ($('#liveConfigHint') && cfg.liveConfig) {
    $('#liveConfigHint').textContent =
      '实时监控: 每 ' + cfg.liveConfig.pollIntervalSec + ' 秒采集一次（config.smallLive.pollIntervalSec / 环境变量 SMALL_POLL_SEC），入库 ' + (cfg.liveConfig.dbPath || 'data/small-live.db');
  }

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
