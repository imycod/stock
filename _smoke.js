(async () => {
  const { fetchStInfo, isStName, runScreen } = (() => {
    // fetchStInfo not exported - test via require and internal by re-reading
    const mod = require('./src/exportSmall');
    return mod;
  })();
  console.log('exports', Object.keys(require('./src/exportSmall')));
  console.log('isST', require('./src/exportSmall').isStName('ST洲际'), require('./src/exportSmall').isStName('华之杰'));
})().catch(console.error);
