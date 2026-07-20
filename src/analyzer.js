const config = require('../config');
const api = require('./api/eastmoney');
const db = require('./storage/database');
const marketDepthApi = require('./api/marketDepth');

function sma(values, period) {
  if (values.length < period) return null;
  const slice = values.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / period;
}

function ema(values, period) {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let prev = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
  }
  return prev;
}

function calcRSI(closes, period = 14) {
  if (closes.length < period + 1) return 50;
  let gains = 0;
  let losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses -= diff;
  }
  if (losses === 0) return 100;
  const rs = gains / losses;
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes) {
  const ema12 = ema(closes, 12);
  const ema26 = ema(closes, 26);
  if (ema12 == null || ema26 == null) return { dif: 0, signal: 0, hist: 0 };
  const dif = ema12 - ema26;
  const signal = dif * 0.8;
  return { dif, signal, hist: dif - signal };
}

function trendFromScore(score) {
  if (score >= 25) return 'up';
  if (score <= -25) return 'down';
  return 'neutral';
}

function buildReasons(items) {
  return items.filter(Boolean).join('；');
}

/** 分钟级：当日 intraday 动量 + 资金流 */
function analyzeIntraday(minuteRows, benchmarkQuote) {
  if (minuteRows.length < 5) {
    return {
      horizon: 'minute',
      trend: 'neutral',
      score: 0,
      confidence: 0.2,
      reasons: '分钟数据不足，等待采集',
    };
  }

  const prices = minuteRows.map((r) => r.price);
  const last = minuteRows[minuteRows.length - 1];
  const first = minuteRows[0];
  const intradayPct =
    first.price > 0 ? ((last.price - first.price) / first.price) * 100 : 0;

  const recent5 = prices.slice(-5);
  const momentum =
    recent5.length >= 2
      ? ((recent5[recent5.length - 1] - recent5[0]) / recent5[0]) * 100
      : 0;

  const avgVolRatio =
    minuteRows
      .filter((r) => r.volume_ratio != null)
      .reduce((s, r, _, arr) => s + r.volume_ratio / arr.length, 0) || 1;

  const mainFlow = minuteRows
    .filter((r) => r.main_net_inflow != null)
    .slice(-10);
  const flowSum = mainFlow.reduce((s, r) => s + r.main_net_inflow, 0);

  let score = 0;
  const reasons = [];

  if (intradayPct > 1) {
    score += 20;
    reasons.push(`日内涨幅 +${intradayPct.toFixed(2)}%`);
  } else if (intradayPct < -1) {
    score -= 20;
    reasons.push(`日内跌幅 ${intradayPct.toFixed(2)}%`);
  }

  if (momentum > 0.3) {
    score += 15;
    reasons.push('近5分钟价格上行动量');
  } else if (momentum < -0.3) {
    score -= 15;
    reasons.push('近5分钟价格下行动量');
  }

  if (avgVolRatio > 1.5) {
    score += avgVolRatio > 2 ? 15 : 8;
    reasons.push(`量比活跃 ${avgVolRatio.toFixed(2)}`);
  } else if (avgVolRatio < 0.7) {
    score -= 8;
    reasons.push(`量比偏低 ${avgVolRatio.toFixed(2)}`);
  }

  if (flowSum > 1e7) {
    score += 20;
    reasons.push(`主力净流入 ${(flowSum / 1e8).toFixed(2)} 亿`);
  } else if (flowSum < -1e7) {
    score -= 20;
    reasons.push(`主力净流出 ${(Math.abs(flowSum) / 1e8).toFixed(2)} 亿`);
  }

  if (benchmarkQuote) {
    const rel = last.pct_change - benchmarkQuote.pct_change;
    if (rel > 1) {
      score += 10;
      reasons.push(`跑赢大盘 ${rel.toFixed(2)}%`);
    } else if (rel < -1) {
      score -= 10;
      reasons.push(`弱于大盘 ${rel.toFixed(2)}%`);
    }
  }

  if (last.amplitude > 5) {
    reasons.push(`振幅较大 ${last.amplitude.toFixed(2)}%`);
  }

  const confidence = Math.min(0.95, 0.3 + minuteRows.length / 240);

  return {
    horizon: 'minute',
    trend: trendFromScore(score),
    score,
    confidence,
    reasons: buildReasons(reasons) || '盘中震荡，信号中性',
  };
}

