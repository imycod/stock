const $ = (s) => document.querySelector(s);

const state = { polling: null, liveCode: null, liveTimer: null, liveListTimer: null, liveIntervalSec: 60, liveRows: [], liveExpand: {}, favoriteCodes: new Set(), favRows: [], planRows: [], planBound: false, planResolved: null, planAnalyzing: false, aiConfig: null, aiSession: null, aiBound: false, remarkSession: null, remarkBound: false, industries: [], industryComboBound: false, industryMarketLoaded: false, aiBusy: false };

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

async function fetchLiveDays(code) {
  const data = await api('/api/live/history?code=' + encodeURIComponent(code));
  return data.days || [];
}

async function fetchLiveMinutes(code, tradeDate) {
  const data = await api(
    '/api/live/history?code=' +
      encodeURIComponent(code) +
      '&date=' +
      encodeURIComponent(tradeDate)
  );
  return data.snapshots || [];
}

function renderMinuteTable(rows) {
  if (!rows.length) return '<div class="muted" style="padding:8px">该日暂无分钟数据</div>';
  const head =
    '<table class="live-minute-table"><thead><tr>' +
    '<th>时间</th><th>现价</th><th>涨跌%</th><th>成交量</th><th>成交额</th><th>换手%</th><th>量比</th><th>振幅%</th><th>主力净流入</th><th>主动买</th><th>主动卖</th>' +
    '</tr></thead><tbody>';
  const body = rows
    .map(function (r) {
      const pct = r.pctChange;
      const pctCls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
      return (
        '<tr>' +
        '<td>' +
        escapeHtml(r.tradeTime || '') +
        '</td>' +
        '<td class="' +
        pctCls +
        '">' +
        fmt(r.price, 2) +
        '</td>' +
        '<td class="' +
        pctCls +
        '">' +
        (pct == null ? '' : fmt(pct, 2)) +
        '</td>' +
        '<td>' +
        fmtAmt(r.volume) +
        '</td>' +
        '<td>' +
        fmtAmt(r.amount) +
        '</td>' +
        '<td>' +
        (r.turnoverRate != null ? fmt(r.turnoverRate, 2) : '') +
        '</td>' +
        '<td>' +
        fmt(r.volumeRatio, 2) +
        '</td>' +
        '<td>' +
        (r.amplitude != null ? fmt(r.amplitude, 2) : '') +
        '</td>' +
        '<td>' +
        fmtAmt(r.mainNetInflow) +
        '</td>' +
        '<td>' +
        fmtAmt(r.activeBuyVolume) +
        '</td>' +
        '<td>' +
        fmtAmt(r.activeSellVolume) +
        '</td>' +
        '</tr>'
      );
    })
    .join('');
  return '<div class="live-minute-wrap">' + head + body + '</tbody></table></div>';
}

function renderDayBlocks(code, days, dayCache) {
  if (!days.length) {
    return '<div class="muted">暂无入库的分钟快照（交易时段会按间隔采集）</div>';
  }
  return days
    .map(function (d) {
      const date = d.tradeDate;
      const open = !!(dayCache && dayCache[date] && dayCache[date].open);
      const rows = (dayCache && dayCache[date] && dayCache[date].rows) || [];
      const body = open
        ? dayCache[date].loading
          ? '<div class="muted" style="padding:8px">加载中…</div>'
          : renderMinuteTable(rows)
        : '';
      return (
        '<div class="live-day" data-code="' +
        escapeHtml(code) +
        '" data-date="' +
        escapeHtml(date) +
        '">' +
        '<div class="live-day-head">' +
        '<span class="arrow">' +
        (open ? '▼' : '▶') +
        '</span>' +
        '<strong>' +
        escapeHtml(date) +
        '</strong>' +
        '<span class="muted">' +
        (d.count || 0) +
        ' 条</span>' +
        '<span class="muted">末笔 ' +
        escapeHtml(d.lastTime || '') +
        '</span>' +
        '</div>' +
        (open ? body : '') +
        '</div>'
      );
    })
    .join('');
}

async function toggleLiveExpand(code) {
  const cur = state.liveExpand[code] || { open: false, days: [], dayCache: {} };
  if (cur.open) {
    cur.open = false;
    state.liveExpand[code] = cur;
    applyLiveFilter();
    return;
  }
  cur.open = true;
  cur.loading = true;
  state.liveExpand[code] = cur;
  applyLiveFilter();
  try {
    cur.days = await fetchLiveDays(code);
  } catch (e) {
    cur.open = false;
    alert(e.message);
  } finally {
    cur.loading = false;
    state.liveExpand[code] = cur;
    applyLiveFilter();
  }
}

async function toggleLiveDay(code, tradeDate) {
  const cur = state.liveExpand[code];
  if (!cur) return;
  cur.dayCache = cur.dayCache || {};
  const slot = cur.dayCache[tradeDate] || { open: false, rows: [], loading: false };
  if (slot.open) {
    slot.open = false;
    cur.dayCache[tradeDate] = slot;
    state.liveExpand[code] = cur;
    applyLiveFilter();
    return;
  }
  slot.open = true;
  slot.loading = true;
  cur.dayCache[tradeDate] = slot;
  state.liveExpand[code] = cur;
  applyLiveFilter();
  try {
    slot.rows = await fetchLiveMinutes(code, tradeDate);
  } catch (e) {
    slot.open = false;
    alert(e.message);
  } finally {
    slot.loading = false;
    cur.dayCache[tradeDate] = slot;
    state.liveExpand[code] = cur;
    applyLiveFilter();
  }
}

function bindLiveExpandEvents(tbody) {
  tbody.querySelectorAll('.btn-ai').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openAiModal(btn.getAttribute('data-code'), btn.getAttribute('data-name')).catch(alert);
    });
  });
  tbody.querySelectorAll('.btn-remark').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      openRemarkModal(btn.getAttribute('data-code'), btn.getAttribute('data-name')).catch(alert);
    });
  });
  tbody.querySelectorAll('.live-expand').forEach(function (btn) {
    btn.addEventListener('click', function (e) {
      e.preventDefault();
      toggleLiveExpand(btn.getAttribute('data-code')).catch(alert);
    });
  });
  tbody.querySelectorAll('.live-day-head').forEach(function (head) {
    head.addEventListener('click', function () {
      const box = head.closest('.live-day');
      if (!box) return;
      toggleLiveDay(box.getAttribute('data-code'), box.getAttribute('data-date')).catch(alert);
    });
  });
}

