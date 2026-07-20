const path = require('path');
const express = require('express');
const cron = require('node-cron');
const config = require('../config');
const collector = require('./collector');
const analyzer = require('./analyzer');
const db = require('./storage/database');
const api = require('./api/eastmoney');
const marketDepth = require('./api/marketDepth');

const app = express();
app.use(express.static(path.join(__dirname, '../public')));
app.use(express.json());

let lastCollectResult = null;
let lastAnalysis = null;

async function bootstrap() {
  console.log('[init] 同步历史日K...');
  try {
    await collector.syncDailyKlines(30);
    await collector.syncTodayMinuteBars();
    console.log('[init] 历史数据同步完成');
  } catch (e) {
    console.warn('[init] 历史同步失败（可稍后重试）:', e.message);
  }

  console.log('[init] 首次采集...');
  try {
    lastCollectResult = await collector.collectOnce(true);
    lastAnalysis = await analyzer.runAnalysis();
    if (lastAnalysis?.threeDayEnergy) {
      console.log('[init]', lastAnalysis.threeDayEnergy.text);
    }
    if (lastCollectResult?.ok) {
      console.log('[init] 首次采集成功，价=', lastCollectResult.row.price);
    }
  } catch (e) {
    console.warn('[init] 首次采集失败（服务仍启动，可手动重试）:', e.message);
    try {
      lastAnalysis = await analyzer.runAnalysis();
      if (lastAnalysis?.threeDayEnergy) {
        console.log('[init]', lastAnalysis.threeDayEnergy.text);
      }
    } catch {
      /* 无数据时分析可空跑 */
    }
  }
}

app.get('/api/status', (req, res) => {
  res.json({
    stock: config.stock,
    trading: api.isTradingTime(),
    stats: db.getStats(),
    lastCollect: lastCollectResult,
  });
});

app.get('/api/quote', async (req, res) => {
  try {
    const quote = await api.getRealtimeQuote(
      config.stock.secid,
      config.stock.code,
      config.stock.market
    );
    res.json(quote);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/minute/:date?', (req, res) => {
  const date = req.params.date || api.todayStr();
  const rows = db.getMinuteSnapshots(date, config.stock.code);
  res.json(rows);
});

app.get('/api/daily', (req, res) => {
  const limit = +req.query.limit || 60;
  res.json(db.getDailyQuotes(config.stock.code, limit));
});

app.get('/api/deep', async (req, res) => {
  try {
    const ttl = 15000;
    const force = req.query.refresh === '1';
    if (!force && lastDeepData && Date.now() - lastDeepAt < ttl) {
      return res.json(lastDeepData);
    }
    const { code, secid } = config.stock;
    const quote = await api.getRealtimeQuote(secid, code, config.stock.market);
    const dailyRows = db.getDailyQuotes(code, 120);
    const marginHistory = db.getMarginSnapshots(code, 30);
    lastDeepData = await marketDepth.fetchMarketDepth({
      secid,
      code,
      quote,
      dailyRows,
      marginHistory,
    });
    lastDeepAt = Date.now();
    res.json(lastDeepData);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/analysis', async (req, res) => {
  try {
    if (req.query.refresh === '1') {
      lastAnalysis = await analyzer.runAnalysis();
    }
    res.json(lastAnalysis || (await analyzer.runAnalysis()));
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/collect', async (req, res) => {
  try {
    lastCollectResult = await collector.collectOnce(true);
    lastAnalysis = await analyzer.runAnalysis();
    res.json({ collect: lastCollectResult, analysis: lastAnalysis?.signals });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/sync/daily', async (req, res) => {
  try {
    const result = await collector.syncDailyKlines(60);
    lastAnalysis = await analyzer.runAnalysis();
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

cron.schedule(config.collectCron, async () => {
  const result = await collector.collectOnce();
  if (result.ok) {
    lastCollectResult = result;
    lastAnalysis = await analyzer.runAnalysis();
    console.log(
      `[collect] ${result.row.trade_time} 价=${result.row.price} 涨跌=${result.row.pct_change}%`
    );
  }
});

cron.schedule(config.dailySyncCron, async () => {
  console.log('[sync] 收盘后同步日K');
  await collector.syncDailyKlines(5);
  await collector.syncTodayMinuteBars();
  lastAnalysis = await analyzer.runAnalysis();
});

cron.schedule('0 9 * * 1-5', async () => {
  console.log('[sync] 开盘前同步当日分钟K');
  await collector.syncTodayMinuteBars();
});

const PORT = config.port;

bootstrap().then(() => {
  app.listen(PORT, () => {
    console.log('');
    console.log('========================================');
    console.log(`  600759 ${config.stock.name} 行情采集分析`);
    console.log(`  仪表盘: http://localhost:${PORT}`);
    console.log(`  数据源: 新浪 / 腾讯 / 东方财富 公开 API（无需密钥）`);
    console.log(`  采集频率: 每分钟（交易时段）`);
    console.log('========================================');
    console.log('');
  });
});

module.exports = app;