/** 日级：MA / RSI / MACD */
function analyzeDaily(dailyRows) {
  if (dailyRows.length < 10) {
    return {
      horizon: 'daily',
      trend: 'neutral',
      score: 0,
      confidence: 0.3,
      reasons: '日K数据不足（需至少10个交易日）',
    };
  }

  const closes = dailyRows.map((r) => r.close);
  const last = dailyRows[dailyRows.length - 1];
  const ma5 = sma(closes, 5);
  const ma10 = sma(closes, 10);
  const ma20 = sma(closes, 20);
  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);

  let score = 0;
  const reasons = [];

  if (ma5 && ma10 && ma5 > ma10) {
    score += 15;
    reasons.push('MA5 上穿 MA10');
  } else if (ma5 && ma10 && ma5 < ma10) {
    score -= 15;
    reasons.push('MA5 下穿 MA10');
  }

  if (ma20 && last.close > ma20) {
    score += 10;
    reasons.push('收盘价站上 MA20');
  } else if (ma20 && last.close < ma20) {
    score -= 10;
    reasons.push('收盘价跌破 MA20');
  }

  if (rsi > 70) {
    score -= 12;
    reasons.push(`RSI 超买 ${rsi.toFixed(1)}`);
  } else if (rsi < 30) {
    score += 12;
    reasons.push(`RSI 超卖 ${rsi.toFixed(1)}`);
  } else if (rsi > 55) {
    score += 8;
    reasons.push(`RSI 偏强 ${rsi.toFixed(1)}`);
  } else if (rsi < 45) {
    score -= 8;
    reasons.push(`RSI 偏弱 ${rsi.toFixed(1)}`);
  }

  if (macd.hist > 0) {
    score += 12;
    reasons.push('MACD 柱为正');
  } else {
    score -= 12;
    reasons.push('MACD 柱为负');
  }

  const pct3 = dailyRows.slice(-3).reduce((s, r) => s + r.pct_change, 0);
  if (pct3 > 3) {
    score += 10;
    reasons.push(`近3日累计 +${pct3.toFixed(2)}%`);
  } else if (pct3 < -3) {
    score -= 10;
    reasons.push(`近3日累计 ${pct3.toFixed(2)}%`);
  }

  return {
    horizon: 'daily',
    trend: trendFromScore(score),
    score,
    confidence: Math.min(0.9, 0.4 + dailyRows.length / 60),
    reasons: buildReasons(reasons),
    indicators: { ma5, ma10, ma20, rsi, macd },
  };
}

/** 近3天量能：对比前3日均量/均额，判断缩量或放量 */
function calcThreeDayVolumeEnergy(dailyRows) {
  if (dailyRows.length < 6) {
    return {
      status: 'unknown',
      label: '数据不足',
      text: '近3天量能：数据不足（需至少6个交易日）',
      volumeRatio: null,
      amountRatio: null,
    };
  }

  const last3 = dailyRows.slice(-3);
  const prev3 = dailyRows.slice(-6, -3);

  const avg = (rows, field) =>
    rows.reduce((s, r) => s + (r[field] || 0), 0) / rows.length;

  const recentVol = avg(last3, 'volume');
  const prevVol = avg(prev3, 'volume') || 1;
  const recentAmt = avg(last3, 'amount');
  const prevAmt = avg(prev3, 'amount') || 1;

  const volumeRatio = recentVol / prevVol;
  const amountRatio = recentAmt > 0 && prevAmt > 0 ? recentAmt / prevAmt : null;

  const ratio = amountRatio ?? volumeRatio;
  let status;
  let label;

  if (ratio >= 1.2) {
    status = 'expand';
    label = '放量';
  } else if (ratio <= 0.8) {
    status = 'shrink';
    label = '缩量';
  } else {
    status = 'flat';
    label = '平量';
  }

  const fmtDate = (d) => d.slice(5).replace('-', '/');
  const recentRange = `${fmtDate(last3[0].trade_date)}~${fmtDate(last3[2].trade_date)}`;
  const prevRange = `${fmtDate(prev3[0].trade_date)}~${fmtDate(prev3[2].trade_date)}`;
  const pct = ((ratio - 1) * 100).toFixed(1);
  const pctSign = ratio >= 1 ? '+' : '';

  const text = `近3天量能：${label}（较前3日 ${pctSign}${pct}%，${recentRange} vs ${prevRange}）`;

  return {
    status,
    label,
    text,
    volumeRatio: Math.round(volumeRatio * 1000) / 1000,
    amountRatio: amountRatio ? Math.round(amountRatio * 1000) / 1000 : null,
    recent3AvgVolume: Math.round(recentVol),
    prev3AvgVolume: Math.round(prevVol),
    recentDates: last3.map((r) => r.trade_date),
    prevDates: prev3.map((r) => r.trade_date),
  };
}

