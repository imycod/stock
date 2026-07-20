const TREND_LABEL = { up: '上涨趋势', down: '下跌趋势', neutral: '震荡中性' };
const HORIZON_LABEL = {
  minute: '分钟级',
  daily: '日级',
  '3day': '3日级',
  sentiment: '市场情绪',
  composite: '综合研判',
  depth: '深度行情',
};

let charts = {};
let turnoverVolumeChart = null;
let dailyMetricChart = null;

const COLOR_UP = '#f85149';
const COLOR_DOWN = '#3fb950';

const chartDefaults = {
  responsive: true,
  maintainAspectRatio: false,
  plugins: { legend: { labels: { color: '#adbac7', boxWidth: 12 } } },
  scales: {
    x: { ticks: { color: '#8b949e', maxTicksLimit: 12 }, grid: { color: '#21262d' } },
    y: { ticks: { color: '#8b949e' }, grid: { color: '#21262d' } },
  },
};

function destroyChart(id) {
  if (charts[id]) {
    charts[id].destroy();
    delete charts[id];
  }
}

function fmtNum(n, d = 2) {
  if (n == null || Number.isNaN(n)) return '--';
  return Number(n).toFixed(d);
}

function renderThreeDayEnergy(energy) {
  const el = document.getElementById('threeDayEnergyText');
  if (!energy) {
    el.textContent = '近3天量能：--';
    el.className = 'summary-text';
    return;
  }
  el.textContent = energy.text;
  el.className = `summary-text ${energy.status || ''}`;
}

function renderSummary(quote, stats) {
  const grid = document.getElementById('summaryGrid');
  if (!quote) {
    grid.innerHTML = '<div class="stat-card"><div class="label">加载中</div></div>';
    return;
  }

  const pctClass = quote.pct_change >= 0 ? 'up' : 'down';
  const items = [
    { label: '最新价', value: fmtNum(quote.price), cls: pctClass },
    { label: '涨跌幅', value: `${quote.pct_change >= 0 ? '+' : ''}${fmtNum(quote.pct_change)}%`, cls: pctClass },
    { label: '成交额', value: `${fmtNum(quote.amount / 1e8)} 亿` },
    { label: '成交量', value: `${fmtNum(quote.volume / 10000)} 万手` },
    { label: '换手率', value: `${fmtNum(quote.turnover_rate)}%` },
    { label: '量比', value: fmtNum(quote.volume_ratio) },
    { label: '振幅', value: `${fmtNum(quote.amplitude)}%` },
    { label: '已录分钟', value: stats?.minuteCount ?? 0 },
  ];

  grid.innerHTML = items
    .map(
      (i) => `
    <div class="stat-card">
      <div class="label">${i.label}</div>
      <div class="value ${i.cls || ''}">${i.value}</div>
    </div>`
    )
    .join('');
}

function renderSignals(signals) {
  const row = document.getElementById('signalsRow');
  if (!signals?.length) {
    row.innerHTML = '';
    return;
  }

  row.innerHTML = signals
    .map((s) => {
      const isComposite = s.horizon === 'composite';
      return `
      <div class="signal-card ${s.trend} ${isComposite ? 'composite' : ''}">
        <h3>${HORIZON_LABEL[s.horizon] || s.horizon} · 得分 ${fmtNum(s.score, 1)}</h3>
        <div class="trend ${s.trend}">${TREND_LABEL[s.trend]}</div>
        <div class="reason">${s.reasons}</div>
      </div>`;
    })
    .join('');
}

