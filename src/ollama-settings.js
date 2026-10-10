export const defaultOllamaSettings = () => ({ enabled: true, model: 'qwen2.5-coder:7b',
  baseUrl: 'http://127.0.0.1:11434', temperature: 0.2, numCtx: 32768, numPredict: 4096,
  timeoutSeconds: 300, think: 'default' });

export function validateOllamaSettings(input = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid Ollama settings.');
  const value = { ...defaultOllamaSettings(), ...input };
  let url;
  try { url = new URL(value.baseUrl); } catch { throw new Error('Enter a local Ollama server URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
    || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('Use a local Ollama server URL, such as http://127.0.0.1:11434.');
  }
  if (typeof value.enabled !== 'boolean' || typeof value.model !== 'string'
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/.test(value.model)) throw new Error('Choose an Ollama model.');
  for (const [key, min, max, integer] of [['temperature', 0, 2, false], ['numCtx', 1024, 262144, true],
    ['numPredict', 128, 32768, true], ['timeoutSeconds', 5, 1800, true]]) {
    if (!Number.isFinite(value[key]) || value[key] < min || value[key] > max || (integer && !Number.isInteger(value[key]))) {
      throw new Error(`Ollama ${key} must be ${integer ? 'an integer' : 'a number'} between ${min} and ${max}.`);
    }
  }
  if (!['default', 'on', 'off'].includes(value.think)) throw new Error('Choose a supported Ollama thinking setting.');
  return { enabled: value.enabled, model: value.model, baseUrl: url.origin, temperature: value.temperature,
    numCtx: value.numCtx, numPredict: value.numPredict, timeoutSeconds: value.timeoutSeconds, think: value.think };
}
