import { spawn } from 'node:child_process';

// gh uses its existing login; credentials never enter tool arguments or logs.
export function githubRequest(endpoint, { method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const args = ['api', '--hostname', 'github.com', '--method', method, endpoint];
    if (body !== undefined) args.push('--input', '-');
    const child = spawn(process.env.KEFANIA_GH_COMMAND || 'gh', args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let output = '', error = '', size = 0, settled = false;
    const finish = (failure, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      failure ? reject(failure) : resolve(value);
    };
    const timer = setTimeout(() => {
      child.kill();
      finish(new Error('GitHub request timed out. Check whether the PR exists before retrying a write.'));
    }, 60000);
    child.stdout.on('data', chunk => {
      size += chunk.length;
      if (size > 16 * 1024 * 1024) {
        child.kill();
        finish(new Error('GitHub response exceeded the size limit. Narrow the branch changes.'));
      } else output += chunk;
    });
    child.stderr.on('data', chunk => { error += chunk; });
    child.on('error', () => finish(new Error('GitHub CLI is unavailable. Install gh and sign in before starting Kefania.')));
    child.on('close', code => {
      if (code !== 0) {
        const status = error.match(/HTTP (\d{3})/)?.[1];
        const failure = new Error(`GitHub request failed${status ? ` (HTTP ${status})` : ''}. Check repository access and gh authentication.`);
        failure.status = Number(status) || undefined;
        return finish(failure);
      }
      try { finish(null, JSON.parse(output)); }
      catch { finish(new Error('GitHub returned an invalid response.')); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
