import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeUrl, smartLocator, tokenizeLine } from '../bin/terminav.js';

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