/** 3日级：短期趋势延续性 */
function analyzeThreeDay(dailyRows) {
  if (dailyRows.length < 5) {
    return {
      horizon: '3day',
      trend: 'neutral',
      score: 0,
      confidence: 0.25,
      reasons: '数据不足',
    };
  }

  const last3 = dailyRows.slice(-3);
  const upDays = last3.filter((r) => r.pct_change > 0).length;
  const sumPct = last3.reduce((s, r) => s + r.pct_change, 0);
  const sumAmount = last3.reduce((s, r) => s + r.amount, 0);
  const prev3 = dailyRows.slice(-6, -3);
  const prevSumAmount = prev3.reduce((s, r) => s + r.amount, 0) || 1;
  const amountRatio = sumAmount / prevSumAmount;

  let score = 0;
  const reasons = [];

  if (upDays === 3) {
    score += 25;
    reasons.push('连续3日收阳');
  } else if (upDays === 0) {
    score -= 25;
    reasons.push('连续3日收阴');
  } else if (upDays === 2) {
    score += 10;
    reasons.push('3日中2日上涨');
  } else if (upDays === 1) {
    score -= 10;
    reasons.push('3日中2日下跌');
  }

  if (sumPct > 5) {
    score += 20;
    reasons.push(`3日涨幅 +${sumPct.toFixed(2)}%`);
  } else if (sumPct < -5) {
    score -= 20;
    reasons.push(`3日跌幅 ${sumPct.toFixed(2)}%`);
  }

  if (amountRatio > 1.2) {
    score += amountRatio > 1.5 ? 15 : 8;
    reasons.push(`近3日成交额放大 ${((amountRatio - 1) * 100).toFixed(0)}%`);
  } else if (amountRatio < 0.8) {
    score -= 8;
    reasons.push('近3日成交额萎缩');
  }

  const avgTurnover =
    last3.reduce((s, r) => s + (r.turnover_rate || 0), 0) / 3;
  if (avgTurnover > 8) {
    reasons.push(`3日平均换手 ${avgTurnover.toFixed(2)}%（活跃）`);
  }

  return {
    horizon: '3day',
    trend: trendFromScore(score),
    score,
    confidence: 0.55,
    reasons: buildReasons(reasons),
  };
}

/** 市场情绪：个股 vs 大盘 + 资金 + 波动 */
async function analyzeSentiment(minuteRows) {
  const benchQuote = await api
    .getRealtimeQuote(
      config.benchmark.secid,
      config.benchmark.code,
      'SH'
    )
    .catch(() => null);

  const last = minuteRows[minuteRows.length - 1];
  let score = 0;
  const reasons = [];

  if (benchQuote) {
    if (benchQuote.pct_change > 0.5) {
      score += 8;
      reasons.push(`大盘偏强（上证 ${benchQuote.pct_change.toFixed(2)}%）`);
    } else if (benchQuote.pct_change < -0.5) {
      score -= 8;
      reasons.push(`大盘偏弱（上证 ${benchQuote.pct_change.toFixed(2)}%）`);
    }

    if (last && benchQuote) {
      const rel = last.pct_change - benchQuote.pct_change;
      if (rel > 2) {
        score += 15;
        reasons.push('个股显著强于大盘（情绪偏多）');
      } else if (rel < -2) {
        score -= 15;
        reasons.push('个股显著弱于大盘（情绪偏空）');
      }
    }
  }

  const flows = minuteRows.filter((r) => r.main_net_inflow != null).slice(-5);
  if (flows.length) {
    const positive = flows.filter((r) => r.main_net_inflow > 0).length;
    if (positive >= 4) {
      score += 15;
      reasons.push('近5次采样主力持续净流入');
    } else if (positive <= 1) {
      score -= 15;
      reasons.push('近5次采样主力持续净流出');
    }
  }

  if (last?.volume_ratio > 2) {
    score += 10;
    reasons.push(`量比 ${last.volume_ratio.toFixed(2)}，交投活跃`);
  }

  return {
    horizon: 'sentiment',
    trend: trendFromScore(score),
    score,
    confidence: 0.5,
    reasons: buildReasons(reasons) || '市场情绪中性',
    benchmark: benchQuote,
  };
}