function renderTurnoverVolumeEchart(daily) {
  const dom = document.getElementById('turnoverVolumeRatioChart');
  if (!dom || !daily?.labels?.length || typeof echarts === 'undefined') return;

  if (!turnoverVolumeChart) {
    turnoverVolumeChart = echarts.init(dom, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => turnoverVolumeChart?.resize());
  }

  const labels = daily.labels.map((d) => d.slice(5));
  const pctList = daily.pctChange || [];
  const turnoverList = daily.turnover || [];
  const volumeRatioList = daily.volumeRatio || [];

  const signedTurnover = turnoverList.map((v, i) => {
    const val = v || 0;
    return pctList[i] >= 0 ? val : -val;
  });

  const signedVolRatio = volumeRatioList.map((v, i) => {
    if (v == null) return null;
    return pctList[i] >= 0 ? v : -v;
  });

  const markPoints = [];
  turnoverList.forEach((v, i) => {
    if (v != null && v > 10) {
      markPoints.push({
        name: '换手>10%',
        coord: [i, signedTurnover[i]],
        value: `换手${fmtNum(v)}%`,
        symbol: 'pin',
        symbolSize: 42,
        itemStyle: { color: '#ffd700' },
        label: {
          show: true,
          formatter: '换手>10%',
          color: '#ffd700',
          fontSize: 11,
          fontWeight: 'bold',
        },
      });
    }
  });

  turnoverVolumeChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter(params) {
          const idx = params[0]?.dataIndex ?? 0;
          const pct = pctList[idx];
          const turnover = turnoverList[idx];
          const vr = volumeRatioList[idx];
          const daySign = pct >= 0 ? '正收益' : '负收益';
          return [
            `<b>${daily.labels[idx]}</b> · ${daySign}`,
            `涨跌幅：${pct >= 0 ? '+' : ''}${fmtNum(pct)}%`,
            `换手率：${fmtNum(turnover)}%`,
            `量比：${vr != null ? fmtNum(vr) : '--'}`,
          ].join('<br/>');
        },
      },
      legend: {
        data: ['换手率', '量比'],
        textStyle: { color: '#adbac7' },
        top: 0,
      },
      grid: { left: 52, right: 52, top: 40, bottom: 28 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#8b949e', rotate: 45 },
        axisLine: { lineStyle: { color: '#30363d' } },
      },
      yAxis: [
        {
          type: 'value',
          name: '换手率%',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: {
            color: '#8b949e',
            formatter: (v) => Math.abs(v).toFixed(1),
          },
          splitLine: { lineStyle: { color: '#21262d' } },
          axisLine: { onZero: true, lineStyle: { color: '#30363d' } },
        },
        {
          type: 'value',
          name: '量比',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e' },
          splitLine: { show: false },
          axisLine: { onZero: true, lineStyle: { color: '#30363d' } },
        },
      ],
      series: [
        {
          name: '换手率',
          type: 'bar',
          data: signedTurnover.map((v, i) => ({
            value: v,
            itemStyle: { color: pctList[i] >= 0 ? COLOR_UP : COLOR_DOWN },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#484f58', type: 'solid' },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
          markPoint: { data: markPoints },
        },
        {
          name: '量比',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 6,
          data: signedVolRatio.map((v, i) =>
            v == null
              ? null
              : {
                  value: v,
                  itemStyle: { color: pctList[i] >= 0 ? COLOR_UP : COLOR_DOWN },
                }
          ),
          lineStyle: { width: 2, color: '#a371f7' },
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#484f58', type: 'dashed' },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
        },
      ],
    },
    true
  );
}

function relationHint(pct, turnover, amplitude) {
  const t = turnover || 0;
  const a = amplitude || 0;
  const p = pct || 0;
  if (t > 10 && a > 8 && p > 3) return '放量高振幅上涨（多空激烈）';
  if (t > 10 && a > 8 && p < -3) return '放量高振幅下跌（恐慌抛售）';
  if (t > 10 && p > 0) return '放量上涨';
  if (t > 10 && p < 0) return '放量下跌';
  if (t < 2 && a < 3) return '缩量窄幅整理';
  if (a > 10 && Math.abs(p) < 2) return '高振幅横盘（分歧大）';
  if (p > 0 && t > 5) return '温和放量上涨';
  if (p < 0 && t > 5) return '放量回调';
  return '';
}

