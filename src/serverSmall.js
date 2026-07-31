const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { DEFAULTS, YI, runScreen, lookupStock, remoteFilter, hasCompoundFilters } = require('./exportSmall');
const smallDb = require('./storage/smallDatabase');
const smallCollector = require('./smallCollector');
const { stockFromParts } = require('./stocks');

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
    maxResults: body.maxResults,
  };
  if (!hasCompoundFilters(filters)) {
    return res.status(400).json({ ok: false, error: '请至少选择盈利阶段/持股集中度/刚摘帽/异动之一' });
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
  if (stage) rows = rows.filter((r) => r.profitStage === stage);
  if (focus) rows = rows.filter((r) => r.holdFocus === focus);
  if (uncapped === '1' || uncapped === 'true') rows = rows.filter((r) => r.justUncapped);
  if (abnormal === '1' || abnormal === 'true') rows = rows.filter((r) => r.hasAbnormal);
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

app.get('/api/screen/result', (req, res) => {
  if (!lastResult) {
    const compoundEmpty = {
      stage: String(req.query.stage || '').trim(),
      focus: String(req.query.focus || '').trim(),
      uncapped: String(req.query.uncapped || '').trim(),
      abnormal: String(req.query.abnormal || '').trim(),
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


app.get('/api/live/status', (_req, res) => {
  res.json({ ok: true, poll: smallCollector.getPollStatus(), config: publicLiveConfig() });
});

app.get('/api/live/watchlist', (_req, res) => {
  const list = smallDb.getWatchlist(true);
  const latest = smallDb.getLatestSnapshots(list.map((x) => x.code));
  const byCode = new Map(latest.map((x) => [x.code, x]));
  res.json({
    ok: true,
    config: publicLiveConfig(),
    rows: list.map((w) => ({
      ...w,
      live: smallCollector.mapLiveRow(byCode.get(w.code), w.name),
    })),
  });
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
