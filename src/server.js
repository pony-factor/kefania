import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

import { formatConversationSourceComment, sourceMarker } from './provenance.js';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'windsoruwu-codex-drafter/0.1.0';
const DEFAULT_BANNER_LINK = 'https://youtu.be/DkUEHMfQw-I';
const PULL_REQUEST_INSTRUCTIONS = readFileSync(
  new URL('../PULL_REQUEST.md', import.meta.url),
  'utf8'
).trim();
const CONVERSATION_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const conversationSourceSchema = z.object({
  kind: z.enum(['chatgpt', 'codex']),
  uuid: z.string().regex(CONVERSATION_UUID, 'Conversation source uuid must be a UUID.'),
  url: z.string().url(),
  intentSummary: z.string().max(800).optional()
});

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function ownerFor(input) {
  return input?.trim() || process.env.GITHUB_DEFAULT_OWNER?.trim() || requiredEnv('GITHUB_DEFAULT_OWNER');
}

async function githubRequest(path, init = {}) {
  const token = requiredEnv('GITHUB_TOKEN');
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': API_VERSION,
      'User-Agent': USER_AGENT,
      ...(init.headers ?? {})
    }
  });

  const text = await response.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = text;
  }

  if (!response.ok) {
    const detail = typeof payload === 'object' && payload?.message ? payload.message : String(payload ?? response.statusText);
    throw new Error(`GitHub ${response.status}: ${detail}`);
  }

  return payload;
}

function toolResult(value) {
  return {
    content: [{ type: 'text', text: JSON.stringify(value, null, 2) }],
    structuredContent: value
  };
}

function toolError(error) {
  return {
    isError: true,
    content: [{ type: 'text', text: error instanceof Error ? error.message : String(error) }]
  };
}

function authorshipFooter() {
  const bannerUrl = process.env.CODEX_BANNER_URL?.trim() || '';
  const bannerLink = process.env.CODEX_BANNER_LINK?.trim() || DEFAULT_BANNER_LINK;
  const image = bannerUrl
    ? `<a href="${bannerLink}"><img src="${bannerUrl}" alt="Written by Codex — AI assisted, human directed" width="100%"></a>`
    : `<a href="${bannerLink}">Written by Codex // AI assisted · human directed</a>`;

  return `<details>\n<summary>🤖 <strong>AI-assisted authorship</strong></summary>\n<br>\n${image}\n</details>`;
}

function withPullRequestStyle(body) {
  const normalized = String(body ?? '').trimEnd();
  const footer = authorshipFooter();
  return normalized ? `${normalized}\n\n${footer}` : footer;
}

function initialPromptBody(prompt) {
  return `## AI Prompt\n\n${String(prompt ?? '')}`;
}

function repoPath(owner, repo, suffix) {
  return `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}${suffix}`;
}

async function addConversationSourceComment(owner, repo, number, source) {
  const marker = sourceMarker(source);
  const comments = await githubRequest(repoPath(owner, repo, `/issues/${number}/comments?per_page=100`));
  const existing = Array.isArray(comments)
    ? comments.find(comment => String(comment?.body ?? '').includes(marker))
    : undefined;
  if (existing) return existing.html_url;

  const comment = await githubRequest(repoPath(owner, repo, `/issues/${number}/comments`), {
    method: 'POST',
    body: JSON.stringify({ body: formatConversationSourceComment(source) })
  });
  return comment?.html_url;
}

async function findOpenPullRequest(owner, repo, head, base) {
  const query = new URLSearchParams({
    state: 'open',
    head: `${owner}:${head}`,
    base,
    per_page: '20'
  });
  const pulls = await githubRequest(repoPath(owner, repo, `/pulls?${query}`));
  if (!Array.isArray(pulls)) return undefined;
  return pulls.find(pull => pull?.head?.ref === head && pull?.base?.ref === base);
}

