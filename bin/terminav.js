#!/usr/bin/env node
import { Command } from 'commander';
import chalk from 'chalk';
import readline from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright';

function tokenizeLine(line) {
  const tokens = [];
  let current = '';
  let quote = null;
  let escaping = false;
  for (const ch of line) {
    if (escaping) {
      current += ch;
      escaping = false;
      continue;
    }
    if (ch === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (current.length) {
        tokens.push(current);
        current = '';
      }
      continue;
    }
    current += ch;
  }
  if (escaping) current += '\\';
  if (quote) throw new Error(`Unclosed quote: ${quote}`);
  if (current.length) tokens.push(current);
  return tokens;
}

const program = new Command();

function normalizeUrl(url) {
  if (!url || url === 'about:blank') return 'about:blank';
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(url)) return url;
  return `https://${url}`;
}

function wantsHeaded(opts = {}) {
  if (opts.headed) return true;
  if (opts.headless) return false;
  // Default to headless in non-GUI environments, headed otherwise.
  return process.platform === 'win32' || Boolean(process.env.DISPLAY || process.env.WAYLAND_DISPLAY);
}

async function launchBrowser(opts = {}) {
  const headed = wantsHeaded(opts);
  return chromium.launch({
    headless: !headed,
    slowMo: Number(opts.slowMo || 0),
  });
}

async function withPage(opts, fn) {
  const browser = await launchBrowser(opts);
  try {
    const context = await browser.newContext({
      viewport: opts.viewport ? parseViewport(opts.viewport) : { width: 1440, height: 1000 },
      ignoreHTTPSErrors: Boolean(opts.ignoreHttpsErrors),
    });
    const page = await context.newPage();
    return await fn(page, context, browser);
  } finally {
    await browser.close();
  }
}

function parseViewport(value) {
  const match = String(value).match(/^(\d+)x(\d+)$/i);
  if (!match) throw new Error('Viewport must be WIDTHxHEIGHT, e.g. 1440x1000');
  return { width: Number(match[1]), height: Number(match[2]) };
}

async function goto(page, url, opts = {}) {
  const target = normalizeUrl(url);
  const response = await page.goto(target, {
    waitUntil: opts.waitUntil || 'domcontentloaded',
    timeout: Number(opts.timeout || 45000),
  });
  if (opts.networkIdle) await page.waitForLoadState('networkidle', { timeout: Number(opts.timeout || 45000) }).catch(() => {});
  return response;
}

