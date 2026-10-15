// studio/desk-store.js — Video Desk tickets in the private `studio` container, one blob each:
//   desk/tickets/<id>.json
// Used by /api/studio's desk routes and (phase 3) by the heartbeat when an agent files a ticket.
'use strict';

const { getContainer, readJson, writeJson, mutateJson } = require('./blob');
const D = require('./desk');

const PREFIX = 'desk/tickets/';
const name = (id) => PREFIX + id + '.json';

async function listTickets() {
  const c = await getContainer();
  const out = [];
  for await (const item of c.listBlobsFlat({ prefix: PREFIX })) {
    const t = await readJson(item.name);
    if (t && D.ID.test(t.id || '')) out.push(t);
  }
  return out.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
}

const getTicket = (id) => (D.ID.test(id || '') ? readJson(name(id)) : Promise.resolve(null));

// → the stored ticket, or a reason string.
async function fileFleetTicket(body, from, nowMs) {
  const t = D.cleanFleetTicket(body, from, nowMs || Date.now());
  if (typeof t === 'string') return t;
  await writeJson(name(t.id), t);
  return t;
}

async function fileCrewTicket(body, by, nowMs) {
  const t = D.cleanCrewTicket(body, by, nowMs || Date.now());
  if (typeof t === 'string') return t;
  await writeJson(name(t.id), t);
  return t;
}

// change(ticket) → ticket | reason string. → the saved ticket, null if missing, or the reason.
async function changeTicket(id, change) {
  if (!D.ID.test(id || '')) return null;
  return mutateJson(name(id), (t) => {
    const r = change(t);
    return typeof r === 'string' ? r : undefined;
  });
}

module.exports = { listTickets, getTicket, fileFleetTicket, fileCrewTicket, changeTicket };
