import test from 'node:test';
import assert from 'node:assert/strict';
import { draftWithFallback, runLocalPullRequest } from '../src/local-pr.js';
import { draftWithOllama, ollamaModels } from '../src/ollama.js';
import { defaultOllamaSettings, validateOllamaSettings } from '../src/ollama-settings.js';

const draft = { title: '🔧 Improve the fallback', body: 'Explain the verified change.' };
const preferences = async () => ({ ollama: defaultOllamaSettings() });

test('Codex succeeds first, then Ollama handles failed or invalid Codex drafting', async () => {
  const order = [];
  const options = { preferences, codex: async () => { order.push('codex'); return draft; },
    ollama: async (prompt, settings) => { assert.equal(prompt, 'evidence'); assert.equal(settings.model, 'qwen2.5-coder:7b'); order.push('ollama'); return draft; } };
  assert.deepEqual(await draftWithFallback('evidence', options), draft);
  assert.deepEqual(order, ['codex']);
  options.codex = async () => { order.push('codex'); throw new Error('Quota exhausted'); };
  await draftWithFallback('evidence', options);
  assert.deepEqual(order, ['codex', 'codex', 'ollama']);
  options.codex = async () => ({ title: 'Missing body' });
  await draftWithFallback('evidence', options);
  assert.equal(order.at(-1), 'ollama');
});

test('disabled Ollama and both-provider failures remain actionable without writes', async () => {
  const codex = async () => { throw new Error('Codex unavailable'); };
  await assert.rejects(draftWithFallback('evidence', { codex,
    preferences: async () => ({ ollama: { enabled: false } }), ollama: async () => assert.fail('Disabled') }), /Codex unavailable/);
  await assert.rejects(draftWithFallback('evidence', { codex, preferences,
    ollama: async () => { throw new Error('Model unavailable'); } }), /Ollama fallback also failed.*Model unavailable/);
});

test('Ollama receives structured schema, bounded settings, and unchanged evidence', async () => {
  const settings = { ...defaultOllamaSettings(), model: 'test:local', think: 'off', numCtx: 8192 };
  const result = await draftWithOllama('verified evidence', settings, { fetchImpl: async (url, init) => {
    assert.equal(url, 'http://127.0.0.1:11434/api/generate');
    const payload = JSON.parse(init.body);
    assert.equal(payload.model, 'test:local');
    assert.equal(payload.prompt, 'verified evidence');
    assert.equal(payload.stream, false);
    assert.equal(payload.think, false);
    assert.deepEqual(payload.format.required, ['title', 'body']);
    assert.equal(payload.options.num_ctx, 8192);
    assert.equal(init.redirect, 'error');
    return Response.json({ done: true, response: JSON.stringify(draft) });
  } });
  assert.deepEqual(result, draft);
  for (const value of [{ done: true, response: 'bad JSON' }, { done: true, response: '{}' },
    { done: true, done_reason: 'length', response: JSON.stringify(draft) }]) {
    await assert.rejects(draftWithOllama('evidence', settings, { fetchImpl: async () => Response.json(value) }), /complete, valid/);
  }
  await assert.rejects(draftWithOllama('evidence', settings, { fetchImpl: async () => new Response('', { status: 404 }) }), /selected Ollama model/);
});

test('model discovery omits embedding-only models and rejects remote or credential URLs', async () => {
  assert.deepEqual(await ollamaModels(defaultOllamaSettings(), { fetchImpl: async () => Response.json({ models: [
    { name: 'embedding', capabilities: ['embedding'] }, { name: 'writer', capabilities: ['completion'] }, { name: 'older-version' },
  ] }) }), ['older-version', 'writer']);
  for (const baseUrl of ['https://remote.example', 'http://user:secret@localhost:11434', 'http://localhost:11434/elsewhere']) {
    assert.throws(() => validateOllamaSettings({ baseUrl }), /local Ollama/);
  }
  assert.throws(() => validateOllamaSettings({ timeoutSeconds: 0 }), /timeoutSeconds/);
  assert.throws(() => validateOllamaSettings({ numCtx: 2.5 }), /numCtx/);
});

test('Ollama preserves the verified head and cannot retry a failed GitHub write', async () => {
  let drafts = 0, writes = 0;
  const source = { kind: 'codex', uuid: '11111111-2222-4333-8444-555555555555', url: 'https://example.com/conversation' };
  const actions = { async context() { return { aheadBy: 1, headSha: 'a'.repeat(40) }; },
    async create(input) { writes++; assert.equal(input.expectedHeadSha, 'a'.repeat(40)); assert.deepEqual(input.source, source); throw new Error('Uncertain GitHub write'); } };
  await assert.rejects(runLocalPullRequest({ repository: 'owner/repo', head: 'branch', source }, {
    actions, draft: prompt => draftWithFallback(prompt, { preferences,
      codex: async () => { throw new Error('Codex unavailable'); }, ollama: async () => { drafts++; return draft; } }),
  }), /Uncertain GitHub write/);
  assert.equal(drafts, 1);
  assert.equal(writes, 1);
});