function renderLiveWatchTable(rows) {
  const tbody = $('#liveTable tbody');
  if (!tbody) return;
  if (!rows.length) {
    const hasAll = (state.liveRows || []).length > 0;
    const tip = hasAll
      ? '无匹配监控标的，请调整名称/代码筛选'
      : '监控列表为空。检索股票或运行筛选后会自动加入。';
    tbody.innerHTML = '<tr><td colspan="18">' + tip + '</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(function (w) {
      const L = w.live || {};
      const pct = L.pctChange;
      const pctCls = pct > 0 ? 'up' : pct < 0 ? 'down' : '';
      const exp = state.liveExpand[w.code] || {};
      const open = !!exp.open;
      const main =
        '<tr data-code="' +
        escapeHtml(w.code) +
        '">' +
        '<td><button type="button" class="live-expand' +
        (open ? ' open' : '') +
        '" data-code="' +
        escapeHtml(w.code) +
        '" title="展开分钟数据">' +
        (open ? '▼' : '▶') +
        '</button></td>' +
        '<td>' +
        escapeHtml(w.code) +
        '</td>' +
        '<td>' +
        escapeHtml(w.name || '') +
        '</td>' +
        '<td>' +
        escapeHtml(w.source || '') +
        '</td>' +
        '<td class="' +
        pctCls +
        '">' +
        fmt(L.price, 2) +
        '</td>' +
        '<td class="' +
        pctCls +
        '">' +
        (pct == null ? '' : fmt(pct, 2)) +
        '</td>' +
        '<td>' +
        fmtAmt(L.volume) +
        '</td>' +
        '<td>' +
        fmtAmt(L.amount) +
        '</td>' +
        '<td>' +
        (L.turnoverRate != null ? fmt(L.turnoverRate, 2) : '') +
        '</td>' +
        '<td>' +
        fmt(L.volumeRatio, 2) +
        '</td>' +
        '<td>' +
        fmtAmt(L.mainNetInflow) +
        '</td>' +
        '<td>' +
        fmtAmt(L.activeBuyVolume) +
        '</td>' +
        '<td>' +
        fmtAmt(L.activeSellVolume) +
        '</td>' +
        '<td>' +
        fmtAmt(L.mainBuy) +
        '</td>' +
        '<td>' +
        fmtAmt(L.mainSell) +
        '</td>' +
        '<td>' +
        escapeHtml((L.tradeDate || '') + ' ' + (L.tradeTime || '')) +
        '</td>' +
        '<td><button type="button" class="btn btn-secondary btn-sm btn-ai" data-code="' +
        escapeHtml(w.code) +
        '" data-name="' +
        escapeHtml(w.name || '') +
        '">分析</button></td>' +
        '<td><button type="button" class="btn btn-secondary btn-sm btn-remark" data-code="' +
        escapeHtml(w.code) +
        '" data-name="' +
        escapeHtml(w.name || '') +
        '">备注' +
        (w.remarkCount ? ' (' + w.remarkCount + ')' : '') +
        '</button></td>' +
        '</tr>';
      if (!open) return main;
      const detailInner = exp.loading
        ? '<div class="muted">加载日期列表…</div>'
        : renderDayBlocks(w.code, exp.days || [], exp.dayCache || {});
      const detail =
        '<tr class="live-detail-row" data-code="' +
        escapeHtml(w.code) +
        '">' +
        '<td colspan="18">' +
        detailInner +
        '</td></tr>';
      return main + detail;
    })
    .join('');
  bindLiveExpandEvents(tbody);
}



async function loadAiConfig() {
  try {
    const data = await api('/api/ai/config');
    state.aiConfig = data;
    return data;
  } catch (e) {
    state.aiConfig = { configured: false, presets: [], defaultDays: 5, maxDays: 10, model: '' };
    return state.aiConfig;
  }
}

function appendAiMsg(role, content) {
  const box = $('#aiChat');
  if (!box) return;
  const div = document.createElement('div');
  div.className = 'ai-msg ' + role;
  div.textContent = content;
  box.appendChild(div);
  box.scrollTop = box.scrollHeight;
}

function renderAiPresets() {
  const wrap = $('#aiPresets');
  if (!wrap) return;
  const presets = (state.aiConfig && state.aiConfig.presets) || [];
  wrap.innerHTML = presets
    .map(function (p, i) {
      return '<button type="button" data-preset="' + i + '">' + escapeHtml(p) + '</button>';
    })
    .join('');
  wrap.querySelectorAll('button').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const idx = Number(btn.getAttribute('data-preset'));
      const text = presets[idx];
      if ($('#aiInput')) $('#aiInput').value = text;
      sendAiChat(text).catch(alert);
    });
  });
}

async function openAiModal(code, name) {
  bindAiModalEvents();
  await loadAiConfig();
  state.aiSession = { code: code, name: name || '', messages: [] };
  const modal = $('#aiModal');
  if (!modal) return;
  modal.classList.remove('hidden');
  if (state.aiBusy) state.aiBusy = false;
  $('#aiModalTitle').textContent = 'AI 分析 · ' + code + ' ' + (name || '');
  const cfg = state.aiConfig || {};
  $('#aiModalSub').textContent = '基于实时监控入库的分钟快照，与模型多轮对话';
  $('#aiModelHint').textContent = '模型: ' + (cfg.model || 'glm-4.7-flash');
  $('#aiKeyHint').textContent = cfg.configured
    ? 'API Key 已配置'
    : '未配置 ZHIPU_API_KEY。请在项目根目录 .env 写入 ZHIPU_API_KEY=xxx 后重启 3010 服务';
  $('#aiKeyHint').style.color = cfg.configured ? '' : 'var(--danger)';
  const days = cfg.defaultDays || 5;
  if ($('#aiDays')) $('#aiDays').value = days;
  $('#aiChat').innerHTML = '';
  appendAiMsg(
    'system',
    '选择天数后，可点快捷问题或自己输入。每次提问都会附带该股近 N 日分钟数据给模型。'
  );
  renderAiPresets();
  if ($('#aiInput')) {
    $('#aiInput').value = '';
    $('#aiInput').focus();
  }
}

function closeAiModal() {
  const modal = $('#aiModal');
  if (modal) modal.classList.add('hidden');
}

