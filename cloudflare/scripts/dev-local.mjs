#!/usr/bin/env node
// An isolated local preview: synthetic password, separate empty D1, no AI key.
import fs from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const configPath = path.join(root, 'build/local/wrangler.json');
const config = JSON.parse(await fs.readFile(path.join(root, 'wrangler.jsonc'), 'utf8'));
config.name = 'dynasty-local';
delete config.account_id;
delete config.routes;
config.main = path.join(root, 'src/runtime.mjs');
config.assets.directory = path.join(root, 'build/assets');
config.workers_dev = false;
config.d1_databases = [{ binding: 'DYNASTY_DB', database_name: 'dynasty-local-data' }];
config.vars = { ...config.vars, APP_SECRET: 'test-local-dynasty', DATA_READY: 'true', ALLOWED_ORIGINS: 'http://127.0.0.1:8878' };
config.migrations = [{ tag: 'v1', new_sqlite_classes: ['DynastyApi'] }];
await fs.mkdir(path.dirname(configPath), { recursive: true });
await fs.writeFile(configPath, JSON.stringify(config, null, 2));
const cli = path.join(root, 'node_modules/wrangler/bin/wrangler.js');
const persist = path.join(root, '.wrangler/local-preview');
const environment = { ...process.env, WRANGLER_SEND_METRICS: 'false', WRANGLER_LOG_PATH: path.join(root, 'build/logs') };
// This preview must never inherit the real provider key from the parent process.
delete environment.GOOGLE_API_KEY;
delete environment.CLOUDFLARE_API_TOKEN;
delete environment.CLOUDFLARE_API_KEY;
function run(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args, '--config', configPath], { cwd: root, env: environment, stdio: 'inherit', windowsHide: true });
    child.on('error', reject);
    child.on('exit', code => code === 0 ? resolve() : reject(new Error('Local preview process failed')));
    process.once('SIGINT', () => child.kill('SIGINT'));
  });
}
await run(['d1', 'execute', 'DYNASTY_DB', '--local', '--file', path.join(root, 'migrations/0001_storage.sql'), '--persist-to', persist, '--yes']);
console.log('Local preview: http://127.0.0.1:8878/play; test password: test-local-dynasty; separate local saves; AI key not configured.');
await run(['dev', '--local', '--ip', '127.0.0.1', '--port', '8878', '--persist-to', persist]);
