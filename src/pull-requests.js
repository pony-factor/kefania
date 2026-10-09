import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { githubRequest } from './github.js';

export const FOOTER = '';
export const rules = () => readFile(new URL('../PULL_REQUEST.md', import.meta.url), 'utf8');
export const initialPromptBody = prompt => `## AI Prompt\n\n${prompt}`;

function repository({ owner, repo }, allowedRepositories) {
  const name = `${owner}/${repo}`;
  if (allowedRepositories.length && !allowedRepositories.some(value => value.toLowerCase() === name.toLowerCase())) {
    throw new Error('This repository is not in KEFANIA_ALLOWED_REPOSITORIES.');
  }
  return `repos/${owner}/${repo}`;
}

export function secretPath(filename) {
  return /(^|\/)(\.env(?:\..*)?|\.npmrc|\.pypirc|credentials(?:\..*)?|secrets?(?:\..*)?|id_(?:rsa|ed25519|ecdsa)|[^/]+\.(?:pem|p12|pfx|key))$/i.test(filename)
    || /(^|\/)(?:\.ssh|\.aws|\.gnupg)\//i.test(filename);
}

export function descriptionBody(body) {
  const text = body.trim();
  if (!text) throw new Error('Write a substantive PR description before publishing.');
  return text;
}

function sourceComment(source) {
  const id = createHash('sha256').update(`${source.kind}:${source.uuid}`).digest('hex');
  const marker = `<!-- kefania-source:${id} -->`;
  return {
    marker,
    body: `${marker}\nSource conversation: ${source.kind}\n\nUUID: ${source.uuid}\n\n${source.url}${source.intentSummary ? `\n\n${source.intentSummary}` : ''}`,
  };
}

