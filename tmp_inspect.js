const fs = require('fs');
const t = fs.readFileSync('src/exportSmall.js','utf8');
const lines = t.split(/\r?\n/);
console.log('lines', lines.length);
const fns = [];
for (const line of lines) {
  if (/^(async )?function /.test(line)) fns.push(line.trim());
}
console.log(fns.join('\n'));
console.log('--- has module.exports?', /module\.exports/.test(t));
console.log('--- main call?', /main\(\)\.catch/.test(t));
