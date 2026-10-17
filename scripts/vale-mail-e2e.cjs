// Vale Mail — end-to-end test on the demo mailbox (Playwright + system Edge).
//
// Usage:  NODE_PATH="C:/tmp/node_modules" node scripts/vale-mail-e2e.cjs <screenshot-dir>
//
// Serves the site from this repo on an OS-assigned port (port 0, so parallel runs never
// collide), stubs /api/* and /.auth/me so nothing reaches a live service, opens
// /modules/company/mail.html?demo=1 and walks the whole product: counts, Reply-To guard,
// remote-image blocking, stance → draft → send → undo → send → Sent, j/k/e shortcuts with
// Undo, search, empty state, shortcut sheet, and the phone layout. A real-mode pass stubs MSAL
// and Microsoft Graph (opaque folder ids) and captures the vale-draft requests. Prints "E2E OK".
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

// Demo drafts leave gaps like [day] for Chad, and Send stops on them. Flows that test sending
// fill them first (the gap guard itself has its own checks).
// Screenshots after a theme switch or a panel opening wait for transitions and animations to end,
// so the evidence shows the settled UI, not a mid-fade frame.
async function settle(pg) {
  await pg.waitForTimeout(400);
  // Infinite animations (the drafting dots) never finish: wait for the rest, at most 1.5 s.
  await pg.evaluate(() => Promise.race([
    Promise.all(document.getAnimations().filter((a) => { const t = a.effect && a.effect.getComputedTiming(); return !t || isFinite(t.endTime); })
      .map((a) => a.finished.catch(() => null))),
    new Promise((r) => setTimeout(r, 1500))
  ]));
}

async function fillGaps(pg) {
  await pg.evaluate(() => {
    const t = document.querySelector('#vmail-editor-text');
    if (!t || t.disabled) return;
    const v = t.value.replace(/\[[^\]\n]{1,40}\]/g, 'Monday');
    if (v !== t.value) { t.value = v; t.dispatchEvent(new Event('input', { bubbles: true })); }
  });
}