async function sendAiChat(questionOverride) {
  const session = state.aiSession;
  if (!session || !session.code) return;
  if (state.aiBusy) return;
  const question = String(questionOverride || ($('#aiInput') && $('#aiInput').value) || '').trim();
  if (!question) return alert('请输入问题');
  if (state.aiConfig && state.aiConfig.configured === false) {
    await loadAiConfig();
    if (!state.aiConfig.configured) {
      return alert('服务未读到 API Key。请确认项目根目录 .env 有 ZHIPU_API_KEY=... 并已重启 npm run start:small');
    }
  }
  const days = Number(($('#aiDays') && $('#aiDays').value) || (state.aiConfig && state.aiConfig.defaultDays) || 5);
  state.aiBusy = true;
  if ($('#btnAiSend')) $('#btnAiSend').disabled = true;
  appendAiMsg('user', question);
  if ($('#aiInput')) $('#aiInput').value = '';
  const loading = document.createElement('div');
  loading.className = 'ai-msg system';
  loading.textContent = '分析中…（附带近 ' + days + ' 日分钟数据，高峰期可能自动重试）';
  $('#aiChat').appendChild(loading);
  $('#aiChat').scrollTop = $('#aiChat').scrollHeight;

  try {
    const data = await api('/api/ai/chat', {
      method: 'POST',
      body: JSON.stringify({
        code: session.code,
        days: days,
        question: question,
        messages: session.messages,
      }),
    });
    loading.remove();
    session.messages.push({ role: 'user', content: question });
    session.messages.push({ role: 'assistant', content: data.answer || '' });
    appendAiMsg('assistant', data.answer || '(空回复)');
    if (data.meta) {
      appendAiMsg(
        'system',
        '本次上下文: ' +
          (data.meta.dateList || []).join(', ') +
          ' · ' +
          data.meta.rowCount +
          ' 条' +
          (data.meta.truncated ? '（已截断）' : '') +
          (data.model ? ' · ' + data.model : '')
      );
    }
  } catch (e) {
    loading.className = 'ai-msg system';
    loading.textContent = '失败: ' + (e.message || e) + '（若提示访问量过大，请稍等几秒再问）';
  } finally {
    state.aiBusy = false;
    if ($('#btnAiSend')) $('#btnAiSend').disabled = false;
  }
}


function bindAiModalEvents() {
  const closeBtn = $('#btnAiClose');
  if (closeBtn) closeBtn.onclick = function () { closeAiModal(); };
  // 蒙层不关闭，避免误触丢失对话；仅关闭按钮可关
  const sendBtn = $('#btnAiSend');
  if (sendBtn) {
    sendBtn.onclick = function (e) {
      e.preventDefault();
      sendAiChat().catch(function (err) { alert(err.message || err); });
    };
  }
  const input = $('#aiInput');
  if (input && !input.dataset.aiKeyBound) {
    input.dataset.aiKeyBound = '1';
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendAiChat().catch(function (err) { alert(err.message || err); });
      }
    });
  }
  state.aiBound = true;
}

function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function tomorrowShanghai() {
  const today = todayShanghai();
  const parts = today.split('-').map(Number);
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  dt.setUTCDate(dt.getUTCDate() + 1);
  return dt.toISOString().slice(0, 10);
}

function renderPlanCheckTable(rows) {
  const tbody = $('#planCheckTable tbody');
  if (!tbody) return;
  tbody.innerHTML = (rows || []).map(function (r) {
    const pred = r.predictionOk === 1 || r.predictionOk === true ? '1'
      : r.predictionOk === 0 || r.predictionOk === false ? '0' : '';
    return (
      '<tr data-date="' + escapeHtml(r.checkDate) + '">' +
      '<td class="remark-date">' + escapeHtml(r.checkDate) + '</td>' +
      '<td><select class="plan-check-pred">' +
      '<option value=""' + (pred === '' ? ' selected' : '') + '>未评</option>' +
      '<option value="1"' + (pred === '1' ? ' selected' : '') + '>正确</option>' +
      '<option value="0"' + (pred === '0' ? ' selected' : '') + '>错误</option>' +
      '</select></td></tr>'
    );
  }).join('');
}

async function loadPlanChecks(planId) {
  const block = $('#planCheckBlock');
  if (!planId) {
    if (block) block.classList.add('hidden');
    renderPlanCheckTable([]);
    return;
  }
  if (block) block.classList.remove('hidden');
  const data = await api('/api/trade-plans/' + planId + '/checks');
  const tomorrow = data.tomorrow || tomorrowShanghai();
  let rows = data.rows || [];
  if (!rows.some(function (r) { return r.checkDate === tomorrow; })) {
    rows = [{ checkDate: tomorrow, predictionOk: null }].concat(rows);
  }
  renderPlanCheckTable(rows);
}

async function savePlanChecks(planId) {
  if (!planId) return;
  const trs = document.querySelectorAll('#planCheckTable tbody tr');
  for (const tr of trs) {
    const checkDate = tr.getAttribute('data-date');
    const predVal = tr.querySelector('.plan-check-pred').value;
    await api('/api/trade-plans/' + planId + '/checks', {
      method: 'POST',
      body: JSON.stringify({
        checkDate: checkDate,
        predictionOk: predVal === '' ? null : Number(predVal),
      }),
    });
  }
}

async function openRemarkModal(code, name) {
  bindRemarkModalEvents();
  state.remarkSession = { code: code, name: name || '' };
  const modal = $('#remarkModal');
  if (!modal) return;
  $('#remarkModalTitle').textContent = '备注 · ' + code + ' ' + (name || '');
  modal.classList.remove('hidden');
  await loadRemarkRows();
}

function closeRemarkModal() {
  const modal = $('#remarkModal');
  if (modal) modal.classList.add('hidden');
}

async function loadRemarkRows() {
  if (!state.remarkSession || !state.remarkSession.code) return;
  const code = state.remarkSession.code;
  const data = await api('/api/remarks?code=' + encodeURIComponent(code));
  const today = data.today || todayShanghai();
  let rows = data.rows || [];
  if (!rows.some(function (r) { return r.tradeDate === today; })) {
    rows = [{ tradeDate: today, content: '', predictionOk: null, dayMove: null }].concat(rows);
  }
  renderRemarkTable(rows);
}

function renderRemarkTable(rows) {
  const tbody = $('#remarkTable tbody');
  if (!tbody) return;
  tbody.innerHTML = (rows || [])
    .map(function (r) {
      const pred =
        r.predictionOk === 1 || r.predictionOk === true
          ? '1'
          : r.predictionOk === 0 || r.predictionOk === false
            ? '0'
            : '';
      const move = r.dayMove || '';
      return (
        '<tr data-date="' +
        escapeHtml(r.tradeDate) +
        '">' +
        '<td class="remark-date">' +
        escapeHtml(r.tradeDate) +
        '</td>' +
        '<td><textarea class="remark-content" rows="3" placeholder="AI 分析简要记录…">' +
        escapeHtml(r.content || '') +
        '</textarea></td>' +
        '<td><select class="remark-pred">' +
        '<option value=""' +
        (pred === '' ? ' selected' : '') +
        '>未评</option>' +
        '<option value="1"' +
        (pred === '1' ? ' selected' : '') +
        '>正确</option>' +
        '<option value="0"' +
        (pred === '0' ? ' selected' : '') +
        '>错误</option>' +
        '</select></td>' +
        '<td><select class="remark-move">' +
        '<option value=""' +
        (move === '' ? ' selected' : '') +
        '>未填</option>' +
        '<option value="up"' +
        (move === 'up' ? ' selected' : '') +
        '>涨</option>' +
        '<option value="down"' +
        (move === 'down' ? ' selected' : '') +
        '>跌</option>' +
        '<option value="flat"' +
        (move === 'flat' ? ' selected' : '') +
        '>平</option>' +
        '</select></td>' +
        '</tr>'
      );
    })
    .join('');
}

