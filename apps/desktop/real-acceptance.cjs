// Real-daemon acceptance: the shipped web bundle against a live `warshad`, no RPC stub.
// Injects only the shell config (`get_config`), which is what Tauri publishes in production.
const { chromium } = require('@playwright/test');

(async () => {
  const token = process.env.WARSHA_TEST_TOKEN;
  const rpcUrl = 'http://127.0.0.1:8766';
  const appUrl = 'http://localhost:4173';

  let browser;
  try {
    browser = await chromium.launch({ channel: 'msedge', headless: true });
  } catch (edgeError) {
    console.log('EDGE_LAUNCH_FAILED:' + edgeError.message.split('\n')[0]);
    browser = await chromium.launch({ headless: true });
  }
  const context = await browser.newContext();
  const page = await context.newPage();
  const rpcMethods = [];
  page.on('request', (request) => {
    if (!request.url().includes('/rpc')) return;
    try {
      const body = request.postDataJSON();
      rpcMethods.push(body.method);
    } catch {
      rpcMethods.push('<unparsed>');
    }
  });

  await page.addInitScript(
    ({ token }) => {
      window.localStorage.setItem('warsha.theme', 'dark');
      window.localStorage.setItem('warsha.locale', 'en');
      const config = {
        daemon_url: 'http://127.0.0.1:8766',
        daemon_ws_url: 'ws://127.0.0.1:8766',
        daemon_token: token,
        onboarding_complete: 'true',
        app_mode: 'simple',
      };
      window.__TAURI_INTERNALS__ = {
        invoke: (command, args) => {
          if (command === 'get_config') return Promise.resolve(config[args && args.key] || '');
          if (command === 'set_config') return Promise.resolve(undefined);
          return Promise.reject(new Error('unexpected tauri command: ' + command));
        },
        transformCallback: () => 1,
        unregisterCallback: () => undefined,
        convertFileSrc: (p) => p,
      };
    },
    { token }
  );

  await page.goto(appUrl, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(5000);

  const headings = await page.locator('h1, h2').allTextContents();
  const body = await page.locator('body').innerText();
  console.log('HEADINGS:' + JSON.stringify(headings.slice(0, 8)));
  console.log('RPC_METHODS:' + JSON.stringify([...new Set(rpcMethods)]));
  console.log('HAS_CLI_PROJECT:' + body.includes('acceptance-cli'));
  console.log('BODY_SNIPPET:' + body.replace(/\s+/g, ' ').slice(0, 300));

  await page.screenshot({ path: 'real-acceptance.png', fullPage: false });
  await browser.close();
})().catch((error) => {
  console.error('SCRIPT_ERROR:' + error.message);
  process.exit(1);
});
