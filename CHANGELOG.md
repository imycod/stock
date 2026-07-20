# Changelog

本项目的 notable 变更按版本记录。格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)。

## [Unreleased]

### 修复

- 东方财富 ltt=2 行情：涨跌幅、量比、换手率不再错误除以 100（如 7.42% 误显为 0.07%）

## [1.1.0-dev] - 2026-07-20

### 新增

- 多股票监控：`watchlist` 表与 `config.watchlist`，交易时段对列表内全部标的每分钟采集
- 仪表盘：股票代码输入、「切换」展示、「加入监控」写入列表；快捷芯片切换当前查看标的
- API 支持 `?code=` 指定标的；`POST /api/stocks` 加入监控；`POST /api/collect/all` 采集全部监控股
- 深度行情（逐笔、大单、筹码、龙虎榜、融资融券、封单强度）与 `GET /api/deep`
- `config.watchlist` 支持 `{ code, name }` 对象，可手动填写名称避免接口乱码
- 仪表盘可选「名称」字段，加入监控时一并提交

### 变更

- 默认配置改为 `defaultStockCode` + 监控列表，不再绑定单一 `config.stock`
- 综合研判权重纳入「深度行情」维度
- 行情名称优先东方财富 UTF-8；新浪备用接口使用 GB18030 解码（`iconv-lite`）

### 修复

- 修复 `database.js` 未导出 `getWatchlist` 等函数导致服务无法启动
- 修复中文乱码：静态资源与 JSON 响应 `charset=utf-8`、编辑器 UTF-8 约定
- 修复「切换」误将每只股票都加入监控；与「加入监控」职责分离
- 修复分析模块 `depthSignal` 未定义等问题

### 依赖

- 新增 `iconv-lite`（新浪行情 GB18030 解码）

## [1.0.0] - 2026-07-20

### 新增

- 600759 分钟级采集、SQLite 持久化、Web 仪表盘与多周期趋势分析
- README 与公开 API 说明（新浪 / 腾讯 / 东方财富，无需密钥）

[Unreleased]: https://github.com/imycod/stock/compare/v1.1.0-dev...HEAD
[1.1.0-dev]: https://github.com/imycod/stock/compare/v1.0.0...v1.1.0-dev
[1.0.0]: https://github.com/imycod/stock/releases/tag/v1.0.0
