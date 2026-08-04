const { loadEnv } = require('./loadEnv');
loadEnv();
const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { DEFAULTS, YI, runScreen, lookupStock, remoteFilter, hasCompoundFilters, fetchMainBoardList } = require('./exportSmall');
const smallDb = require('./storage/smallDatabase');
const smallCollector = require('./smallCollector');
const { stockFromParts } = require('./stocks');
const { publicAiConfig, chatCompletions } = require('./ai/zhipu');
const { buildSnapshotContext, systemPrompt } = require('./ai/analyzeContext');

const PORT = Number(process.env.SMALL_PORT || config.smallPort || 3010);
const RUNTIME_PATH = path.join(__dirname, '..', 'data', 'exportSmall.runtime.json');
const RESULT_PATH = path.join(__dirname, '..', 'data', 'exports', 'small-screen-latest.json');
const FILTER_RESULT_PATH = path.join(__dirname, '..', 'data', 'exports', 'small-remote-filter-latest.json');

const app = express();
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, '..', 'public-small')));

let job = {
  status: 'idle', // idle | running | done | error
  progress: { stage: '', message: '', done: 0, total: 0 },
  error: null,
  startedAt: null,
  finishedAt: null,
};
let lastResult = null;
let lastFilterResult = null;
let runningPromise = null;
let jobKind = 'screen'; // screen | remote-filter

function loadRuntimeConfig() {
  const base = { ...DEFAULTS, ...(config.exportSmall || {}) };
  try {
    if (fs.existsSync(RUNTIME_PATH)) {
      const raw = JSON.parse(fs.readFileSync(RUNTIME_PATH, 'utf8'));
      return { ...base, ...raw };
    }
  } catch {
    /* ignore */
  }
  return base;
}

function saveRuntimeConfig(cfg) {
  fs.mkdirSync(path.dirname(RUNTIME_PATH), { recursive: true });
  const toSave = {
    maxTotalShares: Number(cfg.maxTotalShares),
    maxMarketCap: Number(cfg.maxMarketCap),
    maxHolders: Number(cfg.maxHolders),
    minTop10Ratio: Number(cfg.minTop10Ratio),
    volumeExpandRatio: Number(cfg.volumeExpandRatio),
    maxPriceVsYearAvg: Number(cfg.maxPriceVsYearAvg),
    maxPriceVsYearLow: Number(cfg.maxPriceVsYearLow),
    includeST: cfg.includeST !== false,
    turnoverJumpTo: Number(cfg.turnoverJumpTo ?? DEFAULTS.turnoverJumpTo),
  };
  fs.writeFileSync(RUNTIME_PATH, JSON.stringify(toSave, null, 2), 'utf8');
  return toSave;
}

function publicConfig(cfg) {
  return {
    maxTotalSharesYi: cfg.maxTotalShares / YI,
    maxMarketCapYi: cfg.maxMarketCap / YI,
    maxHolders: cfg.maxHolders,
    minTop10Ratio: cfg.minTop10Ratio,
    volumeExpandRatio: cfg.volumeExpandRatio,
    maxPriceVsYearAvg: cfg.maxPriceVsYearAvg,
    maxPriceVsYearLow: cfg.maxPriceVsYearLow,
    includeST: cfg.includeST !== false,
    turnoverJumpTo: cfg.turnoverJumpTo ?? DEFAULTS.turnoverJumpTo,
  };
}

function fromPublicConfig(body) {
  return {
    maxTotalShares: Number(body.maxTotalSharesYi) * YI,
    maxMarketCap: Number(body.maxMarketCapYi) * YI,
    maxHolders: Number(body.maxHolders),
    minTop10Ratio: Number(body.minTop10Ratio),
    volumeExpandRatio: Number(body.volumeExpandRatio),
    maxPriceVsYearAvg: Number(body.maxPriceVsYearAvg),
    maxPriceVsYearLow: Number(body.maxPriceVsYearLow),
    includeST: body.includeST !== false && body.includeST !== 'false',
    turnoverJumpTo: Number(body.turnoverJumpTo ?? DEFAULTS.turnoverJumpTo),
  };
}

function loadCachedResult() {
  try {
    if (fs.existsSync(RESULT_PATH)) {
      lastResult = JSON.parse(fs.readFileSync(RESULT_PATH, 'utf8'));
    }
  } catch {
    lastResult = null;
  }
}

function persistResult(result) {
  fs.mkdirSync(path.dirname(RESULT_PATH), { recursive: true });
  fs.writeFileSync(RESULT_PATH, JSON.stringify(result), 'utf8');
}

function persistFilterResult(result) {
  fs.mkdirSync(path.dirname(FILTER_RESULT_PATH), { recursive: true });
  fs.writeFileSync(FILTER_RESULT_PATH, JSON.stringify(result), 'utf8');
}