async function saveRemarkRows() {
  if (!state.remarkSession || !state.remarkSession.code) return;
  const code = state.remarkSession.code;
  const trs = Array.prototype.slice.call(document.querySelectorAll('#remarkTable tbody tr'));
  for (let i = 0; i < trs.length; i++) {
    const tr = trs[i];
    const tradeDate = tr.getAttribute('data-date');
    if (!tradeDate) continue;
    const content = tr.querySelector('.remark-content').value;
    const predVal = tr.querySelector('.remark-pred').value;
    const moveVal = tr.querySelector('.remark-move').value;
    const isEmpty =
      !String(content || '').trim() && predVal === '' && (moveVal === '' || moveVal == null);
    if (isEmpty) {
      await api('/api/remarks/' + encodeURIComponent(code) + '/' + encodeURIComponent(tradeDate), {
        method: 'DELETE',
      });
      continue;
    }
    await api('/api/remarks', {
      method: 'POST',
      body: JSON.stringify({
        code: code,
        tradeDate: tradeDate,
        content: content,
        predictionOk: predVal === '' ? null : Number(predVal),
        dayMove: moveVal || null,
      }),
    });
  }
  alert('已保存');
  await loadRemarkRows();
  try {
    if (typeof loadLiveWatchlist === 'function') {
      await loadLiveWatchlist();
    }
  } catch (e) {
    /* ignore refresh errors */
  }
}

function bindRemarkModalEvents() {
  if (state.remarkBound) return;
  const closeBtn = $('#btnRemarkClose');
  if (closeBtn) closeBtn.onclick = function () { closeRemarkModal(); };
  const saveBtn = $('#btnRemarkSave');
  if (saveBtn) {
    saveBtn.onclick = function () {
      saveRemarkRows().catch(function (e) { alert(e.message || e); });
    };
  }
  const backdrop = document.querySelector('#remarkModal .modal-backdrop');
  if (backdrop) {
    backdrop.addEventListener('click', function () { closeRemarkModal(); });
  }
  state.remarkBound = true;
}


function stopLiveListAutoRefresh() {
  if (state.liveListTimer) {
    clearInterval(state.liveListTimer);
    state.liveListTimer = null;
  }
}

