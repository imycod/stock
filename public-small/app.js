const $ = (s) => document.querySelector(s);

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
      return `<tr>
        <td>${escapeHtml(r.code)}</td>
        <td>${escapeHtml(r.name)}</td>
        <td class="${stageCls}">${escapeHtml(r.profitStage)}</td>
        <td>${escapeHtml(r.holdFocus)}</td>
        <td>${r.holderNum ?? ''}</td>
        <td>${fmt(r.top10Ratio, 1)}</td>
        <td>${fmt(r.marketCapYi)}</td>
        <td>${fmt(r.totalSharesYi)}</td>
        <td class="clip" title="${escapeHtml(r.financeSummary)}">${escapeHtml(r.financeSummary)}</td>
        <td class="clip" title="${escapeHtml(r.mainProducts)}">${escapeHtml(r.mainProducts)}</td>
        <td class="clip" title="${escapeHtml(r.partners)}">${escapeHtml(r.partners)}</td>
        <td class="${r.isST ? 'st-yes' : ''}">${r.isST ? escapeHtml(r.stType || '是') : ''}</td>
        <td>${escapeHtml(r.stDate)}</td>
        <td class="clip" title="${escapeHtml(r.stReason)}">${escapeHtml(r.stReason)}</td>
        <td class="clip" title="${escapeHtml(r.stRemoveEstimate)}">${escapeHtml(r.stRemoveEstimate)}</td>
      </tr>`;
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
    `共 ${data.total}/${data.allTotal} 只 · 生成于 ${new Date(data.generatedAt).toLocaleString('zh-CN')} · ST ${st.stCount || 0} · ${stages}`;
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
          p.total > 0 ? ` ${p.done || 0}/${p.total}` : '';
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
