(async () => {
  const headers = {
    "User-Agent": "Mozilla/5.0",
    Referer: "https://data.eastmoney.com/",
  };
  async function get(url) {
    const r = await fetch(url, { headers, signal: AbortSignal.timeout(20000) });
    return r.json();
  }

  let found = [];
  for (let page=1; page<=15; page++) {
    const j = await get(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=50&page_index=${page}&ann_type=A&stock_list=600759&f_node=0&s_node=0`);
    const list = j.data?.list||[];
    if (!list.length) break;
    for (const a of list) {
      if (/实施.*风险警示|撤销.*风险警示|实行.*ST|被实施ST|其他风险警示|退市风险警示/.test(a.title||'')) {
        found.push({date:a.notice_date?.slice(0,10), title:a.title, art:a.art_code});
      }
    }
  }
  console.log('found', found.length);
  found.forEach(x=>console.log(x.date, x.title));

  // Try to get announcement content for latest 实施
  if (found[0]) {
    const art = found.find(x=>/实施其他风险警示|实施退市风险警示|被实施/.test(x.title) && !/进展/.test(x.title)) || found[0];
    console.log('\nchosen', art);
    // content API
    const contentUrls = [
      `https://np-cnotice-stock.eastmoney.com/api/content/ann?art_code=${art.art}&page_index=1&page_size=1`,
      `https://data.eastmoney.com/notices/detail/${art.art}.html`,
    ];
    for (const u of contentUrls) {
      try {
        const r = await fetch(u, {headers, signal:AbortSignal.timeout(15000)});
        const t = await r.text();
        console.log('\nurl', u.slice(0,80), 'len', t.length);
        console.log(t.slice(0,800).replace(/\s+/g,' '));
      } catch(e){ console.log('err', e.message); }
    }
  }

  // Another stock *ST for comparison - from BK0511
  const clist = await get('https://push2delay.eastmoney.com/api/qt/clist/get?pn=1&pz=3&po=1&np=1&fltt=2&invt=2&fid=f3&fs=b:BK0511&fields=f12,f14&ut=fa5fd1943c7b386f172d6893dbfba107');
  console.log('\nST samples', clist.data?.diff);
})().catch(console.error);