function loadCachedFilterResult() {
  try {
    if (fs.existsSync(FILTER_RESULT_PATH)) {
      lastFilterResult = JSON.parse(fs.readFileSync(FILTER_RESULT_PATH, 'utf8'));
    }
  } catch {
    lastFilterResult = null;
  }
}

function mapRow(r) {
  return {
    code: r.code,
    name: r.name,
    industry: r.industry || '',
    price: r.price,
    pctChange: r.pctChange,
    marketCapYi: r.marketCap != null ? +(r.marketCap / YI).toFixed(2) : null,
    totalSharesYi: r.totalShares != null ? +(r.totalShares / YI).toFixed(2) : null,
    floatCapYi: r.floatCap != null ? +(r.floatCap / YI).toFixed(2) : null,
    holderNum: r.holderNum,
    top10Ratio: r.top10Ratio,
    holdFocus: r.holdFocus || '',
    turnoverRate: r.turnoverRate,
    volumeRatio: r.volumeRatio,
    volExpand5: r.volExpand5,
    volExpand10: r.volExpand10,
    profitStage: r.profitStage || '',
    financeSummary: r.financeSummary || '',
    revenue1: r.revenue1,
    profit1: r.profit1,
    profit0: r.profit0,
    mainProducts: r.mainProducts || '',
    partners: r.partners || '',
    businessBrief: r.businessBrief || '',
    employeeNum: r.employeeNum ?? null,
    province: r.province || '',
    outboundInvest: r.outboundInvest || '',
    isST: !!r.isST,
    stType: r.stType || '',
    stDate: r.stDate || '',
    stReason: r.stReason || '',
    stRemoveEstimate: r.stRemoveEstimate || '',
    justUncapped: !!r.justUncapped,
    uncapLabel: r.justUncapped ? '刚摘帽' : r.uncapDate ? '曾摘帽' : '',
    uncapDate: r.uncapDate || '',
    uncapTitle: r.uncapTitle || '',
    hasAbnormal: !!r.hasAbnormal,
    abnormalCount: r.abnormalCount || 0,
    lastAbnormalDate: r.lastAbnormalDate || '',
    abnormalSummary: r.abnormalSummary || '',
    reasons: r.reasons || '',
  };
}


function trackScreenRows(rows) {
  if (!Array.isArray(rows)) return 0;
  let n = 0;
  for (const r of rows) {
    if (!r?.code) continue;
    try {
      smallCollector.ensureWatch(stockFromParts(r.code, r.name), 'screen');
      n++;
    } catch {
      /* ignore */
    }
  }
  return n;
}

function publicLiveConfig() {
  const o = smallCollector.liveOpts();
  return {
    pollIntervalSec: o.pollIntervalSec,
    maxWatchlist: o.maxWatchlist,
    lhbSyncIntervalMin: o.lhbSyncIntervalMin,
    collectOutsideHours: o.collectOutsideHours,
    dbPath: smallDb.dbPath(),
  };
}


async function startRemoteFilter(filters) {
  if (job.status === 'running') {
    return { ok: false, error: 'busy' };
  }
  if (!hasCompoundFilters(filters || {})) {
    return { ok: false, error: '需要至少一个复合条件' };
  }
  jobKind = 'remote-filter';
  job = {
    status: 'running',
    progress: { stage: 'start', message: '开始远程复合过滤', done: 0, total: 0 },
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  const cfg = loadRuntimeConfig();
  runningPromise = (async () => {
    try {
      const result = await remoteFilter(
        {
          ...filters,
          includeST: cfg.includeST !== false,
          maxResults: Number(filters.maxResults || DEFAULTS.remoteMaxResults || 80),
        },
        (stage, payload = {}) => {
          job.progress = {
            stage,
            message: payload.message || stage,
            done: payload.done || 0,
            total: payload.total || payload.matched || 0,
          };
        }
      );
      lastFilterResult = {
        ...result,
        market: result.market || null,
        rows: result.rows.map(mapRow),
      };
      persistFilterResult(lastFilterResult);
      try {
        trackScreenRows(lastFilterResult.rows);
      } catch (e) {
        console.warn('[small-live] track filter failed:', e.message || e);
      }
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      job.progress = {
        stage: 'done',
        message: '远程过滤完成 ' + lastFilterResult.rows.length + ' 只',
        done: lastFilterResult.rows.length,
        total: lastFilterResult.rows.length,
      };
    } catch (e) {
      job.status = 'error';
      job.error = e.message || String(e);
      job.finishedAt = new Date().toISOString();
    } finally {
      runningPromise = null;
    }
  })();

  return { ok: true };
}

async function startScreen(opts) {
  if (job.status === 'running') {
    return { ok: false, error: 'busy' };
  }
  job = {
    status: 'running',
    progress: { stage: 'start', message: '开始筛选', done: 0, total: 0 },
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null,
  };

  runningPromise = (async () => {
    try {
      const result = await runScreen(opts, (stage, payload = {}) => {
        job.progress = {
          stage,
          message: payload.message || stage,
          done: payload.done || 0,
          total: payload.total || payload.matched || 0,
        };
      });
      lastResult = {
        ...result,
        market: result.market || null,
        rows: result.rows.map(mapRow),
      };
      persistResult(lastResult);
      try {
        trackScreenRows(lastResult.rows);
      } catch (e) {
        console.warn('[small-live] track screen failed:', e.message || e);
      }
      job.status = 'done';
      job.finishedAt = new Date().toISOString();
      job.progress = {
        stage: 'done',
        message: `完成 ${lastResult.rows.length} 只`,
        done: lastResult.rows.length,
        total: lastResult.rows.length,
      };
    } catch (e) {
      job.status = 'error';
      job.error = e.message || String(e);
      job.finishedAt = new Date().toISOString();
    } finally {
      runningPromise = null;
    }
  })();

  return { ok: true };
}

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, port: PORT, service: 'small-screen' });
});

