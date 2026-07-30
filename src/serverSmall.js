const fs = require('fs');
const path = require('path');
const express = require('express');
const config = require('../config');
const { DEFAULTS, YI, runScreen } = require('./exportSmall');

const PORT = Number(process.env.SMALL_PORT || config.smallPort || 3010);
const RUNTIME_PATH = path.join(__dirname, '..', 'data', 'exportSmall.runtime.json');
const RESULT_PATH = path.join(__dirname, '..', 'data', 'exports', 'small-screen-latest.json');

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
let runningPromise = null;

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
    isST: !!r.isST,
    stType: r.stType || '',
    stDate: r.stDate || '',
    stReason: r.stReason || '',
    stRemoveEstimate: r.stRemoveEstimate || '',
    reasons: r.reasons || '',
  };
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
        rows: result.rows.map(mapRow),
      };
      persistResult(lastResult);
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
      progress: job.progress,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    },
    hasResult: !!lastResult,
    resultCount: lastResult?.rows?.length || 0,
  });
});

app.get('/api/screen/result', (req, res) => {
  if (!lastResult) {
    return res.json({ ok: true, empty: true, rows: [], stats: null, opts: publicConfig(loadRuntimeConfig()) });
  }
  const q = String(req.query.q || '').trim().toLowerCase();
  const stage = String(req.query.stage || '').trim();
  const focus = String(req.query.focus || '').trim();
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

  res.json({
    ok: true,
    empty: false,
    generatedAt: lastResult.generatedAt,
    stats: lastResult.stats,
    opts: publicConfig(lastResult.opts || loadRuntimeConfig()),
    rows,
    total: rows.length,
    allTotal: lastResult.rows.length,
  });
});

loadCachedResult();

// ensure includeST default true for web runtime file if missing
(() => {
  const cfg = loadRuntimeConfig();
  if (!fs.existsSync(RUNTIME_PATH)) {
    saveRuntimeConfig({ ...cfg, includeST: true });
  }
})();

app.listen(PORT, () => {
  console.log(`[small-screen] http://localhost:${PORT}  (独立于 3009)`);
});
