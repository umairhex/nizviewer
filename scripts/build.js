'use strict';
const fs = require('fs');
const path = require('path');

const ROOT_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

const FILES_TO_COPY = [
  'background.js',
  'content.js',
  'popup.html',
  'popup.js',
  'styles.css',
  'features.html',
  'icons',
  'scripts',
];

function copyRecursiveSync(src, dest) {
  const exists = fs.existsSync(src);
  const stats = exists && fs.statSync(src);
  const isDirectory = exists && stats.isDirectory();
  if (isDirectory) {
    if (!fs.existsSync(dest)) fs.mkdirSync(dest, { recursive: true });
    fs.readdirSync(src).forEach((childItemName) => {
      copyRecursiveSync(path.join(src, childItemName), path.join(dest, childItemName));
    });
  } else {
    fs.copyFileSync(src, dest);
  }
}

function buildTarget(target) {
  const targetDir = path.join(DIST_DIR, target);
  if (fs.existsSync(targetDir)) {
    fs.rmSync(targetDir, { recursive: true, force: true });
  }
  fs.mkdirSync(targetDir, { recursive: true });

  for (const item of FILES_TO_COPY) {
    const srcPath = path.join(ROOT_DIR, item);
    const destPath = path.join(targetDir, item);
    if (fs.existsSync(srcPath)) {
      copyRecursiveSync(srcPath, destPath);
    }
  }

  const manifestPath = path.join(ROOT_DIR, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

  if (target === 'chrome') {
    manifest.background = {
      service_worker: 'background.js',
    };
  } else if (target === 'firefox') {
    manifest.background = {
      scripts: ['background.js'],
    };
  }

  fs.writeFileSync(
    path.join(targetDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf8',
  );
}

const arg = process.argv[2] || 'all';
if (arg === 'chrome' || arg === 'all') buildTarget('chrome');
if (arg === 'firefox' || arg === 'all') buildTarget('firefox');
