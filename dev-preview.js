/* Standalone launcher for PHP Studio's preview server (no Electron needed).
 * Serves the bundled sample sites through the WordPress shim on port 8471,
 * so the preview can be inspected in a plain browser. */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = __dirname;
const PORT = process.env.PS_PORT || 8471;
const docroot = path.join(ROOT, 'samples');
const target = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(docroot, 'pa-site.php');

const inst = require('./main/instrument.js').instrument(fs.readFileSync(target, 'utf8'));
const tmp = path.join(ROOT, '.tmp', 'dev-preview-target.php');
fs.mkdirSync(path.dirname(tmp), { recursive: true });
fs.writeFileSync(tmp, inst.instrumented);

const proc = spawn(path.join(ROOT, 'php', 'php.exe'),
  ['-S', '127.0.0.1:' + PORT, path.join(ROOT, 'shim', 'router.php')], {
    cwd: docroot,
    env: { ...process.env, PS_DOCROOT: docroot, PS_SHIMDIR: path.join(ROOT, 'shim'), PS_TARGET: tmp },
    stdio: 'inherit',
    windowsHide: true,
  });
console.log(`PHP Studio preview server → http://127.0.0.1:${PORT}/  (serving ${path.basename(target)})`);
proc.on('exit', (c) => process.exit(c || 0));