async function smartLocator(page, query) {
  const q = String(query);
  if (q.startsWith('text=')) return page.getByText(q.slice(5), { exact: false }).first();
  if (q.startsWith('role=')) {
    const [, role, name] = q.match(/^role=([^:]+):?(.*)$/) || [];
    return page.getByRole(role, name ? { name } : {}).first();
  }
  if (/^(css=|xpath=|id=|data-testid=)/.test(q)) return page.locator(q).first();
  // CSS-looking selectors use CSS. Otherwise click by visible text.
  if (/^[#.\[]|[:>~+]|^[a-z]+[.#\[]/i.test(q)) return page.locator(q).first();
  return page.getByText(q, { exact: false }).first();
}

async function screenshotPage(page, outputPath, opts = {}) {
  await mkdir(path.dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: Boolean(opts.fullPage) });
  return outputPath;
}

async function extractPage(page, opts = {}) {
  const result = {};
  if (opts.title) result.title = await page.title();
  if (opts.url) result.url = page.url();
  if (opts.text) result.text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  if (opts.links) {
    result.links = await page.locator('a').evaluateAll((anchors) => anchors.slice(0, 200).map(a => ({ text: a.innerText.trim(), href: a.href })).filter(x => x.text || x.href));
  }
  if (!opts.title && !opts.url && !opts.text && !opts.links) {
    result.title = await page.title();
    result.url = page.url();
    result.text = await page.locator('body').innerText({ timeout: 5000 }).catch(() => '');
  }
  return result;
}

function commonOptions(cmd) {
  return cmd
    .option('--headed', 'open a visible Chromium window')
    .option('--headless', 'force headless Chromium')
    .option('--slow-mo <ms>', 'slow browser actions for demos/debugging', '0')
    .option('--timeout <ms>', 'navigation timeout in milliseconds', '45000')
    .option('--viewport <size>', 'browser viewport, e.g. 1440x1000')
    .option('--ignore-https-errors', 'ignore invalid TLS certificates');
}

program
  .name('terminav')
  .description('A terminal-driven graphical browser controller: curl-like commands backed by Playwright/Chromium.')
  .version('0.1.0');

commonOptions(program.command('open <url>'))
  .description('Open a URL in Chromium. Use --headed to leave a visible browser window open until Enter is pressed.')
  .option('--network-idle', 'wait for network idle after DOMContentLoaded')
  .action(async (url, opts) => {
    await withPage(opts, async (page) => {
      const response = await goto(page, url, opts);
      console.log(chalk.green('opened'), page.url(), chalk.gray(`status=${response?.status() ?? 'n/a'}`));
      console.log(chalk.gray(`title=${await page.title()}`));
      if (wantsHeaded(opts)) {
        console.log(chalk.yellow('Visible browser is open. Press Enter to close.'));
        await readline.createInterface({ input, output }).question('');
      }
    });
  });

commonOptions(program.command('screenshot <url>'))
  .description('Open a URL and write a PNG screenshot.')
  .requiredOption('-o, --output <file>', 'PNG output path')
  .option('--full-page', 'capture the whole page')
  .option('--network-idle', 'wait for network idle after DOMContentLoaded')
  .action(async (url, opts) => {
    await withPage(opts, async (page) => {
      const response = await goto(page, url, opts);
      const out = path.resolve(opts.output);
      await screenshotPage(page, out, opts);
      console.log(JSON.stringify({ ok: true, url: page.url(), status: response?.status() ?? null, title: await page.title(), screenshot: out }, null, 2));
    });
  });

commonOptions(program.command('extract <url>'))
  .description('Open a URL and extract title, URL, text, and/or links.')
  .option('--title', 'include document title')
  .option('--url', 'include final URL')
  .option('--text', 'include visible body text')
  .option('--links', 'include links')
  .option('--json', 'print JSON instead of a human-readable form')
  .option('--network-idle', 'wait for network idle after DOMContentLoaded')
  .action(async (url, opts) => {
    await withPage(opts, async (page) => {
      await goto(page, url, opts);
      const data = await extractPage(page, opts);
      if (opts.json) console.log(JSON.stringify(data, null, 2));
      else {
        if (data.title) console.log(chalk.bold('Title:'), data.title);
        if (data.url) console.log(chalk.bold('URL:'), data.url);
        if (data.text) console.log(data.text);
        if (data.links) for (const l of data.links) console.log(`- ${l.text || '(no text)'} ${chalk.gray(l.href)}`);
      }
    });
  });

commonOptions(program.command('shell [url]'))
  .description('Start an interactive browser-control shell that keeps one browser/page alive.')
  .option('--network-idle', 'wait for network idle after navigation')
  .action(async (url = 'about:blank', opts) => {
    const browser = await launchBrowser(opts);
    const context = await browser.newContext({ viewport: opts.viewport ? parseViewport(opts.viewport) : { width: 1440, height: 1000 }, ignoreHTTPSErrors: Boolean(opts.ignoreHttpsErrors) });
    const page = await context.newPage();
    if (url !== 'about:blank') await goto(page, url, opts);
    console.log(chalk.green('TermiNav shell'), chalk.gray('type help for commands, quit to exit'));
    console.log(chalk.gray(`current=${page.url()}`));
    const rl = readline.createInterface({ input, output, prompt: chalk.cyan('terminav> ') });
    rl.prompt();
    for await (const line of rl) {
      let cmd;
      let args = [];
      try {
        const parts = tokenizeLine(line);
        [cmd, ...args] = parts;
        if (!cmd) { rl.prompt(); continue; }
        if (['quit', 'exit'].includes(cmd)) break;
        if (cmd === 'help') {
          console.log(`Commands:\n  open <url>\n  click <selector|text=Text|role=button:Name>\n  type <selector> <text>\n  press <key>\n  wait <ms>\n  screenshot <file> [--full-page]\n  extract [title|url|text|links|all] [--json]\n  eval <javascript>\n  status\n  quit`);
        } else if (cmd === 'open' || cmd === 'navigate') {
          if (!args[0]) throw new Error('open requires a URL');
          const response = await goto(page, args[0], opts);
          console.log(chalk.green('opened'), page.url(), chalk.gray(`status=${response?.status() ?? 'n/a'}`));
        } else if (cmd === 'click') {
          if (!args[0]) throw new Error('click requires a selector or text query');
          await (await smartLocator(page, args.join(' '))).click({ timeout: Number(opts.timeout || 45000) });
          console.log(chalk.green('clicked'), args.join(' '));
        } else if (cmd === 'type') {
          if (args.length < 2) throw new Error('type requires a selector and text');
          const [selector, ...textParts] = args;
          await (await smartLocator(page, selector)).fill(textParts.join(' '), { timeout: Number(opts.timeout || 45000) });
          console.log(chalk.green('typed'), selector);
        } else if (cmd === 'press') {
          if (!args[0]) throw new Error('press requires a key, e.g. Enter');
          await page.keyboard.press(args[0]);
          console.log(chalk.green('pressed'), args[0]);
        } else if (cmd === 'wait') {
          await page.waitForTimeout(Number(args[0] || 1000));
          console.log(chalk.green('waited'), `${Number(args[0] || 1000)}ms`);
        } else if (cmd === 'screenshot') {
          if (!args[0]) throw new Error('screenshot requires a file path');
          const fullPage = args.includes('--full-page');
          const out = path.resolve(args[0]);
          await screenshotPage(page, out, { fullPage });
          console.log(chalk.green('screenshot'), out);
        } else if (cmd === 'extract') {
          const flags = new Set(args);
          const json = flags.has('--json');
          const modes = { title: flags.has('title') || flags.has('all'), url: flags.has('url') || flags.has('all'), text: flags.has('text') || flags.has('all'), links: flags.has('links') || flags.has('all') };
          const data = await extractPage(page, modes);
          console.log(json ? JSON.stringify(data, null, 2) : Object.entries(data).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v, null, 2)}`).join('\n'));
        } else if (cmd === 'eval') {
          const script = line.trim().slice(/^eval\s+/.exec(line.trim())?.[0].length ?? 0);
          if (!script) throw new Error('eval requires JavaScript');
          const value = await page.evaluate(script);
          console.log(JSON.stringify(value, null, 2));
        } else if (cmd === 'status') {
          console.log(JSON.stringify({ url: page.url(), title: await page.title(), headed: wantsHeaded(opts), pages: context.pages().length }, null, 2));
        } else {
          console.log(chalk.red(`unknown command: ${cmd}`));
        }
      } catch (err) {
        console.error(chalk.red('error:'), err.message);
      }
      rl.prompt();
    }
    rl.close();
    await browser.close();
  });

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  program.parseAsync(process.argv).catch((err) => {
    console.error(chalk.red(err.stack || err.message));
    process.exit(1);
  });
}

export { normalizeUrl, smartLocator, tokenizeLine, wantsHeaded };
