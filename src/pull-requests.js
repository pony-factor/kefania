import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { githubRequest, githubCliRequest } from './github.js';
import { loadPreferences, writingInstructions } from './preferences.js';

export const FOOTER = '';
export const rules = async () => (await readFile(new URL('../PULL_REQUEST.md', import.meta.url), 'utf8')) + '\n\n' + writingInstructions(await loadPreferences());
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

export function createActions({ request = githubRequest,
  upstreamRequest = request === githubRequest ? githubCliRequest : request, allowedRepositories = [] } = {}) {
  // A fork's GitHub user may publish to an upstream without installing codex-pony.
  // The default local transport uses gh only for explicitly selected fork PRs.
  // Hosted deployments use the explicitly injected App transport throughout.
  const selection = args => {
    const root = repository(args, allowedRepositories);
    const target = args.owner + '/' + args.repo;
    const source = args.headRepository || target;
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(source)) {
      throw new Error('headRepository must be an owner/repo name.');
    }
    const cross = source.toLowerCase() !== target.toLowerCase();
    return { root, target, source, cross,
      qualifiedHead: source.split('/')[0] + ':' + args.head,
      api: cross ? upstreamRequest : request };
  };
  const verifyFork = async scope => {
    if (!scope.cross) return;
    const fork = await scope.api('repos/' + scope.source);
    if (!fork.fork || fork.full_name?.toLowerCase() !== scope.source.toLowerCase()
        || (fork.parent?.full_name?.toLowerCase() !== scope.target.toLowerCase()
            && fork.source?.full_name?.toLowerCase() !== scope.target.toLowerCase())) {
      throw new Error('headRepository must be a fork of the selected upstream repository.');
    }
  };
  const comparisonPath = (scope, args) => scope.root + '/compare/'
    + encodeURIComponent(scope.cross ? args.owner + ':' + args.base : args.base)
    + '...' + encodeURIComponent(scope.cross ? scope.qualifiedHead : args.head);
  const readHead = (scope, args) => scope.api('repos/' + scope.source + '/commits/' + encodeURIComponent(args.head));
  // Serializing writes for a head/base avoids duplicates when local clients race.
  const locks = new Map();
  const serial = async (key, operation) => {
    const previous = locks.get(key) || Promise.resolve();
    const current = previous.catch(() => {}).then(operation);
    locks.set(key, current);
    try { return await current; }
    finally { if (locks.get(key) === current) locks.delete(key); }
  };
  // New PR is a branch-level action: do not produce a second open PR for a
  // different base (including when the head belongs to a fork).
  const openPr = async scope => {
    const query = new URLSearchParams({ state: 'open', head: scope.qualifiedHead, per_page: '100' });
    const pulls = await scope.api(scope.root + '/pulls?' + query);
    return pulls.find(pr => pr.head.label?.toLowerCase() === scope.qualifiedHead.toLowerCase()
      && pr.head.repo?.full_name?.toLowerCase() === scope.source.toLowerCase());
  };
  const recordSource = async (root, pr, source, api = request) => {
    const comment = sourceComment(source);
    for (let page = 1; ; page++) {
      const comments = await api(`${root}/issues/${pr.number}/comments?per_page=100&page=${page}`);
      const existing = comments.find(item => item.body?.startsWith(comment.marker));
      if (existing) return { recorded: true, url: existing.html_url, existing: true };
      if (comments.length < 100) break;
    }
    const created = await api(`${root}/issues/${pr.number}/comments`, { method: 'POST', body: { body: comment.body } });
    return { recorded: true, url: created.html_url, existing: false };
  };
  const provenance = async (root, pr, source, api = request) => {
    if (!source) return { recorded: false, reason: 'No originating conversation supplied.' };
    try { return await recordSource(root, pr, source, api); }
    catch { return { recorded: false, reason: 'PR exists, but source recording failed. Retry github_comment_pull_request_source, not PR creation.' }; }
  };
  const summary = (pr, scope) => ({ number: pr.number, url: pr.html_url, head: pr.head.ref,
    base: pr.base.ref, ...(scope.cross ? { repository: scope.target, headRepository: scope.source } : {}) });
  const finalize = async (root, pr, body, api = request) => {
    try {
      await api(`${root}/pulls/${pr.number}`, { method: 'PATCH', body: { body } });
      return { finalized: true };
    } catch {
      return { finalized: false, reason: 'PR exists, but final-description update failed. Edit this PR; do not create another.' };
    }
  };
  return {
    async context(args) {
      const scope = selection(args);
      if (!scope.cross && args.head === args.base) throw new Error('Choose a head branch other than the base.');
      await verifyFork(scope);
      const head = await readHead(scope, args);
      const comparison = await scope.api(comparisonPath(scope, args) + '?per_page=100');
      const existing = await openPr(scope);
      if (scope.cross && comparison.head_commit?.sha !== head.sha) {
        throw new Error('The fork head changed during comparison. Read the comparison again.');
      }
      const files = (comparison.files || []).map(file => secretPath(file.filename) || secretPath(file.previous_filename || '')
        ? { filename: file.filename, omitted: 'Secret-bearing path; contents withheld.' }
        : { filename: file.filename, status: file.status, additions: file.additions, deletions: file.deletions,
            patch: file.patch?.slice(0, 30000), patchTruncated: (file.patch?.length || 0) > 30000,
            patchUnavailable: !file.patch });
      return {
        repository: scope.target, ...(scope.cross ? { headRepository: scope.source } : {}),
        head: args.head, base: args.base, headSha: head.sha,
        ...(existing ? { existingPullRequest: summary(existing, scope) } : {}),
        baseSha: comparison.base_commit?.sha, aheadBy: comparison.ahead_by, behindBy: comparison.behind_by,
        files, incomplete: (comparison.files?.length || 0) >= 300 || files.some(file => file.omitted || file.patchTruncated || file.patchUnavailable),
        commitsTruncated: comparison.total_commits > (comparison.commits?.length || 0),
        instructions: await rules(),
      };
    },
    async create(args) {
      const scope = selection(args);
      if (!scope.cross && args.head === args.base) throw new Error('Choose a head branch other than the base.');
      return serial(scope.root + ':' + scope.source + ':' + args.head + ':' + args.base, async () => {
        await verifyFork(scope);
        let pr = await openPr(scope);
        if (pr) return { ...summary(pr, scope), existing: true,
          source: await provenance(scope.root, pr, args.source, scope.api) };
        const comparison = await scope.api(comparisonPath(scope, args));
        if (!comparison.ahead_by) throw new Error('The published head has no committed changes ahead of the base.');
        const currentSha = (await readHead(scope, args)).sha;
        if (currentSha !== args.expectedHeadSha || (scope.cross && comparison.head_commit?.sha !== currentSha)) {
          throw new Error('The head changed since drafting. Read the comparison again before publishing.');
        }
        const finalBody = descriptionBody(args.body);
        const payload = { title: args.title, body: args.prompt === undefined ? finalBody : initialPromptBody(args.prompt),
          head: scope.cross ? scope.qualifiedHead : args.head, base: args.base,
          draft: args.draft ?? false, maintainer_can_modify: args.maintainerCanModify ?? true,
          ...(scope.cross ? { head_repo: scope.source.split('/')[1] } : {}) };
        try { pr = await scope.api(scope.root + '/pulls', { method: 'POST', body: payload }); }
        catch (error) {
          const existing = await openPr(scope).catch(() => undefined);
          if (existing) return { ...summary(existing, scope), existing: true,
            source: await provenance(scope.root, existing, args.source, scope.api) };
          throw error;
        }
        const description = args.prompt === undefined ? { finalized: true }
          : await finalize(scope.root, pr, finalBody, scope.api);
        return { ...summary(pr, scope), existing: false, description,
          source: await provenance(scope.root, pr, args.source, scope.api) };
      });
    },
    async comment(args) {
      const scope = selection(args);
      return serial(scope.root + ':' + scope.source + ':' + args.head + ':' + args.base, async () => {
        await verifyFork(scope);
        const pr = await openPr(scope);
        if (!pr) throw new Error('No open pull request found for this head and base.');
        return { ...summary(pr, scope), source: await recordSource(scope.root, pr, args.source, scope.api) };
      });
    },
    async status() {
      const identity = request.status ? await request.status() : { githubLogin: (await request('user')).login };
      return { ready: true, ...identity, allowedRepositories, writes: ['create pull request', 'create upstream pull request from fork', 'add source comment', 'create issue'] };
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
