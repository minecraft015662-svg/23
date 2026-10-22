// Packages the theme and every addon into server/releases and writes server/registry.json
// Needs only Node.js and the system `tar` command (no jq).
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const out = path.join(root, 'server', 'releases');
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

const tar = (file, dir) => execFileSync('tar', ['-czf', file, '-C', dir, '.']);
tar(path.join(out, 'theme.tar.gz'), path.join(root, 'theme', 'overlay'));

const registry = [];
const addonsDir = path.join(root, 'addons');
for (const name of fs.readdirSync(addonsDir).sort()) {
  const dir = path.join(addonsDir, name);
  const meta = path.join(dir, 'addon.json');
  if (!fs.statSync(dir).isDirectory() || !fs.existsSync(meta)) continue;
  tar(path.join(out, `addon-${name}.tar.gz`), dir);
  registry.push(JSON.parse(fs.readFileSync(meta, 'utf8')));
}
fs.writeFileSync(path.join(root, 'server', 'registry.json'), JSON.stringify(registry, null, 2));
console.log(`Built theme + ${registry.length} addons into ${out}`);
