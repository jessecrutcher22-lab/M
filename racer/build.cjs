/* build.js — bundles the game into one self-contained HTML file.
 *
 *   node racer/build.cjs
 *
 * The multi-file source under racer/ is the thing you edit; this just
 * concatenates it so the game can be handed around as a single file.
 * Two outputs:
 *   dist/apex-rush.html           a complete standalone page
 *   dist/apex-rush.fragment.html  the same without <html>/<head>/<body>,
 *                                 for hosts that supply their own skeleton
 */
const fs = require('fs');
const path = require('path');

const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

const css = fs.readFileSync(path.join(root, 'css/style.css'), 'utf8');

// Script order comes from index.html itself, so the two can never drift.
const srcs = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map(m => m[1]);
const js = srcs.map(s =>
  '/* ===== ' + s + ' ===== */\n' + fs.readFileSync(path.join(root, s), 'utf8')
).join('\n');

const bootMatch = html.match(/<script>\n([\s\S]*?)<\/script>/);
const boot = bootMatch ? bootMatch[1] : '';

const title = (html.match(/<title>([^<]*)<\/title>/) || [, 'Apex Rush'])[1];
const body = html
  .slice(html.indexOf('<canvas id="view">'), html.indexOf('<script src='))
  .trim();

const fragment =
  '<title>' + title + '</title>\n' +
  '<style>\n' + css + '\n</style>\n\n' +
  body + '\n\n' +
  '<script>\n' + js + '\n</script>\n' +
  '<script>\n' + boot + '</script>\n';

const standalone =
  '<!DOCTYPE html>\n<html lang="en">\n<head>\n' +
  '<meta charset="utf-8">\n' +
  '<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">\n' +
  '<link rel="icon" href="data:image/svg+xml,<svg xmlns=\'http://www.w3.org/2000/svg\' viewBox=\'0 0 100 100\'><text y=\'.9em\' font-size=\'90\'>🏎️</text></svg>">\n' +
  fragment.replace('<title>', '<title>') +
  '</head>\n<body>\n</body>\n</html>\n';

// The fragment already carries <title>/<style>; for the standalone file put the
// markup and scripts in the body where they belong.
const headEnd = standalone.indexOf('</style>') + '</style>'.length;
const finalStandalone =
  standalone.slice(0, headEnd) + '\n</head>\n<body>\n' +
  fragment.slice(fragment.indexOf('</style>') + '</style>'.length).trim() +
  '\n</body>\n</html>\n';

fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/apex-rush.html'), finalStandalone);
fs.writeFileSync(path.join(root, 'dist/apex-rush.fragment.html'), fragment);
console.log('dist/apex-rush.html          ' + (finalStandalone.length / 1024).toFixed(0) + ' KB');
console.log('dist/apex-rush.fragment.html ' + (fragment.length / 1024).toFixed(0) + ' KB');
console.log('bundled ' + srcs.length + ' scripts: ' + srcs.join(' '));
