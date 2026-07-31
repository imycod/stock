/** 默认标的与监控列表（启动时写入 watchlist 表；name 可手动填写，避免接口乱码） */
module.exports = {
  defaultStockCode: process.env.DEFAULT_STOCK || '600759',
  watchlist: [
    { code: '600759', name: '洲际油气' },
    { code: '600660', name: '福耀玻璃' },
    { code: '002129', name: 'TCL中环' },
    { code: '601212', name: '白银有色' },
    { code: '601899', name: '紫金矿业' },
    { code: '600096', name: '云天化' },
    { code: '600227', name: '赤天化' },
    { code: '600722', name: '金牛化工' },
    { code: '601615', name: '明阳智能' },
    { code: '002738', name: '中矿资源' },
  ],
  benchmark: {
    code: '000001',
    name: '上证指数',
    secid: '1.000001',
  },
  port: process.env.PORT || 3009,
  smallPort: process.env.SMALL_PORT || 3010,
  dataDir: './data',
  dbPath: './data/stock.db',
  collectCron: '5 * * * * *',
  dailySyncCron: '5 15 * * 1-5',
  /** 主板小盘筛选（npm run export:small） */
  exportSmall: {
    maxTotalShares: 3e8, // 总股本 < 3亿股
    maxMarketCap: 9e9, // 总市值 < 90亿元
    maxHolders: 100000, // 股东户数 < 10万
    minTop10Ratio: 40, // 前十大持股比例 >= 40%
    volumeExpandRatio: 1.5,
    maxPriceVsYearAvg: 1.0,
    maxPriceVsYearLow: 1.25,
  },
  smallLive: {
    dbPath: './data/small-live.db',
    pollIntervalSec: Number(process.env.SMALL_POLL_SEC || 60),
    maxWatchlist: 200,
    lhbSyncIntervalMin: 60,
    collectOutsideHours: false,
  },
  ai: {
    provider: 'zhipu',
    baseUrl: process.env.ZHIPU_BASE_URL || 'https://open.bigmodel.cn/api/paas/v4',
    apiKey: process.env.ZHIPU_API_KEY || process.env.BIGMODEL_API_KEY || 'bdd431c8a1454bed9a166fabbd10ac51.mpcM6i9pXuaw0lZX',
    model: process.env.ZHIPU_MODEL || 'glm-4.7-flash',
    defaultDays: Number(process.env.AI_DEFAULT_DAYS || 5),
    maxDays: 10,
    maxRows: 900,
    temperature: 0.6,
    maxTokens: 4096,
  },
};