function compositeTrend(signals) {
  const weights = { minute: 0.28, daily: 0.22, '3day': 0.15, sentiment: 0.15, depth: 0.2 };
  let totalScore = 0;
  let totalWeight = 0;

  for (const s of signals) {
    const w = weights[s.horizon] || 0.1;
    totalScore += s.score * w;
    totalWeight += w;
  }

  const score = totalWeight ? totalScore / totalWeight : 0;
  return {
    horizon: 'composite',
    trend: trendFromScore(score),
    score: Math.round(score * 10) / 10,
    confidence: 0.65,
    reasons: signals.map((s) => `[${s.horizon}] ${s.trend}(${s.score})`).join(' | '),
  };
}

function analyzeMarketDepth(deep) {
  if (!deep) {
    return {
      horizon: 'depth',
      trend: 'neutral',
      score: 0,
      confidence: 0.2,
      reasons: '深度行情数据未就绪',
    };
  }

  let score = 0;
  const reasons = [];

  const mainNet = deep.largeOrders?.main?.net;
  if (mainNet != null) {
    if (mainNet > 5e7) {
      score += 18;
      reasons.push(`主力大单净流入 ${(mainNet / 1e8).toFixed(2)} 亿`);
    } else if (mainNet < -5e7) {
      score -= 18;
      reasons.push(`主力大单净流出 ${(Math.abs(mainNet) / 1e8).toFixed(2)} 亿`);
    }
  }

  const superNet = deep.largeOrders?.tiers?.[0]?.net;
  if (superNet != null && Math.abs(superNet) > 3e7) {
    if (superNet > 0) {
      score += 10;
      reasons.push('超大单净买入');
    } else {
      score -= 10;
      reasons.push('超大单净卖出');
    }
  }

  const ts = deep.tickStats;
  if (ts?.activeBuyVolume != null && ts?.activeSellVolume != null) {
    const diff = ts.activeBuyVolume - ts.activeSellVolume;
    if (diff > 0) {
      score += 8;
      reasons.push('逐笔主动买量大于卖量');
    } else if (diff < 0) {
      score -= 8;
      reasons.push('逐笔主动卖量大于买量');
    }
  }

  if (deep.seal?.atLimitUp && deep.seal.strength != null) {
    score += deep.seal.strength > 0.5 ? 20 : 10;
    reasons.push(`涨停封单强度 ${deep.seal.strength.toFixed(2)}%`);
  } else if (deep.seal?.atLimitDown) {
    score -= 20;
    reasons.push('跌停封板，极度弱势');
  }

  const chip = deep.chip;
  if (chip?.profitRatio != null) {
    if (chip.profitRatio > 90) {
      score -= 10;
      reasons.push(`获利盘 ${chip.profitRatio.toFixed(1)}% 偏高`);
    } else if (chip.profitRatio < 20) {
      score += 8;
      reasons.push(`获利盘 ${chip.profitRatio.toFixed(1)}% 偏低`);
    }
  }
  if (chip?.peaks?.[0]) {
    reasons.push(`筹码主峰约 ${chip.peaks[0].price.toFixed(2)} 元`);
  }

  const lhb = deep.lhb?.records?.[0];
  if (lhb?.net_amount != null) {
    if (lhb.net_amount > 1e7) {
      score += 12;
      reasons.push(`最近龙虎榜净买 ${(lhb.net_amount / 1e8).toFixed(2)} 亿`);
    } else if (lhb.net_amount < -1e7) {
      score -= 12;
      reasons.push(`最近龙虎榜净卖 ${(Math.abs(lhb.net_amount) / 1e8).toFixed(2)} 亿`);
    }
  }

  const hist = deep.margin?.history || [];
  if (hist.length >= 2) {
    const last = hist[hist.length - 1];
    const prev = hist[hist.length - 2];
    if (last.rzye != null && prev.rzye != null) {
      const chg = (last.rzye - prev.rzye) / (prev.rzye || 1);
      if (chg > 0.03) {
        score += 8;
        reasons.push(`融资余额较上一日 + ${(chg * 100).toFixed(1)}%`);
      } else if (chg < -0.03) {
        score -= 6;
        reasons.push('融资余额回落');
      }
    }
  }

  return {
    horizon: 'depth',
    trend: trendFromScore(score),
    score,
    confidence: 0.6,
    reasons: buildReasons(reasons) || '深度资金与筹码信号中性',
  };
}

