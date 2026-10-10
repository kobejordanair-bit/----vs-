// Claude author-mode provenance constants. Kept free of imports from
// import.mjs so the importer can use them without a module cycle.
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CLAUDE_PROVIDER = 'Claude Code (Anthropic)';
export const CHATGPT_PROVIDER = 'ChatGPT web';
const policyText = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), '..', 'author-policy.v2.json'), 'utf8');
export const AUTHOR_POLICY_SHA256 = createHash('sha256').update(policyText, 'utf8').digest('hex');
export const AUTHOR_POLICY_FILE = 'analysis-batch-51-100/author-policy.v2.json';

export function validClaudeSessionUrl(value) {
  let url; try { url = new URL(value); } catch { return false; }
  return url.protocol === 'https:' && url.hostname === 'claude.ai' && /^\/code\/session_[A-Za-z0-9]+$/.test(url.pathname)
    && !url.username && !url.password && !url.search && !url.hash;
}

export function validClaudeProvenance(provenance) {
  return provenance?.provider === CLAUDE_PROVIDER && validClaudeSessionUrl(provenance.sessionUrl)
    && provenance.authorPolicySha256 === AUTHOR_POLICY_SHA256 && provenance.conversationUrl === undefined;
}
