// Regenerates the precache list + content-hash VERSION inside sw.js.
// Usage: node scripts/build-sw.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', 'public');
const include = ['index.html', 'manifest.webmanifest', 'css', 'js', 'fonts', 'icons', 'vendor'];
const skip = f => /(^|\/)(LICENSE|\.DS_Store)|\.map$|\.md$|\.txt$/.test(f);
const files = [];
const walk = rel => {
  const abs = path.join(root, rel);
  if (fs.statSync(abs).isDirectory()) fs.readdirSync(abs).sort().forEach(f => walk(path.join(rel, f)));
  else if (!skip(rel)) files.push(rel.split(path.sep).join('/'));
};
include.forEach(walk);
const h = crypto.createHash('sha256');
for (const f of files) h.update(f).update(fs.readFileSync(path.join(root, f)));
const swPath = path.join(root, 'sw.js');
let sw = fs.readFileSync(swPath, 'utf8');
const body = sw.replace(/\/\/ <precache>[\s\S]*?\/\/ <\/precache>/, '');
h.update(body);
const version = h.digest('hex').slice(0, 10);
const list = ['/', ...files.map(f => '/' + f)];
sw = sw.replace(/\/\/ <precache>[\s\S]*?\/\/ <\/precache>/,
  `// <precache>\nconst VERSION = '${version}';\nconst PRECACHE = ${JSON.stringify(list, null, 2)};\n// </precache>`);
fs.writeFileSync(swPath, sw);
console.log(`sw.js updated: version ${version}, ${list.length} files`);
