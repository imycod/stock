const { buildChipBins, profitRatioAtPrice } = require('../lib/chipPeak');

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://quote.eastmoney.com/',
};

const DATA_HEADERS = {
  ...HEADERS,
  Referer: 'https://data.eastmoney.com/',
};

async function fetchJson(url, headers = HEADERS, timeoutMs = 15000) {
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function limitPct(code, name = '') {
  if (name.includes('ST') || name.includes('*ST')) return 0.05;
  if (code.startsWith('688') || code.startsWith('30')) return 0.2;
  return 0.1;
}

function roundLimit(price, pct, up = true) {
  const raw = up ? price * (1 + pct) : price * (1 - pct);
  return Math.round(raw * 100) / 100;
}

async function getTickDetails(secid, pos = -80) {
  const params = new URLSearchParams({
    secid,
    pos: String(pos),
    fields1: 'f1,f2,f3,f4',
    fields2: 'f51,f52,f53,f54,f55',
    ut: 'fa5fd1943c7b386f172d6893dbfba107',
    _: String(Date.now()),
  });
  const url = `https://push2.eastmoney.com/api/qt/stock/details/get?${params}`;
  const json = await fetchJson(url, HEADERS, 20000);
  const d = json.data;
  if (!d?.details?.length) return { ticks: [], prePrice: null };

  const ticks = d.details.map((line) => {
    const p = line.split(',');
    const side = +p[4];
    return {
      time: p[0],
      price: +p[1],
      volume: +p[2],
      trade_count: +p[3] || null,
      side,
      side_label: side === 2 ? '买' : side === 1 ? '卖' : '中性',
    };
  });

  return {
    prePrice: d.prePrice,
    decimal: d.decimal,
    ticks,
  };
}

async function getExtendedQuote(secid) {
  const fields = [
    'f43', 'f44', 'f45', 'f46', 'f47', 'f48', 'f57', 'f58', 'f60',
    'f113', 'f114', 'f115', 'f116', 'f117', 'f118', 'f119', 'f120',
    'f121', 'f122', 'f135', 'f136', 'f137', 'f138', 'f139', 'f140',
    'f141', 'f142', 'f143', 'f144', 'f145', 'f146', 'f147', 'f148',
    'f277', 'f278', 'f279', 'f280', 'f84', 'f85',
  ].join(',');
  const url = `https://push2.eastmoney.com/api/qt/stock/get?secid=${secid}&invt=2&fltt=2&fields=${fields}&ut=fa5fd1943c7b386f172d6893dbfba107&_=${Date.now()}`;
  const json = await fetchJson(url);
  return json.data || {};
}

function parseNum(v) {
  if (v === '-' || v == null || v === '') return null;
  const n = +v;
  return Number.isFinite(n) ? n : null;
}

function buildLargeOrderDistribution(ext) {
  const tiers = [
    { key: 'super_large', label: '超大单', buy: 'f135', sell: 'f136', net: 'f137' },
    { key: 'large', label: '大单', buy: 'f138', sell: 'f139', net: 'f140' },
    { key: 'medium', label: '中单', buy: 'f141', sell: 'f142', net: 'f143' },
    { key: 'small', label: '小单', buy: 'f144', sell: 'f145', net: 'f146' },
  ];

  const rows = tiers.map((t) => ({
    key: t.key,
    label: t.label,
    buy: parseNum(ext[t.buy]),
    sell: parseNum(ext[t.sell]),
    net: parseNum(ext[t.net]),
  }));

  const mainBuy = parseNum(ext.f147);
  const mainSell = parseNum(ext.f148);
  const mainNet =
    mainBuy != null && mainSell != null ? mainBuy - mainSell : null;

  return {
    tiers: rows,
    main: { buy: mainBuy, sell: mainSell, net: mainNet },
  };
}
function buildSealStrength(quote, ext) {
  const code = quote.code || ext.f57;
  const name = quote.name || ext.f58 || '';
  const price = quote.price ?? parseNum(ext.f43);
  const preClose = quote.pre_close ?? parseNum(ext.f60);
  if (!price || !preClose) {
    return { status: 'unknown', label: '—', strength: null };
  }

  const pct = limitPct(String(code), name);
  const limitUp = roundLimit(preClose, pct, true);
  const limitDown = roundLimit(preClose, pct, false);
  const atLimitUp = price >= limitUp - 0.004;
  const atLimitDown = price <= limitDown + 0.004;

  const sealUp = parseNum(ext.f113);
  const sealDown = parseNum(ext.f114);
  const sealNeutral = parseNum(ext.f115);

  let sealVolume = null;
  let direction = 'none';
  if (atLimitUp && sealUp != null) {
    sealVolume = sealUp;
    direction = 'limit_up';
  } else if (atLimitDown && sealDown != null) {
    sealVolume = sealDown;
    direction = 'limit_down';
  } else if (sealNeutral != null) {
    sealVolume = sealNeutral;
  }

  const floatMv = parseNum(ext.f117) || parseNum(ext.f116);
  const dailyAmount = quote.amount ?? parseNum(ext.f48);
  let strength = null;
  if (sealVolume != null && floatMv && floatMv > 0) {
    strength = (sealVolume / floatMv) * 100;
  } else if (sealVolume != null && dailyAmount && dailyAmount > 0) {
    strength = (sealVolume / dailyAmount) * 100;
  }

  let label = '非涨跌停';
  if (atLimitUp) label = sealVolume != null ? '涨停封单' : '涨停（封单未披露）';
  else if (atLimitDown) label = sealVolume != null ? '跌停封单' : '跌停（封单未披露）';

  return {
    limitUp,
    limitDown,
    atLimitUp,
    atLimitDown,
    sealVolume,
    sealAmount: sealVolume,
    direction,
    strength,
    label,
    floatMarketValue: floatMv,
    dailyAmount,
  };
}

function buildMarginSnapshot(ext) {
  const rzye = parseNum(ext.f277) ?? parseNum(ext.f84);
  const rqye = parseNum(ext.f278);
  const rzrqye =
    rzye != null && rqye != null ? rzye + rqye : parseNum(ext.f85);
  return {
    rzye,
    rqye,
    rzrqye,
    rqyl: parseNum(ext.f279),
    tradeDate: null,
  };
}

function buildChipSummary(ext, dailyRows, currentPrice) {
  const computed = buildChipBins(dailyRows, 0.01);
  const apiAvgCost = parseNum(ext.f119);
  const apiProfitRatio = parseNum(ext.f120);

  const profitRatio =
    apiProfitRatio ??
    (currentPrice
      ? profitRatioAtPrice(computed.bins, computed.totalVolume, currentPrice)
      : null);

  return {
    avgCost: apiAvgCost ?? computed.avgCost,
    profitRatio,
    concentration: {
      low: parseNum(ext.f121),
      high: parseNum(ext.f122),
    },
    peaks: computed.peaks,
    bins: computed.bins.slice(-80),
  };
}

async function getDragonTigerList(code, pageSize = 10) {
  const filter = `(SECURITY_CODE="${code}")`;
  const params = new URLSearchParams({
    reportName: 'RPT_DAILYBILLBOARD_DETAILS',
    columns: 'ALL',
    pageSize: String(pageSize),
    pageNumber: '1',
    sortColumns: 'TRADE_DATE',
    sortTypes: '-1',
    filter,
  });
  const url = `https://datacenter-web.eastmoney.com/api/data/v1/get?${params}`;
  const json = await fetchJson(url, DATA_HEADERS, 15000);
  const rows = json.result?.data || [];
  return rows.map((r) => ({
    trade_date: r.TRADE_DATE?.slice(0, 10),
    reason: r.EXPLANATION || r.EXPLAIN,
    close: r.CLOSE_PRICE,
    pct_change: r.CHANGE_RATE,
    turnover_rate: r.TURNOVERRATE,
    net_amount: r.BILLBOARD_NET_AMT,
    buy_amount: r.BILLBOARD_BUY_AMT,
    sell_amount: r.BILLBOARD_SELL_AMT,
    deal_net_ratio: r.DEAL_NET_RATIO,
  }));
}

async function getDragonTigerSeats(tradeDate, code) {
  const filter = `(TRADE_DATE='${tradeDate}')(SECURITY_CODE="${code}")`;
  const base = 'https://datacenter-web.eastmoney.com/api/data/v1/get';

  const [buyJson, sellJson] = await Promise.all([
    fetchJson(
      `${base}?${new URLSearchParams({
        reportName: 'RPT_BILLBOARD_DAILYDETAILSBUY',
        columns: 'ALL',
        pageSize: '10',
        pageNumber: '1',
        sortColumns: 'BUY',
        sortTypes: '-1',
        filter,
      })}`,
      DATA_HEADERS,
      15000
    ),
    fetchJson(
      `${base}?${new URLSearchParams({
        reportName: 'RPT_BILLBOARD_DAILYDETAILSSELL',
        columns: 'ALL',
        pageSize: '10',
        pageNumber: '1',
        sortColumns: 'SELL',
        sortTypes: '-1',
        filter,
      })}`,
      DATA_HEADERS,
      15000
    ),
  ]);

  const mapSeat = (r, side) => ({
    side,
    dept: r.OPERATEDEPT_NAME,
    amount: side === 'buy' ? r.BUY : r.SELL,
    net: r.NET,
    rise_prob_3d: r.RISE_PROBABILITY_3DAY,
  });

  const buy = (buyJson.result?.data || []).map((r) => mapSeat(r, 'buy'));
  const sell = (sellJson.result?.data || []).map((r) => mapSeat(r, 'sell'));
  return { trade_date: tradeDate, buy, sell };
}

async function fetchMarketDepth({ secid, code, quote, dailyRows, marginHistory = [] }) {
  const [tickResult, extResult] = await Promise.allSettled([
    getTickDetails(secid, -100),
    getExtendedQuote(secid),
  ]);
  const tickPack =
    tickResult.status === 'fulfilled'
      ? tickResult.value
      : { ticks: [], prePrice: null };
  const ext = extResult.status === 'fulfilled' ? extResult.value : {};

  const currentPrice = quote?.price ?? parseNum(ext.f43);
  const largeOrders = buildLargeOrderDistribution(ext);
  const chip = buildChipSummary(ext, dailyRows, currentPrice);
  const margin = {
    ...buildMarginSnapshot(ext),
    history: marginHistory,
  };
  const seal = buildSealStrength(quote || {}, ext);

  let lhb = { records: [], seats: null };
  try {
    lhb.records = await getDragonTigerList(code, 8);
    const latest = lhb.records[0]?.trade_date;
    if (latest) {
      lhb.seats = await getDragonTigerSeats(latest, code);
    }
  } catch {
    lhb.records = [];
  }

  const buyVol = tickPack.ticks.filter((t) => t.side === 2).reduce((s, t) => s + t.volume, 0);
  const sellVol = tickPack.ticks.filter((t) => t.side === 1).reduce((s, t) => s + t.volume, 0);

  return {
    updatedAt: new Date().toISOString(),
    ticks: tickPack.ticks,
    tickStats: {
      count: tickPack.ticks.length,
      activeBuyVolume: buyVol,
      activeSellVolume: sellVol,
      prePrice: tickPack.prePrice,
    },
    largeOrders,
    chip,
    lhb,
    margin,
    seal,
    source: 'eastmoney_public',
    note: '逐笔与五档为公开延时/摘要数据，非券商级 Level-2',
  };
}

module.exports = {
  getTickDetails,
  getExtendedQuote,
  getDragonTigerList,
  getDragonTigerSeats,
  fetchMarketDepth,
  buildLargeOrderDistribution,
  buildSealStrength,
  buildMarginSnapshot,
  buildChipSummary,
  limitPct,
};