const SHIM = `(() => {
  if (window.__vmShim) return;
  window.__vmShim = true;
  // A rejected promise nobody handled (a fire-and-forget load that threw) fails the run.
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    console.error('unhandledrejection: ' + ((r && (r.message || r.code)) || String(r)));
  });
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
              const delay = window.__vmDelay && window.__vmDelay[k];
              if (delay > 0) {
                delete window.__vmDelay[k];
                const self = this, args = arguments;
                return new Promise((r) => setTimeout(r, delay)).then(() => f.apply(self, args));
              }
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
  // Real mode: a 400/401/404 from the Graph stub (and the rules 500) is expected, and Chromium logs each failed
  // response as a console error, so only those lines are let through.
  function watchReal(page) {
    page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      const t = m.text();
      if (/Content Security Policy/i.test(t)) { problems.push('csp: ' + t); return; }
      if (m.type() !== 'error' || /Failed to load resource: the server responded with a status of (400|401|404|500)/.test(t)) return;
      if (/fonts.googleapis|fonts.gstatic|cdnjs.cloudflare/.test(t + ' ' + ((m.location() && m.location().url) || ''))) return;
      problems.push('console: ' + t);
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
    check(new RegExp('of the latest ' + inbox.length).test(await page.textContent('.vmail-listhead__count')), 'honest "of the latest N" line');
    const rowsNeeds = await page.$$eval('#vmail-list [role="option"]', (r) => r.length);
    check(rowsNeeds === want.needs_you, 'Needs you shows ' + want.needs_you + ' rows by default');
    const stamp = await page.textContent('.vmail-checked');
    check(await page.isVisible('.vmail-checked') && /^Vale sorted (at \d|yesterday at \d|\w+ at \d)/.test(stamp) && !/Checked/.test(stamp), 'sorting stamp says when Vale sorted, not "Checked" (' + stamp + ')');
    check(/Mail is live; Vale last sorted it/.test(await page.getAttribute('.vmail-checked', 'title')), 'the stamp explains that mail is live');
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
    check(!/You last wrote/.test(await page.textContent('#vmail-reader .vmail-vale')), 'Reply-To guard: the panel borrows no "You last wrote to" history');
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

    await fillGaps(page); await page.click('#vmail-send');
    await page.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
    check(/Sending/.test(await page.textContent('#vmail-sendbar')), 'Undo bar counts down');
    await page.screenshot({ path: path.join(SHOTS, '05-undo-bar.png') });
    await page.click('#vmail-undo-send');
    await page.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
    check(/Thursday at 10am Pacific works/.test(await page.inputValue('#vmail-editor-text')), 'after Undo the reply is still an editable draft');

    await fillGaps(page); await page.click('#vmail-send');
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
    await page.waitForSelector('#vmail-list .vmail-empty', { timeout: 5000 });
    check(/No mail matches/.test(await page.textContent('#vmail-list .vmail-empty')), 'empty state says why');
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
      // Even after "Use the Reply-To address", the safe reply goes to the sender's own address.
      await pg.click('.vmail-warn--replyto [data-act="use-replyto"]');
      await pg.click('.vmail-vale [data-act="draft-safe"]');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && t.value.trim().length > 0 && !t.disabled; }, null, { timeout: 5000 });
      const safe = await pg.inputValue('#vmail-editor-text');
      check(!/Sounds good/i.test(safe) && /call/.test(safe), 'Reply-To mismatch: the draft verifies by phone and never agrees');
      const head1 = await pg.textContent('.vmail-editor__head');
      check(/dana@northwind-studio\.example/.test(head1) && !/quickmail/.test(head1) && !(await pg.$('.vmail-editor .vmail-warnchip')),
        'Draft a safe reply goes to the From address, even after "Use the Reply-To address" (no "Not the sender\'s address" tag)');
      check(!(await pg.$('.vmail-warn--replyto [data-act="use-replyto"]')) && /safe reply goes to dana@northwind-studio\.example/.test(await pg.textContent('.vmail-warn--replyto')),
        'while the safe reply is open, the Reply-To toggle is replaced by where it goes');
      await pg.click('.vmail-editor [data-act="discard"]');
      await pg.click('.vmail-warn--replyto [data-act="use-replyto"]');
      await pg.click('.vmail-reader__bar [data-act="reply"]');
      await pg.fill('#vmail-editor-text', 'Hi Dana, replying here.');
      const head2 = await pg.textContent('.vmail-editor__head');
      check(/quickmail\.example/.test(head2) && await pg.isVisible('.vmail-warnchip'), 'Use the Reply-To address switches the editor, with a "Not the sender\'s address" chip');
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      check(/quickmail\.example/.test(await pg.textContent('#vmail-sendbar-text')), 'countdown names the Reply-To address itself, not a display name');
      await pg.click('#vmail-undo-send');
      await pg.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
      await pg.click('.vmail-warn--replyto [data-act="use-from"]');
      check(/dana@northwind-studio\.example/.test(await pg.textContent('.vmail-editor__head')), 'switching back shows the From address');
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent to dana@northwind-studio\.example/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      const sent1 = await pg.evaluate(async () => (await window.__vmGraph.listMessages({ folder: 'sentitems' })).items[0].toRecipients.map((r) => r.emailAddress.address));
      check(JSON.stringify(sent1) === '["dana@northwind-studio.example"]', 'sent to exactly the address the editor showed (From): ' + sent1);
      await pg.click('.vmail-warn--replyto [data-act="use-replyto"]');
      await pg.click('.vmail-vale [data-act="reply"]');
      await pg.fill('#vmail-editor-text', 'Checking with you here first.');
      check(/quickmail\.example/.test(await pg.textContent('.vmail-editor__head')), 'second reply shows the Reply-To address');
      await fillGaps(pg); await pg.click('#vmail-send');
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
      await pg.keyboard.press('Tab');
      const onSkip = await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-skip');
      check(onSkip, 'keyboard: the first Tab press focuses "Skip to messages"');
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
      await fillGaps(pg);
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
      await fillGaps(pg); await pg.click('#vmail-send');
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
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForSelector('.vmail-editor__error[role="alert"]', { timeout: 20000 });
      check(/Try again/.test(await pg.textContent('#vmail-send')), 'send failure: the editor says so and Send reads "Try again"');
      await fillGaps(pg); await pg.click('#vmail-send');
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
      const oneLine = await pg.$$eval('.vmail-chip', (cs) => new Set(cs.map((x) => Math.round(x.getBoundingClientRect().top))).size === 1);
      const faded = await pg.$eval('#vmail-chips', (el) => el.classList.contains('is-more-left') || el.classList.contains('is-more-right'));
      check(oneLine && !faded, '1440: the five chips sit on one line with no edge fade');
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
      await pg.waitForSelector('#vmail-list .vmail-empty', { timeout: 5000 });
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
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForSelector('.vmail-vale [data-act="next"]', { timeout: 20000 });
      const nextText = (await pg.textContent('.vmail-vale [data-act="next"]')).trim();
      check(/^Next:/.test(nextText), 'after sending, the panel offers "' + nextText + '"');
      check(((await pg.textContent('.vmail-vale')).match(/just now/g) || []).length <= 1, 'the post-send panel says "just now" at most once');
      check(await pg.evaluate(() => !!document.activeElement && document.activeElement.getAttribute('data-act') === 'next'), 'after the send, focus is on Next (not <body>)');
      await pg.click('.vmail-vale [data-act="next"]');
      await pg.waitForFunction(() => { const r = document.querySelector('#vmail-list [aria-selected="true"]'); return r && r.getAttribute('data-id') !== 'demo-inb-024' && document.querySelector('#vmail-reader .vmail-vale'); }, null, { timeout: 5000 });
      const nid = await pg.$eval('#vmail-list [aria-selected="true"]', (r) => r.getAttribute('data-id'));
      check(fixture.labels[nid] && fixture.labels[nid].label === 'needs_you', 'Next opens another Needs you email (' + nid + ')');
      await pg.click('.vmail-chip[data-filter="waiting"]');
      await open('demo-inb-024');
      const reopened = await pg.textContent('#vmail-reader .vmail-vale');
      check(/hasn't answered since you wrote/.test(reopened) && !(await pg.$('.vmail-vale [data-act="next"]')) && !/Sent\. It's/.test(reopened), 'reopened later, an answered thread reads as waiting (no post-send panel)');
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
      await pg.evaluate(() => { window.__vmFail.sendDraft = 1; });
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForSelector('.vmail-editor__error[role="alert"]', { timeout: 20000 });
      check(/Not sent/.test(await pg.textContent('.vmail-editor__error')), 'a send that really failed says "Not sent"');
      check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-send'), 'send failure: focus is on Try again');
      // Try again: this time Graph takes the send, but the answer times out.
      await pg.evaluate(() => {
        const g = window.__vmGraph, real = g.sendDraft;
        g.sendDraft = function (id) { g.sendDraft = real; return real.call(g, id).then(() => Promise.reject({ name: 'GraphError', status: 0, code: 'timeout' })); };
      });
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      check(!/Not sent/.test(await pg.textContent('#vmail-reader')), 'a send that landed but timed out: nothing says "Not sent"');
      const copies = await pg.evaluate(async () => (await window.__vmGraph.listMessages({ folder: 'sentitems' })).items.filter((m) => m.conversationId === 'conv-demo-inb-031').length);
      check(copies === 1, 'a send that landed but timed out: the Sent toast, exactly one copy in Sent (' + copies + ')');

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
      await fillGaps(pg); await pg.click('#vmail-send');
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

    // ── Round 3: who-sent-it guards, waiting rows, quoted history, labels, empty states ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      // Lookalike detection compares against people you've written to: wait for Sent to load.
      await pg.waitForFunction(() => (window.__vmCalls.listMessages || 0) >= 2, null, { timeout: 5000 });
      await pg.waitForTimeout(500);
      const open = opener(pg);
      await pg.click('.vmail-chip[data-filter="all"]');

      // A lookalike domain asking for a bank change: warning, and only a safe reply.
      await open('demo-inb-047');
      await pg.waitForSelector('#vmail-sender-warn', { timeout: 5000 });
      check(/This looks like dana@northwind-studio\.example, but it's from dana@northwind-studlo\.example/.test(await pg.textContent('#vmail-sender-warn')), 'lookalike sender: "This looks like … but it\'s from …" warning');
      check(!(await pg.$('.vmail-vale [data-stance="yes"]')) && !(await pg.$('.vmail-vale [data-stance="no"]')) && !!(await pg.$('.vmail-vale [data-act="draft-safe"]')), 'lookalike sender: no Yes/No, only "Draft a safe reply"');
      await pg.click('.vmail-vale [data-act="draft-safe"]');
      await draftLands(pg, /call/);
      check(true, 'lookalike sender: the demo draft says you\'ll call to check');
      await pg.click('.vmail-editor [data-act="discard"]');

      // An outside email that puts the agent's address in From.
      await open('demo-inb-048');
      const spoof = await pg.textContent('#vmail-reader .vmail-vale');
      check(/came from outside your organization/.test(spoof) && !/Your brief from Vale/.test(spoof) && !(await pg.$('.vmail-vale [data-stance]')),
        'a spoof of the agent\'s address: outside-organization warning, never "Your brief from Vale"');
      await open('demo-inb-029');
      check(/Your brief from Vale/.test(await pg.textContent('#vmail-reader .vmail-vale')), 'the real (internal) brief from Vale still reads "Your brief from Vale"');

      // Waiting rows show what you sent; the panel has one day count.
      await pg.click('.vmail-chip[data-filter="waiting"]');
      await pg.waitForSelector('#vmail-list [data-id="demo-inb-013"]', { timeout: 5000 });
      for (const [id, conv, who] of [['demo-inb-013', 'conv-pinecrest-contract', 'Theo'], ['demo-inb-011', 'conv-clientco-invoice', 'Jordan']]) {
        const prev = (await pg.textContent('#vmail-list [data-id="' + id + '"] .vmail-row__preview')).trim();
        const rowWhen = await pg.getAttribute('#vmail-list [data-id="' + id + '"] .vmail-row__when', 'datetime');
        const sentAt = await pg.evaluate(async (cv) => {
          const s = (await window.__vmGraph.listMessages({ folder: 'sentitems' })).items.filter((m) => m.conversationId === cv);
          return s.map((m) => m.sentDateTime).sort().pop();
        }, conv);
        check(/^You: /.test(prev) && rowWhen === sentAt, who + ' (Waiting): the row shows "You: …" and your send date');
        await open(id);
        const panel = await pg.textContent('#vmail-reader .vmail-vale');
        const counts = new Set((panel.match(/\d+ days ago/g) || []));
        check(counts.size <= 1 && /You last wrote to/.test(panel), who + ': one day count in the panel (' + Array.from(counts).join(', ') + ')');
        check(!/\d+ days ago/.test(await pg.textContent('#vmail-reader .vmail-vale__why')), who + ': Vale\'s saved reason carries no relative time');
      }

      // Newsletters: the chip names the mix, a caption explains it, both tags look alike.
      await pg.click('.vmail-chip[data-filter="newsletter"]');
      check(/Newsletters and low-priority mail/.test(await pg.getAttribute('.vmail-chip[data-filter="newsletter"]', 'title')), 'Newsletters chip: the long name is in its title');
      check(await pg.isVisible('#vmail-listnote') && /low-priority mail Vale set aside/.test(await pg.textContent('#vmail-listnote')), 'Newsletters filter: a caption explains the mix');
      const tagLooks = await pg.$$eval('#vmail-list .vmail-tag', (ts) => ({ n: ts.length, kinds: new Set(ts.map((t) => t.textContent)).size, names: ts.map((t) => t.textContent), looks: new Set(ts.map((t) => { const s = getComputedStyle(t); return s.backgroundColor + '|' + s.color; })).size }));
      check(tagLooks.names.indexOf('Newsletter') === -1 && tagLooks.names.indexOf('Low priority') !== -1 && tagLooks.looks === 1, 'Newsletters filter: no repeated Newsletter tag; Low priority tags keep one style (' + JSON.stringify(tagLooks) + ')');
      await pg.click('.vmail-chip[data-filter="all"]');
      check(!(await pg.isVisible('#vmail-listnote')), 'the caption goes away with the Newsletters filter');

      // Plain-text quoted history folds behind "···".
      await open('demo-inb-024');
      const plain = await pg.$eval('#vmail-reader .vmail-plainbody', (el) => el.innerText);
      check(!/^\s*>/m.test(plain) && !/wrote:/.test(plain) && await pg.getAttribute('.vmail-quotetoggle', 'aria-expanded') === 'false', 'plain-text history is folded behind a toggle');
      await pg.click('.vmail-quotetoggle');
      const quote = await pg.textContent('#vmail-quote');
      check(await pg.isVisible('#vmail-quote') && /Happy to help/.test(quote) && !/^\s*>/m.test(quote) && await pg.getAttribute('.vmail-quotetoggle', 'aria-expanded') === 'true', 'the toggle shows the earlier message, without ">" marks');
      await pg.screenshot({ path: path.join(SHOTS, '12-quote.png') });

      // Compose: the brief field says what it does.
      await pg.click('#vmail-compose');
      check((await pg.textContent('label[for="vmail-compose-brief"]')).trim() === 'Ask Vale to draft it', 'compose: the brief field is labelled "Ask Vale to draft it"');
      await pg.click('.vmail-editor [data-act="discard"]');

      // Empty states line up.
      await pg.fill('#vmail-search', 'zzzz');
      await pg.press('#vmail-search', 'Enter');
      await pg.waitForSelector('#vmail-list .vmail-empty', { timeout: 5000 });
      await pg.waitForSelector('#vmail-reader .vmail-empty i', { timeout: 5000 });
      const tops = await pg.evaluate(() => [document.querySelector('#vmail-list .vmail-empty i').getBoundingClientRect().top, document.querySelector('#vmail-reader .vmail-empty i').getBoundingClientRect().top]);
      check(Math.abs(tops[0] - tops[1]) <= 6, 'zero-result search: the list and reader empty states line up (' + tops.map(Math.round).join(' vs ') + ')');
      await pg.screenshot({ path: path.join(SHOTS, '13-empty-aligned.png') });
      await pg.click('#vmail-search-clear');

      // Light theme: the focused skip link is readable.
      await pg.evaluate(() => document.body.setAttribute('data-theme', 'light'));
      await pg.focus('#vmail-skip');
      const sk = await pg.$eval('#vmail-skip', (el) => { const s = getComputedStyle(el); return [s.color, s.backgroundColor, el.getBoundingClientRect().top]; });
      const rgb = (x) => (x.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
      const lum = (c) => { const v = rgb(c).map((n) => { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      const l1 = lum(sk[0]), l2 = lum(sk[1]);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      check(ratio >= 4.5 && sk[2] >= 0, 'light theme: the focused skip link has ' + ratio.toFixed(1) + ':1 contrast and is on screen');
      await settle(pg);
      await pg.screenshot({ path: path.join(SHOTS, '14-skip-light.png') });
      await c.close();
    }

    // ── Round 5: gaps in drafts, Sent panel, honest loading, toasts, hover, editor head, cid ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });

      // A draft with a gap ("[day]") never starts the countdown on Send.
      await pg.click('.vmail-chip[data-filter="all"]');
      await pg.click('#vmail-list [data-id="demo-inb-024"]');
      await pg.waitForSelector('.vmail-vale [data-stance="later"]', { timeout: 5000 });
      await pg.click('.vmail-vale [data-stance="later"]');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && !t.disabled && /\[day\]/.test(t.value); }, null, { timeout: 5000 });
      check(/\[day\]/.test(await pg.textContent('#vmail-fill-note')), 'gaps: the note names [day] as soon as the draft lands');
      await pg.click('#vmail-send');
      await pg.waitForTimeout(600);
      check(!(await pg.isVisible('#vmail-sendbar')), 'gaps: Send with [day] left in starts no countdown');
      const sel = await pg.evaluate(() => { const t = document.querySelector('#vmail-editor-text'); return t.value.slice(t.selectionStart, t.selectionEnd); });
      check(sel === '[day]', 'gaps: the textarea selection covers [day] (' + sel + ')');
      check(await pg.isVisible('#vmail-fill-note [data-act="send-anyway"]'), 'gaps: the note offers Send anyway');
      await pg.keyboard.type('Monday');
      await pg.waitForFunction(() => !document.querySelector('#vmail-fill-note'), null, { timeout: 2000 });
      check(true, 'gaps: filling the gap clears the note');
      await pg.click('#vmail-send');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      check(true, 'gaps: once filled, Send starts the countdown');
      await pg.click('#vmail-undo-send');
      await pg.waitForSelector('#vmail-sendbar', { state: 'hidden', timeout: 3000 });
      await pg.evaluate(() => { const t = document.querySelector('#vmail-editor-text'); t.value = t.value + ' See you [when].'; t.dispatchEvent(new Event('input', { bubbles: true })); });
      await pg.click('#vmail-send');
      await pg.waitForSelector('#vmail-fill-note [data-act="send-anyway"]', { timeout: 3000 });
      await pg.click('#vmail-fill-note [data-act="send-anyway"]');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      check(true, 'gaps: Send anyway still sends');
      await pg.waitForFunction(() => /Sent/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });

      // Sent: the demo preview decodes apostrophes; the Vale panel says who has answered.
      await pg.click('.vmail-folder[data-folder="sentitems"]');
      await pg.waitForSelector('#vmail-list [data-id="demo-sen-014"]', { timeout: 5000 });
      const sentText = await pg.textContent('#vmail-list');
      check(!/&#/.test(sentText) && /I'll/.test(sentText), 'demo Sent previews decode entities (I\'ll, not I&#39;ll)');
      await pg.click('#vmail-list [data-id="demo-sen-014"]');
      await pg.waitForSelector('#vmail-reader .vmail-vale', { timeout: 5000 });
      const theo = await pg.textContent('#vmail-reader .vmail-vale');
      check(/Theo hasn't replied since/.test(theo) && !!(await pg.$('#vmail-reader .vmail-vale [data-stance="nudge"]')), 'Sent: "Theo hasn\'t replied since …" with Draft a nudge (' + theo.replace(/\s+/g, ' ').slice(0, 90) + ')');
      check(!(await pg.$('#vmail-reader .vmail-reader__bar [data-act="unread"]')), 'Sent: no Mark unread on your own mail');
      await pg.click('#vmail-reader .vmail-vale [data-stance="nudge"]');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && !t.disabled && /checking in/i.test(t.value); }, null, { timeout: 5000 });
      check(/Theo Grant/.test(await pg.textContent('.vmail-editor__head')), 'Sent: the nudge is addressed to Theo, not to you');
      await pg.click('.vmail-editor [data-act="discard"]');
      await pg.click('#vmail-list [data-id="demo-sen-005"]');
      await pg.waitForSelector('#vmail-reader .vmail-vale [data-act="open-latest"]', { timeout: 5000 });
      check(/Dana replied/.test(await pg.textContent('#vmail-reader .vmail-vale')), 'Sent: "Dana replied …" with Open the reply');

      // Hover: the subject never reads dimmer than the preview beside it.
      await pg.click('.vmail-folder[data-folder="inbox"]');
      await pg.click('.vmail-chip[data-filter="all"]');
      const readRow = await pg.$('#vmail-list [role="option"]:not(.is-unread)');
      await readRow.click();
      await readRow.hover();
      const hov = await readRow.evaluate((r) => ({ s: getComputedStyle(r.querySelector('.vmail-row__subject strong')).color, p: getComputedStyle(r.querySelector('.vmail-row__subject')).color }));
      const lumOf = (x) => { const v = (x.match(/[\d.]+/g) || []).slice(0, 3).map((n) => { n /= 255; return n <= 0.03928 ? n / 12.92 : Math.pow((n + 0.055) / 1.055, 2.4); }); return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2]; };
      check(lumOf(hov.s) >= lumOf(hov.p), 'hover: the subject is at least as bright as the preview (' + hov.s + ' vs ' + hov.p + ')');

      // Toasts: announced through the always-present live region; the toast itself is not one.
      check(!(await pg.getAttribute('#vmail-toast', 'aria-live')) && !(await pg.getAttribute('#vmail-toast', 'role')), 'a11y: #vmail-toast is not a live region');
      await pg.focus('#vmail-list');
      await pg.keyboard.press('e');
      await pg.waitForFunction(() => { const t = document.querySelector('#vmail-toast'); return !t.hidden && /Archived/.test(t.textContent); }, null, { timeout: 3000 });
      await pg.waitForTimeout(200);
      const said = await pg.evaluate(() => [document.querySelector('#vmail-announce').textContent, document.querySelector('#vmail-toast-text').textContent]);
      check(said[0] === said[1], 'a11y: the toast text is announced in #vmail-announce (' + said[0] + ')');
      await pg.click('#vmail-toast-undo');
      await pg.waitForFunction(() => /Moved back to Inbox/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 5000 });
      // A plain toast is dropped once a search starts.
      await pg.keyboard.press('/');
      check(await pg.isHidden('#vmail-toast'), 'toast: "Moved back to Inbox." is gone once you press / to search');
      await pg.keyboard.type('zzzz-nothing');
      await pg.keyboard.press('Enter');
      await pg.waitForSelector('#vmail-search-clear', { state: 'visible', timeout: 5000 });
      await pg.waitForTimeout(300);
      check(await pg.isHidden('#vmail-toast'), 'toast: no stale toast over the search results');
      await pg.click('#vmail-search-clear');

      // Editor head: one row at 1440 and 1280; the toast never sits on Send/Discard.
      for (const w of [1440, 1280]) {
        await pg.setViewportSize({ width: w, height: 900 });
        await pg.click('.vmail-chip[data-filter="all"]');
        await pg.click('#vmail-list [data-id="demo-inb-006"]');
        await pg.waitForSelector('.vmail-vale [data-stance="yes"]', { timeout: 5000 });
        await pg.click('.vmail-vale [data-stance="yes"]');
        await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && !t.disabled && t.value.length > 10; }, null, { timeout: 5000 });
        const head = await pg.$eval('.vmail-editor__head', (el) => {
          const mids = Array.from(el.children).map((k) => { const r = k.getBoundingClientRect(); return (r.top + r.bottom) / 2; });
          return { h: Math.round(el.getBoundingClientRect().height), spread: Math.round(Math.max.apply(null, mids) - Math.min.apply(null, mids)) };
        });
        check(head.h <= 48 && head.spread <= 4, w + ': the editor head is one row (' + JSON.stringify(head) + ')');
        // Put Send/Discard at the bottom of the reader, then raise a toast.
        await pg.evaluate(() => document.querySelector('.vmail-editor__actions').scrollIntoView({ block: 'end' }));
        await pg.click('#vmail-reader .vmail-reader__bar [data-act="flag"]');
        await pg.waitForFunction(() => !document.querySelector('#vmail-toast').hidden, null, { timeout: 3000 });
        const overlap = await pg.evaluate(() => {
          const a = document.querySelector('#vmail-toast').getBoundingClientRect();
          return Array.from(document.querySelectorAll('.vmail-editor__actions .ap-btn')).some((btn) => { const b = btn.getBoundingClientRect(); return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom; });
        });
        check(!overlap, w + ': the toast never covers Send/Discard');
        await pg.click('#vmail-reader .vmail-reader__bar [data-act="flag"]');
        await pg.click('.vmail-editor [data-act="discard"]');
      }
      await pg.setViewportSize({ width: 1440, height: 900 });

      // Inline (cid:) images: a placeholder while they load, never a broken image.
      await pg.click('.vmail-chip[data-filter="all"]');
      await pg.evaluate(() => { window.__vmDelay = { listAttachments: 1200 }; });
      await pg.click('#vmail-list [data-id="demo-inb-027"]');
      await pg.waitForSelector('#vmail-reader iframe.vmail-frame', { timeout: 5000 });
      await pg.waitForTimeout(150);
      const cidFrame = async () => (await pg.$('#vmail-reader iframe.vmail-frame')).contentFrame();
      const early = await (await cidFrame()).evaluate(() => ({ pending: document.body.classList.contains('vm-cid-wait'), cidSrc: Array.from(document.images).filter((i) => /^cid:/i.test(i.getAttribute('src') || '')).length, boxes: document.querySelectorAll('img[data-vm-cid]').length }));
      check(early.pending && early.cidSrc === 0 && early.boxes >= 1, 'cid: placeholders while the inline images load (' + JSON.stringify(early) + ')');
      await pg.screenshot({ path: path.join(SHOTS, '18-cid-pending.png') });
      let loaded = null;
      for (let i = 0; i < 40 && !loaded; i++) {
        await pg.waitForTimeout(200);
        const fr = await cidFrame();
        const st = fr && await fr.evaluate(() => Array.from(document.images).map((im) => im.complete ? im.naturalWidth : -1)).catch(() => null);
        if (st && st.length >= 2 && st.every((n) => n > 0)) loaded = st;
      }
      check(!!loaded, 'cid: the inline images load once the attachments arrive (' + JSON.stringify(loaded) + ')');
      await c.close();
    }

    // Loading and failed lists: no "0" counts, no keyboard hints with nothing to act on.
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript('window.__vmDelay = { listMessages: 3000 };');
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-chips .vmail-chip', { timeout: 5000 });
      await pg.waitForTimeout(300);
      const loadingChips = await pg.$$eval('#vmail-chips .vmail-chip', (cs) => cs.map((x) => x.textContent + '|' + x.getAttribute('aria-label')).join(' '));
      check(!/\d/.test(loadingChips), 'loading: no chip shows a count before the list arrives (' + loadingChips + ')');
      check(!(await pg.$('.vmail-hello__keys')), 'loading: the greeting shows no j/k/Enter hints yet');
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      check(/\d/.test(await pg.textContent('#vmail-chips')), 'loading: counts appear once the list is in');
      await c.close();
    }
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript('window.__vmFail = { listMessages: 1 };');
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [role="alert"], #vmail-list .vmail-error, #vmail-list [data-act="reload"]', { timeout: 8000 });
      const failChips = await pg.textContent('#vmail-chips');
      check(!/\d/.test(failChips), 'list failed: no "0" counts beside the error (' + failChips.replace(/\s+/g, ' ').trim() + ')');
      check(!(await pg.$('.vmail-hello__keys')) && /^Hi\b/.test((await pg.textContent('.vmail-hello__title')).trim()), 'list failed: a plain "Hi" and no keyboard hints');
      check(await pg.evaluate(() => !document.querySelector('#vmail-main').hasAttribute('aria-busy')), 'list failed: the page is not left busy');
      await pg.click('#vmail-list [data-act="reload"]');
      await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
      await pg.waitForSelector('.vmail-hello__keys', { timeout: 3000 });
      check(true, 'list failed: after Try again the hints come back');
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
      const chips1024 = await pg.$eval('#vmail-chips', (el) => {
        const box = el.getBoundingClientRect();
        const cs = Array.from(el.querySelectorAll('.vmail-chip'));
        const sel = el.querySelector('[aria-pressed="true"]').getBoundingClientRect();
        const over = el.scrollWidth > el.clientWidth + 1;
        return { lines: new Set(cs.map((x) => Math.round(x.getBoundingClientRect().top))).size, over, right: el.classList.contains('is-more-right'), left: el.classList.contains('is-more-left'), selIn: sel.left >= box.left - 0.5 && sel.right <= box.right + 0.5 };
      });
      check(chips1024.lines === 1 && chips1024.selIn && (!chips1024.over || (chips1024.right && !chips1024.left)), '1024: chips on one line, the selected one in view, a fade only on the side with more (' + JSON.stringify(chips1024) + ')');
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

    // ── Links with their own target never navigate the reader frame (they open a new tab) ──
    {
      const c = await browser.newContext();
      const pg = await c.newPage();
      await c.route(/evil\.example/, (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>fake sign-in</p>' }));
      await pg.goto(base + '/data/vale-mail-product.json');
      for (const [name, t] of [['_self', '_self'], ['named', 'foo'], ['_parent', '_parent'], ['_top', '_top']]) {
        const doc = core.safeBodyDoc({ contentType: 'html', content: '<a id="l" href="https://evil.example/t' + name + '" target="' + t + '">x</a>' }, false);
        await pg.setContent('<iframe id="f" sandbox="allow-popups allow-popups-to-escape-sandbox" referrerpolicy="no-referrer"></iframe>');
        await pg.$eval('#f', (f, d) => { f.srcdoc = d; }, doc);
        await pg.waitForTimeout(200);
        const fr = pg.frames().find((f) => f !== pg.mainFrame());
        const popup = c.waitForEvent('page', { timeout: 3000 }).catch(() => null);
        await fr.click('#l');
        const tab = await popup;
        await pg.waitForTimeout(300);
        const still = pg.frames().find((f) => f !== pg.mainFrame());
        const stayed = !!still && still.url().indexOf('evil.example') === -1 && !!(await still.$('#l'));
        check(!!tab && stayed && pg.url().indexOf(base) === 0, 'a target="' + t + '" link opens a new tab; the reader frame and page never navigate');
        if (tab) await tab.close();
      }
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

    // ── Round 4: sender tags, undo keeps the reader in sync, late sends never steal focus, toolbar, quotes ──
    {
      const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForFunction(() => (window.__vmCalls.listMessages || 0) >= 2, null, { timeout: 5000 });
      await pg.waitForTimeout(500);
      const open = opener(pg);
      const rowText = (id) => pg.textContent('#vmail-list [data-id="' + id + '"]');
      const hasCheckTag = (id) => pg.$('#vmail-list [data-id="' + id + '"] .vmail-tag--check').then((x) => !!x);

      // In the Needs you view the "Needs you" tag isn't repeated on every row.
      const needsTags = await pg.$$eval('#vmail-list .vmail-row .vmail-tag--needs_you', (x) => x.length);
      check(needsTags === 0, 'Needs you view: no row repeats the "Needs you" tag (' + needsTags + ')');
      await pg.click('.vmail-chip[data-filter="all"]');
      check(await pg.$$eval('#vmail-list .vmail-row .vmail-tag--needs_you', (x) => x.length) > 0, 'All view: the label tags still show');

      // Faked and lookalike senders carry "Check sender" in the list; ordinary mail doesn't.
      for (const id of ['demo-inb-048', 'demo-inb-047', 'demo-inb-015']) {
        check(await hasCheckTag(id) && /Check sender/.test(await rowText(id)), id + ': the row has a "Check sender" tag');
      }
      check(!(await hasCheckTag('demo-inb-024')) && !(await hasCheckTag('demo-inb-026')), 'ordinary rows (Ravi, Maya) have no "Check sender" tag');
      await open('demo-inb-048');
      const spoofPanel = await pg.textContent('#vmail-reader .vmail-vale');
      check(!/last wrote/.test(spoofPanel) && /comes from inside your organization/.test(spoofPanel), 'spoofed Vale: the panel never borrows the real sender\'s history');
      await open('demo-inb-047');
      check(/Real mail from Dana comes from dana@northwind-studio\.example/.test(await pg.textContent('#vmail-reader .vmail-vale')), 'lookalike: the panel says where real mail from Dana comes from');

      // Lookalike: the safe reply goes to the real contact, never the lookalike address.
      await pg.click('.vmail-vale [data-act="draft-safe"]');
      await draftLands(pg, /call/);
      const lhead = await pg.textContent('.vmail-editor__head');
      check(/dana@northwind-studio\.example/.test(lhead) && !/studlo/.test(lhead), 'lookalike: the safe reply is addressed to the known contact (' + lhead.trim() + ')');
      await pg.click('.vmail-editor [data-act="discard"]');

      // Unlabeled mail older than Vale's sort never reads "Vale hasn't looked at this one".
      const stampAt = Date.parse(fixture.triagedAt);
      for (const m of inbox.filter((x) => !fixture.labels[x.id] && !(x.internetMessageHeaders || []).some((hh) => /list-unsubscribe/i.test(hh.name)))) {
        const t = await rowText(m.id);
        const ok = Date.parse(m.receivedDateTime) > stampAt ? /Arrived after Vale's last check/.test(t) : /Not in Vale's last sort/.test(t);
        check(ok && !/hasn't looked at this one/.test(t), m.id + ': unlabeled row copy matches when it arrived');
      }

      // Undo after archive: the restored email is both the selected row and the open email.
      const selSubj = () => pg.evaluate(() => {
        const r = document.querySelector('#vmail-list [aria-selected="true"]');
        return { id: r && r.getAttribute('data-id'), row: r && r.querySelector('.vmail-row__subject strong').textContent, reader: (document.querySelector('#vmail-subject') || {}).textContent };
      });
      await open('demo-inb-026');
      await pg.focus('#vmail-list');
      await pg.keyboard.press('e');
      await pg.waitForFunction(() => !document.querySelector('#vmail-list [data-id="demo-inb-026"]'), null, { timeout: 5000 });
      await pg.waitForFunction(() => /Archived/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 5000 });
      await pg.waitForTimeout(400);
      await pg.keyboard.press('z');
      await pg.waitForFunction(() => /Moved back/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 5000 });
      await pg.waitForFunction(() => (document.querySelector('#vmail-subject') || {}).textContent === 'Saturday?', null, { timeout: 5000 });
      const u1 = await selSubj();
      check(u1.id === 'demo-inb-026' && u1.row === u1.reader && u1.reader === 'Saturday?', 'demo: after e then z, the selected row and the reader are both "Saturday?" (' + JSON.stringify(u1) + ')');
      await pg.focus('#vmail-list');
      await pg.keyboard.press('e');
      await pg.waitForFunction(() => !document.querySelector('#vmail-list [data-id="demo-inb-026"]'), null, { timeout: 5000 });
      check(true, 'demo: e again archives the email the reader showed');
      await pg.waitForTimeout(400);
      await pg.keyboard.press('z');
      await pg.waitForSelector('#vmail-list [data-id="demo-inb-026"]', { timeout: 5000 });

      // A send that finishes after you moved on leaves focus where you are.
      await open('demo-inb-024');
      await pg.click('.vmail-stance[data-stance="yes"]');
      await draftLands(pg, /\S/);
      await fillGaps(pg); await pg.click('#vmail-send');
      await pg.waitForSelector('#vmail-sendbar:not([hidden])', { timeout: 3000 });
      await pg.focus('#vmail-list');
      await pg.keyboard.press('j');
      await pg.waitForFunction(() => /Sent to/.test((document.querySelector('#vmail-toast') || {}).textContent || ''), null, { timeout: 20000 });
      await pg.waitForTimeout(300);
      check(await pg.evaluate(() => document.activeElement && document.activeElement.id === 'vmail-list'), 'a send finishing after you moved on leaves focus in the list');

      // The HTML reply's quoted history is folded behind "···".
      await open('demo-inb-006');
      await pg.waitForSelector('#vmail-body-slot .vmail-quotetoggle', { timeout: 5000 });
      const foldText = await pg.$eval('#vmail-body-slot', (x) => x.innerText);
      check(/Thursday at 10am Pacific/.test(foldText) && !/Sent:/.test(foldText) && await pg.$eval('#vmail-quote', (q) => q.hidden),
        'HTML reply: quoted history is folded (no "Sent: … GMT" until expanded)');
      await pg.click('#vmail-body-slot .vmail-quotetoggle');
      check(/Sent:/.test(await pg.$eval('#vmail-body-slot', (x) => x.innerText)), 'HTML reply: "···" expands the quoted history');

      // Send leads (solid periwinkle); the picked stance is a tinted "selected" state.
      await pg.click('.vmail-stance[data-stance="yes"]');
      await draftLands(pg, /Thursday/);
      const looks = await pg.evaluate(() => ({
        send: getComputedStyle(document.querySelector('#vmail-send')).backgroundColor,
        picked: getComputedStyle(document.querySelector('.vmail-stance.is-picked')).backgroundColor,
        pressed: document.querySelector('.vmail-stance.is-picked').getAttribute('aria-pressed')
      }));
      const alpha = (cs) => { const m = /rgba?\(([^)]+)\)/.exec(cs); const p = m ? m[1].split(',').map(Number) : []; return p.length === 4 ? p[3] : 1; };
      check(looks.send === 'rgb(155, 140, 255)' && alpha(looks.picked) < 0.2 && looks.pressed === 'true', 'Send is solid periwinkle; the picked stance is tinted (' + JSON.stringify(looks) + ')');
      await pg.click('.vmail-editor [data-act="discard"]');

      // The reader bar keeps its height when focus moves between list and reader.
      const barH = () => pg.$eval('.vmail-reader__bar', (b) => b.getBoundingClientRect().height);
      await pg.focus('#vmail-list');
      const hList = await barH();
      await pg.focus('.vmail-reader__bar [data-act="reply"]');
      const hReader = await barH();
      check(hList === hReader, 'reader bar height is the same with focus in the list and the reader (' + hList + ' / ' + hReader + ')');

      // List focus: no frame around the column; the selected row carries the ring.
      await pg.keyboard.press('Escape');
      await pg.click('#vmail-list [data-id="demo-inb-024"]');
      await pg.focus('#vmail-search');
      await pg.keyboard.press('Shift+Tab');
      await pg.evaluate(() => document.getElementById('vmail-list').focus({ focusVisible: true }));
      const lf = await pg.evaluate(() => ({ list: getComputedStyle(document.getElementById('vmail-list')).boxShadow, fv: document.getElementById('vmail-list').matches(':focus-visible'),
        row: (document.querySelector('#vmail-list [aria-selected="true"]') && getComputedStyle(document.querySelector('#vmail-list [aria-selected="true"]')).boxShadow) || '' }));
      check(lf.list === 'none' && (!lf.fv || /155, 140, 255/.test(lf.row)), 'list focus: no ring around the column; the selected row has the ring (' + JSON.stringify(lf) + ')');

      // Compose To field: one periwinkle ring, no cyan border.
      await pg.click('#vmail-compose');
      await pg.focus('#vmail-compose-to');
      await pg.waitForTimeout(350); // the border-color transition
      const bc = await pg.$eval('#vmail-compose-to', (x) => getComputedStyle(x).borderColor);
      check(/155, 140, 255/.test(bc) && !/90, 228, 255/.test(bc), 'compose To focus border is periwinkle, not cyan (' + bc + ')');
      await pg.click('.vmail-editor [data-act="discard"]').catch(() => {});
      await c.close();
    }

    // ── Round 4: toolbar with the pinned subject never wraps (1440 / 1280 / 1024) ──
    for (const w of [1440, 1280, 1024]) {
      const c = await browser.newContext({ viewport: { width: w, height: 900 } });
      await c.addInitScript(SHIM);
      const pg = await c.newPage();
      watch(pg);
      await pg.goto(base + PAGE);
      await pg.waitForSelector('#vmail-list [data-id="demo-inb-006"]', { timeout: 8000 });
      await opener(pg)('demo-inb-006');
      await pg.click('.vmail-stance[data-stance="yes"]');
      await draftLands(pg, /Thursday/);
      await pg.$eval('#vmail-reader', (r) => { r.scrollTop = 300; });
      await pg.waitForTimeout(200);
      await pg.waitForSelector('.vmail-toolbar--with-subject', { timeout: 3000 });
      const m = await pg.evaluate(() => {
        const bar = document.querySelector('.vmail-reader__bar');
        const sub = bar.querySelector('.vmail-toolbar__subject');
        return { tools: Array.from(bar.querySelectorAll('.vmail-tool')).filter((t) => t.offsetParent).map((t) => Math.round(t.getBoundingClientRect().height)),
          bar: bar.getBoundingClientRect().height, sub: sub.getBoundingClientRect().width, shadow: getComputedStyle(bar).boxShadow,
          ch: sub.scrollWidth / Math.max(1, sub.textContent.length) };
      });
      check(m.tools.length && m.tools.every((x) => x === 30) && m.bar <= 49 && m.sub >= 20 * m.ch && m.shadow !== 'none',
        w + ': toolbar buttons stay one line with the subject pinned, bar ≤ 49px, subject ≥ 20 chars, raised edge (' + JSON.stringify(m) + ')');
      if (w === 1440) await pg.screenshot({ path: path.join(SHOTS, '04b-editor-pinned.png') });
      await c.close();
    }

    // ── Real mode (MSAL + Microsoft Graph), fully stubbed: nothing leaves this machine ──
    // MSAL is a stub, the product config gets a client id, Graph answers from a small fixture
    // with OPAQUE folder ids (as the real Graph does), and vale-state / vale-draft are captured.
    // The page carries the production CSP plus the one morning change (Graph in connect-src).
    {
      const MSAL_STUB = 'window.msal = { PublicClientApplication: function (cfg) { this.cfg = cfg; } };' +
        'window.msal.PublicClientApplication.prototype = {' +
        ' initialize: function () { return Promise.resolve(); },' +
        ' handleRedirectPromise: function () { return Promise.resolve(null); },' +
        ' getAllAccounts: function () { return [{ name: "Chad Martin", username: "chad@ambientpixels.ai" }]; },' +
        ' acquireTokenSilent: function () { return Promise.resolve({ accessToken: "t" }); },' +
        ' loginRedirect: function () { window.__vmSignin = (window.__vmSignin || 0) + 1; } };';
      const MORNING_CSP = PROD_CSP.replace('connect-src ', 'connect-src https://graph.microsoft.com ');
      const FID = { inbox: 'AAMkAD-in==', sentitems: 'AAMkAD-sent==', archive: 'AAMkAD-arch==', drafts: 'AAMkAD-drafts==' };
      const ME = { emailAddress: { name: 'Chad Martin', address: 'chad@ambientpixels.ai' } };
      const person = (name, address) => ({ emailAddress: { name, address } });
      const realMsg = (id, conv, from, subject, text, hour) => ({
        id, conversationId: conv, subject, bodyPreview: text.slice(0, 80), body: { contentType: 'text', content: text },
        from, sender: from, toRecipients: [ME], ccRecipients: [], replyTo: [], isRead: false, isDraft: false,
        importance: 'normal', flag: { flagStatus: 'notFlagged' }, hasAttachments: false, inferenceClassification: 'focused',
        internetMessageHeaders: [], parentFolderId: FID.inbox, webLink: '',
        receivedDateTime: new Date(Date.now() - hour * 3600000).toISOString(), sentDateTime: new Date(Date.now() - hour * 3600000 - 30000).toISOString()
      });

      async function realPage(mode) {
        const c = await browser.newContext({ viewport: { width: 1440, height: 900 } });
        const msgs = {
          r1: realMsg('r1', 'conv-r1', person('Pat Lee', 'pat@contractor.example'), 'Launch notes', 'Hi Chad,\n\nNotes from the launch call are below.\n\nPat', 1),
          r2: realMsg('r2', 'conv-r2', person('Sam Ortiz', 'sam@greenleaf-coffee.example'), 'Audit follow-up', 'Hi Chad,\n\nThanks for the audit.\n\nSam', 2),
          r3: realMsg('r3', 'conv-r3', person('Noah Kim', 'noah@harbor-labs.example'), 'Coffee soon', 'Hi Chad,\n\nCoffee soon?\n\nNoah', 3)
        };
        // conv-r1 has an earlier client message that is NOT in any loaded page.
        const conversations = {
          'conv-r1': [msgs.r1, realMsg('r0', 'conv-r1', person('Kim Okafor', 'kim@clientco.example'), 'Launch notes', 'earlier', 300)],
          'conv-r3': [msgs.r3]
        };
        const out = { drafts: [], foreign: [], graph: [], moves: [] };
        c.on('request', (r) => {
          const u = new URL(r.url());
          if (u.hostname === '127.0.0.1' || u.hostname === 'graph.microsoft.com') return;
          if (/^(fonts\.googleapis\.com|fonts\.gstatic\.com|cdnjs\.cloudflare\.com)$/.test(u.hostname)) return; // static CSS/fonts only
          out.foreign.push(u.hostname);
        });
        await c.route('**/modules/company/mail.html*', async (route) => {
          const resp = await route.fetch();
          const headers = Object.assign({}, resp.headers(), { 'content-security-policy': MORNING_CSP });
          await route.fulfill({ response: resp, headers });
        });
        await c.route('**/js/vendor/msal-browser.min.js', (route) => route.fulfill({ status: 200, contentType: 'text/javascript', body: MSAL_STUB }));
        await c.route('**/data/vale-mail-product.json', async (route) => {
          const resp = await route.fetch();
          const cfg = await resp.json();
          cfg.clientId = '00000000-0000-4000-8000-000000000001';
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(cfg) });
        });
        await c.route('**/api/vale-state**', async (route) => {
          const req = route.request();
          if (req.method() === 'POST') {
            if (mode === 'rulesFail') return route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ rules: { rulesOnlyDomains: ['clientco.example'] } }) });
          }
          if (/key=valeMailState/.test(req.url())) {
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ value: { at: new Date(Date.now() - 600000).toISOString(),
              triaged: ['r1', 'r2', 'r3'].map((id) => ({ id, label: 'needs_you', why: 'Wants an answer', by: 'model' })) } }) });
          }
          return route.fulfill({ status: 200, contentType: 'application/json', body: '{"value":null}' });
        });
        await c.route('**/api/vale-draft', async (route) => {
          out.drafts.push(JSON.parse(route.request().postData() || '{}'));
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ draft: 'Hi there,\n\nThanks for this.\n\nChad' }) });
        });
        await c.route('https://graph.microsoft.com/**', async (route) => {
          const req = route.request();
          const origin = base;
          const cors = { 'access-control-allow-origin': origin, 'access-control-allow-headers': 'Authorization, Content-Type, Prefer', 'access-control-allow-methods': 'GET, POST, PATCH, OPTIONS' };
          const send = (status, body) => route.fulfill({ status, headers: Object.assign({ 'content-type': 'application/json' }, cors), body: body === undefined ? '' : JSON.stringify(body) });
          if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: cors, body: '' });
          const u = decodeURIComponent(req.url().replace('https://graph.microsoft.com/v1.0', ''));
          out.graph.push(req.method() + ' ' + u.split('?')[0]);
          let m;
          if (mode === 'expired' && /\/mailFolders\/inbox\/messages/.test(u)) return send(401, { error: { code: 'InvalidAuthenticationToken', message: 'expired' } });
          if (/^\/me\?/.test(u)) return send(200, { displayName: 'Chad Martin', mail: 'chad@ambientpixels.ai' });
          if ((m = /^\/me\/mailFolders\/(inbox|sentitems|archive|drafts)\?\$select=id$/.exec(u))) return send(200, { id: FID[m[1]] });
          if (mode === 'paged' && /^\/me\/mailFolders\/inbox\/messages/.test(u)) {
            const all = Object.values(msgs).filter((x) => x.parentFolderId === FID.inbox).map((x) => Object.assign({}, x, { body: undefined }));
            if (/skiptoken=p2/i.test(u)) return send(200, { value: all.slice(2) });
            return send(200, { value: all.slice(0, 2), '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages?$skiptoken=p2' });
          }
          if (/^\/me\/mailFolders\/inbox\/messages/.test(u)) return send(200, { value: Object.values(msgs).filter((x) => x.parentFolderId === FID.inbox).map((x) => Object.assign({}, x, { body: undefined })) });
          if (/^\/me\/mailFolders\/(sentitems|archive)\/messages/.test(u)) return send(200, { value: [] });
          if (/^\/me\/calendarView/.test(u)) return send(200, { value: [] });
          if ((m = /^\/me\/messages\?\$filter=conversationId eq '([^']+)'/.exec(u))) {
            if (!conversations[m[1]]) return send(400, { error: { code: 'ErrorInvalidRequest', message: 'no' } });
            return send(200, { value: conversations[m[1]] });
          }
          if ((m = /^\/me\/messages\/([^/?]+)\/move$/.exec(u)) && req.method() === 'POST') {
            const dest = JSON.parse(req.postData() || '{}').destinationId;
            out.moves.push(m[1] + '>' + dest);
            msgs[m[1]].parentFolderId = FID[dest] || dest;
            return send(201, msgs[m[1]]);
          }
          if ((m = /^\/me\/messages\/([^/?]+)$/.exec(u)) && req.method() === 'PATCH') return send(200, msgs[m[1]] || {});
          if ((m = /^\/me\/messages\/([^/?]+)\?/.exec(u)) && msgs[m[1]]) return send(200, msgs[m[1]]);
          return send(404, { error: { code: 'ErrorItemNotFound', message: 'not found' } });
        });
        const pg = await c.newPage();
        watchReal(pg);
        await pg.goto(base + '/modules/company/mail.html');
        return { c, pg, out, msgs };
      }
      const draftVia = async (pg, out, id, n) => {
        await pg.click('#vmail-list [data-id="' + id + '"]');
        await pg.waitForSelector('#vmail-tell-input', { timeout: 5000 });
        await pg.waitForFunction((i) => (document.querySelector('#vmail-subject') || {}).textContent && document.querySelector('#vmail-list [aria-selected="true"]').getAttribute('data-id') === i, id, { timeout: 5000 });
        await pg.fill('#vmail-tell-input', 'say thanks');
        await pg.press('#vmail-tell-input', 'Enter');
        await pg.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && !t.disabled && /Thanks for this/.test(t.value); }, null, { timeout: 5000 });
        if (out.drafts.length !== n) throw new Error('E2E check failed: expected ' + n + ' vale-draft calls, saw ' + out.drafts.length);
        return out.drafts[n - 1];
      };

      // Rules load; the whole conversation decides "client".
      {
        const { c, pg, out, msgs } = await realPage('ok');
        await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
        check(!(await pg.$('.vmail-banner:not([hidden])')), 'real mode: no demo banner');
        check((await pg.$$('#vmail-list [role="option"]')).length === 3, 'real mode: inbox rows render from Graph');
        const d1 = await draftVia(pg, out, 'r1', 1);
        check(d1.client === true && d1.mode === 'reply', 'real mode: an earlier client message only Graph has (not loaded) makes the draft client:true');
        const d2 = await draftVia(pg, out, 'r2', 2);
        check(d2.client === true, 'real mode: a conversation that fails to load fails closed (client:true)');
        const d3 = await draftVia(pg, out, 'r3', 3);
        check(d3.client === false, 'real mode: a conversation with no client stays client:false');
        check(out.graph.some((g) => /^GET \/me\/messages$/.test(g)), 'real mode: the conversation is fetched from Graph');
        // Archive with opaque folder ids: e removes the row, z puts it back.
        await pg.focus('#vmail-list');
        await pg.keyboard.press('e');
        await pg.waitForFunction(() => !document.querySelector('#vmail-list [data-id="r3"]'), null, { timeout: 5000 });
        await pg.waitForFunction(() => /Archived/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 5000 });
        check(out.moves[0] === 'r3>archive', 'real mode: e archives (opaque folder ids) and removes the row from Inbox');
        await pg.waitForTimeout(300);
        await pg.keyboard.press('z');
        await pg.waitForSelector('#vmail-list [data-id="r3"]', { timeout: 5000 });
        await pg.waitForFunction(() => /Moved back to Inbox/.test(document.querySelector('#vmail-toast').textContent), null, { timeout: 5000 });
        check(out.moves[1] === 'r3>inbox' && msgs.r3.parentFolderId === FID.inbox, 'real mode: z moves it back to Inbox');
        await pg.waitForFunction(() => (document.querySelector('#vmail-subject') || {}).textContent === 'Coffee soon', null, { timeout: 5000 }).catch(() => {});
        const rs = await pg.evaluate(() => {
          const r = document.querySelector('#vmail-list [aria-selected="true"]');
          return { id: r && r.getAttribute('data-id'), row: r && r.querySelector('.vmail-row__subject strong').textContent, reader: (document.querySelector('#vmail-subject') || {}).textContent };
        });
        check(rs.id === 'r3' && rs.row === rs.reader && rs.reader === 'Coffee soon', 'real mode: after e then z, the selected row is the open email (' + JSON.stringify(rs) + ')');
        check(out.foreign.length === 0, 'real mode: no request leaves for any non-stubbed host' + (out.foreign.length ? ': ' + out.foreign.join(', ') : ''));
        await pg.screenshot({ path: path.join(SHOTS, '17-real-mode.png') });
        await c.close();
      }
      // Paged inbox: every listbox child is an option; "Load older mail" is reachable and works.
      {
        const { c, pg } = await realPage('paged');
        await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
        await pg.waitForSelector('#vmail-more-slot:not([hidden]) [data-act="more"]', { timeout: 5000 });
        const kids = await pg.$$eval('#vmail-list > *', (x) => x.map((k) => k.getAttribute('role')));
        check(kids.length === 2 && kids.every((r) => r === 'option'), 'real mode (paged): every child of the listbox is an option (' + kids.join(',') + ')');
        await pg.focus('#vmail-list');
        let reached = false;
        for (let i = 0; i < 4 && !reached; i++) {
          await pg.keyboard.press('Tab');
          reached = await pg.evaluate(() => document.activeElement && document.activeElement.getAttribute('data-act') === 'more');
        }
        check(reached, 'real mode (paged): Tab reaches "Load older mail"');
        await pg.click('#vmail-more-slot [data-act="more"]');
        await pg.waitForFunction(() => document.querySelectorAll('#vmail-list [role="option"]').length === 3, null, { timeout: 5000 });
        check(await pg.$eval('#vmail-more-slot', (x) => x.hidden), 'real mode (paged): Load older mail loads the next page, then goes away');
        await c.close();
      }
      // Rules fail: every draft is client:true.
      {
        const { c, pg, out } = await realPage('rulesFail');
        await pg.waitForSelector('#vmail-list [role="option"]', { timeout: 8000 });
        const d = await draftVia(pg, out, 'r3', 1);
        check(d.client === true, 'real mode: rules that failed to load make the draft client:true');
        check(out.foreign.length === 0, 'real mode (rules failed): no request leaves for any non-stubbed host');
        await c.close();
      }
      // An expired sign-in: plain words and "Sign in again".
      {
        const { c, pg, out } = await realPage('expired');
        await pg.waitForSelector('#vmail-list .vmail-error', { timeout: 8000 });
        check(/sign-in has expired/.test(await pg.textContent('#vmail-list .vmail-error')) && await pg.isVisible('#vmail-list [data-act="signin"]'), 'real mode: a Graph 401 shows "Sign in again"');
        await pg.click('#vmail-list [data-act="signin"]');
        check(await pg.evaluate(() => window.__vmSignin === 1), 'real mode: Sign in again starts the Microsoft sign-in');
        check(out.foreign.length === 0, 'real mode (401): no request leaves for any non-stubbed host');
        await c.close();
      }
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
    const pst = await ph.$eval('#vmail-checked-phone', (x) => { const r = x.getBoundingClientRect(); return { w: r.width, h: r.height, t: x.textContent }; });
    check(pst.w > 0 && pst.h > 0 && /Vale sorted at/.test(pst.t) && await ph.isVisible('#vmail-checked-phone'), 'phone: the "Vale sorted at" stamp shows in the list header (' + JSON.stringify(pst) + ')');
    await ph.screenshot({ path: path.join(SHOTS, '08-phone.png') });
    await ph.tap('#vmail-list [data-id="demo-inb-006"]');
    await ph.waitForSelector('#vmail-reader', { state: 'visible', timeout: 5000 });
    await ph.waitForSelector('#vmail-reader .vmail-vale', { timeout: 5000 });
    check(!(await ph.isVisible('#vmail-list')), 'phone: one column (list hidden while reading)');
    await ph.screenshot({ path: path.join(SHOTS, '09-phone-reader.png') });
    await ph.tap('#vmail-back');
    await ph.waitForSelector('#vmail-list', { state: 'visible', timeout: 3000 });
    check(true, 'phone: back returns to the list');

    // Phone, round 3: no keyboard hint, an honest chip fade, a Next button that fits.
    check(!(await ph.isVisible('.vmail-search__kbd')), 'phone: no "/" keyboard hint in the search field');
    const edge = () => ph.$eval('#vmail-chips', (el) => ({ l: el.classList.contains('is-more-left'), r: el.classList.contains('is-more-right') }));
    const e0 = await edge();
    check(e0.r && !e0.l, 'phone: chips at rest fade only on the right (' + JSON.stringify(e0) + ')');
    await ph.$eval('#vmail-chips', (el) => { el.scrollLeft = el.scrollWidth; el.dispatchEvent(new Event('scroll')); });
    await ph.waitForTimeout(150);
    const e1 = await edge();
    const lastIn = await ph.$eval('#vmail-chips', (el) => { const b = el.getBoundingClientRect(); const r = el.lastElementChild.getBoundingClientRect(); return r.right <= b.right + 0.5; });
    check(e1.l && !e1.r && lastIn, 'phone: scrolled fully right, only the left fades and "Set aside" is fully visible');
    await ph.$eval('#vmail-chips', (el) => { el.scrollLeft = 0; el.dispatchEvent(new Event('scroll')); });

    await ph.tap('#vmail-list [data-id="demo-inb-026"]');
    await ph.waitForSelector('#vmail-reader .vmail-vale [data-stance="yes"]', { timeout: 5000 });
    await ph.tap('.vmail-vale [data-stance="yes"]');
    await ph.waitForFunction(() => { const t = document.querySelector('#vmail-editor-text'); return t && !t.disabled && /Saturday/.test(t.value); }, null, { timeout: 5000 });
    await fillGaps(ph); await ph.tap('#vmail-send');
    await ph.waitForSelector('.vmail-vale [data-act="next"]', { timeout: 20000 });
    const fit = await ph.evaluate(() => {
      const n = document.querySelector('.vmail-vale [data-act="next"]').getBoundingClientRect();
      const v = document.querySelector('.vmail-vale').getBoundingClientRect();
      return { nr: Math.round(n.right), vr: Math.round(v.right), sw: document.documentElement.scrollWidth };
    });
    check(fit.nr <= fit.vr && fit.sw === 390, 'phone: after a send, "Next" fits inside Vale\'s panel (' + JSON.stringify(fit) + ')');
    await ph.screenshot({ path: path.join(SHOTS, '15-phone-sent.png') });
    await ph.waitForFunction(() => !document.querySelector('#vmail-toast').hidden, null, { timeout: 5000 });
    await ph.tap('#vmail-back');
    await ph.tap('#vmail-compose');
    await ph.waitForSelector('.vmail-editor [data-act="discard"]', { timeout: 5000 });
    const covered = await ph.evaluate(() => {
      const t = document.querySelector('#vmail-toast');
      if (t.hidden) return false;
      const a = t.getBoundingClientRect(), b = document.querySelector('.vmail-editor [data-act="discard"]').getBoundingClientRect();
      return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
    });
    check(!covered, 'phone: the send toast never covers Compose\'s Discard button');
    await settle(ph);
    await ph.screenshot({ path: path.join(SHOTS, '16-phone-compose.png') });
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
