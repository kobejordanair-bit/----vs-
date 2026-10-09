#!/usr/bin/env node
/** Build only the existing public website, never backend code or private backups. */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { LARGE_JSON_PATHS } from '../src/static-assets.mjs';

export const MAX_ASSET_BYTES = 25 * 1024 * 1024;
export const FREE_ASSET_LIMIT = 20_000;
const ROOT_FILES = ['index.html', 'history-lab.html', 'source-archive.html', 'manifest.json', 'sw.js'];
const PUBLIC_EXTENSIONS = new Set(['.js', '.css', '.json', '.gz', '.md', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.svg', '.ico', '.txt', '.xml', '.woff', '.woff2', '.ttf']);
const PRIVATE_FILE = /^(?:\.env(?:\..*)?|gcp_key(?:\..*)?|private-library\.json|legends_v\d.*\.json|.*\.(?:pem|key|p12|pfx))$/i;
const CSP = "default-src 'self'; script-src 'self'; worker-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'";
const sha256 = body => crypto.createHash('sha256').update(body).digest('hex');
const posix = value => value.split(path.sep).join('/');

function assertInside(target, parent) {
  const relative = path.relative(parent, target);
  if (!relative || relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) {
    throw new Error(`Build target must be inside ${parent}`);
  }
}

function publicFiles(root) {
  const result = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const absolute = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`Public assets cannot contain symbolic links: ${absolute}`);
      if (entry.isDirectory()) { walk(absolute); continue; }
      if (!entry.isFile()) throw new Error(`Unsupported asset: ${absolute}`);
      if (PRIVATE_FILE.test(entry.name) || !PUBLIC_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        throw new Error(`Unexpected or private file in public assets: ${absolute}`);
      }
      result.push(absolute);
    }
  }
  walk(root);
  return result;
}

function headersFile(gzipPaths, releaseNames) {
  const sections = ['/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: strict-origin-when-cross-origin'];
  for (const route of ['/', '/index.html', '/play', '/manifest.json', '/sw.js']) {
    sections.push(`${route}\n  Cache-Control: no-cache, no-store, must-revalidate`);
  }
  for (const route of ['/history-lab', '/history-lab.html', '/source-archive', '/source-archive.html']) {
    sections.push(`${route}\n  Cache-Control: no-cache, no-store, must-revalidate\n  Content-Security-Policy: ${CSP}`);
  }
  for (const name of releaseNames) {
    sections.push(`/static/data/history/web/releases/${name}/*\n  Cache-Control: public, max-age=31536000, immutable`);
  }
  for (const route of ['/static/icon-192.png', '/static/icon-512.png']) {
    sections.push(`${route}\n  Cache-Control: public, max-age=31536000, immutable`);
  }
  for (const route of gzipPaths) {
    sections.push(`${route}\n  Content-Type: application/json; charset=utf-8\n  Content-Encoding: gzip\n  Vary: Accept-Encoding\n  Cache-Control: no-cache`);
  }
  if (sections.length > 100 || sections.some(section => section.split('\n').some(line => line.length > 2000))) {
    throw new Error('Cloudflare _headers limit exceeded');
  }
  return sections.join('\n\n') + '\n';
}

