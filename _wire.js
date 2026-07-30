const fs = require('fs');

// package.json
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8').replace(/^\uFEFF/, ''));
pkg.scripts['start:small'] = 'node src/serverSmall.js';
pkg.scripts['small'] = 'node src/serverSmall.js';
fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n', 'utf8');

// config.js - add smallPort
let cfg = fs.readFileSync('config.js', 'utf8');
if (!cfg.includes('smallPort')) {
  cfg = cfg.replace(
    'port: process.env.PORT || 3009,',
    "port: process.env.PORT || 3009,\n  smallPort: process.env.SMALL_PORT || 3010,"
  );
  fs.writeFileSync('config.js', cfg, 'utf8');
}
console.log('scripts', pkg.scripts);
console.log('config has smallPort', fs.readFileSync('config.js','utf8').includes('smallPort'));
