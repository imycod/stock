/**
 * 基于日 K 的筹码分布近似（将每日成交量在 [low, high] 区间均匀分配）
 */

function roundPrice(p, step) {
  return Math.round(p / step) * step;
}

function buildChipBins(dailyRows, step = 0.01) {
  if (!dailyRows?.length) return { bins: [], avgCost: null, peaks: [] };

  const map = new Map();
  let totalVol = 0;
  let costSum = 0;

  for (const row of dailyRows) {
    const vol = row.volume || 0;
    if (vol <= 0) continue;
    const low = row.low ?? row.close;
    const high = row.high ?? row.close;
    if (low == null || high == null) continue;

    const lo = Math.min(low, high);
    const hi = Math.max(low, high);
    const span = hi - lo;
    if (span <= step) {
      const key = roundPrice((lo + hi) / 2, step);
      map.set(key, (map.get(key) || 0) + vol);
      costSum += key * vol;
      totalVol += vol;
      continue;
    }

    const steps = Math.max(1, Math.round(span / step));
    const slice = vol / steps;
    for (let i = 0; i <= steps; i++) {
      const price = roundPrice(lo + (span * i) / steps, step);
      map.set(price, (map.get(price) || 0) + slice);
      costSum += price * slice;
      totalVol += slice;
    }
  }

  const bins = [...map.entries()]
    .map(([price, volume]) => ({ price, volume }))
    .sort((a, b) => a.price - b.price);

  const avgCost = totalVol > 0 ? costSum / totalVol : null;
  const peaks = findPeaks(bins, totalVol);

  return { bins, avgCost, peaks, totalVolume: totalVol };
}

function findPeaks(bins, totalVol) {
  if (bins.length < 3 || !totalVol) return [];

  const peaks = [];
  for (let i = 1; i < bins.length - 1; i++) {
    const prev = bins[i - 1].volume;
    const cur = bins[i].volume;
    const next = bins[i + 1].volume;
    if (cur >= prev && cur >= next && cur > totalVol * 0.02) {
      peaks.push({
        price: bins[i].price,
        volume: cur,
        ratio: cur / totalVol,
      });
    }
  }

  peaks.sort((a, b) => b.volume - a.volume);
  if (peaks.length) return peaks.slice(0, 5);

  return bins
    .map((b) => ({ price: b.price, volume: b.volume, ratio: b.volume / totalVol }))
    .sort((a, b) => b.volume - a.volume)
    .slice(0, 3);
}

function profitRatioAtPrice(bins, totalVol, currentPrice) {
  if (!currentPrice || !totalVol || !bins.length) return null;
  let below = 0;
  for (const b of bins) {
    if (b.price <= currentPrice) below += b.volume;
  }
  return (below / totalVol) * 100;
}

module.exports = {
  buildChipBins,
  profitRatioAtPrice,
};