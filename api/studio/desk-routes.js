// studio/desk-routes.js — the Video Desk's handlers inside /api/studio (dispatch and auth live in index.js).
// Each handler is (context, req, reply). req.studioRole is 'op' (the website, Chad's key) or 'worker' (the PC).
'use strict';

const L = require('./lib');
const D = require('./desk');
const S = require('./desk-store');
const storage = require('../_utils/companyStorage');
const W = require('../_lib/releaseWatch/watcher');

// What a release or a ticket can be about: the products in product facts, plus the company site itself.
const PRODUCTS = Object.keys(require('../_data/product-facts.json').products || {}).concat(['AmbientPixels']);

const who = (req) => (req.studioRole === 'worker' ? 'chad (studio)' : 'chad (web)');
const body = (req) => (req.body && typeof req.body === 'object' ? req.body : {});

// The catalogue's labels, so the page can show names instead of ids.
const catalog = () => ({
  formats: D.CATALOG.formats.map((f) => ({ id: f.id, name: f.name, status: f.status, seconds: f.seconds })),
  moods: D.CATALOG.moods.map((m) => ({ id: m.id, feel: m.feel })),
  styles: D.CATALOG.styles.map((s) => ({ id: s.id, name: s.name, status: s.status })),
});

module.exports = {
  // GET desk — every ticket, newest first, plus the catalogue labels and the fleet's current load.
  async list(context, req, reply) {
    const tickets = await S.listTickets();
    const load = D.fleetLoad(tickets);
    reply(context, 200, { tickets, catalog: catalog(), projects: L.hostedProjects(), products: PRODUCTS, load: { open: load.open } });
  },

  // POST desk-decide {id, decision: accept|decline, reason, project}
  async decide(context, req, reply) {
    const b = body(req);
    const t = await S.changeTicket(b.id, (x) => D.decide(x, b, who(req), Date.now(), L.hostedProjects()));
    if (t === null) return reply(context, 404, { error: 'unknown ticket' });
    if (typeof t === 'string') return reply(context, 400, { error: t });
    reply(context, 200, { ok: true, ticket: t });
  },

  // POST desk-ticket — a crew request to the fleet {direction:'crew', kind, title, text, project?, video?, links?},
  // or Chad's own video idea {direction:'fleet', trigger:{type:'manual'}, …} so it is counted with the fleet's.
  async ticket(context, req, reply) {
    const b = body(req);
    const t = b.direction === 'fleet'
      ? await S.fileFleetTicket(Object.assign({}, b, { trigger: Object.assign({ type: 'manual' }, b.trigger) }), 'ceo', Date.now())
      : await S.fileCrewTicket(b, who(req), Date.now());
    if (typeof t === 'string') return reply(context, 400, { error: t });
    reply(context, 200, { ok: true, ticket: t });
  },

  // GET desk-releases — the release log (newest first) and the watcher's last runs.
  async releases(context, req, reply) {
    const read = await storage.getStateWithMeta(W.STATE_KEY);
    if (read.failed) return reply(context, 503, { error: 'release log unavailable' });
    const state = Object.assign(W.emptyState(), read.value || {});
    reply(context, 200, { entries: state.entries.slice(-60).reverse(), runs: state.runs.slice(-3).reverse(), watermark: state.watermark });
  },

  // POST desk-release — "Log a release" {product, title, summary?, kind?, significance?, url?}
  async release(context, req, reply) {
    const b = body(req);
    const r = await W.editReleaseLog(storage, (state) => W.addManualEntry(state, b, Date.now(), who(req)));
    if (r.error) return reply(context, r.status || 400, { error: r.error });
    reply(context, 200, { ok: true, entry: r.entry });
  },

  // POST desk-release-status {id, status: unreviewed|confirmed|hidden}
  async releaseStatus(context, req, reply) {
    const b = body(req);
    const r = await W.editReleaseLog(storage, (state) => W.setEntryStatus(state, String(b.id || ''), String(b.status || ''), who(req), Date.now()));
    if (r.error) return reply(context, r.status || 400, { error: r.error });
    reply(context, 200, { ok: true, entry: r.entry });
  },

  // POST desk-release-url {id, url} — a released video's link. Files the launch-posts ask to Echo and logs the
  // video in the release log (as a minor content release: a video never triggers another video).
  async releaseUrl(context, req, reply) {
    const b = body(req);
    const t = await S.changeTicket(b.id, (x) => D.setReleaseUrl(x, b, who(req), Date.now()));
    if (t === null) return reply(context, 404, { error: 'unknown ticket' });
    if (typeof t === 'string') return reply(context, 400, { error: t });
    const ask = await S.fileCrewTicket(D.launchAsk(t), 'desk', Date.now());
    const logged = await W.editReleaseLog(storage, (state) => W.addManualEntry(state, {
      product: t.product, title: 'New video: ' + t.title, summary: t.goal, kind: 'content', significance: 'minor', url: t.release.url, source: 'video',
    }, Date.now(), who(req)));
    reply(context, 200, { ok: true, ticket: t, launchAsk: typeof ask === 'string' ? { error: ask } : ask, release: logged.error ? { error: logged.error } : logged.entry });
  },

  // GET desk-sync (worker) — the tickets the PC has work to do on: accepted-and-later fleet tickets still open,
  // and open crew tickets.
  async sync(context, req, reply) {
    const tickets = (await S.listTickets()).filter((t) => (t.direction === 'fleet'
      ? ['accepted', 'scripting', 'in_production', 'review'].includes(t.status)
      : ['open', 'taken'].includes(t.status)));
    reply(context, 200, { tickets });
  },

  // POST desk-update (worker) {id, video?, trackerIds?, status?, note?, releaseUrl?}
  async update(context, req, reply) {
    const b = body(req);
    const t = await S.changeTicket(b.id, (x) => D.applyUpdate(x, b, 'studio', Date.now()));
    if (t === null) return reply(context, 404, { error: 'unknown ticket' });
    if (typeof t === 'string') return reply(context, 400, { error: t });
    reply(context, 200, { ok: true, ticket: t });
  },
};