export function createActions({ request = githubRequest, allowedRepositories = [] } = {}) {
  // Serializing writes for a head/base avoids duplicates when local clients race.
  const locks = new Map();
  const serial = async (key, operation) => {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(key, current);
    try { return await current; }
    finally { if (locks.get(key) === current) locks.delete(key); }
  };
  const openPr = async (root, args) => {
    const head = args.head.includes(':') ? args.head : `${args.owner}:${args.head}`;
    const query = new URLSearchParams({ state: 'open', head, base: args.base, per_page: '100' });
    const pulls = await request(`${root}/pulls?${query}`);
    return pulls.find(pr => pr.base.ref === args.base && pr.head.label.toLowerCase() === head.toLowerCase());
  };
  const recordSource = async (root, pr, source) => {
    const comment = sourceComment(source);
    for (let page = 1; ; page++) {
      const comments = await request(`${root}/issues/${pr.number}/comments?per_page=100&page=${page}`);
      const existing = comments.find(item => item.body?.startsWith(comment.marker));
      if (existing) return { recorded: true, url: existing.html_url, existing: true };
      if (comments.length < 100) break;
    }
    const created = await request(`${root}/issues/${pr.number}/comments`, { method: 'POST', body: { body: comment.body } });
    return { recorded: true, url: created.html_url, existing: false };
  };
  const provenance = async (root, pr, source) => {
    if (!source) return { recorded: false, reason: 'No originating conversation supplied.' };
    try { return await recordSource(root, pr, source); }
    catch { return { recorded: false, reason: 'PR exists, but source recording failed. Retry github_comment_pull_request_source, not PR creation.' }; }
  };
  const summary = pr => ({ number: pr.number, url: pr.html_url, head: pr.head.ref, base: pr.base.ref });
  const finalize = async (root, pr, body) => {
    try {
      await request(`${root}/pulls/${pr.number}`, { method: 'PATCH', body: { body } });
      return { finalized: true };
    } catch {
      return { finalized: false, reason: 'PR exists, but final-description update failed. Edit this PR; do not create another.' };
    }
  };
  return {
    async context(args) {
      const root = repository(args, allowedRepositories);
      const head = await request(`${root}/commits/${encodeURIComponent(args.head)}`);
      const comparison = await request(`${root}/compare/${encodeURIComponent(args.base)}...${head.sha}?per_page=100`);
      const files = (comparison.files || []).map(file => secretPath(file.filename) || secretPath(file.previous_filename || '')
        ? { filename: file.filename, omitted: 'Secret-bearing path; contents withheld.' }
        : { filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions,
            patch: file.patch?.slice(0, 30000), patchTruncated: (file.patch?.length || 0) > 30000,
            patchUnavailable: !file.patch });
      return {
        repository: `${args.owner}/${args.repo}`, head: args.head, base: args.base,
        headSha: head.sha,
        baseSha: comparison.base_commit?.sha, aheadBy: comparison.ahead_by, behindBy: comparison.behind_by,
        files, incomplete: (comparison.files?.length || 0) >= 300 || files.some(file => file.omitted || file.patchTruncated || file.patchUnavailable),
        commitsTruncated: comparison.total_commits > (comparison.commits?.length || 0),
        instructions: await rules(),
      };
    },
    async create(args) {
      const root = repository(args, allowedRepositories);
      return serial(`${root}:${args.head}:${args.base}`, async () => {
        let pr = await openPr(root, args);
        if (pr) return { ...summary(pr), existing: true, source: await provenance(root, pr, args.source) };
        const comparison = await request(`${root}/compare/${encodeURIComponent(args.base)}...${encodeURIComponent(args.head)}`);
        if (!comparison.ahead_by) throw new Error('The published head has no committed changes ahead of the base.');
        const currentSha = (await request(`${root}/commits/${encodeURIComponent(args.head)}`)).sha;
        if (currentSha !== args.expectedHeadSha) throw new Error('The head changed since drafting. Read the comparison again before publishing.');
        const finalBody = descriptionBody(args.body);
        const payload = { title: args.title, body: args.prompt === undefined ? finalBody : initialPromptBody(args.prompt), head: args.head, base: args.base, draft: args.draft ?? false,
          maintainer_can_modify: args.maintainerCanModify ?? true };
        try { pr = await request(`${root}/pulls`, { method: 'POST', body: payload }); }
        catch (error) {
          // Another process may have published after our initial read, or a
          // network failure may have happened after GitHub accepted the write.
          const existing = await openPr(root, args).catch(() => undefined);
          if (existing) return { ...summary(existing), existing: true, source: await provenance(root, existing, args.source) };
          throw error;
        }
        const description = args.prompt === undefined ? { finalized: true } : await finalize(root, pr, finalBody);
        return { ...summary(pr), existing: false, description, source: await provenance(root, pr, args.source) };
      });
    },
    async comment(args) {
      const root = repository(args, allowedRepositories);
      return serial(`${root}:${args.head}:${args.base}`, async () => {
        const pr = await openPr(root, args);
        if (!pr) throw new Error('No open pull request found for this head and base.');
        return { ...summary(pr), source: await recordSource(root, pr, args.source) };
      });
    },
    async status() {
      const identity = request.status ? await request.status() : { githubLogin: (await request('user')).login };
      return { ready: true, ...identity, allowedRepositories, writes: ['create pull request', 'add source comment', 'create issue'] };
    },
    async issue(args) {
      const root = repository(args, allowedRepositories);
      const issue = await request(`${root}/issues`, { method: 'POST', body: {
        title: args.title, body: initialPromptBody(args.prompt), labels: args.labels || [], assignees: args.assignees || [],
      } });
      try {
        await request(`${root}/issues/${issue.number}`, { method: 'PATCH', body: { body: args.body } });
        return { number: issue.number, url: issue.html_url, finalized: true };
      } catch {
        return { number: issue.number, url: issue.html_url, finalized: false,
          reason: 'Issue exists, but final-description update failed. Edit this issue; do not create another.' };
      }
    },
  };
}
