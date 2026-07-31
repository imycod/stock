# stock-analyzer

A 股公开行情采集与分析工具。数据来自新浪 / 腾讯 / 东方财富公开接口，本地 SQLite 持久化，**无需 API 密钥**。

项目包含两套独立服务：

| 服务 | 端口 | 启动命令 | 定位 |
|------|------|----------|------|
| 监控分析台 | **3009** | `npm start` | 自选股分钟采集、趋势研判、深度行情仪表盘 |
| 小盘筛选台 | **3010** | `npm run start:small` | 主板小盘筛选、远程个股检索、实时指标入库 |

---

## 总设计

```
                    ┌─────────────────────────────┐
                    │   公开行情源（东财/新浪/腾讯） │
                    └─────────────┬───────────────┘
                                  │
            ┌─────────────────────┼─────────────────────┐
            ▼                                           ▼
   ┌─────────────────┐                       ┌─────────────────────┐
   │  3009 监控服务   │                       │  3010 小盘服务       │
   │  server.js      │                       │  serverSmall.js     │
   │  collector.js   │                       │  exportSmall.js     │
   │  analyzer.js    │                       │  smallCollector.js  │
   └────────┬────────┘                       └──────────┬──────────┘
            │                                           │
            ▼                                           ▼
   data/stock.db                               data/small-live.db
   （watchlist / 分钟快照 /                     （小盘监控 / 分钟快照 /
    日K / 信号 / 融资 / 龙虎榜）                  龙虎榜 / 基本面缓存）
            │                                           │
            ▼                                           ▼
        public/                                   public-small/
```

设计原则：

1. **双库隔离**：3009 与 3010 各自 SQLite，互不覆盖 watchlist 生命周期。
2. **复用接口层**：`src/api/eastmoney.js`、`src/api/marketDepth.js` 两边共用。
3. **筛选与实时解耦**：3010 先做基本面/股东/量价筛选与远程补全，再把命中标的纳入分钟级实时采集。
4. **可配置调度**：采集间隔、筛选阈值阈值均在 `config.js`（及环境变量）中配置。

---

## 功能

### 3009 监控分析台

- 交易时段每分钟自动采集快照（价量、量比、主力净流入等）
- 多周期研判：分钟 / 日 K / 3 日 / 市场情绪 / 深度行情 / 综合得分
- 深度数据：逐笔成交、大单分布、筹码主峰、龙虎榜、融资融券、封单强度
- Web 仪表盘：日内与日 K 图表、信号卡片、深度行情面板
- 多股票：切换展示 / 加入监控，watchlist 内交易时段每分钟采集

### 3010 小盘筛选台

- **配置筛选**：总股本、市值、股东户数、前十大持股、量能放大、贴近年内低点等
- **结果展示**：盈利阶段、业务/合作方、员工与省份、ST/摘帽、异动公告、大盘天气等
- **远程检索**：搜索框输入代码或名称 → 新浪联想 + 东财行情 → 补全与筛选结果同结构字段
- **远程复合过滤**：盈利阶段 / 持股集中度 / 刚摘帽 / 异动 在本地缓存无命中时，自动扫描主板全市场（约三千余只）并按条件过滤入库
- **实时辅助指标**（参考 3009，默认每 60 秒）：
  - 最新价、涨跌幅、成交量、成交额、换手率、量比、振幅
  - 主力 / 大单 / 超大单净流入
  - 主动买/卖量、主买/主卖/主净额
  - 龙虎榜摘要
- **入库**：检索与筛选命中的标的写入 `small-live.db`，分钟快照持续追加

---

## 环境要求

- Node.js 18+（需原生 `fetch`）

```bash
npm install
```

---

## 用法

### 启动 3009（监控分析）

```bash
npm start
# 浏览器 http://localhost:3009
```

手动采集一次：

```bash
npm run collect
```

### 启动 3010（小盘筛选 + 实时）

```bash
npm run start:small
# 或 npm run small
# 浏览器 http://localhost:3010
```

页面说明：

1. **筛选结果**：查看缓存结果；点「刷新数据」按当前配置重新抓取。
2. **搜索框**：输入 `603400` 或 `华之杰` → 远程查全量字段 + 立刻采一帧实时指标并纳入监控。
3. **复合条件**：选择盈利阶段 / 持股集中度 / 刚摘帽 / 异动后点「查询」——先过滤本地筛选缓存；若无命中，自动远程扫描主板并展示。
4. **实时监控**：查看监控列表最新价量、资金流、主动买卖等；可「全量采集」。
5. **配置参数**：调整筛选阈值；保存后可选立即重跑筛选。

命令行导出 Excel/CSV（不启 Web）：

```bash
npm run export:small
```

### 端口与环境变量

| 变量 | 默认 | 说明 |
|------|------|------|
| `PORT` | 3009 | 监控服务端口 |
| `SMALL_PORT` | 3010 | 小盘服务端口 |
| `SMALL_POLL_SEC` | 60 | 小盘实时采集间隔（秒） |
| `DEFAULT_STOCK` | 600759 | 3009 默认标的 |

---

## 输入与配置

### `config.js` 主要字段

