import assert from 'node:assert/strict';
import test from 'node:test';
import { createActions, descriptionBody, FOOTER } from '../src/pull-requests.js';

test('publishing an existing PR adds the supplied conversation once', async () => {
  const comments = [];
  let commentPosts = 0;
  const existing = {
    number: 42, html_url: 'https://github.com/example/demo/pull/42',
    head: { ref: 'topic', label: 'example:topic' }, base: { ref: 'main' }
  };
  const request = async (path, options = {}) => {
    if (path.startsWith('repos/example/demo/pulls?')) return [existing];
    if (path.startsWith('repos/example/demo/issues/42/comments?')) return comments;
    if (path === 'repos/example/demo/issues/42/comments' && options.method === 'POST') {
      commentPosts++;
      const item = { body: options.body.body, html_url: 'https://github.com/example/demo/pull/42#issuecomment-1' };
      comments.push(item);
      return item;
    }
    throw new Error('Unexpected request: ' + path);
  };
  const args = {
    owner: 'example', repo: 'demo', head: 'topic', base: 'main',
    source: {
      kind: 'chatgpt',
      uuid: '11111111-2222-4333-8444-555555555555',
      url: 'https://chatgpt.com/c/11111111-2222-4333-8444-555555555555',
      intentSummary: 'Explain a GitHub change'
    }
  };
  const actions = createActions({ request });
  const first = await actions.create(args);
  const second = await actions.create(args);
  assert.equal(first.existing, true);
  assert.equal(second.existing, true);
  assert.equal(commentPosts, 1);
  assert.equal(second.source.existing, true);
  assert.match(comments[0].body, /11111111-2222-4333-8444-555555555555/);
  assert.match(comments[0].body, /Explain a GitHub change/);
});

test('PR attribution appears exactly once when supplied in the draft', () => {
  const description = descriptionBody('Summary of work.\n\n' + FOOTER);
  assert.equal(description.split(FOOTER).length - 1, 1);
  assert.match(description, /^Summary of work\./);
});
