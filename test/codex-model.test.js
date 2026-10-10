import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough, Writable } from 'node:stream';
import { writeFile } from 'node:fs/promises';
import { discoverCodexModel, selectCodexModel } from '../src/codex-model.js';
import { draftWithCodex, draftWithFallback } from '../src/local-pr.js';

const model = (id, extra = {}) => ({ id, model: id,
  supportedReasoningEfforts: [{ reasoningEffort: 'medium' }], ...extra });

test('selection follows the account recommendation and available upgrades without a pinned version', () => {
  assert.equal(selectCodexModel([model('old', { isDefault: true, upgrade: 'current' }),
    model('current', { upgrade: 'next' }), model('next')]), 'next');
  assert.equal(selectCodexModel([model('current', { isDefault: true, upgrade: 'hidden' }),
    model('hidden', { hidden: true }), model('unrelated')]), 'current');
  assert.equal(selectCodexModel([model('current', { isDefault: true, upgrade: 'audio' }),
    model('audio', { inputModalities: ['audio'] })]), 'current');
});

test('unavailable recommendations and unsupported medium reasoning fail rather than silently changing effort', () => {
  assert.throws(() => selectCodexModel([model('other')]), /medium reasoning/);
  assert.throws(() => selectCodexModel([model('current', { isDefault: true,
    supportedReasoningEfforts: [{ reasoningEffort: 'high' }] })]), /medium reasoning/);
});

function fakeServer(handle) {
  const child = new EventEmitter();
  child.stdout = new PassThrough();
  child.kill = () => { child.emit('close', 0); return true; };
  child.stdin = new Writable({ write(chunk, encoding, done) {
    const request = JSON.parse(chunk.toString());
    queueMicrotask(() => {
      const response = handle(request);
      if (response) child.stdout.write(JSON.stringify({ id: request.id, ...response }) + '\n');
    });
    done();
  } });
  return child;
}

test('catalog discovery initializes, paginates, and removes API keys without starting an inference turn', async () => {
  const methods = [];
  const result = await discoverCodexModel({ env: { OPENAI_API_KEY: 'fixture', CODEX_API_KEY: 'fixture' },
    spawnProcess(command, args, options) {
      assert.equal(args[0], 'app-server');
      assert.ok(args.includes('forced_login_method="chatgpt"'));
      assert.ok(args.includes('model_provider="openai"'));
      assert.equal(options.env.OPENAI_API_KEY, undefined);
      assert.equal(options.env.CODEX_API_KEY, undefined);
      return fakeServer(request => {
        methods.push(request.method);
        if (request.method === 'initialize') return { result: {} };
        if (request.method === 'model/list') {
          assert.equal(request.params.includeHidden, false);
          return { result: request.params.cursor
            ? { data: [model('new')], nextCursor: null }
            : { data: [model('old', { isDefault: true, upgrade: 'new' })], nextCursor: 'page2' } };
        }
      });
    } });
  assert.equal(result, 'new');
  assert.deepEqual(methods, ['initialize', 'initialized', 'model/list', 'model/list']);
});

test('catalog errors and timeouts reject and terminate discovery', async () => {
  await assert.rejects(discoverCodexModel({ spawnProcess: () => fakeServer(() => ({ error: {} })) }), /catalog is unavailable/);
  let killed = false;
  await assert.rejects(discoverCodexModel({ timeoutMs: 10, spawnProcess: () => {
    const child = fakeServer(() => null);
    child.kill = () => { killed = true; };
    return child;
  } }), /timed out/);
  assert.equal(killed, true);
});

test('draft invocation uses the dynamically selected model and medium, and refreshes selection each run', async () => {
  let discoveries = 0;
  for (const selected of ['current', 'future']) {
    const result = await draftWithCodex('Draft from supplied evidence only.', {
      async discoverModel() { discoveries++; return selected; },
      spawnProcess(command, args, options) {
        assert.equal(args[args.indexOf('--model') + 1], selected);
        assert.ok(args.includes('model_reasoning_effort="medium"'));
        assert.ok(args.includes('--ignore-user-config'));
        assert.equal(options.env.OPENAI_API_KEY, undefined);
        const child = new EventEmitter();
        child.stderr = new PassThrough();
        child.stdin = new Writable({ write(chunk, encoding, done) { done(); } });
        child.stdin.on('finish', async () => {
          await writeFile(args[args.indexOf('--output-last-message') + 1],
            JSON.stringify({ title: '🔧 Improve drafting', body: 'Use the selected model with medium reasoning.' }));
          child.emit('close', 0);
        });
        return child;
      },
    });
    assert.equal(result.title, '🔧 Improve drafting');
  }
  assert.equal(discoveries, 2);
});

test('model discovery failure reaches the configured Ollama fallback', async () => {
  const result = await draftWithFallback('Draft.', {
    codex: prompt => draftWithCodex(prompt, {
      discoverModel: async () => { throw new Error('Catalog unavailable'); },
      spawnProcess() { assert.fail('Do not infer without a selected model'); },
    }),
    preferences: async () => ({ ollama: { enabled: true, model: 'local' } }),
    ollama: async (prompt, settings) => {
      assert.equal(settings.model, 'local');
      return { title: '🔧 Improve drafting', body: 'Local fallback.' };
    },
  });
  assert.equal(result.body, 'Local fallback.');
});
