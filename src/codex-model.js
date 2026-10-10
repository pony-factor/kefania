import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

export function selectCodexModel(models) {
  const available = models.filter(model => !model.hidden &&
    (!model.inputModalities || model.inputModalities.includes('text')));
  let model = available.find(model => model.isDefault);
  const visited = new Set();
  while (model && !visited.has(model.id)) {
    visited.add(model.id);
    const upgrade = available.find(candidate => candidate.id === model.upgrade || candidate.model === model.upgrade);
    if (!upgrade || visited.has(upgrade.id)) break;
    model = upgrade;
  }
  if (!model?.model || !model.supportedReasoningEfforts?.some(effort => effort.reasoningEffort === 'medium')) {
    throw new Error('The recommended Codex model is unavailable with medium reasoning.');
  }
  return model.model;
}

// Query the installed CLI's account-visible catalog on every draft, without starting an inference turn.
export function discoverCodexModel({ command = process.env.KEFANIA_CODEX_COMMAND || 'codex',
  env = process.env, cwd, timeoutMs = 20000, spawnProcess = spawn } = {}) {
  return new Promise((resolve, reject) => {
    const childEnv = { ...env };
    delete childEnv.OPENAI_API_KEY;
    delete childEnv.CODEX_API_KEY;
    const child = spawnProcess(command, ['app-server', '-c', 'forced_login_method="chatgpt"',
      '-c', 'model_provider="openai"'], { cwd, env: childEnv, stdio: ['pipe', 'pipe', 'ignore'] });
    const lines = createInterface({ input: child.stdout });
    let settled = false, requestId = 1, pages = 0;
    const models = [], cursors = new Set();
    const finish = (error, model) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lines.close();
      child.kill();
      error ? reject(error) : resolve(model);
    };
    const timer = setTimeout(() => finish(new Error('Codex model discovery timed out.')), timeoutMs);
    const send = message => child.stdin.write(JSON.stringify(message) + '\n');
    child.on('error', () => finish(new Error('Codex CLI is unavailable for model discovery.')));
    child.on('close', () => finish(new Error('Codex model discovery ended before a model was selected.')));
    child.stdin.on('error', () => finish(new Error('Codex model discovery connection failed.')));
    lines.on('line', line => {
      if (settled) return;
      let message;
      try { message = JSON.parse(line); } catch { return; }
      if (message.id !== requestId) return;
      if (message.error) return finish(new Error('Codex model catalog is unavailable.'));
      if (requestId === 1) {
        send({ method: 'initialized', params: {} });
        send({ method: 'model/list', id: ++requestId, params: { limit: 100, includeHidden: false } });
        return;
      }
      const result = message.result;
      if (!Array.isArray(result?.data)) return finish(new Error('Codex returned an invalid model catalog.'));
      models.push(...result.data);
      if (result.nextCursor) {
        if (++pages > 20 || cursors.has(result.nextCursor)) return finish(new Error('Codex model catalog pagination failed.'));
        cursors.add(result.nextCursor);
        send({ method: 'model/list', id: ++requestId,
          params: { limit: 100, includeHidden: false, cursor: result.nextCursor } });
      } else {
        try { finish(null, selectCodexModel(models)); } catch (error) { finish(error); }
      }
    });
    send({ method: 'initialize', id: requestId,
      params: { clientInfo: { name: 'kefania', title: 'Kefania', version: '0.1.0' } } });
  });
}