/** repoRoot may be a fixture for testing; deployment builds use this repository. */
export function buildAssets(repoRoot, options = {}) {
  const root = fs.realpathSync(repoRoot);
  const backend = path.join(root, 'backend');
  const staticRoot = path.join(backend, 'static');
  if (fs.lstatSync(staticRoot).isSymbolicLink()) throw new Error('Public static root cannot be a symbolic link');
  const cloudflareRoot = path.join(root, 'cloudflare');
  if (fs.existsSync(cloudflareRoot) && fs.lstatSync(cloudflareRoot).isSymbolicLink()) throw new Error('Cloudflare build parent cannot be a symbolic link');
  const buildRoot = path.join(root, 'cloudflare', 'build');
  const output = path.join(buildRoot, 'assets');
  const pending = path.join(buildRoot, `assets-pending-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  assertInside(output, buildRoot);
  assertInside(pending, buildRoot);
  if (fs.existsSync(buildRoot) && fs.lstatSync(buildRoot).isSymbolicLink()) throw new Error('Build directory cannot be a symbolic link');
  fs.mkdirSync(pending, { recursive: true });
  const files = [];
  const gzipPaths = [];
  let gzipPairsVerified = 0;
  let sourceBytes = 0;
  const maxAssetBytes = options.maxAssetBytes ?? MAX_ASSET_BYTES;
  const maxAssetCount = options.maxAssetCount ?? FREE_ASSET_LIMIT;
  function write(relative, body, extra = {}) {
    if (body.length > maxAssetBytes) throw new Error(`Asset exceeds ${maxAssetBytes} bytes: ${relative}`);
    const absolute = path.join(pending, ...relative.split('/'));
    assertInside(absolute, pending);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, body);
    files.push({ path: relative, bytes: body.length, sha256: sha256(body), ...extra });
  }
  try {
    const versionMatch = fs.readFileSync(path.join(backend, 'main.py'), 'utf8').match(/^APP_VERSION\s*=\s*["']([^"']+)["']/m);
    if (!versionMatch) throw new Error('APP_VERSION is missing');
    const version = versionMatch[1];
    for (const name of ROOT_FILES) {
      const source = path.join(backend, name);
      if (fs.lstatSync(source).isSymbolicLink()) throw new Error(`Root asset cannot be a symbolic link: ${name}`);
      let body = fs.readFileSync(source);
      const originalHash = sha256(body);
      if (name === 'manifest.json') {
        const manifest = JSON.parse(body.toString('utf8'));
        for (const icon of manifest.icons ?? []) {
          if (typeof icon.src === 'string' && !icon.src.includes('?')) icon.src += `?v=${version}`;
        }
        body = Buffer.from(JSON.stringify(manifest, null, 2) + '\n');
      }
      sourceBytes += fs.statSync(source).size;
      write(name, body, { source: `backend/${name}`, sourceSha256: originalHash, mode: name === 'manifest.json' ? 'manifest-icon-version' : 'copy' });
    }
    const staticFiles = publicFiles(staticRoot);
    const staticFilesSet = new Set(staticFiles);
    for (const source of staticFiles) {
      const relative = `static/${posix(path.relative(staticRoot, source))}`;
      const original = fs.readFileSync(source);
      const originalHash = sha256(original);
      sourceBytes += original.length;
      if (source.endsWith('.gz')) {
        const canonical = source.slice(0, -3);
        if (!staticFilesSet.has(canonical)) throw new Error(`Gzip asset is missing its canonical source: ${relative}`);
        const decoded = zlib.gunzipSync(original);
        if (sha256(decoded) !== sha256(fs.readFileSync(canonical))) throw new Error(`Gzip contents do not match source: ${relative}`);
        gzipPairsVerified++;
      }
      if (original.length > maxAssetBytes) {
        if (!source.endsWith('.json')) throw new Error(`Oversized asset cannot be compressed as JSON: ${relative}`);
        if (!LARGE_JSON_PATHS.has('/' + relative)) throw new Error(`Oversized JSON route is not registered for Worker content encoding: ${relative}`);
        const compressed = zlib.gzipSync(original, { level: 9, mtime: 0 });
        if (sha256(zlib.gunzipSync(compressed)) !== originalHash) throw new Error(`Generated gzip verification failed: ${relative}`);
        write(relative, compressed, { source: `backend/${relative}`, sourceSha256: originalHash, sourceBytes: original.length, mode: 'gzip-canonical' });
        if (!staticFilesSet.has(`${source}.gz`)) {
          write(`${relative}.gz`, compressed, { source: `backend/${relative}`, sourceSha256: originalHash, sourceBytes: original.length, mode: 'gzip-download' });
        }
        gzipPaths.push(`/${relative}`);
      } else {
        write(relative, original, { source: `backend/${relative}`, sourceSha256: originalHash, mode: 'copy' });
      }
    }
    const releasesRoot = path.join(staticRoot, 'data', 'history', 'web', 'releases');
    const releaseNames = fs.existsSync(releasesRoot) ? fs.readdirSync(releasesRoot).filter(name => /^[a-f0-9]{16}$/.test(name)).sort() : [];
    write('_headers', Buffer.from(headersFile(gzipPaths, releaseNames)), { mode: 'generated-routing' });
    write('_redirects', Buffer.from('/ /index.html 200\n/play /index.html 200\n/history-lab /history-lab.html 200\n/source-archive /source-archive.html 200\n'), { mode: 'generated-routing' });
    const assetCount = files.filter(file => !['_headers', '_redirects'].includes(file.path)).length;
    if (assetCount > maxAssetCount) throw new Error(`Static asset count ${assetCount} exceeds ${maxAssetCount}`);
    const deployedPaths = new Set(files.map(file => '/' + file.path));
    for (const name of ROOT_FILES.filter(file => file.endsWith('.html'))) {
      const html = fs.readFileSync(path.join(pending, name), 'utf8');
      for (const match of html.matchAll(/(?:src|href)\s*=\s*["'](\/(?:static\/[^"']+|manifest\.json|sw\.js))["']/g)) {
        const resource = match[1].split('?')[0].split('#')[0];
        if (!deployedPaths.has(resource)) throw new Error(`HTML resource missing from deployment: ${name} -> ${resource}`);
      }
    }
    let archive = null;
    const sourceManifest = path.join(staticRoot, 'data', 'history', 'web', 'manifest.json');
    if (fs.existsSync(sourceManifest)) {
      const manifest = JSON.parse(fs.readFileSync(sourceManifest, 'utf8'));
      archive = { version: manifest.version, summary: manifest.summary };
      function verifyPaths(value) {
        if (typeof value === 'string' && value.startsWith('/static/') && !value.includes('{')) {
          if (!deployedPaths.has(value)) throw new Error(`Archive manifest resource missing: ${value}`);
        } else if (Array.isArray(value)) value.forEach(verifyPaths);
        else if (value && typeof value === 'object') Object.values(value).forEach(verifyPaths);
      }
      verifyPaths(manifest);
      const documentsDir = path.join(pending, 'static', 'data', 'history', 'web', 'releases', manifest.version, 'documents');
      if (fs.existsSync(documentsDir)) {
        const documentCount = fs.readdirSync(documentsDir).filter(name => name.endsWith('.json')).length;
        if (documentCount !== manifest.summary.documents) throw new Error(`Archive document count mismatch: ${documentCount} != ${manifest.summary.documents}`);
        archive.verifiedDocumentFiles = documentCount;
      }
    }
    const report = {
      format: 'dynasty-cloudflare-assets', schemaVersion: 1, appVersion: version,
      generatedAt: new Date().toISOString(), sourceRoot: 'backend/', output: 'cloudflare/build/assets/',
      sourceFiles: staticFiles.length + ROOT_FILES.length, sourceBytes,
      outputFiles: files.length, assetCount, totalBytes: files.reduce((sum, file) => sum + file.bytes, 0),
      largestFile: files.reduce((largest, file) => file.bytes > (largest?.bytes ?? -1) ? { path: file.path, bytes: file.bytes } : largest, null),
      limits: { maximumFiles: maxAssetCount, maximumFileBytes: maxAssetBytes },
      gzipPairsVerified, gzipCanonicalPaths: gzipPaths.sort(), archive, files,
    };
    let previous = null;
    if (fs.existsSync(output)) {
      if (fs.lstatSync(output).isSymbolicLink()) throw new Error('Asset output cannot be a symbolic link');
      assertInside(fs.realpathSync(output), fs.realpathSync(buildRoot));
      previous = path.join(buildRoot, `assets-previous-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
      assertInside(previous, buildRoot);
      fs.renameSync(output, previous);
    }
    try { fs.renameSync(pending, output); }
    catch (error) {
      if (previous) fs.renameSync(previous, output);
      throw error;
    }
    if (previous) {
      assertInside(fs.realpathSync(previous), fs.realpathSync(buildRoot));
      fs.rmSync(previous, { recursive: true });
    }
    fs.writeFileSync(path.join(buildRoot, 'assets-report.json'), JSON.stringify(report, null, 2) + '\n');
    return report;
  } catch (error) {
    if (fs.existsSync(pending)) {
      assertInside(fs.realpathSync(pending), fs.realpathSync(buildRoot));
      fs.rmSync(pending, { recursive: true });
    }
    throw error;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
  const report = buildAssets(repoRoot);
  const { files, ...summary } = report;
  console.log(JSON.stringify(summary, null, 2));
}
