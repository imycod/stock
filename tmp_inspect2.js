const fs = require('fs');
const t = fs.readFileSync('src/exportSmall.js', 'utf8');
// dump critical sections with line numbers for patching
const lines = t.split(/\r?\n/);
function show(re, ctx=2) {
  lines.forEach((l,i) => {
    if (re.test(l)) console.log(String(i+1).padStart(4), l);
  });
}
show(/isStName|includeST|async function main|fetchMainBoardList|enrichFundamentals|module\.exports|resolveOptions|DEFAULTS/);
console.log('\n--- resolveOptions ---');
console.log(lines.slice(108, 160).join('\n'));
console.log('\n--- fetchMainBoard filter ---');
const i = lines.findIndex(l => /isStName\(name\)/.test(l));
console.log(lines.slice(i-5, i+15).join('\n'));
console.log('\n--- main end ---');
console.log(lines.slice(-30).join('\n'));