function renderDailyMetricEchart(daily) {
  const dom = document.getElementById('dailyMetricEchart');
  if (!dom || !daily?.labels?.length || typeof echarts === 'undefined') return;

  if (!dailyMetricChart) {
    dailyMetricChart = echarts.init(dom, null, { renderer: 'canvas' });
    window.addEventListener('resize', () => dailyMetricChart?.resize());
  }

  const labels = daily.labels.map((d) => d.slice(5));
  const pctList = daily.pctChange || [];
  const turnoverList = daily.turnover || [];
  const ampList = daily.amplitude || [];

  const maxAmp = Math.max(...ampList.filter(Boolean), 1);
  const markPoints = [];

  pctList.forEach((pct, i) => {
    const t = turnoverList[i] || 0;
    const a = ampList[i] || 0;
    const hint = relationHint(pct, t, a);
    if (hint && (t > 10 || a > 10 || (t > 5 && Math.abs(pct) > 5))) {
      markPoints.push({
        name: hint,
        coord: [i, pct],
        value: hint,
        symbol: 'roundRect',
        symbolSize: [72, 22],
        itemStyle: { color: 'rgba(210,153,34,0.85)' },
        label: { show: true, formatter: hint, color: '#0f1419', fontSize: 10 },
      });
    }
  });

  const scatterData = daily.labels.map((label, i) => ({
    name: label,
    value: [turnoverList[i] || 0, pctList[i] || 0, ampList[i] || 0],
    itemStyle: { color: pctList[i] >= 0 ? COLOR_UP : COLOR_DOWN },
  }));

  dailyMetricChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        formatter(params) {
          const bar = params.find((p) => p.seriesName === '涨跌幅') || params[0];
          const idx = bar?.dataIndex ?? 0;
          const pct = pctList[idx];
          const t = turnoverList[idx];
          const a = ampList[idx];
          const hint = relationHint(pct, t, a);
          const lines = [
            `<b>${daily.labels[idx]}</b>`,
            `涨跌幅：<span style="color:${pct >= 0 ? COLOR_UP : COLOR_DOWN}">${pct >= 0 ? '+' : ''}${fmtNum(pct)}%</span>`,
            `换手率：${fmtNum(t)}%`,
            `振幅：${fmtNum(a)}%`,
          ];
          if (hint) lines.push(`<i>${hint}</i>`);
          return lines.join('<br/>');
        },
      },
      axisPointer: { link: [{ xAxisIndex: [0, 1] }] },
      legend: {
        data: ['涨跌幅', '换手率', '振幅'],
        textStyle: { color: '#adbac7' },
        top: 0,
      },
      grid: [
        { left: 52, right: 52, top: 36, height: '48%' },
        { left: 52, right: 52, top: '62%', height: '28%' },
      ],
      xAxis: [
        {
          type: 'category',
          gridIndex: 0,
          data: labels,
          axisLabel: { show: false },
          axisLine: { lineStyle: { color: '#30363d' } },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: '换手率%',
          nameTextStyle: { color: '#8b949e', fontSize: 11 },
          axisLabel: { color: '#8b949e' },
          splitLine: { lineStyle: { color: '#21262d' } },
          axisLine: { lineStyle: { color: '#30363d' } },
        },
      ],
      yAxis: [
        {
          type: 'value',
          gridIndex: 0,
          name: '涨跌幅%',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e', formatter: '{value}%' },
          splitLine: { lineStyle: { color: '#21262d' } },
          axisLine: { onZero: true, lineStyle: { color: '#484f58', width: 2 } },
        },
        {
          type: 'value',
          gridIndex: 0,
          name: '换手/振幅%',
          nameTextStyle: { color: '#8b949e' },
          axisLabel: { color: '#8b949e' },
          splitLine: { show: false },
        },
        {
          type: 'value',
          gridIndex: 1,
          name: '涨跌幅%',
          nameTextStyle: { color: '#8b949e', fontSize: 11 },
          axisLabel: { color: '#8b949e' },
          splitLine: { lineStyle: { color: '#21262d' } },
          axisLine: { onZero: true, lineStyle: { color: '#484f58' } },
        },
      ],
      series: [
        {
          name: '涨跌幅',
          type: 'bar',
          xAxisIndex: 0,
          yAxisIndex: 0,
          barMaxWidth: 18,
          data: pctList.map((v, i) => ({
            value: v,
            itemStyle: {
              color: v >= 0 ? COLOR_UP : COLOR_DOWN,
              opacity: 0.35 + Math.min((turnoverList[i] || 0) / 15, 0.65),
              borderWidth: Math.max(1, (ampList[i] || 0) / 4),
              borderColor: '#ffd700',
            },
          })),
          markLine: {
            silent: true,
            symbol: 'none',
            lineStyle: { color: '#484f58' },
            data: [{ yAxis: 0 }],
            label: { show: false },
          },
          markPoint: { data: markPoints, symbolOffset: [0, -14] },
        },
        {
          name: '换手率',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'circle',
          symbolSize: 5,
          data: turnoverList,
          lineStyle: { width: 2, color: '#d29922' },
          itemStyle: { color: '#d29922' },
        },
        {
          name: '振幅',
          type: 'line',
          xAxisIndex: 0,
          yAxisIndex: 1,
          smooth: true,
          symbol: 'diamond',
          symbolSize: 6,
          data: ampList,
          lineStyle: { width: 2, type: 'dashed', color: '#a371f7' },
          itemStyle: { color: '#a371f7' },
        },
        {
          name: '换手-涨跌关系',
          type: 'scatter',
          xAxisIndex: 1,
          yAxisIndex: 2,
          data: scatterData,
          symbolSize: (val) => Math.max(8, ((val[2] || 0) / maxAmp) * 36),
          tooltip: {
            trigger: 'item',
            formatter(p) {
              const [t, pct, a] = p.value;
              const hint = relationHint(pct, t, a);
              return [
                `<b>${p.name}</b>`,
                `换手率 ${fmtNum(t)}% → 涨跌幅 ${pct >= 0 ? '+' : ''}${fmtNum(pct)}%`,
                `振幅 ${fmtNum(a)}%（气泡大小）`,
                hint ? `<i>${hint}</i>` : '',
              ]
                .filter(Boolean)
                .join('<br/>');
            },
          },
        },
      ],
    },
    true
  );
}

