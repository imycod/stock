const fs = require('fs');
for (const f of ['public-small/app.js','src/serverSmall.js','src/exportSmall.js']) {
  try { require('child_process').execSync('node --check '+f, {stdio:'pipe'}); console.log('OK', f); }
  catch(e){ console.log('FAIL', f, e.stderr?.toString()||e.message); }
}
const t = fs.readFileSync('public-small/app.js','utf8');
const i = t.indexOf('tbody.innerHTML');
console.log('snippet:', JSON.stringify(t.slice(i, i+180)));
console.log('has literal backslash-dollar', t.includes('\\${'));
console.log('has proper ${escapeHtml', t.includes('${escapeHtml'));