app.get('/api/config', (_req, res) => {
  res.json({ ok: true, config: publicConfig(loadRuntimeConfig()) });
});

app.post('/api/config', async (req, res) => {
  try {
    const next = fromPublicConfig(req.body || {});
    const saved = saveRuntimeConfig(next);
    const runNow = req.body?.run !== false;
    let run = null;
    if (runNow) {
      run = await startScreen({ ...saved, includeST: saved.includeST !== false });
    }
    res.json({
      ok: true,
      config: publicConfig(saved),
      run,
      job: { status: job.status, progress: job.progress },
    });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/screen/run', async (req, res) => {
  const cfg = loadRuntimeConfig();
  const merged = {
    ...cfg,
    ...(req.body && Object.keys(req.body).length ? fromPublicConfig(req.body) : {}),
  };
  // web 默认包含 ST
  if (merged.includeST == null) merged.includeST = true;
  const run = await startScreen(merged);
  if (!run.ok) return res.status(409).json({ ok: false, error: '筛选进行中，请稍后' });
  res.json({ ok: true, job: { status: job.status, progress: job.progress } });
});

app.get('/api/screen/status', (_req, res) => {
  res.json({
    ok: true,
    job: {
      status: job.status,
      kind: jobKind,
      progress: job.progress,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
    hasResult: !!lastResult,
    resultCount: lastResult?.rows?.length || 0,
    hasFilterResult: !!lastFilterResult,
    filterResultCount: lastFilterResult?.rows?.length || 0,
  });
});



app.post('/api/screen/remote-filter', async (req, res) => {
  const body = req.body || {};
  const filters = {
    stage: String(body.stage || '').trim(),
    focus: String(body.focus || '').trim(),
    uncapped: body.uncapped,
    abnormal: body.abnormal,
    industry: String(body.industry || '').trim(),
    maxResults: body.maxResults,
  };
  if (!hasCompoundFilters(filters)) {
    return res.status(400).json({ ok: false, error: '请至少选择行业/盈利阶段/持股集中度/刚摘帽/异动之一' });
  }
  const run = await startRemoteFilter(filters);
  if (!run.ok) {
    return res.status(run.error === 'busy' ? 409 : 400).json({
      ok: false,
      error: run.error === 'busy' ? '任务进行中，请稍后' : run.error,
    });
  }
  res.json({ ok: true, job: { status: job.status, kind: jobKind, progress: job.progress } });
});

app.get('/api/screen/remote-result', (req, res) => {
  if (!lastFilterResult) {
    return res.json({ ok: true, empty: true, source: 'remote-filter', rows: [], stats: null });
  }
  let rows = lastFilterResult.rows || [];
  const stage = String(req.query.stage || '').trim();
  const focus = String(req.query.focus || '').trim();
  const uncapped = String(req.query.uncapped || '').trim();
  const abnormal = String(req.query.abnormal || '').trim();
  const industry = String(req.query.industry || '').trim().toLowerCase();
  if (stage) rows = rows.filter((r) => r.profitStage === stage);
  if (focus) rows = rows.filter((r) => r.holdFocus === focus);
  if (uncapped === '1' || uncapped === 'true') rows = rows.filter((r) => r.justUncapped);
  if (abnormal === '1' || abnormal === 'true') rows = rows.filter((r) => r.hasAbnormal);
  if (industry) {
    rows = rows.filter((r) => String(r.industry || '').toLowerCase().includes(industry));
  }
  res.json({
    ok: true,
    empty: false,
    source: 'remote-filter',
    generatedAt: lastFilterResult.generatedAt,
    stats: lastFilterResult.stats,
    market: lastFilterResult.market || null,
    filters: lastFilterResult.filters || null,
    rows,
    total: rows.length,
    allTotal: (lastFilterResult.rows || []).length,
  });
});

app.get('/api/stock/lookup', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (!q) {
    return res.status(400).json({ ok: false, error: '请输入股票代码或名称' });
  }
  try {
    const { row, market, resolved } = await lookupStock(q);
    const mapped = mapRow(row);
    let live = null;
    let lhb = [];
    try {
      const watched = await smallCollector.watchAndCollect(
        stockFromParts(mapped.code, mapped.name),
        'lookup'
      );
      live = watched.live || null;
      smallDb.upsertFundamentals(mapped.code, mapped.name, mapped);
      lhb = smallDb.getLhbRecords(mapped.code, 5).map((r) => ({
        tradeDate: r.trade_date,
        reason: r.reason,
        netAmount: r.net_amount,
        buyAmount: r.buy_amount,
        sellAmount: r.sell_amount,
        pctChange: r.pct_change,
      }));
    } catch (e) {
      console.warn('[small-live] lookup collect failed:', e.message || e);
    }
    res.json({
      ok: true,
      source: 'remote',
      query: q,
      resolved,
      market: market || null,
      row: mapped,
      rows: [mapped],
      live,
      lhb,
      liveConfig: publicLiveConfig(),
    });
  } catch (e) {
    res.status(404).json({ ok: false, error: e.message || String(e) });
  }
});


let marketIndustryCache = { at: 0, list: [] };

function collectIndustriesFromRows(rows, set) {
  for (const r of rows || []) {
    const ind = String(r.industry || '').trim();
    if (ind) set.add(ind);
  }
}

app.get('/api/screen/industries', async (req, res) => {
  try {
    const set = new Set();
    collectIndustriesFromRows(lastResult && lastResult.rows, set);
    collectIndustriesFromRows(lastFilterResult && lastFilterResult.rows, set);

    const wantMarket =
      req.query.market === '1' ||
      req.query.market === 'true';

    if (wantMarket) {
      const fresh = Date.now() - marketIndustryCache.at < 60 * 60 * 1000;
      if (fresh && marketIndustryCache.list.length) {
        for (const x of marketIndustryCache.list) set.add(x);
      } else {
        const all = await fetchMainBoardList(false);
        const list = [];
        const mset = new Set();
        for (const r of all) {
          const ind = String(r.industry || '').trim();
          if (ind && !mset.has(ind)) {
            mset.add(ind);
            list.push(ind);
          }
        }
        list.sort((a, b) => a.localeCompare(b, 'zh-CN'));
        marketIndustryCache = { at: Date.now(), list };
        for (const x of list) set.add(x);
      }
    }

    const industries = [...set].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    res.json({
      ok: true,
      industries,
      source: wantMarket ? 'mixed' : 'cache',
      count: industries.length,
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.get('/api/screen/result', (req, res) => {
  if (!lastResult) {
    const compoundEmpty = {
      stage: String(req.query.stage || '').trim(),
      focus: String(req.query.focus || '').trim(),
      uncapped: String(req.query.uncapped || '').trim(),
      abnormal: String(req.query.abnormal || '').trim(),
      industry: String(req.query.industry || '').trim(),
    };
    return res.json({
      ok: true,
      empty: true,
      source: 'cache',
      rows: [],
      stats: null,
      opts: publicConfig(loadRuntimeConfig()),
      suggestRemote: hasCompoundFilters(compoundEmpty),
      compound: compoundEmpty,
    });
  }
  const q = String(req.query.q || '').trim().toLowerCase();
  const industry = String(req.query.industry || '').trim().toLowerCase();
  const stage = String(req.query.stage || '').trim();
  const focus = String(req.query.focus || '').trim();
  const uncapped = String(req.query.uncapped || '').trim();
  const abnormal = String(req.query.abnormal || '').trim();
  let rows = lastResult.rows;
  if (q) {
    rows = rows.filter(
      (r) =>
        String(r.code).includes(q) ||
        String(r.name).toLowerCase().includes(q)
    );
  }
  if (industry) {
    rows = rows.filter((r) => String(r.industry || '').toLowerCase().includes(industry));
  }
  if (stage) rows = rows.filter((r) => r.profitStage === stage);
  if (focus) rows = rows.filter((r) => r.holdFocus === focus);
  if (uncapped === '1' || uncapped === 'true') rows = rows.filter((r) => r.justUncapped);
  if (abnormal === '1' || abnormal === 'true') rows = rows.filter((r) => r.hasAbnormal);
  rows = rows.map((r) => ({
    ...r,
    uncapLabel: r.uncapLabel || (r.justUncapped ? '刚摘帽' : r.uncapDate ? '曾摘帽' : ''),
  }));

  const compound = {
    stage,
    focus,
    uncapped: uncapped === '1' || uncapped === 'true',
    abnormal: abnormal === '1' || abnormal === 'true',
  };
  res.json({
    ok: true,
    empty: false,
    source: 'cache',
    generatedAt: lastResult.generatedAt,
    stats: lastResult.stats,
    market: lastResult.market || null,
    opts: publicConfig(lastResult.opts || loadRuntimeConfig()),
    rows,
    total: rows.length,
    allTotal: lastResult.rows.length,
    suggestRemote: rows.length === 0 && hasCompoundFilters(compound),
    compound,
  });
});



app.get('/api/favorites', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = smallDb.getFavorites(q);
    res.json({ ok: true, rows, total: rows.length, codes: smallDb.getFavoriteCodes() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.get('/api/favorites/codes', (_req, res) => {
  try {
    res.json({ ok: true, codes: smallDb.getFavoriteCodes() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/favorites', (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无效股票代码' });
    }
    const name = body.name || body.row?.name || '';
    const payload = body.row || body.payload || { code, name };
    smallDb.upsertFavorite({ code, name, note: body.note || '', payload });
    // 顺带纳入实时监控，便于后续采集
    try {
      smallCollector.ensureWatch(stockFromParts(code, name), 'favorite');
    } catch {
      /* ignore */
    }
    res.json({ ok: true, codes: smallDb.getFavoriteCodes(), favorite: smallDb.getFavorite(code) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.delete('/api/favorites/:code', (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    smallDb.removeFavorite(code);
    res.json({ ok: true, codes: smallDb.getFavoriteCodes() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.put('/api/favorites/reorder', (req, res) => {
  try {
    const codes = Array.isArray(req.body?.codes) ? req.body.codes.map((c) => String(c).trim()) : [];
    if (!codes.length) {
      return res.status(400).json({ ok: false, error: '缺少排序列表' });
    }
    if (!codes.every((c) => /^\d{6}$/.test(c))) {
      return res.status(400).json({ ok: false, error: '无效代码列表' });
    }
    const rows = smallDb.reorderFavorites(codes);
    res.json({ ok: true, rows, total: rows.length, codes: smallDb.getFavoriteCodes() });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

function todayShanghai() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date());
}

function tomorrowShanghai() {
  const today = todayShanghai();
  const [y, m, d] = today.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + 1);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function normalizePredictionOk(v) {
  if (v === true || v === 1 || v === '1' || v === 'true') return 1;
  if (v === false || v === 0 || v === '0' || v === 'false') return 0;
  if (v == null || v === '' || v === 'unset') return null;
  return null;
}

function normalizeDayMove(v) {
  if (v == null || v === '') return null;
  const s = String(v);
  if (s === 'up' || s === 'down' || s === 'flat') return s;
  return null;
}

app.get('/api/remarks', (req, res) => {
  try {
    const code = String(req.query.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无效股票代码' });
    }
    const today = todayShanghai();
    const rows = smallDb.getDailyRemarks(code);
    res.json({ ok: true, today, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/remarks', (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无效股票代码' });
    }
    const tradeDate = String(body.tradeDate || todayShanghai()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      return res.status(400).json({ ok: false, error: '无效日期' });
    }
    const predictionOk = normalizePredictionOk(body.predictionOk);
    const dayMove = normalizeDayMove(body.dayMove);
    const content = body.content == null ? '' : String(body.content);
    const isEmpty = !content.trim() && predictionOk == null && dayMove == null;
    if (isEmpty) {
      smallDb.deleteDailyRemark(code, tradeDate);
      return res.json({ ok: true, row: null, rows: smallDb.getDailyRemarks(code) });
    }
    const row = smallDb.upsertDailyRemark({
      code,
      tradeDate,
      content,
      predictionOk,
      dayMove,
    });
    const rows = smallDb.getDailyRemarks(code);
    res.json({ ok: true, row, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.delete('/api/remarks/:code/:date', (req, res) => {
  try {
    const code = String(req.params.code || '').trim();
    const tradeDate = String(req.params.date || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无效股票代码' });
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) {
      return res.status(400).json({ ok: false, error: '无效日期' });
    }
    smallDb.deleteDailyRemark(code, tradeDate);
    res.json({ ok: true, rows: smallDb.getDailyRemarks(code) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});


app.get('/api/ai/config', (_req, res) => {
  res.json({ ok: true, ...publicAiConfig() });
});

app.post('/api/ai/chat', async (req, res) => {
  try {
    const body = req.body || {};
    const code = String(body.code || '').trim();
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无效股票代码' });
    }
    const days = body.days;
    const question = String(body.question || body.prompt || '').trim();
    if (!question) {
      return res.status(400).json({ ok: false, error: '请输入分析问题' });
    }
    const history = Array.isArray(body.messages) ? body.messages : [];
    const ctx = buildSnapshotContext(code, days);
    if (!ctx.meta.rowCount) {
      return res.status(400).json({
        ok: false,
        error: '该股票暂无分钟快照，请先纳入实时监控并等待采集',
        meta: ctx.meta,
      });
    }

    const messages = [
      { role: 'system', content: systemPrompt() },
      {
        role: 'user',
        content:
          '以下是供分析的分钟快照数据（CSV）。后续问题都基于这份数据，除非用户更换天数后重新发送。\n\n' +
          ctx.text,
      },
      {
        role: 'assistant',
        content:
          '已收到 ' +
          ctx.meta.code +
          ' ' +
          ctx.meta.name +
          ' 近 ' +
          ctx.meta.days +
          ' 日共 ' +
          ctx.meta.rowCount +
          ' 条分钟数据。请提出你的分析问题。',
      },
    ];

    for (const m of history.slice(-12)) {
      const role = m.role === 'assistant' ? 'assistant' : 'user';
      const content = String(m.content || '').trim();
      if (!content) continue;
      messages.push({ role, content });
    }
    messages.push({ role: 'user', content: question });

    const result = await chatCompletions({ messages });
    res.json({
      ok: true,
      answer: result.content,
      reasoning: result.reasoning || '',
      model: result.model,
      usage: result.usage,
      meta: ctx.meta,
    });
  } catch (e) {
    const status = e.code === 'AI_NOT_CONFIGURED' ? 503 : 500;
    res.status(status).json({ ok: false, error: e.message || String(e) });
  }
});


const PLAN_SYSTEM = [
  '你是一名 A 股分时与主力资金研究助手。',
  '根据提供的分钟快照与资金流数据，判断主力是吸筹、出货还是不明确。',
  '必须给出明确建议：买入 / 卖出 / 观望 三者之一。',
  '规则：主力吸筹→买入；主力出货→卖出；无明显方向或矛盾→观望。',
  '输出格式严格如下（不要省略标记行）：',
  '信号: 买入|卖出|观望',
  '理由: （2-5句中文，引用关键价量与资金现象）',
  '仅供研究参考，不构成投资建议。',
].join('');

function shanghaiNowLocal() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function parsePlanSignal(answer) {
  const text = String(answer || '');
  let signal = 'hold';
  const m = text.match(/信号\s*[:：]\s*(买入|卖出|观望)/);
  if (m) {
    signal = m[1] === '买入' ? 'buy' : m[1] === '卖出' ? 'sell' : 'hold';
  } else if (/建议买入|可以买入|吸筹/.test(text) && !/出货|建议卖出/.test(text)) {
    signal = 'buy';
  } else if (/建议卖出|可以卖出|出货/.test(text) && !/吸筹|建议买入/.test(text)) {
    signal = 'sell';
  }
  return signal;
}

function normalizePlanDateTime(v) {
  if (v == null || v === '') return null;
  let s = String(v).trim().replace('T', ' ');
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(s)) return s.slice(0, 16);
  return s;
}

function parseOptionalPrice(v) {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function analyzeTradePlanById(id, days) {
  const plan = smallDb.getTradePlan(id);
  if (!plan) {
    const err = new Error('计划不存在');
    err.status = 404;
    throw err;
  }
  const code = String(plan.code || '').trim();
  if (!/^\d{6}$/.test(code)) {
    const err = new Error('计划股票代码无效');
    err.status = 400;
    throw err;
  }
  try {
    smallCollector.ensureWatch(stockFromParts(code, plan.name || ''), 'plan');
  } catch {
    /* ignore */
  }

  let ctx = buildSnapshotContext(code, days || 5);
  if (!ctx.meta.rowCount) {
    try {
      const w = smallDb.getWatchlistStock(code) || stockFromParts(code, plan.name || '');
      await smallCollector.collectOnce(w, { force: true, withDepth: true, withLhb: true });
      ctx = buildSnapshotContext(code, days || 5);
    } catch (e) {
      console.warn('[trade-plan] collectOnce failed:', e.message || e);
    }
  }
  if (!ctx.meta.rowCount) {
    const err = new Error('该股票暂无分钟快照，请先纳入实时监控并等待采集');
    err.status = 400;
    err.meta = ctx.meta;
    throw err;
  }

  const question = [
    '请根据分钟快照与资金流，判断主力是吸筹、出货还是不明确，并给出买入/卖出/观望建议。',
    `计划标的：${plan.code} ${plan.name || ''}`,
    `浮动买入价格：${plan.buyPrice == null ? '未设' : plan.buyPrice}`,
    `买入时间：${plan.buyTime || '未设'}`,
    `浮动卖出价格：${plan.sellPrice == null ? '未设' : plan.sellPrice}`,
    `卖出时间：${plan.sellTime || '未设'}`,
    plan.note ? `备注：${plan.note}` : '',
    '请严格按指定格式输出。',
  ]
    .filter(Boolean)
    .join('\n');

  const messages = [
    { role: 'system', content: PLAN_SYSTEM },
    {
      role: 'user',
      content:
        '以下是供分析的分钟快照数据（CSV）。请基于这份数据完成计划买卖分析。\n\n' +
        ctx.text,
    },
    { role: 'user', content: question },
  ];

  const result = await chatCompletions({ messages });
  const answer = result.content || '';
  const signal = parsePlanSignal(answer);
  const reasonMatch = String(answer).match(/理由\s*[:：]\s*([\s\S]*?)(?:\n仅供研究参考|$)/);
  const aiReason = (reasonMatch ? reasonMatch[1] : answer).trim().slice(0, 2000);
  const aiAnalyzedAt = shanghaiNowLocal();
  const updated = smallDb.updateTradePlanAi(id, {
    aiSignal: signal,
    aiReason,
    aiAnalyzedAt,
  });
  return {
    ok: true,
    plan: updated,
    answer,
    signal,
    reasoning: result.reasoning || '',
    model: result.model,
    usage: result.usage,
    meta: ctx.meta,
  };
}

app.get('/api/trade-plans', (req, res) => {
  try {
    const q = String(req.query.q || '').trim();
    const rows = smallDb.getTradePlans(q);
    res.json({ ok: true, rows, total: rows.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/trade-plans', async (req, res) => {
  try {
    const body = req.body || {};
    let code = String(body.code || '').trim();
    let name = body.name == null ? '' : String(body.name);
    const q = String(body.q || '').trim();
    if (!/^\d{6}$/.test(code)) {
      if (!q && !code) {
        return res.status(400).json({ ok: false, error: '请填写股票名称或代码' });
      }
      const looked = await lookupStock(q || code);
      code = String(looked?.resolved?.code || looked?.row?.code || looked?.row?.f12 || '').trim();
      if (!name) {
        name = String(looked?.resolved?.name || looked?.row?.name || looked?.row?.f14 || '');
      }
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无法解析股票代码' });
    }
    const buyPrice = parseOptionalPrice(body.buyPrice);
    const sellPrice = parseOptionalPrice(body.sellPrice);
    if (buyPrice == null && sellPrice == null) {
      return res.status(400).json({ ok: false, error: '请至少填写买入价或卖出价' });
    }
    try {
      smallCollector.ensureWatch(stockFromParts(code, name), 'plan');
    } catch {
      /* ignore */
    }
    const plan = smallDb.createTradePlan({
      code,
      name,
      buyPrice,
      buyTime: normalizePlanDateTime(body.buyTime),
      sellPrice,
      sellTime: normalizePlanDateTime(body.sellTime),
      note: body.note,
    });
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.put('/api/trade-plans/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: '无效计划 id' });
    }
    const cur = smallDb.getTradePlan(id);
    if (!cur) return res.status(404).json({ ok: false, error: '计划不存在' });
    const body = req.body || {};
    let code = body.code != null ? String(body.code).trim() : cur.code;
    let name = body.name != null ? String(body.name) : cur.name;
    const q = String(body.q || '').trim();
    if (q && !/^\d{6}$/.test(code)) {
      const looked = await lookupStock(q);
      code = String(looked?.resolved?.code || looked?.row?.code || looked?.row?.f12 || '').trim();
      if (body.name == null) {
        name = String(looked?.resolved?.name || looked?.row?.name || looked?.row?.f14 || name || '');
      }
    }
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ ok: false, error: '无效股票代码' });
    }
    const fields = { code, name };
    if (Object.prototype.hasOwnProperty.call(body, 'buyPrice')) fields.buyPrice = parseOptionalPrice(body.buyPrice);
    if (Object.prototype.hasOwnProperty.call(body, 'buyTime')) fields.buyTime = normalizePlanDateTime(body.buyTime);
    if (Object.prototype.hasOwnProperty.call(body, 'sellPrice')) fields.sellPrice = parseOptionalPrice(body.sellPrice);
    if (Object.prototype.hasOwnProperty.call(body, 'sellTime')) fields.sellTime = normalizePlanDateTime(body.sellTime);
    if (Object.prototype.hasOwnProperty.call(body, 'note')) fields.note = body.note;
    const mergedBuy = Object.prototype.hasOwnProperty.call(fields, 'buyPrice') ? fields.buyPrice : cur.buyPrice;
    const mergedSell = Object.prototype.hasOwnProperty.call(fields, 'sellPrice') ? fields.sellPrice : cur.sellPrice;
    if (mergedBuy == null && mergedSell == null) {
      return res.status(400).json({ ok: false, error: '请至少填写买入价或卖出价' });
    }
    try {
      smallCollector.ensureWatch(stockFromParts(code, name), 'plan');
    } catch {
      /* ignore */
    }
    const plan = smallDb.updateTradePlan(id, fields);
    res.json({ ok: true, plan });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});


app.get('/api/trade-plans/:id/checks', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: '无效计划 id' });
    }
    const plan = smallDb.getTradePlan(id);
    if (!plan) return res.status(404).json({ ok: false, error: '计划不存在' });
    const tomorrow = tomorrowShanghai();
    const rows = smallDb.getTradePlanChecks(id);
    res.json({ ok: true, tomorrow, rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/trade-plans/:id/checks', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: '无效计划 id' });
    }
    const plan = smallDb.getTradePlan(id);
    if (!plan) return res.status(404).json({ ok: false, error: '计划不存在' });
    const body = req.body || {};
    const checkDate = String(body.checkDate || tomorrowShanghai()).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(checkDate)) {
      return res.status(400).json({ ok: false, error: '无效日期' });
    }
    const predictionOk = normalizePredictionOk(body.predictionOk);
    smallDb.upsertTradePlanCheck({ planId: id, checkDate, predictionOk });
    const rows = smallDb.getTradePlanChecks(id);
    res.json({ ok: true, tomorrow: tomorrowShanghai(), rows });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.delete('/api/trade-plans/:id', (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: '无效计划 id' });
    }
    smallDb.deleteTradePlan(id);
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/trade-plans/:id/analyze', async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ ok: false, error: '无效计划 id' });
    }
    const days = req.body?.days;
    const out = await analyzeTradePlanById(id, days);
    res.json(out);
  } catch (e) {
    const status = e.code === 'AI_NOT_CONFIGURED' ? 503 : e.status || 500;
    res.status(status).json({ ok: false, error: e.message || String(e), meta: e.meta });
  }
});

app.post('/api/trade-plans/analyze-all', async (req, res) => {
  try {
    const days = req.body?.days;
    const plans = smallDb.getTradePlans();
    const results = [];
    for (const plan of plans) {
      try {
        const out = await analyzeTradePlanById(plan.id, days);
        results.push({ ok: true, id: plan.id, code: plan.code, signal: out.signal });
      } catch (e) {
        results.push({
          ok: false,
          id: plan.id,
          code: plan.code,
          error: e.message || String(e),
        });
      }
    }
    const okCount = results.filter((r) => r.ok).length;
    res.json({
      ok: true,
      total: results.length,
      okCount,
      failCount: results.length - okCount,
      results,
    });
  } catch (e) {
    const status = e.code === 'AI_NOT_CONFIGURED' ? 503 : 500;
    res.status(status).json({ ok: false, error: e.message || String(e) });
  }
});

app.get('/api/live/status', (_req, res) => {
  res.json({ ok: true, poll: smallCollector.getPollStatus(), config: publicLiveConfig() });
});

app.get('/api/live/watchlist', (_req, res) => {
  const list = smallDb.getWatchlist(true);
  const latest = smallDb.getLatestSnapshots(list.map((x) => x.code));
  const byCode = new Map(latest.map((x) => [x.code, x]));
  const remarkCounts = smallDb.getDailyRemarkCounts(list.map((x) => x.code));
  res.json({
    ok: true,
    config: publicLiveConfig(),
    rows: list.map((w) => ({
      ...w,
      remarkCount: remarkCounts[w.code] || 0,
      live: smallCollector.mapLiveRow(byCode.get(w.code), w.name),
    })),
  });
});


app.get('/api/live/history', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: '缺少 code' });
  const date = String(req.query.date || '').trim() || null;
  try {
    const bundle = smallCollector.getHistoryBundle(code, date);
    res.json({ ok: true, ...bundle });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.get('/api/live/latest', (req, res) => {
  const code = String(req.query.code || '').trim();
  if (!code) return res.status(400).json({ ok: false, error: '缺少 code' });
  const bundle = smallCollector.getLiveBundle(code);
  res.json({ ok: true, ...bundle, config: publicLiveConfig() });
});

app.post('/api/live/collect', async (req, res) => {
  try {
    const code = String(req.body?.code || req.query.code || '').trim();
    const force = req.body?.force !== false;
    if (code) {
      const w = smallDb.getWatchlistStock(code) || stockFromParts(code);
      smallCollector.ensureWatch(w, 'manual');
      const r = await smallCollector.collectOnce(w, { force: true, withDepth: true, withLhb: true });
      return res.json({ ok: true, result: r, live: r.live || null });
    }
    const results = await smallCollector.collectWatchlist(force);
    res.json({ ok: true, poll: smallCollector.getPollStatus(), count: results.length });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || String(e) });
  }
});

app.post('/api/live/watch', (req, res) => {
  try {
    const code = String(req.body?.code || '').trim();
    const name = req.body?.name || '';
    if (!code) return res.status(400).json({ ok: false, error: '缺少 code' });
    const s = smallCollector.ensureWatch(stockFromParts(code, name), req.body?.source || 'manual');
    res.json({ ok: true, stock: s });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message || String(e) });
  }
});


loadCachedResult();


// ensure includeST default true for web runtime file if missing
(() => {
  const cfg = loadRuntimeConfig();
  if (!fs.existsSync(RUNTIME_PATH)) {
    saveRuntimeConfig({ ...cfg, includeST: true });
  }
})();

// seed watchlist from cached screen
try {
  if (lastResult?.rows?.length) trackScreenRows(lastResult.rows);
} catch {
  /* ignore */
}

smallCollector.startPolling();

app.listen(PORT, () => {
  console.log(`[small-screen] http://localhost:${PORT}  (独立于 3009)`);
  console.log(`[small-live] db=${smallDb.dbPath()} interval=${smallCollector.liveOpts().pollIntervalSec}s`);
});