function renderCharts(chart) {
  if (!chart) return;
  const { intraday, daily } = chart;

  destroyChart('price');
  charts.price = new Chart(document.getElementById('priceChart'), {
    type: 'line',
    data: {
      labels: intraday.labels,
      datasets: [
        {
          label: '价格',
          data: intraday.price,
          borderColor: '#58a6ff',
          backgroundColor: 'rgba(88,166,255,0.08)',
          fill: true,
          tension: 0.2,
          pointRadius: 0,
        },
      ],
    },
    options: chartDefaults,
  });

  destroyChart('volume');
  charts.volume = new Chart(document.getElementById('volumeChart'), {
    type: 'bar',
    data: {
      labels: intraday.labels,
      datasets: [
        {
          label: '成交额(万)',
          data: intraday.amount,
          backgroundColor: 'rgba(210,153,34,0.6)',
          yAxisID: 'y',
        },
        {
          label: '量比',
          data: intraday.volumeRatio,
          type: 'line',
          borderColor: '#a371f7',
          pointRadius: 0,
          yAxisID: 'y1',
        },
      ],
    },
    options: {
      ...chartDefaults,
      scales: {
        ...chartDefaults.scales,
        y: { ...chartDefaults.scales.y, position: 'left' },
        y1: {
          position: 'right',
          ticks: { color: '#a371f7' },
          grid: { drawOnChartArea: false },
        },
      },
    },
  });

  destroyChart('flow');
  charts.flow = new Chart(document.getElementById('flowChart'), {
    type: 'bar',
    data: {
      labels: intraday.labels,
      datasets: [
        {
          label: '主力净流入',
          data: intraday.mainFlow,
          backgroundColor: intraday.mainFlow.map((v) =>
            v >= 0 ? 'rgba(248,81,73,0.65)' : 'rgba(63,185,80,0.65)'
          ),
        },
      ],
    },
    options: chartDefaults,
  });

  destroyChart('daily');
  charts.daily = new Chart(document.getElementById('dailyChart'), {
    type: 'line',
    data: {
      labels: daily.labels,
      datasets: [
        {
          label: '收盘',
          data: daily.close,
          borderColor: '#e7ecf3',
          pointRadius: 0,
          tension: 0.1,
        },
        {
          label: 'MA5',
          data: daily.ma5,
          borderColor: '#f85149',
          pointRadius: 0,
          borderDash: [4, 2],
        },
        {
          label: 'MA10',
          data: daily.ma10,
          borderColor: '#d29922',
          pointRadius: 0,
          borderDash: [4, 2],
        },
        {
          label: 'MA20',
          data: daily.ma20,
          borderColor: '#58a6ff',
          pointRadius: 0,
          borderDash: [4, 2],
        },
      ],
    },
    options: chartDefaults,
  });

  renderTurnoverVolumeEchart(daily);
  renderDailyMetricEchart(daily);
}


let largeOrderChart = null;
let chipChart = null;

function fmtWanFromYuan(yuan) {
  if (yuan == null || Number.isNaN(yuan)) return '--';
  return (yuan / 10000).toFixed(1);
}

function fmtYiFromYuan(yuan) {
  if (yuan == null || Number.isNaN(yuan)) return '--';
  return (yuan / 1e8).toFixed(2);
}