function buildServer() {
  const server = new McpServer(
    { name: 'codex-drafter', version: '0.1.0' },
    {
      instructions:
        'Use these tools only for explicit GitHub write requests. Pass the user\'s original input verbatim in prompt and the finished GitHub text in body. The server first publishes ## AI Prompt plus prompt, then replaces that body with the final message. Pull requests default to draft and receive the server-owned authorship footer. Follow these canonical pull-request drafting instructions whenever preparing a pull request:\n\n' + PULL_REQUEST_INSTRUCTIONS
    }
  );

  server.registerTool(
    'github_create_issue',
    {
      title: 'Create GitHub issue',
      description: 'Create an issue, first recording the original AI prompt in its edit history, then replacing it with the final body.',
      inputSchema: z.object({
        owner: z.string().min(1).optional().describe('Repository owner. Falls back to GITHUB_DEFAULT_OWNER.'),
        repo: z.string().min(1),
        title: z.string().min(1),
        prompt: z.string().min(1).describe('Original user input, copied verbatim without trimming or rewriting.'),
        body: z.string().default('').describe('Final issue body that replaces the initial AI Prompt body.'),
        labels: z.array(z.string().min(1)).optional(),
        assignees: z.array(z.string().min(1)).optional()
      })
    },
    async ({ owner, repo, title, prompt, body, labels, assignees }) => {
      try {
        const resolvedOwner = ownerFor(owner);
        const issue = await githubRequest(`/repos/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repo)}/issues`, {
          method: 'POST',
          body: JSON.stringify({
            title,
            body: initialPromptBody(prompt),
            ...(labels?.length ? { labels } : {}),
            ...(assignees?.length ? { assignees } : {})
          })
        });

        await githubRequest(
          `/repos/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repo)}/issues/${issue.number}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ body })
          }
        );

        return toolResult({
          number: issue.number,
          url: issue.html_url,
          repository: `${resolvedOwner}/${repo}`,
          title: issue.title
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'github_create_pull_request',
    {
      title: 'Create GitHub pull request',
      description: 'Create a styled pull request using Kafania\'s canonical drafting rules, preserve the original AI prompt in edit history, and optionally add a conversation-source comment.',
      inputSchema: z.object({
        owner: z.string().min(1).optional().describe('Repository owner. Falls back to GITHUB_DEFAULT_OWNER.'),
        repo: z.string().min(1),
        title: z.string().min(1),
        prompt: z.string().min(1).describe('Original user input, copied verbatim without trimming or rewriting.'),
        body: z.string().default('').describe('Final pull request body that replaces the initial AI Prompt body.'),
        head: z.string().min(1),
        base: z.string().min(1).default('main'),
        draft: z.boolean().default(true),
        maintainerCanModify: z.boolean().default(true),
        source: conversationSourceSchema.optional().describe(
          'Originating ChatGPT or Codex conversation. Preserve the actual UUID and URL. intentSummary may briefly describe the conversation goal rather than the final diff.'
        )
      })
    },
    async ({ owner, repo, title, prompt, body, head, base, draft, maintainerCanModify, source }) => {
      try {
        const resolvedOwner = ownerFor(owner);
        const pull = await githubRequest(`/repos/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repo)}/pulls`, {
          method: 'POST',
          body: JSON.stringify({
            title,
            body: initialPromptBody(prompt),
            head,
            base,
            draft,
            maintainer_can_modify: maintainerCanModify
          })
        });

        await githubRequest(
          `/repos/${encodeURIComponent(resolvedOwner)}/${encodeURIComponent(repo)}/pulls/${pull.number}`,
          {
            method: 'PATCH',
            body: JSON.stringify({ body: withPullRequestStyle(body) })
          }
        );

        let sourceCommentUrl;
        let sourceCommentError;
        if (source) {
          try {
            sourceCommentUrl = await addConversationSourceComment(
              resolvedOwner,
              repo,
              pull.number,
              source
            );
          } catch (error) {
            sourceCommentError = error instanceof Error ? error.message : String(error);
          }
        }

        return toolResult({
          number: pull.number,
          url: pull.html_url,
          repository: `${resolvedOwner}/${repo}`,
          title: pull.title,
          draft: pull.draft,
          head: pull.head?.ref,
          base: pull.base?.ref,
          ...(sourceCommentUrl ? { sourceCommentUrl } : {}),
          ...(sourceCommentError ? { sourceCommentError } : {})
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  server.registerTool(
    'github_comment_pull_request_source',
    {
      title: 'Comment pull request conversation source',
      description: 'Add the formatted originating ChatGPT or Codex conversation link to an existing pull request. Repeated calls for the same source UUID are deduplicated.',
      inputSchema: z.object({
        owner: z.string().min(1).optional().describe('Repository owner. Falls back to GITHUB_DEFAULT_OWNER.'),
        repo: z.string().min(1),
        number: z.number().int().positive().optional(),
        head: z.string().min(1).optional(),
        base: z.string().min(1).default('main'),
        source: conversationSourceSchema
      })
    },
    async ({ owner, repo, number, head, base, source }) => {
      try {
        const resolvedOwner = ownerFor(owner);
        let pullNumber = number;
        if (!pullNumber) {
          if (!head) throw new Error('Provide either number or head to identify the pull request.');
          const pull = await findOpenPullRequest(resolvedOwner, repo, head, base);
          if (!pull) throw new Error(`No open pull request found for ${head} against ${base}.`);
          pullNumber = pull.number;
        }
        const commentUrl = await addConversationSourceComment(
          resolvedOwner,
          repo,
          pullNumber,
          source
        );
        return toolResult({
          number: pullNumber,
          repository: `${resolvedOwner}/${repo}`,
          sourceCommentUrl: commentUrl
        });
      } catch (error) {
        return toolError(error);
      }
    }
  );

  return server;
}

function splitHost(hostHeader) {
  if (!hostHeader) return '';
  if (hostHeader.startsWith('[')) return hostHeader.slice(1, hostHeader.indexOf(']'));
  return hostHeader.split(':')[0];
}

function constantTimeTokenMatch(expected, actual) {
  const a = Buffer.from(expected);
  const b = Buffer.from(actual);
  return a.length === b.length && timingSafeEqual(a, b);
}

function requestIsAuthorized(req, bearerToken) {
  if (!bearerToken) return true;
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return false;
  return constantTimeTokenMatch(bearerToken, header.slice('Bearer '.length));
}

async function serveHttp() {
  const host = process.env.MCP_HOST?.trim() || '127.0.0.1';
  const port = Number(process.env.MCP_PORT || 8787);
  const bearerToken = process.env.MCP_BEARER_TOKEN?.trim() || '';
  const publicHostname = process.env.MCP_PUBLIC_HOSTNAME?.trim() || '';
  const loopbackHosts = new Set(['127.0.0.1', '::1', 'localhost']);
  const isLoopback = loopbackHosts.has(host);

  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('MCP_PORT must be a valid TCP port');
  if (!isLoopback && !bearerToken) throw new Error('MCP_BEARER_TOKEN is required when MCP_HOST is not loopback');
  if (!isLoopback && !publicHostname) throw new Error('MCP_PUBLIC_HOSTNAME is required when MCP_HOST is not loopback');

  const handler = createMcpHandler(buildServer);
  const nodeHandler = toNodeHandler(handler);

  const httpServer = createServer((req, res) => {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, server: 'codex-drafter' }));
      return;
    }

    if (url.pathname !== '/mcp') {
      res.writeHead(404).end();
      return;
    }

    const requestHost = splitHost(req.headers.host);
    const expectedHost = isLoopback ? null : publicHostname;
    if ((isLoopback && !loopbackHosts.has(requestHost)) || (expectedHost && requestHost !== expectedHost)) {
      res.writeHead(403).end('Invalid Host');
      return;
    }

    if (req.headers.origin) {
      try {
        const originHost = new URL(req.headers.origin).hostname;
        if ((isLoopback && !loopbackHosts.has(originHost)) || (expectedHost && originHost !== expectedHost)) {
          res.writeHead(403).end('Invalid Origin');
          return;
        }
      } catch {
        res.writeHead(403).end('Invalid Origin');
        return;
      }
    }

    if (!requestIsAuthorized(req, bearerToken)) {
      res.writeHead(401, { 'www-authenticate': 'Bearer' }).end('Unauthorized');
      return;
    }

    void nodeHandler(req, res);
  });

  httpServer.listen(port, host, () => {
    console.error(`codex-drafter MCP listening on http://${host}:${port}/mcp`);
  });

  const shutdown = async () => {
    httpServer.close();
    await handler.close();
  };

  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
}

if (process.argv.includes('--stdio')) {
  await serveStdio(buildServer);
} else {
  await serveHttp();
}
