// Vale Mail — end-to-end test on the demo mailbox (Playwright + system Edge).
//
// Usage:  NODE_PATH="C:/tmp/node_modules" node scripts/vale-mail-e2e.cjs <screenshot-dir>
//
// Serves the site from this repo on an OS-assigned port (port 0, so parallel runs never
// collide), stubs /api/* and /.auth/me so nothing reaches a live service, opens
// /modules/company/mail.html?demo=1 and walks the whole product: counts, Reply-To guard,
// remote-image blocking, stance → draft → send → undo → send → Sent, j/k/e shortcuts with
// Undo, search, empty state, shortcut sheet, and the phone layout. Prints "E2E OK".
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { chromium } = require('playwright');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.resolve(process.argv[2] || path.join(ROOT, '..', 'vale-mail-shots'));
const PAGE = '/modules/company/mail.html?demo=1';

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon',
  '.webp': 'image/webp', '.woff2': 'font/woff2', '.txt': 'text/plain'
};

function serve() {
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const p = decodeURIComponent(url.pathname);
    // Stubs: no live API, no real sign-in.
    if (p === '/.auth/me') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"clientPrincipal":null}'); return; }
    if (p.indexOf('/api/') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); return; }
    const file = path.join(ROOT, p.replace(/\/$/, '/index.html'));
    if (file.indexOf(ROOT) !== 0) { res.writeHead(403); res.end(); return; }
    fs.readFile(file, (err, buf) => {
      if (err) {
        if (/runtime-config\.js$/.test(p)) { res.writeHead(200, { 'Content-Type': MIME['.js'] }); res.end('/* local */'); return; }
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('not found'); return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function check(cond, what) {
  if (!cond) throw new Error('E2E check failed: ' + what);
  console.log('  ok  ', what);
}

const fixture = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'vale-mail-demo.json'), 'utf8'));
const core = require(path.join(ROOT, 'modules', 'company', 'js', 'vale-mail-core.js'));

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = await serve();
  const base = 'http://127.0.0.1:' + server.address().port;
  const browser = await chromium.launch({ channel: 'msedge' });
  const problems = [];
  function watch(page) {
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() !== 'error') return;
      const t = m.text();
      const loc = (m.location() && m.location().url) || '';
      // Third-party font/icon CDNs can be slow or offline on a dev box; they are not our code.
      if (/fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare/.test(t + ' ' + loc)) return;
      // After the test presses "Show images" the newsletter asks for its invented .example images,
      // which cannot resolve (sandboxed srcdoc frames bypass page routing). Expected, and only those.
      if (/ERR_NAME_NOT_RESOLVED/.test(t) && /^https:\/\/[a-z0-9.-]+\.example\//.test(loc)) return;
      problems.push('console: ' + t + (loc ? ' @ ' + loc : ''));
    });
  }
  try {
    // ── Desktop 1440 ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await ctx.newPage();
    watch(page);
    const t0 = Date.now();
    await page.goto(base + PAGE);
    await page.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
    const ttiMs = Date.now() - t0;
    console.log('  inbox interactive in ' + ttiMs + ' ms');
    check(ttiMs < 2500, 'inbox interactive quickly on demo (' + ttiMs + ' ms)');

    check(await page.isVisible('.vmail-banner'), 'demo banner visible');
    check(/Demo mailbox/.test(await page.textContent('.vmail-banner')), 'demo banner copy');

    const inbox = fixture.folders.inbox;
    const want = core.counts(inbox, fixture.labels);
    const chipCount = async (f) => (await page.textContent('.vmail-chip[data-filter="' + f + '"] .vmail-chip__count')).trim();
    check(await chipCount('needs_you') === String(want.needs_you), 'Needs you chip count = ' + want.needs_you);
    check(await chipCount('newsletter') === String(want.newsletter), 'Newsletters chip count = ' + want.newsletter);
    check(await chipCount('all') === String(want.all), 'Everything chip count = ' + want.all);
    check(/of the latest 30/.test(await page.textContent('.vmail-listhead__count')), 'honest "of the latest N" line');
    const rowsNeeds = await page.$$eval('#vmail-list [role="option"]', (r) => r.length);
    check(rowsNeeds === want.needs_you, 'Needs you shows ' + want.needs_you + ' rows by default');
    check(await page.isVisible('.vmail-checked'), '"Checked at" stamp visible');
    check(await page.isVisible('.vmail-today'), 'Today rail visible at 1440');
    await page.screenshot({ path: path.join(SHOTS, '01-inbox.png') });

    // Unsorted mail says so (Everything filter).
    await page.click('.vmail-chip[data-filter="all"]');
    check(/Not sorted yet/.test(await page.textContent('#vmail-list [data-id="demo-inb-031"]')), 'newer mail says "Not sorted yet"');
    check(await page.isVisible('#vmail-list [data-id="demo-inb-008"] .vmail-client'), 'client marker on client mail');

    // ── Reply-To phishing guard ──
    await page.click('#vmail-list [data-id="demo-inb-015"]');
    await page.waitForSelector('.vmail-warn--replyto', { timeout: 5000 });
    const warn = await page.textContent('.vmail-warn--replyto');
    const phish = inbox.find((m) => m.id === 'demo-inb-015');
    check(warn.indexOf(phish.replyTo[0].emailAddress.address) !== -1, 'Reply-To warning names the real reply address');
    check(await page.isVisible('.vmail-vale'), 'Vale panel visible');
    await page.screenshot({ path: path.join(SHOTS, '02-reader-replyto.png') });

    // ── Newsletter: remote images blocked until asked ──
    await page.click('.vmail-chip[data-filter="newsletter"]');
    await page.click('#vmail-list [data-id="demo-inb-016"]');
    await page.waitForSelector('#vmail-show-images', { timeout: 5000 });
    const frameSel = '#vmail-reader iframe.vmail-frame';
    const sandbox = await page.getAttribute(frameSel, 'sandbox');
    check(sandbox === 'allow-popups allow-popups-to-escape-sandbox', 'iframe sandbox exact');
    const cspOff = await page.$eval(frameSel, (f) => (f.srcdoc.match(/Content-Security-Policy" content="([^"]*)"/) || [])[1] || '');
    check(cspOff.indexOf('img-src data: cid:;') !== -1 && cspOff.indexOf('https:') === -1, 'iframe CSP blocks remote images by default');
    const docOff = await page.$eval(frameSel, (f) => f.srcdoc);
    check(docOff.indexOf('track.productbrief.example') === -1, 'tracking pixel URL removed while images are hidden');
    await page.click('#vmail-show-images');
    await page.waitForFunction((s) => /img-src data: cid: https:/.test(document.querySelector(s).srcdoc), frameSel);
    check(true, 'Show images allows https images');
    await page.screenshot({ path: path.join(SHOTS, '03-newsletter.png') });

    // ── Stance → draft → send → undo → send → Sent ──
    await page.click('.vmail-chip[data-filter="needs_you"]');
    await page.click('#vmail-list [data-id="demo-inb-006"]');
    await page.waitForSelector('.vmail-stance[data-stance="yes"]', { timeout: 5000 });
    check(/\?/.test(await page.textContent('.vmail-question')), 'Vale quotes the question she found');
    await page.click('.vmail-stance[data-stance="yes"]');
    await page.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && /Yes, that works/.test(t.value); }, null, { timeout: 5000 });
    await page.waitForTimeout(250); // let the editor's entrance settle before the screenshot
    check(/Dana/.test(await page.inputValue('#vmail-editor-text')), 'Vale\'s draft lands in the editor, addressed to Dana');
    await page.screenshot({ path: path.join(SHOTS, '04-editor.png') });

    await page.click('#vmail-send');
    await page.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
    check(/Sending/.test(await page.textContent('#vmail-sendbar')), 'Undo bar counts down');
    await page.screenshot({ path: path.join(SHOTS, '05-undo-bar.png') });
    await page.click('#vmail-undo-send');
    await page.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
    check(/Yes, that works/.test(await page.inputValue('#vmail-editor-text')), 'after Undo the reply is still an editable draft');

    await page.click('#vmail-send');
    await page.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
    await page.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
    check(true, 'send completes after the countdown');
    await page.click('.vmail-folder[data-folder="sentitems"]');
    await page.waitForSelector('#vmail-list [role="option"]', { timeout: 5000 });
    const firstSent = await page.textContent('#vmail-list [role="option"]:first-child');
    check(/RE: Northwind x AmbientPixels: kickoff/.test(firstSent), 'sent reply appears at the top of Sent');

    // ── Shortcuts: j / k / e (+ Undo) ──
    await page.click('.vmail-folder[data-folder="inbox"]');
    await page.waitForSelector('#vmail-list [role="option"]');
    await page.click('.vmail-chip[data-filter="all"]');
    await page.focus('#vmail-list');
    const sel = () => page.$eval('#vmail-list [aria-selected="true"]', (r) => r.getAttribute('data-id')).catch(() => null);
    const ids = await page.$$eval('#vmail-list [role="option"]', (r) => r.map((x) => x.getAttribute('data-id')));
    await page.keyboard.press('j');
    const s1 = await sel();
    await page.keyboard.press('j');
    const s2 = await sel();
    check(s1 && s2 && ids.indexOf(s2) === ids.indexOf(s1) + 1, 'j moves down');
    await page.keyboard.press('k');
    check(await sel() === s1, 'k moves up');
    const before = await page.$$eval('#vmail-list [role="option"]', (r) => r.length);
    await page.keyboard.press('e');
    await page.waitForFunction((n) => document.querySelectorAll('#vmail-list [role="option"]').length === n - 1, before, { timeout: 5000 });
    check(!(await page.$('#vmail-list [data-id="' + s1 + '"]')), 'e archives the selected email');
    check(/Archived/.test(await page.textContent('#vmail-toast')), 'archive shows an Undo strip');
    await page.click('#vmail-toast .vmail-toast__undo');
    await page.waitForSelector('#vmail-list [data-id="' + s1 + '"]', { timeout: 5000 });
    check(true, 'Undo brings the email back');

    // ── Search + empty state ──
    await page.click('#vmail-list');
    await page.keyboard.press('/');
    check(await page.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-search'), '/ focuses search');
    await page.keyboard.type('Lumen');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => /Intro from Ana: Lumen Capital/.test(document.querySelector('#vmail-list').textContent), null, { timeout: 5000 });
    check(true, 'search finds a fixture subject');
    await page.fill('#vmail-search', 'zzzz nothing matches');
    await page.keyboard.press('Enter');
    await page.waitForSelector('.vmail-empty', { timeout: 5000 });
    check(/No mail matches/.test(await page.textContent('.vmail-empty')), 'empty state says why');
    await page.screenshot({ path: path.join(SHOTS, '06-empty.png') });
    await page.click('#vmail-search-clear');
    await page.waitForSelector('#vmail-list [role="option"]', { timeout: 5000 });

    // ── Shortcut sheet ──
    await page.focus('#vmail-list');
    await page.keyboard.press('?');
    await page.waitForSelector('#vmail-help[open]', { timeout: 3000 });
    check(true, '? opens the shortcut sheet');
    await page.screenshot({ path: path.join(SHOTS, '07-shortcuts.png') });
    await page.keyboard.press('Escape');
    await page.waitForSelector('#vmail-help:not([open])', { state: 'attached', timeout: 3000 });
    check(true, 'Esc closes the shortcut sheet');
    await ctx.close();

    // ── Phone 390×844 ──
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const ph = await pctx.newPage();
    watch(ph);
    await ph.goto(base + PAGE);
    await ph.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
    check(!(await ph.isVisible('#vmail-reader')), 'phone: reader hidden until an email opens');
    check(!(await ph.isVisible('.vmail-nav')), 'phone: folder column hidden');
    const sw = await ph.evaluate(() => document.documentElement.scrollWidth);
    check(sw <= 390, 'phone: no horizontal scroll (' + sw + ')');
    await ph.screenshot({ path: path.join(SHOTS, '08-phone.png') });
    await ph.tap('#vmail-list [data-id="demo-inb-006"]');
    await ph.waitForSelector('#vmail-reader', { state: 'visible', timeout: 5000 });
    await ph.waitForSelector('#vmail-reader .vmail-vale', { timeout: 5000 });
    check(!(await ph.isVisible('#vmail-list')), 'phone: one column (list hidden while reading)');
    await ph.screenshot({ path: path.join(SHOTS, '09-phone-reader.png') });
    await ph.tap('#vmail-back');
    await ph.waitForSelector('#vmail-list', { state: 'visible', timeout: 3000 });
    check(true, 'phone: back returns to the list');
    await pctx.close();

    check(problems.length === 0, 'no console or page errors' + (problems.length ? ':\n    ' + problems.join('\n    ') : ''));
    console.log('Screenshots: ' + SHOTS);
    console.log('E2E OK');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => { console.error(e && e.message ? e.message : e); process.exit(1); });
