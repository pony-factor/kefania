import { timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';

import { toNodeHandler } from '@modelcontextprotocol/node';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const API_VERSION = '2022-11-28';
const USER_AGENT = 'windsoruwu-codex-drafter/0.1.0';
const DEFAULT_BANNER_LINK = 'https://youtu.be/DkUEHMfQw-I';

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

function buildServer() {
  const server = new McpServer(
    { name: 'codex-drafter', version: '0.1.0' },
    {
      instructions:
        'Use these tools only for explicit GitHub write requests. Pass the user\'s original input verbatim in prompt and the finished GitHub text in body. The server first publishes ## AI Prompt plus prompt, then replaces that body with the final message. Pull requests default to draft and receive the server-owned authorship footer.'
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
      description: 'Create a styled pull request, first recording the original AI prompt in its edit history, then replacing it with the final body.',
      inputSchema: z.object({
        owner: z.string().min(1).optional().describe('Repository owner. Falls back to GITHUB_DEFAULT_OWNER.'),
        repo: z.string().min(1),
        title: z.string().min(1),
        prompt: z.string().min(1).describe('Original user input, copied verbatim without trimming or rewriting.'),
        body: z.string().default('').describe('Final pull request body that replaces the initial AI Prompt body.'),
        head: z.string().min(1),
        base: z.string().min(1).default('main'),
        draft: z.boolean().default(true),
        maintainerCanModify: z.boolean().default(true)
      })
    },
    async ({ owner, repo, title, prompt, body, head, base, draft, maintainerCanModify }) => {
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

        return toolResult({
          number: pull.number,
          url: pull.html_url,
          repository: `${resolvedOwner}/${repo}`,
          title: pull.title,
          draft: pull.draft,
          head: pull.head?.ref,
          base: pull.base?.ref
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