```js
{
  watchlist: [ { code, name }, ... ],   // 3009 启动写入 watchlist
  port: 3009,
  smallPort: 3010,
  dbPath: './data/stock.db',
  collectCron: '5 * * * * *',           // 3009 每分钟 :05 采集
  dailySyncCron: '5 15 * * 1-5',        // 收盘后同步日 K
  exportSmall: {                        // 3010 筛选默认阈值
    maxTotalShares: 3e8,                // 总股本 < 3 亿股
    maxMarketCap: 9e9,                  // 总市值 < 90 亿
    maxHolders: 100000,
    minTop10Ratio: 40,
    volumeExpandRatio: 1.5,
    maxPriceVsYearAvg: 1.0,
    maxPriceVsYearLow: 1.25,
  },
  smallLive: {                          // 3010 实时监控
    dbPath: './data/small-live.db',
    pollIntervalSec: 60,                // 可配置，也可用 SMALL_POLL_SEC
    maxWatchlist: 200,
    lhbSyncIntervalMin: 60,             // 龙虎榜同步间隔（分钟）
    collectOutsideHours: false,         // 非交易时段是否轮询
  },
}
```

### 3010 运行时覆盖

- 文件：`data/exportSmall.runtime.json`（页面「配置参数」保存后生成）
- 会覆盖 `exportSmall` 中的筛选阈值；`includeST` 默认 `true`

### 筛选条件含义（输入）

| 参数 | 含义 |
|------|------|
| 总股本上限（亿股） | 流通/总股本规模过滤 |
| 总市值上限（亿） | 小盘市值过滤 |
| 股东户数上限 | 筹码分散度 |
| 前十大持股下限 % | 集中度 |
| 量能放大倍数 | 近 5/10 日相对前段放量 |
| 相对年内均价 / 低点 | 价格位置过滤 |
| 换手跳升阈值 | 换手辅助放量判断 |
| 包含 ST | 是否纳入 ST/*ST |

### 搜索输入

- **代码**：6 位 A 股代码，如 `600759`、`603400`
- **名称**：简称或关键字，如 `洲际`、`华之杰`（新浪联想解析）

---

## 主要 API

### 3009

| 路径 | 说明 |
|------|------|
| `GET /api/status` | 服务与数据统计 |
| `GET /api/quote?code=` | 实时行情 |
| `GET /api/analysis?refresh=1` | 分析结果（含深度） |
| `GET /api/deep?refresh=1` | 深度行情 |
| `POST /api/collect` | 手动采集 |

### 3010

| 路径 | 说明 |
|------|------|
| `GET /api/health` | 健康检查 |
| `GET/POST /api/config` | 读/写筛选配置（POST 可触发重跑） |
| `POST /api/screen/run` | 启动筛选任务 |
| `GET /api/screen/status` | 任务进度 |
| `GET /api/screen/result` | 缓存结果（可按阶段/集中度等过滤） |
| `GET /api/stock/lookup?q=` | 远程检索个股 + 采实时 + 入库 |
| `POST /api/screen/remote-filter` | 主板复合条件远程过滤（异步任务） |
| `GET /api/screen/remote-result` | 远程过滤结果 |
| `GET /api/live/status` | 实时轮询状态 |
| `GET /api/live/watchlist` | 监控列表 + 最新快照 |
| `GET /api/live/latest?code=` | 单票最新快照 / 今日分钟 / 龙虎榜 |
| `POST /api/live/collect` | 强制采集（body 可带 `code`） |
| `POST /api/live/watch` | 手动加入监控 |

---

## 数据说明

### 数据库

| 文件 | 归属 | 主要表 |
|------|------|--------|
| `data/stock.db` | 3009 | `watchlist`, `minute_snapshots`, `daily_quotes`, `analysis_signals`, `margin_snapshots`, `lhb_records` |
| `data/small-live.db` | 3010 | `watchlist`, `minute_snapshots`, `lhb_records`, `fundamentals` |

`data/` 与 `*.db` 默认 gitignore，本地运行自动创建。

字段可参考历史导出样例：`data/stock/{code}/{date}/*.csv`（如 `minute_snapshots.csv`）。

### 分钟快照（小盘库扩展字段）

在 3009 价量/资金流基础上增加：`active_buy_volume` / `active_sell_volume` / `tick_count` / `main_buy` / `main_sell` / `main_net` / 超大单与大单买卖额等。

### 注意

- 逐笔等为公开延时/摘要数据，**非券商级 Level-2**
- 非交易时段默认不轮询；检索接口会强制采一帧便于验证
- 仅供研究参考，不构成投资建议

---

## 目录结构

```
config.js                 # 双服务配置
package.json
src/
  server.js               # 3009 HTTP + cron
  collector.js            # 3009 采集 / 日K / 龙虎榜
  analyzer.js             # 信号与图表
  serverSmall.js          # 3010 HTTP + 实时轮询
  exportSmall.js          # 小盘筛选 / lookupStock
  smallCollector.js       # 小盘实时采集入库
  stocks.js               # 代码 / secid 规范化
  api/                    # 东财 / 深度接口
  storage/
    database.js           # stock.db
    smallDatabase.js      # small-live.db
public/                   # 3009 前端
public-small/             # 3010 前端
data/
  stock.db                # 运行时（gitignore）
  small-live.db           # 运行时（gitignore）
  exportSmall.runtime.json
  exports/                # 筛选结果缓存 / Excel
```

---

## 开发脚本

| 命令 | 作用 |
|------|------|
| `npm start` | 启动 3009 |
| `npm run collect` | 3009 手动采一次 |
| `npm run start:small` / `npm run small` | 启动 3010 |
| `npm run export:small` | 命令行导出小盘筛选结果 |