function renderDeep(deep) {
  const noteEl = document.getElementById('deepNote');
  const summary = document.getElementById('deepSummary');
  if (!deep) {
    noteEl.textContent = '深度行情加载中…';
    summary.innerHTML = '';
    return;
  }

  noteEl.textContent = deep.note || '';
  const seal = deep.seal || {};
  const margin = deep.margin || {};
  const chip = deep.chip || {};
  const ts = deep.tickStats || {};

  const items = [
    { label: '封单状态', value: seal.label || '--' },
    {
      label: '封单强度',
      value: seal.strength != null ? `${fmtNum(seal.strength, 2)}%` : '--',
    },
    { label: '融资余额', value: margin.rzye != null ? `${fmtYiFromYuan(margin.rzye)} 亿` : '--' },
    { label: '融券余额', value: margin.rqye != null ? `${fmtYiFromYuan(margin.rqye)} 亿` : '--' },
    {
      label: '平均成本',
      value: chip.avgCost != null ? `${fmtNum(chip.avgCost)} 元` : '--',
    },
    {
      label: '获利盘',
      value: chip.profitRatio != null ? `${fmtNum(chip.profitRatio, 1)}%` : '--',
    },
    {
      label: '逐笔买/卖量',
      value: `${ts.activeBuyVolume ?? '--'} / ${ts.activeSellVolume ?? '--'}`,
    },
    {
      label: '主力大单净额',
      value: `${fmtWanFromYuan(deep.largeOrders?.main?.net)} 万`,
    },
  ];

  summary.innerHTML = items
    .map(
      (i) => `
    <div class="stat-card">
      <div class="label">${i.label}</div>
      <div class="value">${i.value}</div>
    </div>`
    )
    .join('');

  renderLargeOrderChart(deep.largeOrders);
  renderChipChart(deep.chip, deep.tickStats?.prePrice);
  renderTickTable(deep.ticks);
  renderLhbTable(deep.lhb);
  renderLhbSeats(deep.lhb?.seats);
}

function renderLargeOrderChart(largeOrders) {
  const dom = document.getElementById('largeOrderChart');
  if (!dom || typeof echarts === 'undefined' || !largeOrders?.tiers?.length) return;
  if (!largeOrderChart) {
    largeOrderChart = echarts.init(dom);
    window.addEventListener('resize', () => largeOrderChart?.resize());
  }

  const labels = largeOrders.tiers.map((t) => t.label);
  const buy = largeOrders.tiers.map((t) => (t.buy || 0) / 10000);
  const sell = largeOrders.tiers.map((t) => -(t.sell || 0) / 10000);
  const net = largeOrders.tiers.map((t) => (t.net || 0) / 10000);

  largeOrderChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: { trigger: 'axis' },
      legend: { data: ['买入', '卖出', '净额'], textStyle: { color: '#adbac7' } },
      grid: { left: 48, right: 24, top: 36, bottom: 28 },
      xAxis: {
        type: 'category',
        data: labels,
        axisLabel: { color: '#8b949e' },
      },
      yAxis: {
        type: 'value',
        name: '万元',
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          name: '买入',
          type: 'bar',
          stack: 'flow',
          data: buy,
          itemStyle: { color: COLOR_UP },
        },
        {
          name: '卖出',
          type: 'bar',
          stack: 'flow',
          data: sell,
          itemStyle: { color: COLOR_DOWN },
        },
        {
          name: '净额',
          type: 'line',
          data: net,
          smooth: true,
          lineStyle: { color: '#58a6ff', width: 2 },
        },
      ],
    },
    true
  );
}

function renderChipChart(chip, refPrice) {
  const dom = document.getElementById('chipChart');
  if (!dom || typeof echarts === 'undefined' || !chip?.bins?.length) return;
  if (!chipChart) {
    chipChart = echarts.init(dom);
    window.addEventListener('resize', () => chipChart?.resize());
  }

  const prices = chip.bins.map((b) => b.price);
  const vols = chip.bins.map((b) => b.volume);

  const markLine = refPrice
    ? {
        silent: true,
        symbol: 'none',
        lineStyle: { color: '#58a6ff', type: 'dashed' },
        data: [{ xAxis: refPrice, name: '现价' }],
      }
    : undefined;

  chipChart.setOption(
    {
      backgroundColor: 'transparent',
      tooltip: {
        trigger: 'axis',
        formatter(params) {
          const p = params[0];
          return `价格 ${p.name}<br/>筹码量 ${Number(p.value).toFixed(0)}`;
        },
      },
      grid: { left: 48, right: 16, top: 20, bottom: 28 },
      xAxis: {
        type: 'category',
        data: prices.map((p) => p.toFixed(2)),
        axisLabel: { color: '#8b949e', interval: Math.floor(prices.length / 8) },
      },
      yAxis: {
        type: 'value',
        axisLabel: { color: '#8b949e' },
        splitLine: { lineStyle: { color: '#21262d' } },
      },
      series: [
        {
          type: 'bar',
          data: vols,
          itemStyle: { color: 'rgba(163,113,247,0.75)' },
          markLine,
        },
      ],
    },
    true
  );
}