function startLiveListAutoRefresh() {
  stopLiveListAutoRefresh();
  const sec = Math.max(15, Number(state.liveIntervalSec) || 60);
  state.liveListTimer = setInterval(function () {
    loadLiveWatchlist().catch(function () {});
    if (state.liveCode) refreshLive(state.liveCode).catch(function () {});
  }, sec * 1000);
}
async function loadLiveWatchlist() {
  const data = await api('/api/live/watchlist');
  if (data.config?.pollIntervalSec) {
    const next = Number(data.config.pollIntervalSec);
    if (next && next !== state.liveIntervalSec) {
      state.liveIntervalSec = next;
      startLiveListAutoRefresh();
    } else {
      state.liveIntervalSec = next || state.liveIntervalSec;
    }
  }
  const st = await api('/api/live/status');
  const p = st.poll || {};
  state.liveRows = data.rows || [];
  $('#livePollStatus').textContent =
    '间隔 ' + state.liveIntervalSec + 's · 监控 ' + (p.stats?.watchCount ?? state.liveRows.length) +
    ' 只 · 快照 ' + (p.stats?.snapCount ?? '-') +
    ' · 交易时段 ' + (p.trading ? '是' : '否') +
    (p.finishedAt ? ' · 上次 ' + new Date(p.finishedAt).toLocaleTimeString('zh-CN') : '') +
    ' · 每' + state.liveIntervalSec + 's 自动刷新';
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


async function loadFavoriteCodes() {
  try {
    const data = await api('/api/favorites/codes');
    state.favoriteCodes = new Set(data.codes || []);
  } catch {
    state.favoriteCodes = new Set();
  }
  return state.favoriteCodes;
}

function isFav(code) {
  return state.favoriteCodes.has(String(code));
}

async function toggleFavorite(row) {
  const code = String(row && row.code || '');
  if (!code) return;
  if (isFav(code)) {
    const data = await api('/api/favorites/' + encodeURIComponent(code), { method: 'DELETE' });
    state.favoriteCodes = new Set(data.codes || []);
  } else {
    const data = await api('/api/favorites', {
      method: 'POST',
      body: JSON.stringify({ code: code, name: row.name || '', row: row }),
    });
    state.favoriteCodes = new Set(data.codes || []);
  }
  document.querySelectorAll('.fav-check[data-code]').forEach(function (box) {
    const c = box.getAttribute('data-code');
    const on = isFav(c);
    box.checked = on;
    box.title = on ? '取消收藏' : '收藏';
  });
  if ($('#tab-favorites') && $('#tab-favorites').classList.contains('active')) {
    await loadFavorites().catch(function () {});
  }
}

function renderFavTable(rows) {
  const tbody = $('#favTable tbody');
  if (!tbody) return;
  const filterQ = $('#favFilterQ') ? $('#favFilterQ').value.trim() : '';
  const dragEnabled = !filterQ;
  if (!rows.length) {
    const hasAll = (state.favRows || []).length > 0;
    tbody.innerHTML =
      '<tr><td colspan="12">' +
      (hasAll ? '无匹配收藏，请调整名称/代码筛选' : '暂无收藏。可在筛选结果中勾选收藏') +
      '</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map(function (f) {
      const r = f.row || {};
      const code = escapeHtml(f.code);
      const rowClass = 'fav-row' + (dragEnabled ? '' : ' fav-drag-disabled');
      const dragAttr = dragEnabled ? ' draggable="true"' : '';
      return (
        '<tr class="' + rowClass + '" data-code="' + code + '"' + dragAttr + '>' +
        '<td class="fav-drag" title="拖拽排序"><span class="fav-drag-handle">⋮⋮</span></td>' +
        '<td class="fav-actions"><button type="button" class="btn btn-secondary btn-sm btn-unfav" data-code="' +
        code +
        '">取消收藏</button></td>' +
        '<td>' + code + '</td>' +
        '<td>' + escapeHtml(f.name || r.name || '') + '</td>' +
        '<td>' + escapeHtml(r.industry || '') + '</td>' +
        '<td>' + escapeHtml(r.profitStage || '') + '</td>' +
        '<td>' + escapeHtml(r.holdFocus || '') + '</td>' +
        '<td>' + (r.holderNum == null ? '' : r.holderNum) + '</td>' +
        '<td>' + fmt(r.marketCapYi) + '</td>' +
        '<td>' + escapeHtml(r.uncapLabel || '') + '</td>' +
        '<td class="' + (r.hasAbnormal ? 'yes' : '') + '">' + (r.hasAbnormal ? '有' : '') + '</td>' +
        '<td>' + escapeHtml(f.updatedAt || f.createdAt || '') + '</td>' +
        '</tr>'
      );
    })
    .join('');
  tbody.querySelectorAll('.btn-unfav').forEach(function (btn) {
    btn.addEventListener('click', async function () {
      try {
        await toggleFavorite({ code: btn.getAttribute('data-code') });
        await loadFavorites();
      } catch (e) {
        alert(e.message);
      }
    });
  });
  if (dragEnabled) {
    let dragCode = null;
    tbody.querySelectorAll('tr.fav-row').forEach(function (tr) {
      tr.addEventListener('dragstart', function (e) {
        dragCode = tr.dataset.code;
        tr.classList.add('dragging');
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', dragCode);
      });
      tr.addEventListener('dragend', function () {
        tr.classList.remove('dragging');
        tbody.querySelectorAll('tr.drag-over').forEach(function (el) {
          el.classList.remove('drag-over');
        });
        dragCode = null;
      });
      tr.addEventListener('dragover', function (e) {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        tr.classList.add('drag-over');
      });
      tr.addEventListener('dragleave', function () {
        tr.classList.remove('drag-over');
      });
      tr.addEventListener('drop', async function (e) {
        e.preventDefault();
        tr.classList.remove('drag-over');
        const targetCode = tr.dataset.code;
        if (!dragCode || dragCode === targetCode) return;
        const list = state.favRows.slice();
        const from = list.findIndex(function (x) { return x.code === dragCode; });
        const to = list.findIndex(function (x) { return x.code === targetCode; });
        if (from < 0 || to < 0) return;
        const item = list.splice(from, 1)[0];
        list.splice(to, 0, item);
        state.favRows = list;
        applyFavFilter();
        try {
          const data = await api('/api/favorites/reorder', {
            method: 'PUT',
            body: JSON.stringify({ codes: list.map(function (x) { return x.code; }) }),
          });
          state.favRows = data.rows || list;
          state.favoriteCodes = new Set(
            data.codes || (state.favRows || []).map(function (r) { return r.code; })
          );
          applyFavFilter();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }
}

function applyFavFilter() {
  const q = $('#favFilterQ') ? $('#favFilterQ').value.trim().toLowerCase() : '';
  const filtered = (state.favRows || []).filter(function (f) {
    if (!q) return true;
    return (
      String(f.code || '').toLowerCase().includes(q) ||
      String(f.name || '').toLowerCase().includes(q) ||
      String((f.row && f.row.name) || '').toLowerCase().includes(q)
    );
  });
  renderFavTable(filtered);
  if ($('#favStatus')) {
    let msg = q
      ? '显示 ' + filtered.length + '/' + state.favRows.length + ' 只收藏'
      : '共 ' + state.favRows.length + ' 只收藏';
    if (q) msg += '（筛选中不可排序）';
    $('#favStatus').textContent = msg;
  }
  return filtered;
}

async function loadFavorites() {
  const data = await api('/api/favorites');
  state.favoriteCodes = new Set(data.codes || (data.rows || []).map(function (r) { return r.code; }));
  state.favRows = data.rows || [];
  applyFavFilter();
  return data;
}

function renderRows(rows) {
  window.__lastResultRows = rows || [];
  const tbody = $('#resultTable tbody');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="24">无匹配结果</td></tr>';
    return;
  }
  tbody.innerHTML = rows
    .map((r) => {
      const stageCls = 'stage-' + (r.profitStage || '');
      const favOn = isFav(r.code);
      return `<tr>
        <td class="fav-cell"><input type="checkbox" class="fav-check" data-code="${escapeHtml(r.code)}" ${favOn ? 'checked' : ''} title="${favOn ? '取消收藏' : '收藏'}" /></td>
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
  tbody.querySelectorAll('.fav-check').forEach(function (box) {
    box.addEventListener('change', async function () {
      const code = box.getAttribute('data-code');
      const full = (window.__lastResultRows || []).find(function (x) { return String(x.code) === String(code); });
      const want = box.checked;
      if (want === isFav(code)) return;
      try {
        await toggleFavorite(full || { code: code, name: '' });
        box.checked = isFav(code);
      } catch (err) {
        box.checked = isFav(code);
        alert(err.message);
      }
    });
  });
}


function readIndustryFilter() {
  const el = $('#filterIndustry');
  return el ? String(el.value || '').trim() : '';
}

function readCompoundFilters() {
  return {
    stage: $('#filterStage').value.trim(),
    focus: $('#filterFocus').value.trim(),
    uncapped: $('#filterUncapped').value,
    abnormal: $('#filterAbnormal').value,
    industry: readIndustryFilter(),
  };
}

function hasCompoundFiltersClient(f) {
  return !!(f.stage || f.focus || f.industry || f.uncapped === '1' || f.abnormal === '1');
}

/* ---------- industry searchable combo ---------- */
state.industries = state.industries || [];
state.industryComboBound = false;

async function loadIndustries(forceMarket) {
  try {
    const qs = forceMarket ? '?market=1' : '';
    const data = await api('/api/screen/industries' + qs);
    state.industries = data.industries || [];
    if (forceMarket) state.industryMarketLoaded = true;
    renderIndustryOptions(readIndustryFilter());
    return state.industries;
  } catch (e) {
    console.warn('loadIndustries', e.message || e);
    return state.industries || [];
  }
}

function renderIndustryOptions(query) {
  const list = $('#industryOptions');
  if (!list) return;
  const q = String(query || '').trim().toLowerCase();
  const all = state.industries || [];
  const items = q ? all.filter((x) => x.toLowerCase().includes(q)) : all.slice();
  if (!items.length) {
    list.innerHTML = '<li class="muted">' + (all.length ? '无匹配行业' : '暂无行业列表，稍后自动加载') + '</li>';
    return;
  }
  const max = 80;
  list.innerHTML = items
    .slice(0, max)
    .map((name) => '<li role="option" data-value="' + escapeHtml(name) + '">' + escapeHtml(name) + '</li>')
    .join('');
  if (items.length > max) {
    list.innerHTML += '<li class="muted">仅显示前 ' + max + ' 项，请继续输入缩小范围</li>';
  }
}

function openIndustryCombo() {
  const list = $('#industryOptions');
  if (!list) return;
  renderIndustryOptions(readIndustryFilter());
  list.classList.remove('hidden');
  if (!state.industryMarketLoaded) loadIndustries(true).catch(() => {});
  else if (!(state.industries || []).length) loadIndustries(true).catch(() => {});
}

function closeIndustryCombo() {
  const list = $('#industryOptions');
  if (list) list.classList.add('hidden');
}

function bindIndustryCombo() {
  if (state.industryComboBound) return;
  const input = $('#filterIndustry');
  const caret = $('#industryCaret');
  const list = $('#industryOptions');
  const wrap = $('#industryCombo');
  if (!input || !list || !wrap) return;
  state.industryComboBound = true;

  input.addEventListener('focus', () => openIndustryCombo());
  input.addEventListener('input', () => {
    renderIndustryOptions(input.value);
    list.classList.remove('hidden');
  });
  input.addEventListener('keydown', (e) => {
    const visible = [...list.querySelectorAll('li[data-value]')];
    let idx = visible.findIndex((li) => li.classList.contains('active'));
    if (e.key === 'Escape') {
      closeIndustryCombo();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      list.classList.remove('hidden');
      if (!visible.length) return;
      if (idx >= 0) visible[idx].classList.remove('active');
      idx = Math.min(visible.length - 1, idx + 1);
      visible[idx].classList.add('active');
      visible[idx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!visible.length) return;
      if (idx >= 0) visible[idx].classList.remove('active');
      idx = Math.max(0, idx - 1);
      visible[idx].classList.add('active');
      visible[idx].scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (idx >= 0 && visible[idx]) input.value = visible[idx].dataset.value || input.value;
      closeIndustryCombo();
      searchWithFallback().catch(alert);
    }
  });
  if (caret) {
    caret.addEventListener('click', (e) => {
      e.preventDefault();
      if (list.classList.contains('hidden')) {
        openIndustryCombo();
        input.focus();
      } else closeIndustryCombo();
    });
  }
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li[data-value]');
    if (!li) return;
    e.preventDefault();
    input.value = li.dataset.value || '';
    closeIndustryCombo();
    searchWithFallback().catch(alert);
  });
  document.addEventListener('click', (e) => {
    if (!wrap.contains(e.target)) closeIndustryCombo();
  });
}

async function searchWithFallback() {
  const q = $('#filterQ').value.trim();
  const f = readCompoundFilters();
  const canRemote = !!q || hasCompoundFiltersClient(f);

  const local = await loadLocalResult();
  const rows = (local && local.rows) || [];
  if (rows.length) return local;

  // 本地无数据或无命中：有条件则自动远程
  if (!canRemote) return local;
  if (local && local.empty && !q && !f.industry && !hasCompoundFiltersClient({ ...f, industry: '' })) {
    // empty cache and no remoteable filters besides nothing
  }
  setLoading(true, '本地无命中，正在远程搜索…');
  try {
    return await loadRemoteSearch();
  } finally {
    setLoading(false);
  }
}

async function runRemoteFilterAndShow() {
  const f = readCompoundFilters();
  if (!hasCompoundFiltersClient(f)) {
    throw new Error('请先选择行业/盈利阶段/持股集中度/刚摘帽/异动');
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
      industry: f.industry,
    }),
  });
  await pollUntilDone();
  const params = new URLSearchParams();
  if (f.stage) params.set('stage', f.stage);
  if (f.focus) params.set('focus', f.focus);
  if (f.uncapped) params.set('uncapped', f.uncapped);
  if (f.abnormal) params.set('abnormal', f.abnormal);
  if (f.industry) params.set('industry', f.industry);
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
  window.__lastResultRows = data.rows || [];
  renderRows(data.rows);
  setBadge('idle', '远程过滤');
  return data;
}

async function loadLocalResult() {
  const q = $('#filterQ').value.trim();
  const industry = readIndustryFilter();
  const stage = $('#filterStage').value;
  const focus = $('#filterFocus').value;
  const uncapped = $('#filterUncapped').value;
  const abnormal = $('#filterAbnormal').value;

  const params = new URLSearchParams();
  if (q) params.set('q', q);
  if (industry) params.set('industry', industry);
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
    (!(data.rows || []).length ? '（本地无命中）' : '');
  window.__lastResultRows = data.rows || [];
  renderRows(data.rows || []);
  setBadge('idle', '本地搜索');
  if ((data.rows || []).length) loadIndustries(false).catch(() => {}); // refresh after result
  return data;
}

async function loadRemoteSearch() {
  const q = $('#filterQ').value.trim();
  const industry = readIndustryFilter();
  const stage = $('#filterStage').value;
  const focus = $('#filterFocus').value;
  const uncapped = $('#filterUncapped').value;
  const abnormal = $('#filterAbnormal').value;
  const compound = { stage, focus, uncapped, abnormal, industry };

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
      let rows = r ? [r] : [];
      if (industry && rows.length) {
        const key = industry.toLowerCase();
        rows = rows.filter((x) => String(x.industry || '').toLowerCase().includes(key));
        if (!rows.length) {
          $('#stats').textContent =
            '远程搜索: ' +
            (r ? r.code + ' ' + r.name : q) +
            '（行业不匹配：' +
            industry +
            '）';
        }
      }
      window.__lastResultRows = rows;
      renderRows(rows);
      if (rows.length && (data.live || data.lhb)) {
        if (data.liveConfig?.pollIntervalSec) state.liveIntervalSec = data.liveConfig.pollIntervalSec;
        renderLiveBox(data.live, data.lhb);
        if (rows[0]?.code) startLivePoll(rows[0].code);
      } else if (!rows.length) {
        if ($('#liveBox')) $('#liveBox').classList.add('hidden');
        stopLivePoll();
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
    alert('远程搜索请输入名称/代码，或选择行业/盈利阶段/持股集中度/刚摘帽/异动');
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


function planSignalLabel(signal) {
  if (signal === 'buy') return '买入';
  if (signal === 'sell') return '卖出';
  if (signal === 'hold') return '观望';
  return '未分析';
}

function planSignalClass(signal) {
  if (signal === 'buy' || signal === 'sell' || signal === 'hold') return signal;
  return 'none';
}

function toDatetimeLocalValue(v) {
  if (!v) return '';
  let s = String(v).trim().replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s)) return s.slice(0, 16);
  return '';
}

function fromDatetimeLocalValue(v) {
  if (!v) return '';
  return String(v).trim().replace('T', ' ').slice(0, 16);
}

function setPlanStatus(text) {
  const el = $('#planStatus');
  if (el) el.textContent = text || '';
}

function renderPlanTable(rows) {
  const tbody = $('#planTable tbody');
  if (!tbody) return;
  const list = rows || [];
  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="10" class="muted">暂无计划，点击「创建」添加</td></tr>';
    return;
  }
  tbody.innerHTML = list
    .map(function (r) {
      const sig = planSignalClass(r.aiSignal);
      const sigLabel = planSignalLabel(r.aiSignal);
      const reason = r.aiReason || '';
      return (
        '<tr data-id="' +
        r.id +
        '">' +
        '<td><span class="signal-cell"><span class="signal-dot ' +
        sig +
        '"></span>' +
        escapeHtml(sigLabel) +
        '</span></td>' +
        '<td>' +
        escapeHtml(r.code || '') +
        '</td>' +
        '<td>' +
        escapeHtml(r.name || '') +
        '</td>' +
        '<td>' +
        escapeHtml(r.buyPrice == null ? '' : fmt(r.buyPrice, 2)) +
        '</td>' +
        '<td>' +
        escapeHtml(r.buyTime || '') +
        '</td>' +
        '<td>' +
        escapeHtml(r.sellPrice == null ? '' : fmt(r.sellPrice, 2)) +
        '</td>' +
        '<td>' +
        escapeHtml(r.sellTime || '') +
        '</td>' +
        '<td><div class="plan-reason" title="' +
        escapeHtml(reason) +
        '">' +
        escapeHtml(reason) +
        '</div></td>' +
        '<td>' +
        escapeHtml(r.aiAnalyzedAt || '') +
        '</td>' +
        '<td class="plan-actions">' +
        '<button type="button" class="btn btn-secondary btn-sm btn-plan-analyze" data-id="' +
        r.id +
        '">分析</button>' +
        '<button type="button" class="btn btn-secondary btn-sm btn-plan-edit" data-id="' +
        r.id +
        '">编辑</button>' +
        '<button type="button" class="btn btn-secondary btn-sm btn-plan-del" data-id="' +
        r.id +
        '">删除</button>' +
        '</td>' +
        '</tr>'
      );
    })
    .join('');

  tbody.querySelectorAll('.btn-plan-analyze').forEach(function (btn) {
    btn.addEventListener('click', function () {
      analyzePlan(Number(btn.dataset.id)).catch(function (e) {
        alert(e.message);
      });
    });
  });
  tbody.querySelectorAll('.btn-plan-edit').forEach(function (btn) {
    btn.addEventListener('click', function () {
      const id = Number(btn.dataset.id);
      const row = (state.planRows || []).find(function (x) {
        return x.id === id;
      });
      if (row) openPlanModal(row).catch(function (e) { alert(e.message || e); });
    });
  });
  tbody.querySelectorAll('.btn-plan-del').forEach(function (btn) {
    btn.addEventListener('click', function () {
      deletePlan(Number(btn.dataset.id)).catch(function (e) {
        alert(e.message);
      });
    });
  });
}

function applyPlanFilter() {
  const q = ($('#planFilterQ') && $('#planFilterQ').value ? $('#planFilterQ').value : '').trim().toLowerCase();
  const rows = state.planRows || [];
  const filtered = !q
    ? rows
    : rows.filter(function (r) {
        return (
          String(r.code || '')
            .toLowerCase()
            .includes(q) ||
          String(r.name || '')
            .toLowerCase()
            .includes(q)
        );
      });
  renderPlanTable(filtered);
  setPlanStatus('共 ' + rows.length + ' 条计划' + (q ? '，筛选后 ' + filtered.length + ' 条' : ''));
}

async function loadTradePlans() {
  const data = await api('/api/trade-plans');
  state.planRows = data.rows || [];
  applyPlanFilter();
}

function bindPlanModalOnce() {
  if (state.planBound) return;
  // Modals are after <script> historically; do not mark bound until Save exists
  if (!$('#btnPlanSave') || !$('#planForm')) {
    console.warn('[plan] bindPlanModalOnce: DOM not ready, will retry on open');
    return;
  }
  state.planBound = true;
  if ($('#btnPlanClose')) $('#btnPlanClose').addEventListener('click', closePlanModal);
  const bd = $('#planModal') && $('#planModal').querySelector('.modal-backdrop');
  if (bd) bd.addEventListener('click', closePlanModal);
  $('#btnPlanSave').addEventListener('click', function (e) {
    e.preventDefault();
    console.log('[plan] save clicked');
    savePlan().catch(function (err) {
      console.error('[plan] save failed', err);
      alert(err.message || String(err));
    });
  });
  if ($('#planStockQ')) {
    $('#planStockQ').addEventListener('keydown', function (e) {
      if (e.key === 'Enter') {
        e.preventDefault();
        lookupPlanStock().catch(function (err) {
          alert(err.message || String(err));
        });
      }
    });
  }
  $('#planForm').addEventListener('submit', function (e) {
    e.preventDefault();
    console.log('[plan] form submit');
    savePlan().catch(function (err) {
      console.error('[plan] save failed', err);
      alert(err.message || String(err));
    });
  });
}

async function openPlanModal(editRow) {
  bindPlanModalOnce();
  const modal = $('#planModal');
  if (!modal) return;
  $('#planModalTitle').textContent = editRow ? '编辑计划' : '创建计划';
  $('#planEditId').value = editRow ? String(editRow.id) : '';
  if (editRow) {
    state.planResolved = { code: editRow.code, name: editRow.name || '' };
    $('#planStockQ').value = (editRow.code || '') + (editRow.name ? ' ' + editRow.name : '');
    $('#planStockQ').disabled = true;
    $('#planStockHint').textContent = '代码 ' + editRow.code + (editRow.name ? ' · ' + editRow.name : '');
    $('#planBuyPrice').value = editRow.buyPrice == null ? '' : editRow.buyPrice;
    $('#planBuyTime').value = toDatetimeLocalValue(editRow.buyTime);
    $('#planSellPrice').value = editRow.sellPrice == null ? '' : editRow.sellPrice;
    $('#planSellTime').value = toDatetimeLocalValue(editRow.sellTime);
    $('#planNote').value = editRow.note || '';
  } else {
    state.planResolved = null;
    $('#planStockQ').value = '';
    $('#planStockQ').disabled = false;
    $('#planStockHint').textContent = '将自动解析为 6 位代码';
    $('#planBuyPrice').value = '';
    $('#planBuyTime').value = '';
    $('#planSellPrice').value = '';
    $('#planSellTime').value = '';
    $('#planNote').value = '';
  }
  modal.classList.remove('hidden');
  if (editRow && editRow.id) {
    await loadPlanChecks(editRow.id);
  } else {
    await loadPlanChecks(null);
  }
}

function closePlanModal() {
  const modal = $('#planModal');
  if (modal) modal.classList.add('hidden');
  state.planResolved = null;
  if ($('#planStockQ')) $('#planStockQ').disabled = false;
}

async function lookupPlanStock() {
  const q = ($('#planStockQ').value || '').trim();
  if (!q) throw new Error('请输入股票名称或代码');
  const data = await api('/api/stock/lookup?q=' + encodeURIComponent(q));
  const code = (data.resolved && data.resolved.code) || (data.row && data.row.code) || '';
  const name = (data.resolved && data.resolved.name) || (data.row && data.row.name) || '';
  if (!/^\d{6}$/.test(String(code))) throw new Error('未能解析股票代码');
  state.planResolved = { code: String(code), name: name || '' };
  $('#planStockQ').value = code + (name ? ' ' + name : '');
  $('#planStockHint').textContent = '已解析：' + code + (name ? ' · ' + name : '');
  return state.planResolved;
}

async function savePlan() {
  const editId = ($('#planEditId').value || '').trim();
  let resolved = state.planResolved;
  const q = ($('#planStockQ').value || '').trim();
  if (!editId) {
    if (!q) {
      alert('请输入股票名称或代码');
      throw new Error('请输入股票名称或代码');
    }
    if (!resolved || !/^\d{6}$/.test(resolved.code)) {
      resolved = await lookupPlanStock();
    }
  }
  const buyPrice = ($('#planBuyPrice').value || '').trim();
  const sellPrice = ($('#planSellPrice').value || '').trim();
  if (!buyPrice && !sellPrice) {
    alert('请至少填写买入价或卖出价');
    throw new Error('请至少填写买入价或卖出价');
  }
  const code = editId
    ? ((resolved && resolved.code) || ((q.match(/\d{6}/) || [])[0] || ''))
    : (resolved && resolved.code) || '';
  if (!/^\d{6}$/.test(String(code))) {
    alert('未能解析股票代码，请先输入代码/名称并回车检索');
    throw new Error('未能解析股票代码');
  }
  const body = {
    code: String(code),
    name: editId ? (resolved && resolved.name) || '' : (resolved && resolved.name) || '',
    q: q,
    buyPrice: buyPrice === '' ? null : Number(buyPrice),
    buyTime: fromDatetimeLocalValue($('#planBuyTime').value),
    sellPrice: sellPrice === '' ? null : Number(sellPrice),
    sellTime: fromDatetimeLocalValue($('#planSellTime').value),
    note: ($('#planNote').value || '').trim(),
  };
  if (buyPrice !== '' && !Number.isFinite(body.buyPrice)) {
    alert('买入价格式无效');
    throw new Error('买入价格式无效');
  }
  if (sellPrice !== '' && !Number.isFinite(body.sellPrice)) {
    alert('卖出价格式无效');
    throw new Error('卖出价格式无效');
  }
  console.log('[plan] calling API', editId ? 'PUT' : 'POST', body);
  let savedId = editId ? Number(editId) : null;
  if (editId) {
    await api('/api/trade-plans/' + encodeURIComponent(editId), {
      method: 'PUT',
      body: JSON.stringify(body),
    });
    await savePlanChecks(savedId);
  } else {
    const created = await api('/api/trade-plans', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    savedId = created && created.plan && created.plan.id ? created.plan.id : null;
    if (savedId) await savePlanChecks(savedId);
  }
  closePlanModal();
  await loadTradePlans();
  setPlanStatus(editId ? '计划已更新' : '计划已创建');
}

async function deletePlan(id) {
  if (!confirm('确认删除该计划？')) return;
  await api('/api/trade-plans/' + encodeURIComponent(id), { method: 'DELETE' });
  await loadTradePlans();
  setPlanStatus('已删除计划 #' + id);
}

async function analyzePlan(id) {
  if (state.planAnalyzing) return;
  state.planAnalyzing = true;
  setPlanStatus('正在分析计划 #' + id + '…');
  try {
    const data = await api('/api/trade-plans/' + encodeURIComponent(id) + '/analyze', {
      method: 'POST',
      body: JSON.stringify({ days: 5 }),
    });
    await loadTradePlans();
    const label = planSignalLabel(data.signal);
    setPlanStatus('分析完成：' + label + (data.plan && data.plan.code ? ' · ' + data.plan.code : ''));
  } finally {
    state.planAnalyzing = false;
  }
}

async function analyzeAllPlans() {
  if (state.planAnalyzing) return;
  if (!(state.planRows || []).length) {
    await loadTradePlans();
  }
  if (!(state.planRows || []).length) {
    alert('暂无计划可分析');
    return;
  }
  if (!confirm('确认对全部 ' + state.planRows.length + ' 条计划依次分析？可能耗时较长。')) return;
  state.planAnalyzing = true;
  const btn = $('#btnPlanAnalyzeAll');
  if (btn) btn.disabled = true;
  setPlanStatus('正在全部分析…');
  try {
    const data = await api('/api/trade-plans/analyze-all', {
      method: 'POST',
      body: JSON.stringify({ days: 5 }),
    });
    await loadTradePlans();
    setPlanStatus(
      '全部分析完成：成功 ' +
        (data.okCount || 0) +
        ' / ' +
        (data.total || 0) +
        '，失败 ' +
        (data.failCount || 0)
    );
  } finally {
    state.planAnalyzing = false;
    if (btn) btn.disabled = false;
  }
}

async function init() {
  document.querySelectorAll('.tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      showTab(btn.dataset.tab);
      if (btn.dataset.tab === 'live') loadLiveWatchlist().catch(alert);
      if (btn.dataset.tab === 'favorites') loadFavorites().catch(alert);
      if (btn.dataset.tab === 'plans') loadTradePlans().catch(alert);
    });
  });
  bindIndustryCombo();
  $('#btnFilter').addEventListener('click', () => searchWithFallback().catch(alert));
  loadIndustries(false).catch(() => {});
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
  if ($('#btnFavFilter')) {
    $('#btnFavFilter').addEventListener('click', () => {
      if (!(state.favRows || []).length) loadFavorites().catch(alert);
      else applyFavFilter();
    });
  }
  if ($('#favFilterQ')) {
    $('#favFilterQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (!(state.favRows || []).length) loadFavorites().catch(alert);
        else applyFavFilter();
      }
    });
    $('#favFilterQ').addEventListener('input', () => {
      if ((state.favRows || []).length) applyFavFilter();
    });
  }
  if ($('#btnFavRefresh')) {
    $('#btnFavRefresh').addEventListener('click', () => loadFavorites().catch(alert));
  }
  if ($('#btnPlanFilter')) {
    $('#btnPlanFilter').addEventListener('click', () => {
      if (!(state.planRows || []).length) loadTradePlans().catch(alert);
      else applyPlanFilter();
    });
  }
  if ($('#planFilterQ')) {
    $('#planFilterQ').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        if (!(state.planRows || []).length) loadTradePlans().catch(alert);
        else applyPlanFilter();
      }
    });
    $('#planFilterQ').addEventListener('input', () => {
      if ((state.planRows || []).length) applyPlanFilter();
    });
  }
  if ($('#btnPlanCreate')) {
    $('#btnPlanCreate').addEventListener('click', () => openPlanModal(null).catch(function (e) { alert(e.message || e); }));
  }
  if ($('#btnPlanRefresh')) {
    $('#btnPlanRefresh').addEventListener('click', () => loadTradePlans().catch(alert));
  }
  if ($('#btnPlanAnalyzeAll')) {
    $('#btnPlanAnalyzeAll').addEventListener('click', () => analyzeAllPlans().catch(alert));
  }
  bindPlanModalOnce();
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

  await loadFavoriteCodes();
  await loadAiConfig();
  bindAiModalEvents();
  const cfg = await api('/api/config');
  fillConfigForm(cfg.config);
  if (cfg.liveConfig?.pollIntervalSec) state.liveIntervalSec = cfg.liveConfig.pollIntervalSec;
  startLiveListAutoRefresh();
  loadLiveWatchlist().catch(function () {});
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
