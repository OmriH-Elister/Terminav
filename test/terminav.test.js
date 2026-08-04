import assert from 'node:assert/strict';
import test from 'node:test';

import { activePage, goto, normalizeUrl, smartLocator, tokenizeLine } from '../bin/terminav.js';

test('tokenizeLine preserves quoted arguments', () => {
  assert.deepEqual(tokenizeLine('click "Learn more"'), ['click', 'Learn more']);
  assert.deepEqual(tokenizeLine('type #search "time travel"'), ['type', '#search', 'time travel']);
});

test('normalizeUrl adds HTTPS only when a scheme is absent', () => {
  assert.equal(normalizeUrl('example.com'), 'https://example.com');
  assert.equal(normalizeUrl('file:///tmp/page.html'), 'file:///tmp/page.html');
  assert.equal(normalizeUrl('about:blank'), 'about:blank');
});

test('smartLocator treats multi-word input as visible text', async () => {
  const calls = [];
  const result = { first: () => 'text-locator' };
  const page = {
    getByText(value, options) {
      calls.push({ value, options });
      return result;
    },
    locator() {
      throw new Error('multi-word text must not be parsed as CSS');
    },
  };

  assert.equal(await smartLocator(page, 'Learn more'), 'text-locator');
  assert.deepEqual(calls, [{ value: 'Learn more', options: { exact: false } }]);
});

test('smartLocator keeps explicit and obvious CSS selectors as CSS', async () => {
  const calls = [];
  const page = {
    locator(value) {
      calls.push(value);
      return { first: () => 'css-locator' };
    },
    getByText() {
      throw new Error('CSS must not be parsed as text');
    },
  };

  assert.equal(await smartLocator(page, '#search'), 'css-locator');
  assert.deepEqual(calls, ['#search']);
});

test('activePage selects the newest live page and replaces a closed page', async () => {
  const closed = { isClosed: () => true };
  const first = { isClosed: () => false };
  const newest = { isClosed: () => false };
  const context = { pages: () => [closed, first, newest] };

  assert.equal(await activePage(context), newest);

  const replacement = { isClosed: () => false };
  const emptyContext = {
    pages: () => [closed],
    newPage: async () => replacement,
  };
  assert.equal(await activePage(emptyContext), replacement);
});

test('goto tolerates redirect-driven ERR_ABORTED on a live page', async () => {
  const states = [];
  const page = {
    goto: async () => { throw new Error('net::ERR_ABORTED'); },
    isClosed: () => false,
    waitForLoadState: async (state) => { states.push(state); },
  };

  assert.equal(await goto(page, 'example.com'), undefined);
  assert.deepEqual(states, ['domcontentloaded']);
});
