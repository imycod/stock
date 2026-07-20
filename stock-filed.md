一、基础信息（Stock）

几乎不会变化

id
code                 // 000831
name                 // 中国稀土
market               // SZ SH BJ
industry_lv1
industry_lv2
concepts             // AI PCB 稀土
listing_date
total_share
float_share
二、每日行情（Daily Quote）

这个是每天都会新增一条

trade_date

open
close
high
low

pre_close

change
pct_change

volume              // 成交量
amount              // 成交额

turnover_rate       // 换手率

volume_ratio        // 量比

amplitude           // 振幅

pe
pb
ps

market_value
float_market_value

这些基本所有行情软件都有。

三、资金数据（非常重要）

这是我最关注的一类。

main_net_inflow

super_large_buy

large_buy

medium_buy

small_buy

northbound_buy

northbound_hold

financing_balance

margin_balance


如果还能获取：

机构净流入

游资净流入

散户净流入

更好。

四、财务数据（季度）

这个不用每天更新。

利润
revenue

revenue_yoy

net_profit

net_profit_yoy

扣非净利润

gross_margin

net_margin
成长
roe

roa

eps

cashflow

free_cashflow
偿债
asset_liability_ratio

current_ratio

quick_ratio
现金
cash

cash_equivalent

operating_cashflow
估值
pe_ttm

pb

peg

ev_ebitda
五、行业数据（Industry）

很多人忽略。

其实我天天看。

例如：

行业

行业涨跌

行业成交额

行业资金流入

行业热度

行业排名


例如

PCB

今天：

+4.7%

行业第一

这比单独看股票重要。

六、概念（Concept）

例如：

AI

HBM

GPU

铜缆

算力

玻璃基板

机器人

储能

每天记录

概念涨跌

概念成交额

概念排名

概念资金流
七、公告（重要）
公告日期

公告类型

公告标题

是否利好

是否利空

例如

中报预增

定增

回购

减持

股权激励

重大合同

中标

停牌

复牌
八、机构数据

这个很关键。

机构评级

目标价

近30天评级数量

买入

增持

中性

卖出

还有

基金持仓

社保持仓

QFII

养老金
九、龙虎榜

如果做短线。

一定要收。

上榜原因

买一

买二

卖一

机构席位

游资席位

净买额
十、股东数据
股东人数

变化率

十大股东

十大流通股东

机构持仓比例
十一、技术指标（可计算）

这些完全不用存。

运行时算。

MA5

MA10

MA20

MA30

MA60

MA120

MA250

MACD

KDJ

RSI

BOLL

CCI

OBV

ATR

DMI

十二、事件（Event）

这个其实价值特别高。

例如：

特朗普关税

美国降息

国产替代

AI发布

英伟达新品

OpenAI发布

光伏政策

稀土出口


然后建立关联：

事件
↓

影响行业

↓

影响股票

例如

事件

美国限制EDA

↓

半导体

↓

华大九天
概伦电子

以后统计：

同类事件

历史上涨概率

平均涨幅
十三、我最喜欢的一张表（Signal）

这是整个系统最有价值的地方。

不是存行情。

而是存：

今天为什么值得关注。

例如

stock_code

date

signal_type

score

reason

例如：

股票	Signal
TCL中环	中报预增+行业反转
三安光电	MiniLED订单增长
江丰电子	半导体材料涨价
有研新材	靶材价格上涨
多氟多	六氟磷酸锂涨价