async function runAnalysis() {
  const { code } = config.stock;
  const tradeDate = api.todayStr();
  const minuteRows = db.getMinuteSnapshots(tradeDate, code);
  const dailyRows = db.getDailyQuotes(code, 60);

  const benchQuote = await api
    .getRealtimeQuote(
      config.benchmark.secid,
      config.benchmark.code,
      'SH'
    )
    .catch(() => null);

  const threeDayEnergy = calcThreeDayVolumeEnergy(dailyRows);
  const intraday = analyzeIntraday(minuteRows, benchQuote);
  const daily = analyzeDaily(dailyRows);
  const threeDay = analyzeThreeDay(dailyRows);
  const sentiment = await analyzeSentiment(minuteRows);
  const composite = compositeTrend([intraday, daily, threeDay, sentiment]);

  const all = [intraday, daily, threeDay, sentiment, depthSignal, composite];
  for (const s of all) {
    db.upsertSignal({
      trade_date: tradeDate,
      code,
      horizon: s.horizon,
      trend: s.trend,
      score: s.score,
      confidence: s.confidence,
      reasons: s.reasons,
    });
  }

  const closes = dailyRows.map((r) => r.close);
  return {
    tradeDate,
    code,
    name: config.stock.name,
    threeDayEnergy,
    signals: all,
    minuteCount: minuteRows.length,
    dailyCount: dailyRows.length,
    chart: buildChartData(minuteRows, dailyRows, daily.indicators),
  };
}

function buildChartData(minuteRows, dailyRows, indicators) {
  return {
    intraday: {
      labels: minuteRows.map((r) => r.trade_time),
      price: minuteRows.map((r) => r.price),
      volume: minuteRows.map((r) => r.volume),
      amount: minuteRows.map((r) => r.amount / 1e4),
      turnover: minuteRows.map((r) => r.turnover_rate),
      volumeRatio: minuteRows.map((r) => r.volume_ratio),
      amplitude: minuteRows.map((r) => r.amplitude),
      mainFlow: minuteRows.map((r) => (r.main_net_inflow || 0) / 1e4),
      pctChange: minuteRows.map((r) => r.pct_change),
    },
    daily: {
      labels: dailyRows.map((r) => r.trade_date),
      close: dailyRows.map((r) => r.close),
      volume: dailyRows.map((r) => r.volume),
      pctChange: dailyRows.map((r) => r.pct_change),
      turnover: dailyRows.map((r) => r.turnover_rate),
      volumeRatio: dailyRows.map((_, i) => {
        if (i < 5) return null;
        const avg =
          dailyRows.slice(i - 5, i).reduce((s, r) => s + r.volume, 0) / 5;
        return avg ? Math.round((dailyRows[i].volume / avg) * 100) / 100 : null;
      }),
      amplitude: dailyRows.map((r) => r.amplitude),
      ma5: dailyRows.map((_, i) => {
        if (i < 4) return null;
        return dailyRows.slice(i - 4, i + 1).reduce((s, r) => s + r.close, 0) / 5;
      }),
      ma10: dailyRows.map((_, i) => {
        if (i < 9) return null;
        return dailyRows.slice(i - 9, i + 1).reduce((s, r) => s + r.close, 0) / 10;
      }),
      ma20: dailyRows.map((_, i) => {
        if (i < 19) return null;
        return dailyRows.slice(i - 19, i + 1).reduce((s, r) => s + r.close, 0) / 20;
      }),
    },
    indicators: indicators || {},
  };
}

module.exports = {
  runAnalysis,
  calcThreeDayVolumeEnergy,
  analyzeIntraday,
  analyzeDaily,
  analyzeThreeDay,
  compositeTrend,
};
