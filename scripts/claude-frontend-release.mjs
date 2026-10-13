import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repository = 'kobejordanair-bit/----vs-';
const sha = value => /^[a-f0-9]{40}$/.test(value || '');
const git = (...args) => execFileSync('git', args, {maxBuffer: 40 * 1024 * 1024});
export function allowedFile(name) {
  if (name.includes('..') || /[\\\x00-\x1f]/.test(name)) return false;
  if (/^backend\/(index|history-lab|source-archive)\.html$/.test(name)) return true;
  if (['backend/manifest.json', 'backend/sw.js'].includes(name)) return true;
  if (/^backend\/static\/(css|js)\/[a-zA-Z0-9_./-]+\.(css|js)$/.test(name)) return true;
  return /^backend\/static\/art\/[a-zA-Z0-9_./-]+\.(png|jpg|jpeg|webp|gif|svg|woff|woff2|ttf)$/.test(name);
}
// Only the first line is the command. Text after it (such as an attribution footer added by
// the posting tool) is ignored; authority still comes from the commenter's write permission and the exact SHA.
export function parseDeployComment(body) {
  const first = String(body || '').replace(/^\s+/, '').split(/\r?\n/, 1)[0].trim();
  return first.match(/^\/deploy-dynasty ([a-f0-9]{40})$/)?.[1] || null;
}
export function checkEntries(entries) {
  for (const item of entries) {
    if (!allowedFile(item.path)) throw new Error(`Outside frontend release scope: ${item.path}`);
    if (!['A', 'M', 'D'].includes(item.status)) throw new Error(`Unsupported change: ${item.status}`);
    if (item.status !== 'D' && item.mode !== '100644') throw new Error(`Not a regular asset: ${item.path}`);
    if (item.size > 25 * 1024 * 1024) throw new Error(`Asset too large: ${item.path}`);
  }
  if (entries.length > 200) throw new Error('Release exceeds 200 changed frontend files');
  return entries;
}
async function api(endpoint, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${repository}/${endpoint}`, {
    ...options,
    headers: {Authorization: `Bearer ${process.env.GH_TOKEN}`, 'User-Agent': 'dynasty-frontend-release',
      Accept: 'application/vnd.github+json', 'Content-Type': 'application/json'},
  });
  const body = await response.json();
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message || 'request failed'}`);
  return body;
}
async function prepare() {
  if (process.env.GITHUB_REPOSITORY !== repository) throw new Error('Unexpected repository');
  const event = JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8'));
  let number, expected, actor;
  if (process.env.GITHUB_EVENT_NAME === 'issue_comment') {
    if (!event.issue?.pull_request || event.action !== 'created') throw new Error('Requires a new PR comment');
    const requested = parseDeployComment(event.comment.body);
    if (!requested) throw new Error('Expected /deploy-dynasty followed by exact head SHA on the first line');
    number = event.issue.number; expected = requested; actor = event.comment.user.login;
  } else if (process.env.GITHUB_EVENT_NAME === 'workflow_dispatch') {
    number = Number(event.inputs.pr); expected = event.inputs.sha; actor = event.sender.login;
  } else throw new Error('Unsupported event');
  const permission = await api(`collaborators/${encodeURIComponent(actor)}/permission`);
  if (!['admin', 'maintain', 'write'].includes(permission.permission)) throw new Error('Requester needs repository write permission');
  const base = git('rev-parse', 'HEAD').toString().trim();
  if (!sha(base) || process.env.GITHUB_REF !== 'refs/heads/main') throw new Error('Workflow must run from main');
  const entries = [];
  if (number !== 0) {
    if (!Number.isSafeInteger(number) || number < 1 || !sha(expected)) throw new Error('Invalid PR/SHA');
    const pr = await api(`pulls/${number}`);
    if (pr.state !== 'open' || pr.draft || pr.base.ref !== 'main' || pr.head.repo.full_name !== repository ||
        !pr.head.ref.startsWith('claude/') || pr.head.sha !== expected) throw new Error('Requires an open same-repository claude/* PR at exact SHA');
    git('fetch', '--no-tags', 'origin', `pull/${number}/head`);
    const fetched = git('rev-parse', 'FETCH_HEAD').toString().trim();
    if (fetched !== expected || git('merge-base', base, expected).toString().trim() !== base) throw new Error('PR changed or needs rebase onto current main');
    const fields = git('diff', '--no-renames', '--name-status', '-z', base, expected).toString().split('\0').filter(Boolean);
    for (let i = 0; i < fields.length; i += 2) {
      const status = fields[i], name = fields[i + 1];
      let mode, size = 0;
      if (status !== 'D') {
        const tree = git('ls-tree', '-z', expected, '--', name).toString();
        mode = tree.split(' ')[0];
        size = Number(git('cat-file', '-s', `${expected}:${name}`).toString());
      }
      entries.push({status, path: name, mode, size});
    }
    checkEntries(entries); // Validate the entire diff BEFORE writing any candidate asset.
    if (!entries.length) throw new Error('PR has no frontend changes');
    for (const entry of entries) {
      const target = path.resolve(entry.path);
      if (entry.status === 'D') fs.unlinkSync(target);
      else { fs.mkdirSync(path.dirname(target), {recursive: true}); fs.writeFileSync(target, git('show', `${expected}:${entry.path}`)); }
    }
  } else if (process.env.GITHUB_EVENT_NAME !== 'workflow_dispatch' || expected !== base) {
    throw new Error('No-op verification requires the exact current main SHA');
  }
  const receipt = {pr: number, head: number ? expected : base, base, files: entries, createdAt: new Date().toISOString()};
  fs.writeFileSync('frontend-release.json', JSON.stringify(receipt, null, 2));
  fs.appendFileSync(process.env.GITHUB_OUTPUT, `tag=frontend-${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT}\n`);
}
export async function verifyLiveAsset(name, bytes, {fetchAsset = fetch, pause = ms => new Promise(resolve => setTimeout(resolve, ms)), attempts = 13} = {}) {
  const route = name === 'backend/index.html' ? '/play' : '/' + name.slice('backend/'.length);
  const digest = value => crypto.createHash('sha256').update(value).digest('hex');
  const expected = digest(bytes);
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetchAsset(`https://dynasty.piamamba.com${route}?release=${process.env.GITHUB_RUN_ID}&verify=${attempt}`, {cache: 'no-store', signal: AbortSignal.timeout(15000)});
      if (response.ok && digest(Buffer.from(await response.arrayBuffer())) === expected) return;
    } catch { /* Retry transient network failures during global propagation. */ }
    if (attempt + 1 < attempts) await pause(5000);
  }
  throw new Error(`Live asset verification failed after bounded propagation retries: ${name}`);
}
async function finish() {
  const receipt = JSON.parse(fs.readFileSync('frontend-release.json', 'utf8'));
  // Check public bytes without executing submitted HTML or JavaScript.
  const paths = new Set(['backend/index.html', ...receipt.files.filter(x => x.status !== 'D').map(x => x.path)]);
  for (const name of paths) {
    await verifyLiveAsset(name, fs.readFileSync(name));
  }
  receipt.liveAssetsVerified = true;
  if (receipt.pr) {
    const current = await api('git/ref/heads/main');
    if (current.object.sha !== receipt.base) throw new Error('Production deployed, but main changed: merge needs reconciliation');
    const result = await api(`pulls/${receipt.pr}/merge`, {method: 'PUT', body: JSON.stringify({sha: receipt.head, merge_method: 'merge'})});
    if (!result.merged) throw new Error('Production deployed, merge did not complete');
    receipt.merge = result.sha;
  }
  receipt.status = 'deployed_verified';
  fs.writeFileSync('frontend-release.json', JSON.stringify(receipt, null, 2));
  fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `## Dynasty frontend deployed\n\n- Commit: ${receipt.head}\n- PR: ${receipt.pr || 'current main verification'}\n- Live assets: verified\n- No data import or database migration was run.\n`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'prepare') await prepare();
    else if (process.argv[2] === 'finish') await finish();
    else throw new Error('Use prepare or finish');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
