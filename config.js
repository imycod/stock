/** 监控标的：600759 洲际油气（沪市） */
module.exports = {
  stock: {
    code: '600759',
    name: '洲际油气',
    market: 'SH',
    secid: '1.600759',
  },
  /** 大盘参考：上证指数 */
  benchmark: {
    code: '000001',
    name: '上证指数',
    secid: '1.000001',
  },
  port: process.env.PORT || 3009,
  /** 数据目录 */
  dataDir: './data',
  dbPath: './data/stock.db',
  /** 采集 cron：每分钟第 5 秒（避开整点拥堵） */
  collectCron: '5 * * * * *',
  /** 日 K 同步：每天 15:05 和启动时 */
  dailySyncCron: '5 15 * * 1-5',
};
