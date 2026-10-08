#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createMcpServer } from './server.js';
import { createActions } from './pull-requests.js';
import { createHttpApp } from './http.js';

const list = value => (value || '').split(',').map(item => item.trim()).filter(Boolean);
const allowedRepositories = list(process.env.KEFANIA_ALLOWED_REPOSITORIES);
const actions = createActions({ allowedRepositories });
try {
  if (process.argv.includes('--http')) {
    const host = process.env.KEFANIA_HOST || '127.0.0.1';
    const port = Number(process.env.PORT || '8765');
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535.');
    if (!allowedRepositories.length) throw new Error('HTTP mode requires KEFANIA_ALLOWED_REPOSITORIES as a comma-separated owner/repo list.');
    const app = createHttpApp({ host, actions, allowedHosts: list(process.env.KEFANIA_ALLOWED_HOSTS), token: process.env.KEFANIA_MCP_TOKEN });
    const listener = app.listen(port, host, () => console.error(`Kefania MCP listening on ${host}:${port}/mcp`));
    listener.on('error', () => { console.error('Could not bind Kefania HTTP listener.'); process.exitCode = 1; });
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => listener.close());
  } else {
    await createMcpServer({ actions }).connect(new StdioServerTransport());
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
