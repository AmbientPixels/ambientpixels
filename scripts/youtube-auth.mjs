// youtube-auth.mjs — one-time sign-in that lets the AmbientPixels uploader publish to the YouTube channel.
//
//   node scripts/youtube-auth.mjs                      (from ambientpixels/, on Chad's PC)
//
// Opens Google's sign-in in the browser (sign in as ambientpixels2022@gmail.com; the app is unverified until the
// YouTube audit passes, so click Advanced → Go to AmbientPixels Publisher). Exchanges the code for a refresh token,
// checks the token belongs to the expected channel, then writes YOUTUBE_CLIENT_ID / YOUTUBE_CLIENT_SECRET /
// YOUTUBE_REFRESH_TOKEN straight into the Function App's settings with the Azure CLI. Nothing secret is printed or
// written to the repo. Reads the client from C:/Dev/Ambientpixels/youtube-oauth-client.json (outside the repo).
// Plan: memory project_video_approvals_and_youtube (stage 2 uploads run in Azure from the studio blob).
import http from "node:http";
import crypto from "node:crypto";
import { readFileSync, writeFileSync, unlinkSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawn } from "node:child_process";

const CLIENT_FILE = process.env.YOUTUBE_CLIENT_FILE || "C:/Dev/Ambientpixels/youtube-oauth-client.json";
const EXPECTED_HANDLE = "@ambientpixels6107";
const ACCOUNT = "ambientpixels2022@gmail.com";
const SCOPES = ["https://www.googleapis.com/auth/youtube.upload", "https://www.googleapis.com/auth/youtube.force-ssl"];
const APP = { name: "ambientpixels-nova-api", group: "ambientpixelsV2" };

const client = (() => { const j = JSON.parse(readFileSync(CLIENT_FILE, "utf8")); return j.installed || j.web; })();
if (!client || !client.client_id || !client.client_secret) throw new Error("the client file has no client_id/client_secret");

const b64url = (buf) => buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const verifier = b64url(crypto.randomBytes(48));
const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
const state = b64url(crypto.randomBytes(16));

const server = http.createServer();
await new Promise((ok) => server.listen(0, "127.0.0.1", ok));
const redirectUri = `http://localhost:${server.address().port}`;

const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
  client_id: client.client_id, redirect_uri: redirectUri, response_type: "code", scope: SCOPES.join(" "),
  access_type: "offline", prompt: "consent", login_hint: ACCOUNT, state, code_challenge: challenge, code_challenge_method: "S256",
});

const code = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error("no sign-in within 10 minutes")), 10 * 60 * 1000);
  server.on("request", (req, res) => {
    const u = new URL(req.url, redirectUri);
    if (u.pathname !== "/") { res.writeHead(404); return res.end(); }
    const done = (msg) => { res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(`<p style="font:16px system-ui">${msg}</p>`); };
    if (u.searchParams.get("state") !== state) { done("This sign-in did not come from the script. Close this tab."); return; }
    clearTimeout(timer);
    if (u.searchParams.get("error")) { done("Sign-in was cancelled. You can close this tab."); return reject(new Error("sign-in: " + u.searchParams.get("error"))); }
    done("Signed in. You can close this tab and go back to VS Code.");
    resolve(u.searchParams.get("code"));
  });
  console.log("Opening Google sign-in. Sign in as " + ACCOUNT + ".");
  console.log("If the browser doesn't open, visit:\n" + authUrl + "\n");
  spawn("cmd", ["/c", "start", "", authUrl.replace(/&/g, "^&")], { stdio: "ignore", detached: true }).unref();
});
server.close();

const tok = await (await fetch("https://oauth2.googleapis.com/token", {
  method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({ client_id: client.client_id, client_secret: client.client_secret, code, code_verifier: verifier, grant_type: "authorization_code", redirect_uri: redirectUri }),
})).json();
if (!tok.refresh_token) throw new Error("Google returned no refresh token (" + (tok.error || "unknown") + "). Run the script again.");
const granted = String(tok.scope || "").split(" ");
const missing = SCOPES.filter((s) => !granted.includes(s));
if (missing.length) throw new Error("these permissions were not granted: " + missing.join(", ") + ". Run again and tick every box.");

const ch = await (await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { Authorization: "Bearer " + tok.access_token } })).json();
const item = (ch.items || [])[0];
if (!item) throw new Error("that Google account has no YouTube channel (" + ((ch.error && ch.error.message) || "none") + ")");
const handle = String(item.snippet.customUrl || "").toLowerCase();
console.log(`Signed in to channel: ${item.snippet.title} (${item.snippet.customUrl || "no handle"}, ${item.id})`);
if (handle !== EXPECTED_HANDLE) throw new Error(`expected ${EXPECTED_HANDLE}; nothing was saved. Run again and pick the AmbientPixels channel.`);

// Settings go to Azure through a temp file (not the command line), then the file is deleted.
const dir = mkdtempSync(join(tmpdir(), "yt-"));
const file = join(dir, "settings.json");
writeFileSync(file, JSON.stringify([
  { name: "YOUTUBE_CLIENT_ID", value: client.client_id, slotSetting: false },
  { name: "YOUTUBE_CLIENT_SECRET", value: client.client_secret, slotSetting: false },
  { name: "YOUTUBE_REFRESH_TOKEN", value: tok.refresh_token, slotSetting: false },
  { name: "YOUTUBE_CHANNEL_ID", value: item.id, slotSetting: false },
]), { mode: 0o600 });
try {
  execFileSync("az", ["functionapp", "config", "appsettings", "set", "--name", APP.name, "--resource-group", APP.group, "--settings", "@" + file, "-o", "none"],
    { stdio: ["ignore", "ignore", "inherit"], env: { ...process.env, MSYS_NO_PATHCONV: "1" }, shell: true });
} finally {
  unlinkSync(file);
}
console.log("Saved to the Function App settings: YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN, YOUTUBE_CHANNEL_ID.");
