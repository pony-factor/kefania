import { draftSchema, outputSchema } from './draft-schema.js';
import { validateOllamaSettings } from './ollama-settings.js';

export async function ollamaModels(settings, { fetchImpl = fetch } = {}) {
  const config = validateOllamaSettings(settings);
  try {
    const response = await fetchImpl(config.baseUrl + '/api/tags', { redirect: 'error', signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error();
    const data = await response.json();
    return (data.models || []).filter(item => !item.capabilities || item.capabilities.includes('completion'))
      .map(item => item.name).filter(name => typeof name === 'string').sort();
  } catch { throw new Error('Ollama models could not be listed. Start Ollama and check its local server address.'); }
}

export async function draftWithOllama(prompt, settings, { fetchImpl = fetch } = {}) {
  const config = validateOllamaSettings(settings);
  if (!config.enabled) throw new Error('Ollama fallback is disabled.');
  let response;
  try {
    response = await fetchImpl(config.baseUrl + '/api/generate', {
      method: 'POST', redirect: 'error', headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(config.timeoutSeconds * 1000),
      body: JSON.stringify({ model: config.model, prompt, stream: false, format: outputSchema,
        ...(config.think === 'default' ? {} : { think: config.think === 'on' }),
        options: { temperature: config.temperature, num_ctx: config.numCtx, num_predict: config.numPredict } }),
    });
  } catch { throw new Error('Ollama drafting failed or timed out. Start Ollama and check its server address and timeout.'); }
  if (!response.ok) throw new Error(response.status === 404
    ? 'The selected Ollama model is unavailable. Choose an installed model in Kefania setup.'
    : 'Ollama drafting failed. Check the selected model and generation settings.');
  try {
    const result = await response.json();
    if (result.done !== true || result.done_reason === 'length') throw new Error();
    return draftSchema.parse(JSON.parse(result.response));
  } catch { throw new Error('Ollama did not return a complete, valid PR draft. Check the model, context size, and output limit.'); }
}
