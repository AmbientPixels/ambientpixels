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

// The production Content-Security-Policy (read-only from staticwebapp.config.json), sent on every
// HTML response so a CSP breakage fails here instead of on the live site.
const PROD_CSP = (JSON.parse(fs.readFileSync(path.join(ROOT, 'staticwebapp.config.json'), 'utf8')).globalHeaders || {})['Content-Security-Policy'] || '';

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
      const ext = path.extname(file).toLowerCase();
      const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-store' };
      if (ext === '.html' && PROD_CSP) headers['Content-Security-Policy'] = PROD_CSP;
      res.writeHead(200, headers);
      res.end(buf);
    });
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve(server)));
}

function check(cond, what) {
  if (!cond) throw new Error('E2E check failed: ' + what);
  console.log('  ok  ', what);
}

const SHIM = `(() => {
  if (window.__vmShim) return;
  window.__vmShim = true;
  window.__vmFail = window.__vmFail || {};
  window.__vmCalls = {};
  let real;
  Object.defineProperty(window, 'ValeMailDemo', {
    configurable: true,
    get() { return real; },
    set(v) {
      const orig = v.createDemoGraph;
      real = Object.assign({}, v, {
        createDemoGraph(fx, o) {
          const g = orig(fx, o);
          Object.keys(g).forEach((k) => {
            const f = g[k];
            if (typeof f !== 'function') return;
            g[k] = function () {
              window.__vmCalls[k] = (window.__vmCalls[k] || 0) + 1;
              if (window.__vmFail[k] > 0) { window.__vmFail[k]--; return Promise.reject({ status: 0, code: 'network' }); }
              return f.apply(this, arguments);
            };
          });
          window.__vmGraph = g;
          return g;
        }
      });
    }
  });
})();`;

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
      const t = m.text();
      const loc = (m.location() && m.location().url) || '';
      // CSP violations are never filtered: the page ships with the production policy.
      if (/Content Security Policy/i.test(t)) { problems.push('csp: ' + t); return; }
      if (m.type() !== 'error') return;
      // Third-party font/icon CDNs can be slow or offline on a dev box; they are not our code.
      if (/fonts\.googleapis|fonts\.gstatic|cdnjs\.cloudflare/.test(t + ' ' + loc)) return;
      problems.push('console: ' + t + (loc ? ' @ ' + loc : ''));
    });
  }
  try {
    // ── Desktop 1440 ──
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await ctx.addInitScript(SHIM);
    const page = await ctx.newPage();
    watch(page);
    const t0 = Date.now();
    await page.goto(base + PAGE);
    await page.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
    const ttiMs = Date.now() - t0;
    console.log('  inbox interactive in ' + ttiMs + ' ms');
    check(ttiMs < 1000, 'inbox interactive in under 1 s on demo (' + ttiMs + ' ms)');

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
    await page.waitForTimeout(300);
    const shown = await page.$eval(frameSel, (f) => f.srcdoc);
    check(/<img[^>]+src="data:image\/png;base64,/.test(shown), 'demo: Show images renders real (drawn) images');
    const nf = page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());
    let natural = -1;
    try { natural = await nf.evaluate(() => Math.max.apply(null, Array.from(document.images).map((i) => i.naturalWidth))); } catch (e) { natural = -1; }
    if (natural !== -1) check(natural > 0, 'demo: an image in the newsletter has naturalWidth > 0 (' + natural + ')');
    await page.screenshot({ path: path.join(SHOTS, '03-newsletter.png') });

    // ── Stance → draft → send → undo → send → Sent ──
    await page.click('.vmail-chip[data-filter="needs_you"]');
    await page.click('#vmail-list [data-id="demo-inb-006"]');
    await page.waitForSelector('.vmail-stance[data-stance="yes"]', { timeout: 5000 });
    check(/\?/.test(await page.textContent('.vmail-question')), 'Vale quotes the question she found');
    await page.click('.vmail-stance[data-stance="yes"]');
    await page.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && /Thursday at 10am Pacific works/.test(t.value); }, null, { timeout: 5000 });
    await page.waitForTimeout(250); // let the editor's entrance settle before the screenshot
    check(/Dana/.test(await page.inputValue('#vmail-editor-text')), 'Vale\'s draft lands in the editor, addressed to Dana');
    await page.screenshot({ path: path.join(SHOTS, '04-editor.png') });

    await page.click('#vmail-send');
    await page.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
    check(/Sending/.test(await page.textContent('#vmail-sendbar')), 'Undo bar counts down');
    await page.screenshot({ path: path.join(SHOTS, '05-undo-bar.png') });
    await page.click('#vmail-undo-send');
    await page.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
    check(/Thursday at 10am Pacific works/.test(await page.inputValue('#vmail-editor-text')), 'after Undo the reply is still an editable draft');

    await page.click('#vmail-send');
    await page.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
    await page.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
    check(true, 'send completes after the countdown');
    await page.waitForFunction((n) => (document.querySelector('.vmail-chip[data-filter="needs_you"] .vmail-chip__count') || {}).textContent === String(n), want.needs_you - 1, { timeout: 5000 });
    check(await chipCount('needs_you') === String(want.needs_you - 1), 'after the reply, Needs you drops by one');
    check(await chipCount('waiting') === String(want.waiting + 1), 'after the reply, Waiting on others grows by one');
    check(/Sent\. It's Dana's turn now\./.test(await page.textContent('.vmail-vale')), 'panel says "Sent. It\'s Dana\'s turn now."');
    check(!(await page.$('.vmail-vale .vmail-stance')), 'no stance buttons once answered');
    check(!(await page.$('#vmail-list [data-id="demo-inb-006"]')), 'the answered email leaves the Needs you list');
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

    // ── Reply-To guard: the safe address is the default, and what the editor shows is what sends ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      await pg.click('.vmail-chip[data-filter="all"]');
      await pg.click('#vmail-list [data-id="demo-inb-015"]');
      await pg.waitForSelector('.vmail-warn--replyto', { timeout: 5000 });
      check(await pg.getAttribute('.vmail-warn--replyto', 'role') === 'note', 'Reply-To warning is a note, not a re-firing alert');
      check(!(await pg.$('.vmail-vale .vmail-stance[data-stance]')), 'Reply-To mismatch: no one-tap stance buttons (no Acknowledge)');
      check(/another way/.test(await pg.textContent('.vmail-vale .vmail-question')), 'Reply-To mismatch: Vale says to check another way first');
      check(/Draft a safe reply/.test(await pg.textContent('.vmail-vale [data-act="draft-safe"]')), 'Reply-To mismatch: the only draft button is "Draft a safe reply"');
      await pg.click('.vmail-vale [data-act="draft-safe"]');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && t.value.trim().length > 0 && !t.disabled; }, null, { timeout: 5000 });
      const safe = await pg.inputValue('#vmail-editor-text');
      check(!/Sounds good/i.test(safe) && /call/.test(safe), 'Reply-To mismatch: the draft verifies by phone and never agrees');
      const head1 = await pg.textContent('.vmail-editor__head');
      check(/dana@northwind-studio\.example/.test(head1) && !/quickmail/.test(head1), 'Draft a reply goes to the From address by default');
      await pg.click('.vmail-warn--replyto [data-act="use-replyto"]');
      const head2 = await pg.textContent('.vmail-editor__head');
      check(/quickmail\.example/.test(head2) && await pg.isVisible('.vmail-warnchip'), 'Use the Reply-To address switches the editor, with a "Not the sender\'s address" chip');
      await pg.click('#vmail-send');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      check(/quickmail\.example/.test(await pg.textContent('#vmail-sendbar-text')), 'countdown names the Reply-To address itself, not a display name');
      await pg.click('#vmail-undo-send');
      await pg.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
      await pg.click('.vmail-warn--replyto [data-act="use-from"]');
      check(/dana@northwind-studio\.example/.test(await pg.textContent('.vmail-editor__head')), 'switching back shows the From address');
      await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent to dana@northwind-studio\.example/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      const sent1 = await pg.evaluate(async () => (await window.__vmGraph.listMessages({ folder: 'sentitems' })).items[0].toRecipients.map((r) => r.emailAddress.address));
      check(JSON.stringify(sent1) === '["dana@northwind-studio.example"]', 'sent to exactly the address the editor showed (From): ' + sent1);
      await pg.click('.vmail-warn--replyto [data-act="use-replyto"]');
      await pg.click('.vmail-vale [data-act="reply"]');
      await pg.fill('#vmail-editor-text', 'Checking with you here first.');
      check(/quickmail\.example/.test(await pg.textContent('.vmail-editor__head')), 'second reply shows the Reply-To address');
      await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent to dana\.reyes\.billing@quickmail\.example/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      const sent2 = await pg.evaluate(async () => (await window.__vmGraph.listMessages({ folder: 'sentitems' })).items[0].toRecipients.map((r) => r.emailAddress.address));
      check(JSON.stringify(sent2) === '["dana.reyes.billing@quickmail.example"]', 'sent to exactly the address the editor showed (Reply-To): ' + sent2);
      await c.close();
    }

    // ── Keyboard only: skip link, j, Tab to a stance, Enter, Ctrl+Enter, Undo with Enter ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      let onSkip = false;
      for (let i = 0; i < 60 && !onSkip; i++) {
        await pg.keyboard.press('Tab');
        onSkip = await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-skip');
      }
      check(onSkip, 'keyboard: Tab reaches the "Skip to messages" link');
      await pg.keyboard.press('Enter');
      check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-list'), 'keyboard: the skip link moves focus to the message list');
      await pg.keyboard.press('j');
      await pg.waitForSelector('.vmail-stance[data-stance="yes"]', { timeout: 5000 });
      let onYes = false;
      for (let i = 0; i < 30 && !onYes; i++) {
        await pg.keyboard.press('Tab');
        onYes = await pg.evaluate(() => { const a = document.activeElement; return !!a && a.matches('.vmail-stance[data-stance="yes"]'); });
      }
      check(onYes, 'keyboard: Tab reaches the Yes stance');
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && /sandbox key/.test(t.value) && document.activeElement === t; }, null, { timeout: 5000 });
      check(true, 'keyboard: Enter on Yes drafts the reply and focuses the editor');
      await pg.keyboard.press('Control+Enter');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-undo-send'), 'keyboard: Ctrl+Enter starts the countdown and focuses Undo');
      const quietCountdown = await pg.$eval('#vmail-sendbar-text', (el) => { for (let n = el; n; n = n.parentElement) if (n.hasAttribute && n.hasAttribute('aria-live')) return false; return true; });
      check(quietCountdown, 'a11y: the per-second countdown is not in a live region');
      check(/Press Undo/.test(await pg.textContent('#vmail-sendbar-sr')), 'a11y: the send is announced once in its own live region');
      await pg.keyboard.press('Enter');
      await pg.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
      check(/sandbox key/.test(await pg.inputValue('#vmail-editor-text')), 'keyboard: Enter on Undo stops the send');

      // Forced colors: the focus ring must survive (box-shadow is dropped there).
      await pg.emulateMedia({ forcedColors: 'active' });
      await pg.focus('#vmail-search');
      await pg.keyboard.press('Tab');
      const ring = await pg.evaluate(() => { const a = document.activeElement; return a.id + ':' + getComputedStyle(a).outlineStyle; });
      check(ring === 'vmail-compose:solid', 'forced colors: focused Compose has a solid outline (' + ring + ')');
      await pg.emulateMedia({ forcedColors: 'none' });

      // j/k: one Graph read when the selection settles, not one per key press.
      await pg.click('.vmail-chip[data-filter="all"]');
      await pg.focus('#vmail-list');
      await pg.waitForTimeout(400);
      await pg.evaluate(() => { window.__vmCalls.getMessage = 0; });
      for (let i = 0; i < 8; i++) await pg.keyboard.press('j');
      await pg.waitForTimeout(900);
      const gets = await pg.evaluate(() => window.__vmCalls.getMessage || 0);
      check(gets >= 1 && gets <= 2, 'holding j: ' + gets + ' message read(s) for 8 presses');
      const selSubj = await pg.$eval('#vmail-list [aria-selected="true"] .vmail-row__subject strong', (e) => e.textContent);
      check((await pg.textContent('#vmail-subject')) === selSubj, 'the reader shows the last selected email');

      // Esc closes the reader and focus returns to the list.
      await pg.keyboard.press('Escape');
      await pg.waitForSelector('#vmail-reader .vmail-hello', { timeout: 3000 });
      check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-list'), 'Esc closes the reader; focus returns to the list');

      // f / u with Undo.
      const fid = await pg.$eval('#vmail-list [aria-selected="true"]', (r) => r.getAttribute('data-id'));
      const rowSel = '#vmail-list [data-id="' + fid + '"]';
      const wasFlagged = !!(await pg.$(rowSel + ' .fa-flag'));
      await pg.keyboard.press('f');
      await pg.waitForFunction(([s, w]) => !!document.querySelector(s + ' .fa-flag') !== w, [rowSel, wasFlagged], { timeout: 3000 });
      check(true, 'f toggles the flag');
      await pg.waitForSelector('#vmail-toast-undo:not([hidden])', { timeout: 3000 });
      await pg.click('#vmail-toast-undo');
      await pg.waitForFunction(([s, w]) => !!document.querySelector(s + ' .fa-flag') === w, [rowSel, wasFlagged], { timeout: 3000 });
      check(true, 'Undo restores the flag');
      await pg.focus('#vmail-list');
      const wasUnread = await pg.$eval(rowSel, (r) => r.classList.contains('is-unread'));
      await pg.keyboard.press('u');
      await pg.waitForFunction(([s, w]) => document.querySelector(s).classList.contains('is-unread') !== w, [rowSel, wasUnread], { timeout: 3000 });
      check(true, 'u toggles read / unread');
      await pg.waitForSelector('#vmail-toast-undo:not([hidden])', { timeout: 3000 });
      await pg.click('#vmail-toast-undo');
      await pg.waitForFunction(([s, w]) => document.querySelector(s).classList.contains('is-unread') === w, [rowSel, wasUnread], { timeout: 3000 });
      check(true, 'Undo restores read / unread');

      // Compose with a Vale brief → send → it lands in Sent.
      await pg.click('#vmail-compose');
      await pg.fill('#vmail-compose-to', 'pat@vendor.example');
      await pg.fill('#vmail-compose-subject', 'E2E compose check');
      await pg.fill('#vmail-compose-brief', 'confirm the Friday call');
      await pg.click('form[data-form="brief"] button[type="submit"]');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && /Confirm the Friday call/.test(t.value) && !t.disabled; }, null, { timeout: 5000 });
      check(/Hi Pat/.test(await pg.inputValue('#vmail-editor-text')), 'compose: Vale drafts from the one-line brief');
      await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      await pg.click('.vmail-folder[data-folder="sentitems"]');
      await pg.waitForFunction(() => /E2E compose check/.test((document.querySelector('#vmail-list [role="option"]') || {}).textContent || ''), null, { timeout: 5000 });
      check(true, 'compose: the new email is at the top of Sent');

      // A failed send keeps the draft, says so, and "Try again" sends it.
      await pg.click('.vmail-folder[data-folder="inbox"]');
      await pg.click('.vmail-chip[data-filter="all"]');
      await pg.click('#vmail-list [data-id="demo-inb-025"]');
      await pg.waitForSelector('.vmail-vale .vmail-stance[data-stance]', { timeout: 5000 });
      await pg.click('.vmail-vale .vmail-stance[data-stance]');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && t.value.trim() && !t.disabled; }, null, { timeout: 5000 });
      await pg.evaluate(() => { window.__vmFail.sendDraft = 1; });
      await pg.click('#vmail-send');
      await pg.waitForSelector('.vmail-editor__error[role="alert"]', { timeout: 20000 });
      check(/Try again/.test(await pg.textContent('#vmail-send')), 'send failure: the editor says so and Send reads "Try again"');
      await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      check(true, 'send failure: Try again sends it');
      await c.close();
    }

    const allMsgs = [].concat(...Object.values(fixture.folders));
    const subjOf = (id) => allMsgs.find((m) => m.id === id).subject;
    const opener = (pg) => async (id) => {
      await pg.click('#vmail-list [data-id="' + id + '"]');
      await pg.waitForFunction(([i, s]) => {
        const r = document.querySelector('#vmail-list [aria-selected="true"]');
        const h1 = document.querySelector('#vmail-subject');
        return r && r.getAttribute('data-id') === i && h1 && h1.textContent === s && document.querySelector('#vmail-reader .vmail-vale');
      }, [id, subjOf(id)], { timeout: 5000 });
    };
    const draftLands = (pg, re) => pg.waitForFunction((src) => {
      const t = document.querySelector('#vmail-editor-text');
      return t && !t.disabled && new RegExp(src).test(t.value);
    }, re.source, { timeout: 5000 });

    // ── Round 2: the panel offers the right action for each kind of email ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      await pg.waitForFunction(() => /, Chad\.$/.test((document.querySelector('.vmail-hello__title') || {}).textContent || ''), null, { timeout: 3000 });
      check(true, '1440: the greeting names Chad on first load');
      const chipsIn = await pg.$$eval('.vmail-chip', (cs) => {
        const box = document.querySelector('#vmail-listpane').getBoundingClientRect();
        return cs.length === 5 && cs.every((x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.left >= box.left && r.right <= box.right; });
      });
      check(chipsIn, '1440: all five filter chips are fully visible in the list header');
      const open = opener(pg);
      await pg.click('.vmail-chip[data-filter="all"]');

      for (const id of ['demo-inb-019', 'demo-inb-020', 'demo-inb-028', 'demo-inb-029', 'demo-inb-030', 'demo-inb-033', 'demo-inb-034']) {
        await open(id);
        const t = await pg.textContent('#vmail-reader .vmail-vale');
        const st = await pg.$('#vmail-reader .vmail-vale [data-stance]');
        check(!/Waiting on your reply/.test(t) && !st && /Archive it/.test(t), id + ': nothing to answer (no waiting line, no stances, Archive it)');
      }

      await open('demo-inb-027');
      check(!(await pg.$('.vmail-vale [data-stance="yes"]')) && !!(await pg.$('.vmail-vale [data-stance="choice"][data-option="A"]')) &&
        !!(await pg.$('.vmail-vale [data-stance="choice"][data-option="B"]')), 'A-or-B question: one button per option, no Yes/No');
      await pg.click('.vmail-vale [data-stance="choice"][data-option="B"]');
      await draftLands(pg, /go with B\./);
      check(true, 'choosing B drafts "Let\'s go with B."');
      check(/Demo draft/.test(await pg.textContent('.vmail-editor__head')), 'demo drafts are marked "Demo draft"');
      await pg.focus('.vmail-editor [data-act="discard"]');
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => !document.querySelector('#vmail-editor-text'), null, { timeout: 3000 });
      check(await pg.evaluate(() => !!document.activeElement && document.activeElement !== document.body), 'Enter on Discard: focus stays on a control, not <body>');
      await pg.click('#vmail-toast-undo');
      await draftLands(pg, /go with B\./);
      const stored = await pg.evaluate(() => Object.keys(sessionStorage).filter((k) => /^vmail:draft:/.test(k)));
      check(stored.length === 0, 'Undo on discard brings the draft back without storing an unedited Vale draft' + (stored.length ? ': ' + stored.join(',') : ''));
      await pg.click('.vmail-editor [data-act="discard"]');

      await open('demo-inb-025');
      check(!(await pg.$('.vmail-vale [data-stance="yes"]')) && !(await pg.$('.vmail-vale [data-stance="no"]')) && /Draft an answer/.test(await pg.textContent('.vmail-vale')),
        'open question: no Yes/No, one "Draft an answer"');

      await open('demo-inb-011');
      check(!!(await pg.$('.vmail-vale [data-stance="nudge"]')) && !(await pg.$('.vmail-vale [data-stance="ack"]')), 'Waiting thread: "Draft a nudge", no Acknowledge');
      await pg.click('.vmail-vale [data-stance="nudge"]');
      await draftLands(pg, /checking in/);
      check(true, 'the nudge draft checks in');
      await pg.click('.vmail-editor [data-act="discard"]');

      await open('demo-inb-001');
      check(/Open the latest/.test(await pg.textContent('.vmail-vale')) && !(await pg.$('.vmail-vale [data-stance]')), 'older message in an answered thread: "Open the latest", no stances');
      await pg.click('.vmail-vale [data-act="open-latest"]');
      await pg.waitForFunction(() => { const r = document.querySelector('#vmail-list [aria-selected="true"]'); return r && r.getAttribute('data-id') === 'demo-inb-006' && document.querySelector('#vmail-reader .vmail-vale [data-stance="yes"]'); }, null, { timeout: 5000 });
      check(true, '"Open the latest" opens demo-inb-006');

      // Toolbar actions keep keyboard focus on their re-rendered button.
      await pg.focus('#vmail-reader .vmail-reader__bar [data-act="flag"]');
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => { const a = document.activeElement; return a && a.getAttribute('data-act') === 'flag' && /Unflag/.test(a.textContent); }, null, { timeout: 3000 });
      check(true, 'Enter on Flag: focus stays on the (now Unflag) button');
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => { const a = document.activeElement; return a && a.getAttribute('data-act') === 'flag' && !/Unflag/.test(a.textContent); }, null, { timeout: 3000 });
      await pg.waitForFunction(() => /Flag removed/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 3000 });
      await pg.focus('#vmail-reader .vmail-reader__bar [data-act="unread"]');
      await pg.keyboard.press('Enter');
      await pg.waitForFunction(() => { const a = document.activeElement; return a && a.getAttribute('data-act') === 'unread' && /Mark read/.test(a.textContent); }, null, { timeout: 3000 });
      check(true, 'Enter on Mark unread: focus stays on that button');
      await pg.waitForFunction(() => /Marked unread/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 3000 });
      await pg.focus('#vmail-reader .vmail-reader__bar [data-act="archive"]');
      await pg.keyboard.press('Enter');
      await pg.waitForTimeout(700);
      check(await pg.evaluate(() => { const a = document.activeElement; return !!a && a !== document.body && (document.querySelector('#vmail-reader').contains(a) || a.id === 'vmail-list'); }),
        'Enter on Archive: focus lands in the reader or the list, never <body>');
      await pg.click('#vmail-toast-undo');
      await pg.waitForSelector('#vmail-list [data-id="demo-inb-006"]', { timeout: 5000 });

      // z undoes the last action from the keyboard.
      await pg.focus('#vmail-list');
      const zid = await pg.$eval('#vmail-list [aria-selected="true"]', (r) => r.getAttribute('data-id'));
      await pg.keyboard.press('e');
      await pg.waitForFunction((i) => !document.querySelector('#vmail-list [data-id="' + i + '"]'), zid, { timeout: 3000 });
      check(/Press z to undo/.test(await pg.textContent('#vmail-toast')), 'the archive toast says "Press z to undo"');
      await pg.keyboard.press('z');
      await pg.waitForSelector('#vmail-list [data-id="' + zid + '"]', { timeout: 5000 });
      await pg.waitForFunction(() => /Moved back to Inbox/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 5000 });
      check(true, 'z undoes the archive ("Moved back to Inbox.")');

      // A search with no results empties the reader and keeps the header height.
      await open('demo-inb-024');
      const top0 = await pg.$eval('#vmail-list', (l) => l.getBoundingClientRect().top);
      await pg.fill('#vmail-search', 'zzzz');
      await pg.press('#vmail-search', 'Enter');
      await pg.waitForSelector('.vmail-empty', { timeout: 5000 });
      const top1 = await pg.$eval('#vmail-list', (l) => l.getBoundingClientRect().top);
      check(!(await pg.$('#vmail-reader .vmail-vale')) && /Nothing selected/.test(await pg.textContent('#vmail-reader')), 'no-result search: the reader goes quiet');
      check(Math.abs(top1 - top0) <= 2, 'no-result search: the list header keeps its height (' + top0 + ' → ' + top1 + ')');
      await pg.click('#vmail-search-clear');
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 5000 });

      // A one-line compose brief becomes a real sentence.
      await pg.click('#vmail-compose');
      await pg.fill('#vmail-compose-to', 'ravi@oakline-dev.example');
      await pg.fill('#vmail-compose-brief', 'ask Ravi if Tuesday works for a demo');
      await pg.click('form[data-form="brief"] button[type="submit"]');
      await draftLands(pg, /\S/);
      const cb = await pg.inputValue('#vmail-editor-text');
      check(/Does Tuesday work/.test(cb) && !/ask Ravi/.test(cb) && !/Quick note:/.test(cb), 'compose brief becomes a real sentence: ' + JSON.stringify(cb.split('\n')[2] || ''));
      await pg.click('.vmail-editor [data-act="discard"]');

      // Send → "Next:" opens the next email that needs Chad.
      await pg.click('.vmail-chip[data-filter="needs_you"]');
      await open('demo-inb-024');
      await pg.click('.vmail-vale [data-stance="yes"]');
      await draftLands(pg, /sandbox/);
      check(true, 'Ravi\'s yes draft hands over a sandbox key');
      await pg.$eval('#vmail-reader', (r) => { r.scrollTop = r.scrollHeight; });
      await pg.waitForTimeout(250);
      const subjOut = await pg.evaluate(() => { const r = document.querySelector('#vmail-reader').getBoundingClientRect(); const s = document.querySelector('#vmail-subject').getBoundingClientRect(); return s.bottom < r.top + 46; });
      if (subjOut) check(await pg.isVisible('.vmail-toolbar--with-subject .vmail-toolbar__subject'), 'the bar carries the subject once the heading scrolls away');
      await pg.click('#vmail-send');
      await pg.waitForSelector('.vmail-vale [data-act="next"]', { timeout: 20000 });
      const nextText = (await pg.textContent('.vmail-vale [data-act="next"]')).trim();
      check(/^Next:/.test(nextText), 'after sending, the panel offers "' + nextText + '"');
      check(((await pg.textContent('.vmail-vale')).match(/just now/g) || []).length <= 1, 'the post-send panel says "just now" at most once');
      check(await pg.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-act') === 'next'), 'after the send, focus is on Next (not <body>)');
      await pg.click('.vmail-vale [data-act="next"]');
      await pg.waitForFunction(() => { const r = document.querySelector('#vmail-list [aria-selected="true"]'); return r && r.getAttribute('data-id') !== 'demo-inb-024' && document.querySelector('#vmail-reader .vmail-vale'); }, null, { timeout: 5000 });
      const nid = await pg.$eval('#vmail-list [aria-selected="true"]', (r) => r.getAttribute('data-id'));
      check(fixture.labels[nid] && fixture.labels[nid].label === 'needs_you', 'Next opens another Needs you email (' + nid + ')');
      await c.close();
    }

    // ── Round 2: sends that half-fail never double-send or report "Not sent" falsely ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      const open = opener(pg);
      await pg.click('.vmail-chip[data-filter="all"]');
      await open('demo-inb-031');
      await pg.click('.vmail-vale [data-stance="yes"]');
      await draftLands(pg, /coffee/);
      await pg.evaluate(() => {
        const g = window.__vmGraph, real = g.sendDraft;
        g.sendDraft = function (id) { g.sendDraft = real; return real.call(g, id).then(() => Promise.reject({ status: 0, code: 'network' })); };
      });
      await pg.click('#vmail-send');
      await pg.waitForSelector('.vmail-editor__error[role="alert"]', { timeout: 20000 });
      check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-send'), 'send failure: focus is on Try again');
      await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      const copies = await pg.evaluate(async () => (await window.__vmGraph.listMessages({ folder: 'sentitems' })).items.filter((m) => m.conversationId === 'conv-demo-inb-031').length);
      check(copies === 1, 'a send that went through but reported failure: Try again finds it in Sent, exactly one copy (' + copies + ')');

      await open('demo-inb-036');
      await pg.click('.vmail-vale [data-stance="yes"]');
      await draftLands(pg, /Marcus/);
      await pg.evaluate(() => {
        const g = window.__vmGraph, list = g.listMessages, send = g.sendDraft;
        let armed = false;
        g.sendDraft = function (id) { return send.call(g, id).then((r) => { armed = true; return r; }); };
        g.listMessages = function (o) {
          if (armed && o && o.folder === 'sentitems') { armed = false; return Promise.resolve({ items: [null], next: null }); }
          return list.call(g, o);
        };
      });
      await pg.click('#vmail-send');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      await pg.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 20000 });
      await pg.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 5000 });
      check(true, 'a UI error after a good send: the toast still says Sent');
      check(!(await pg.$('#vmail-editor-text')), 'a UI error after a good send: the editor is gone');
      check(!/Not sent/.test(await pg.textContent('#vmail-reader')), 'a UI error after a good send: nothing says "Not sent"');
      check(await pg.evaluate(() => sessionStorage.getItem('vmail:draft:demo-inb-036') === null), 'a UI error after a good send: no saved draft left to resend');
      await c.close();
    }

    // ── Errors: inbox and calendar fail once, then recover with Try again ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript('window.__vmFail = { listMessages: 1, calendarView: 1 };');
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list .vmail-error', { timeout: 8000 });
      check(/offline/.test(await pg.textContent('#vmail-list .vmail-error')), 'inbox failure: plain-words error in the list');
      await pg.click('#vmail-list .vmail-error [data-act="reload"]');
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 5000 });
      check(true, 'inbox failure: Try again loads the rows');
      await pg.waitForSelector('#vmail-today-body [data-act="calendar"]', { timeout: 5000 });
      check(true, 'calendar failure: Today shows Try again');
      await pg.click('#vmail-today-body [data-act="calendar"]');
      await pg.waitForSelector('#vmail-today-body .vmail-event', { timeout: 5000 });
      check(true, 'calendar failure: Try again loads the meetings');
      await c.close();
    }

    // ── 1024: two columns, folder menu, one-line chips ──
    {
      const c = await browser.newContext({ viewport: { width: 1024, height: 768 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      check(!(await pg.isVisible('.vmail-nav')), '1024: folder column hidden');
      check(await pg.isVisible('#vmail-folder-select'), '1024: folder menu visible');
      const sw = await pg.evaluate(() => document.documentElement.scrollWidth);
      check(sw <= 1024, '1024: no horizontal scroll (' + sw + ')');
      const clipped = await pg.$$eval('.vmail-chip', (cs) => { const box = document.querySelector('#vmail-chips').getBoundingClientRect(); return cs.filter((c) => { const r = c.getBoundingClientRect(); return r.left < box.left - 0.5 || r.right > box.right + 0.5; }).length; });
      check(clipped === 0, '1024: no filter chip is cut off');
      await pg.waitForFunction(() => /, Chad\.$/.test((document.querySelector('.vmail-hello__title') || {}).textContent || ''), null, { timeout: 3000 });
      check(true, '1024: the greeting names Chad on first load');
      await pg.waitForTimeout(400);
      if (await pg.isVisible('#vmail-nextup')) {
        await pg.click('#vmail-nextup');
        await pg.waitForSelector('#vmail-schedule[open]', { timeout: 3000 });
        check(/Investor call: Lumen Capital/.test(await pg.textContent('#vmail-schedule')), '1024: the schedule sheet shows today and tomorrow');
        await pg.screenshot({ path: path.join(SHOTS, '11-1024-schedule.png') });
        await pg.keyboard.press('Escape');
        await pg.waitForSelector('#vmail-schedule:not([open])', { state: 'attached', timeout: 3000 });
        check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-nextup'), '1024: Esc closes the schedule; focus returns to the strip');
      } else console.log('  skip  1024 schedule: no meetings left today at this hour');
      await pg.screenshot({ path: path.join(SHOTS, '10-1024.png') });
      await c.close();
    }

    // ── Hostile email battery in Edge: zero remote requests even with the meta CSP removed ──
    {
      const c = await browser.newContext();
      const pg = await c.newPage();
      const hits = [];
      await pg.route('**/*', (route) => {
        const u = route.request().url();
        if (/evil\.example/.test(u)) { hits.push(u); return route.abort(); }
        return route.continue();
      });
      const battery = [
        '<svg width="10" height="10"><image href="https://evil.example/a.png" width="10" height="10"/></svg>',
        '<svg width="10" height="10"><image xlink:href="https://evil.example/b.png" width="10" height="10"/></svg>',
        '<svg width="10" height="10"><filter id="f"><feImage href="https://evil.example/c.png"/></filter><rect filter="url(#f)" width="10" height="10"/></svg>',
        '<svg><use href="https://evil.example/s.svg#x"/></svg>',
        '<div style="width:10px;height:10px;background:url(&#39;https://evil.example/d.png&#39;)">x</div>',
        '<div style="width:10px;height:10px;background:u\\72l(https://evil.example/e.png)">x</div>',
        '<div style="width:10px;height:10px;background:url(ht\\74ps://evil.example/f.png)">x</div>',
        '<style>@import "https://evil.example/g.css";</style><p>x</p>',
        '<style>div.q{width:10px;height:10px;background-image:image-set("https://evil.example/h.png" 1x)}</style><div class="q">x</div>',
        '<img src="https://evil.example/i.png"><img srcset="https://evil.example/j.png 2x">',
        // Round 2: parser differentials (a quote in attribute-name position) and URL normalisation.
        '<img src=http://evil.example/q.gif onerror=parent.postMessage(1,"*") "x>',
        "<img src=http://evil.example/q2.gif onerror=parent.postMessage(1,'*') 'x>",
        '<meta http-equiv=refresh content=0;url=http://evil.example/meta "x>',
        '<div style=background:url(http://evil.example/sty) "x>hi</div>',
        '<img src="/\\evil.example/sb">',
        '<img src="\\\\evil.example/bs2">',
        '<img src="https:\\\\evil.example/hb">',
        '<img src="http:evil.example/hns">',
        '<div style="width:10px;height:10px;background:url(http:evil.example/ch)">a</div>',
        '<div style="width:10px;height:10px;background:url(&#92;&#92;evil.example/cbe)">a</div>',
        '<img src="ht&#9;tps://evil.example/tab">'
      ];
      const noCsp = (d) => d.replace(/<meta http-equiv="Content-Security-Policy"[^>]*>/, '');
      // An http page (not about:blank), so relative and backslash URLs resolve the way they would
      // on the live site.
      await pg.goto(base + '/data/vale-mail-product.json');
      await pg.setContent('<img src="https://evil.example/control.png">');
      await pg.waitForTimeout(300);
      check(hits.length >= 1, 'battery probe sees a raw remote image (control)');
      hits.length = 0;
      for (const b of battery) {
        await pg.setContent(noCsp(core.safeBodyDoc({ contentType: 'html', content: b }, false)));
        await pg.waitForTimeout(150);
      }
      check(hits.length === 0, 'hostile battery: zero remote requests with images hidden, even without the CSP meta' + (hits.length ? ': ' + hits.join(', ') : ''));
      await c.close();
    }

    // ── vale-auth.html routes by the MSAL state, not a sticky flag ──
    {
      const c = await browser.newContext();
      const pg = await c.newPage();
      const MSAL_STUB = 'window.msal = { PublicClientApplication: function () { this.initialize = function () { return Promise.resolve(); }; this.handleRedirectPromise = function () { return Promise.resolve(null); }; } };';
      await pg.route('**/js/vendor/msal-browser.min.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: MSAL_STUB }));
      let cfgs = [];
      pg.on('request', (rq) => { const u = rq.url(); if (/\/data\/vale-(config|mail-product)\.json/.test(u)) cfgs.push(/vale-config/.test(u) ? 'office' : 'mail'); });
      async function land(flag, hash) {
        await pg.goto(base + '/data/vale-mail-demo.json');
        await pg.evaluate((f) => { if (f === null) sessionStorage.removeItem('vmail.authReturn'); else sessionStorage.setItem('vmail.authReturn', f); }, flag);
        cfgs = [];
        await pg.goto(base + '/pages/vale-auth.html' + hash);
        await pg.waitForURL(/\/modules\/company\/(office|mail)\.html/, { timeout: 8000, waitUntil: 'commit' });
        return { url: pg.url(), cfgs: Array.from(new Set(cfgs)) };
      }
      let r1 = await land('1', '#code=x&state=abc');
      check(/office\.html\?vale=1&signin=ok/.test(r1.url) && r1.cfgs.join() === 'office', 'vale-auth: a stale flag does not hijack the Office sign-in');
      let r2 = await land(JSON.stringify({ at: Date.now() }), '#code=x&state=abc%7Cvmail');
      check(/mail\.html\?signin=ok/.test(r2.url) && r2.cfgs.join() === 'mail', 'vale-auth: a Vale Mail response (state …|vmail) returns to mail.html');
      let r3 = await land(JSON.stringify({ at: Date.now() }), '#code=x&state=abc');
      check(/office\.html/.test(r3.url) && r3.cfgs.join() === 'office', 'vale-auth: an Office response wins over a fresh abandoned Vale Mail flag');
      await c.close();
    }

    // ── Phone 390×844 ──
    const pctx = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    await pctx.addInitScript(SHIM);
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