function renderTickTable(ticks) {
  const el = document.getElementById('tickTable');
  if (!el) return;
  if (!ticks?.length) {
    el.innerHTML = '<p class="chart-desc">暂无逐笔数据</p>';
    return;
  }
  const rows = [...ticks].reverse().slice(0, 80);
  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>时间</th><th>价</th><th>量</th><th>方向</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (t) => `
          <tr>
            <td>${t.time}</td>
            <td>${fmtNum(t.price)}</td>
            <td>${t.volume}</td>
            <td class="${t.side === 2 ? 'up' : t.side === 1 ? 'down' : ''}">${t.side_label}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderLhbTable(lhb) {
  const el = document.getElementById('lhbTable');
  if (!el) return;
  const rows = lhb?.records || [];
  if (!rows.length) {
    el.innerHTML = '<p class="chart-desc">近期无龙虎榜记录</p>';
    return;
  }
  el.innerHTML = `
    <table class="data-table">
      <thead><tr><th>日期</th><th>涨跌%</th><th>净买额</th><th>原因</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>
            <td>${r.trade_date}</td>
            <td class="${r.pct_change >= 0 ? 'up' : 'down'}">${fmtNum(r.pct_change, 2)}%</td>
            <td class="${r.net_amount >= 0 ? 'up' : 'down'}">${fmtWanFromYuan(r.net_amount)}万</td>
            <td>${(r.reason || '').slice(0, 36)}</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

function renderLhbSeats(seats) {
  const el = document.getElementById('lhbSeats');
  if (!el) return;
  if (!seats) {
    el.innerHTML = '<p class="chart-desc">无席位明细</p>';
    return;
  }
  const rows = [
    ...(seats.buy || []).map((s) => ({ ...s, side: '买' })),
    ...(seats.sell || []).map((s) => ({ ...s, side: '卖' })),
  ];
  el.innerHTML = `
    <p class="chart-desc">${seats.trade_date} 席位</p>
    <table class="data-table">
      <thead><tr><th>方向</th><th>营业部</th><th>金额</th></tr></thead>
      <tbody>
        ${rows
          .map(
            (r) => `
          <tr>
            <td class="${r.side === '买' ? 'up' : 'down'}">${r.side}</td>
            <td>${(r.dept || '').slice(0, 40)}</td>
            <td>${fmtWanFromYuan(r.amount)}万</td>
          </tr>`
          )
          .join('')}
      </tbody>
    </table>`;
}

async function refreshAll() {
  try {
    const [statusRes, quoteRes, analysisRes] = await Promise.all([
      fetch('/api/status'),
      fetch('/api/quote'),
      fetch('/api/analysis?refresh=1'),
    ]);

    const status = await statusRes.json();
    const quote = await quoteRes.json();
    const analysis = await analysisRes.json();

    document.getElementById('tradingBadge').textContent = status.trading
      ? '交易中 · 自动采集'
      : '非交易时段';
    document.getElementById('tradingBadge').className = `badge ${status.trading ? 'live' : 'closed'}`;

    document.getElementById('recordBadge').textContent = `已记录 ${status.stats?.minuteCount || 0} 条分钟数据`;
    document.getElementById('updateBadge').textContent = quote?.updated_at
      ? `更新 ${new Date(quote.updated_at).toLocaleTimeString('zh-CN')}`
      : '--';

    renderSummary(quote, status.stats);
    renderThreeDayEnergy(analysis.threeDayEnergy);
    renderSignals(analysis.signals);
    renderCharts(analysis.chart);
    renderDeep(analysis.deep);
  } catch (e) {
    console.error(e);
  }
}

async function manualCollect() {
  await fetch('/api/collect', { method: 'POST' });
  await refreshAll();
}

refreshAll();
setInterval(refreshAll, 60000);
