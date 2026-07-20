const path = require('path');
if (process.platform === 'win32') {
  try {
    require('child_process').execSync('chcp 65001 >nul', { stdio: 'ignore' });
  } catch {
    /* ignore */
  }
}
const express = require('express');
const cron = require('node-cron');
const config = require('../config');
const collector = require('./collector');
const analyzer = require('./analyzer');
const db = require('./storage/database');
const api = require('./api/eastmoney');
const marketDepth = require('./api/marketDepth');
const stocks = require('./stocks');

const publicDir = path.join(__dirname, '../public');
const app = express();
app.use(
  express.static(publicDir, {
    setHeaders(res, filePath) {
      if (filePath.endsWith('.html')) {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
      } else if (filePath.endsWith('.js')) {
        res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
      } else if (filePath.endsWith('.css')) {
        res.setHeader('Content-Type', 'text/css; charset=utf-8');
      }
    },
  })
);
app.use((req, res, next) => {
  const origJson = res.json.bind(res);
  res.json = (body) => {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    return origJson(body);
  };
  next();
});
app.use(express.json());

const analysisCache = new Map();
const deepCache = new Map();
let lastCollectByCode = {};

async function applyConfigWatchlist() {
  const entries = stocks.normalizeWatchlist(config.watchlist || []);
  const defaultCode = stocks.normalizeCode(config.defaultStockCode);
  if (defaultCode) {
    const has = entries.some((e) => e.code === defaultCode);
    if (!has) entries.unshift({ code: defaultCode, name: null });
  }

  for (const entry of entries) {
    try {
      if (entry.name) {
        db.upsertWatchlistStock(stocks.stockFromParts(entry.code, entry.name, null));
        continue;
      }
      const existing = db.getWatchlistStock(entry.code);
      if (existing?.name && !stocks.isGarbledStockName(existing.name)) continue;
      if (existing && existing.name === entry.code) {
        /* try refresh name below */
      } else if (existing) continue;

      const stock = await stocks.resolveStock(entry.code, api);
      db.upsertWatchlistStock(stock);
    } catch (e) {
      console.warn(`[watchlist] ${entry.code}:`, e.message);
    }
  }
}


async function resolveStockForRequest(req) {
  const raw = req.query.code || req.body?.code || config.defaultStockCode;
  const normalized = stocks.normalizeCode(raw);
  if (!normalized) throw new Error('无效股票代码');

  const cached = db.getWatchlistStock(normalized);
  if (cached) return stocks.resolveStockFromRecord(cached);

  return stocks.resolveStock(normalized, api);
}

async function bootstrap() {
  await applyConfigWatchlist();

  console.log('[init] 同步监控列表历史日K...');
  try {
    await collector.syncWatchlistDaily(30);
    await collector.syncWatchlistTodayMinutes();
    console.log('[init] 历史数据同步完成');
  } catch (e) {
    console.warn('[init] 历史同步失败（可稍后重试）', e.message);
  }

  console.log('[init] 首次采集...');
  try {
    const results = await collector.collectWatchlist(true);
    lastCollectByCode = Object.fromEntries(
      results.filter((r) => r?.code).map((r) => [r.code, r])
    );
    const defaultStock = db.getWatchlistStock(config.defaultStockCode);
    if (defaultStock) {
      analysisCache.set(
        defaultStock.code,
        await analyzer.runAnalysis(defaultStock)
      );
    }
  } catch (e) {
    console.warn('[init] 首次采集失败（服务仍启动）', e.message);
  }
}

app.get('/api/stocks', (req, res) => {
  res.json({ watchlist: db.getWatchlist(), defaultCode: config.defaultStockCode });
});

