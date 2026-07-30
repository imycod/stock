(async () => {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://data.eastmoney.com/notices/",
  };
  async function get(url) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    const t = await r.text();
    try { return JSON.parse(t); } catch { return {_raw:t.slice(0,500)}; }
  }

  const art = 'AN202604271821646696';
  const urls = [
    `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${art}&client_source=web&page_index=1&page_size=1`,
    `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${art}&client_source=web`,
    `https://np-anotice-stock.eastmoney.com/api/content/ann?art_code=${art}&client_source=web&page_index=1&page_size=1`,
  ];
  for (const u of urls) {
    const j = await get(u);
    console.log('\n==', u.slice(40,100));
    console.log(Object.keys(j));
    console.log(JSON.stringify(j).slice(0,1500));
  }
})().catch(console.error);
