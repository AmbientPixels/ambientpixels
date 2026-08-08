// clientIp.js — one correct way to identify the caller behind Azure.
//
// WHY THIS EXISTS (2026-08-08)
// ---------------------------
// Every rate limiter in this repo derived its bucket from
// `x-forwarded-for.split(',')[0]`. On Azure App Service that value carries the
// client's EPHEMERAL PORT — `203.0.113.5:54321` — and the port changes on every
// TCP connection. So every request hashed to a different bucket and no
// anonymous limit has ever bound. Measured, not theorised: 13 consecutive free
// Pixel Agent runs produced 13 separate buckets in `pixelAgentRateLimits`, each
// holding the value 1, while the endpoint cheerfully reported "4 of 5 free runs
// left" every single time.
//
// That is the only thing standing between a public, credential-free endpoint
// and unbounded model spend, which matters precisely when traffic arrives.
//
// The second problem is trust. `x-forwarded-for` is a request header, so a
// caller can simply send their own. App Service appends rather than replaces,
// which means the FIRST entry is whatever the client claimed — verified by
// sending a fixed value and watching a previously unbindable cap suddenly bind.
// Reading the first entry therefore lets anyone mint a fresh allowance per
// request just by varying a header.
//
// So, in order:
//   1. `x-azure-clientip` — set by the Azure front end, no port, and not
//      forwardable by the caller, so it cannot be spoofed.
//   2. the LAST `x-forwarded-for` entry — appended by the closest proxy, i.e.
//      the address Azure actually saw, rather than anything the client prepended.
//   3. `x-real-ip` / `client-ip` — for local dev and non-Azure hosts.
//
// Ports are stripped in every case, IPv6-safely.

// "1.2.3.4:5678"  -> "1.2.3.4"
// "[::1]:5678"    -> "::1"
// "2001:db8::1"   -> "2001:db8::1"   (bare IPv6 is all colons and NO port)
// "1.2.3.4"       -> "1.2.3.4"
//
// The IPv6 cases are why this is not a `split(':')[0]`: that would turn every
// IPv6 caller into the bucket "2001", collapsing unrelated visitors together —
// the opposite failure to the one above, and a worse one, because it locks
// strangers out of each other's free runs.
function stripPort(value) {
  const addr = String(value || '').trim();
  if (!addr) return '';

  // Bracketed IPv6, with or without a port: [::1] / [::1]:443
  if (addr[0] === '[') {
    const close = addr.indexOf(']');
    return close === -1 ? addr : addr.slice(1, close);
  }

  const first = addr.indexOf(':');
  if (first === -1) return addr;                 // IPv4 or hostname, no port

  // More than one colon and not bracketed => bare IPv6, which has no port.
  if (addr.indexOf(':', first + 1) !== -1) return addr;

  return addr.slice(0, first);                   // IPv4:port
}

/**
 * The caller's address, suitable for use as a rate-limit bucket.
 * Always returns a non-empty string; 'unknown' when nothing is available.
 */
function getClientIp(req) {
  const headers = (req && req.headers) || {};

  // 1. Azure's own view of the client. Overwritten by the platform on every
  //    request, so a caller cannot forge it.
  const azure = stripPort(headers['x-azure-clientip']);
  if (azure) return azure;

  // 2. The last x-forwarded-for entry: appended by the nearest proxy, so it is
  //    the address that proxy actually observed. Anything earlier in the list
  //    is only as trustworthy as whoever sent it.
  const fwd = String(headers['x-forwarded-for'] || '').trim();
  if (fwd) {
    const parts = fwd.split(',').map(p => stripPort(p)).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }

  // 3. Local dev / other hosts.
  const real = stripPort(headers['x-real-ip']) || stripPort(headers['client-ip']);
  if (real) return real;

  return 'unknown';
}

module.exports = { getClientIp, stripPort };