app.post('/api/stocks', async (req, res) => {
  try {
    const manualName = (req.body?.name || "").trim();
    const stock = await stocks.resolveStock(req.body?.code, api, {
      preferredName: manualName || undefined,
    });
    db.upsertWatchlistStock(stock);
    await collector.syncDailyKlines(stock, 30).catch(() => null);
    await collector.syncTodayMinuteBars(stock).catch(() => null);
    res.json({ ok: true, stock, watchlist: db.getWatchlist() });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/status', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    res.json({
      stock,
      watchlist: db.getWatchlist(),
      trading: api.isTradingTime(),
      stats: db.getStats(stock.code),
      lastCollect: lastCollectByCode[stock.code] || null,
    });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/quote', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    const quote = await api.getRealtimeQuote(stock.secid, stock.code, stock.market);
    res.json(quote);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/minute/:date?', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    const date = req.params.date || api.todayStr();
    res.json(db.getMinuteSnapshots(date, stock.code));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/daily', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    const limit = +req.query.limit || 60;
    res.json(db.getDailyQuotes(stock.code, limit));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

app.get('/api/deep', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    const ttl = 15000;
    const force = req.query.refresh === '1';
    const cached = deepCache.get(stock.code);
    if (!force && cached && Date.now() - cached.at < ttl) {
      return res.json(cached.data);
    }

    const quote = await api.getRealtimeQuote(stock.secid, stock.code, stock.market);
    const dailyRows = db.getDailyQuotes(stock.code, 120);
    const marginHistory = db.getMarginSnapshots(stock.code, 30);
    const data = await marketDepth.fetchMarketDepth({
      secid: stock.secid,
      code: stock.code,
      quote,
      dailyRows,
      marginHistory,
    });
    deepCache.set(stock.code, { data, at: Date.now() });
    res.json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analysis', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    if (req.query.refresh === '1') {
      const analysis = await analyzer.runAnalysis(stock);
      analysisCache.set(stock.code, analysis);
      return res.json(analysis);
    }
    res.json(
      analysisCache.get(stock.code) || (await analyzer.runAnalysis(stock))
    );
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/collect', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    const collect = await collector.collectOnce(stock, true);
    lastCollectByCode[stock.code] = collect;
    const analysis = await analyzer.runAnalysis(stock);
    analysisCache.set(stock.code, analysis);
    res.json({ collect, analysis: analysis?.signals, code: stock.code });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/collect/all', async (req, res) => {
  try {
    const results = await collector.collectWatchlist(true);
    for (const r of results) {
      if (r?.code) lastCollectByCode[r.code] = r;
    }
    const analyses = [];
    for (const row of db.getWatchlist()) {
      const a = await analyzer.runAnalysis(row);
      analysisCache.set(row.code, a);
      analyses.push({ code: row.code, signals: a.signals });
    }
    res.json({ results, analyses });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync/daily', async (req, res) => {
  try {
    const stock = await resolveStockForRequest(req);
    const result = await collector.syncDailyKlines(stock, 60);
    const analysis = await analyzer.runAnalysis(stock);
    analysisCache.set(stock.code, analysis);
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cron.schedule(config.collectCron, async () => {
  const results = await collector.collectWatchlist();
  for (const r of results) {
    if (!r?.ok || !r.code) continue;
    lastCollectByCode[r.code] = r;
    try {
      const row = db.getWatchlistStock(r.code);
      if (row) {
        const analysis = await analyzer.runAnalysis(row);
        analysisCache.set(r.code, analysis);
      }
    } catch {
      /* skip */
    }
    console.log(
      `[collect] ${r.code} ${r.row?.trade_time} 价=${r.row?.price} 涨跌=${r.row?.pct_change}%`
    );
  }
});

cron.schedule(config.dailySyncCron, async () => {
  console.log('[sync] 收盘后同步日K（全部监控）');
  await collector.syncWatchlistDaily(5);
  await collector.syncWatchlistTodayMinutes();
  for (const row of db.getWatchlist()) {
    try {
      analysisCache.set(row.code, await analyzer.runAnalysis(row));
    } catch {
      /* skip */
    }
  }
});

cron.schedule('0 9 * * 1-5', async () => {
  console.log('[sync] 开盘前同步当日分钟K（全部监控）');
  await collector.syncWatchlistTodayMinutes();
});

const PORT = config.port;

bootstrap().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log('  多股票行情采集分析 (dev)');
    console.log(`  仪表盘: http://localhost:${PORT}`);
    console.log(`  默认代码: ${config.defaultStockCode}`);
    console.log('========================================');
    console.log('');
  });
});

module.exports = app;