# TermiNav

A terminal-driven graphical browser controller: a small cross between `curl` and Chromium, powered by Playwright.

It can:

- open URLs in Chromium from the terminal
- capture screenshots
- extract page title/text/links
- keep a browser session alive in an interactive shell
- click, type, press keys, wait, evaluate JavaScript, and inspect status

## Install

```bash
cd /path/to/terminav
npm install
npx playwright install chromium
npm link   # optional: makes `terminav` available globally for this Node install
```

On Ubuntu or WSL, install Chromium's Linux system dependencies as well:

```bash
sudo npx playwright install-deps chromium
```

If Chromium exits during launch with a missing `.so` library, this prerequisite has not completed successfully; it is a browser launch failure rather than a navigation failure.

You can also run it directly without linking:

```bash
node ./bin/terminav.js --help
```

## Examples

```bash
# Open a URL and print final URL/title/status
terminav open https://example.com

# Force a visible Chromium window when a GUI display is available
terminav open https://example.com --headed

# Capture a screenshot
terminav screenshot https://example.com -o ./artifacts/example.png --headless

# Extract visible page text
terminav extract https://example.com --title --url --text --headless

# Start a persistent browser-control shell
terminav shell https://example.com --headed
```

Inside the shell:

```text
open https://example.com
click "Learn more"
type #search "time travel"
press Enter
screenshot ./artifacts/current.png --full-page
extract all --json
eval document.title
status
quit
```

## Selector shortcuts

`click` and `type` accept:

- CSS-like selectors: `#id`, `.class`, `input[name=q]`, `button.primary`
- visible text: `Learn more`
- explicit text query: `text=Learn more`
- role query: `role=button:Sign in`

## Notes

- Without `--headed`, TermiNav auto-detects whether a graphical display exists. On servers/Telegram/Hermes sessions it will normally run headless.
- `--headed` opens real Chromium if `$DISPLAY` or `$WAYLAND_DISPLAY` is available.
- Some websites still block automation, require login, or present bot/cookie walls. The CLI exposes the browser, but it does not bypass access controls.
