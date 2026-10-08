import { timingSafeEqual } from 'node:crypto';
import { createMcpExpressApp } from '@modelcontextprotocol/sdk/server/express.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createMcpServer } from './server.js';

export function createHttpApp({ token, host = '127.0.0.1', allowedHosts, actions }) {
  if (!token || token.length < 32) throw new Error('HTTP mode requires KEFANIA_MCP_TOKEN with at least 32 characters. Never use a GitHub token here.');
  if (!['127.0.0.1', 'localhost', '::1'].includes(host) && !allowedHosts?.length) {
    throw new Error('Non-local HTTP mode requires KEFANIA_ALLOWED_HOSTS.');
  }
  const app = createMcpExpressApp({ host, allowedHosts });
  app.get('/health', (_req, res) => res.json({ service: 'codex-drafter', ready: true }));
  app.use('/mcp', (req, res, next) => {
    const received = Buffer.from(req.headers.authorization || '');
    const expected = Buffer.from(`Bearer ${token}`);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
      return res.status(401).json({ error: 'Bearer authentication required.' });
    }
    // Browser pages do not need direct access; MCP clients connect server-side.
    if (req.headers.origin) return res.status(403).json({ error: 'Browser-origin requests are not supported.' });
    next();
  });
  app.post('/mcp', async (req, res) => {
    const server = createMcpServer({ actions });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on('close', () => { void transport.close(); void server.close(); });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch {
      if (!res.headersSent) res.status(500).json({ error: 'MCP request failed.' });
    }
  });
  app.all('/mcp', (_req, res) => res.status(405).json({ error: 'Use POST for stateless MCP requests.' }));
  return app;
}
