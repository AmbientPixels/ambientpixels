#!/usr/bin/env node
/* eslint-disable no-console */
/*
 * encode-blindspot-profile-videos.js
 *
 * Re-encodes source player videos into web-friendly profile-video assets
 * for the splash slot machine hover playback. Reads from
 *   ambientpixels/blindspot/img/players/*.mp4
 * Writes a paired set per source video:
 *   <basename>.webm  — VP9, ~720x720 square crop, 4s loop, no audio, target ~500 KB
 *   <basename>.mp4   — H.264 fallback (Safari friendliness), same geometry
 *
 * Sources are committed locally for the encoding script. The .webm + .mp4
 * outputs are what get uploaded via the admin Videos tab.
 *
 * Usage:
 *   node scripts/encode-blindspot-profile-videos.js              # encode every source
 *   node scripts/encode-blindspot-profile-videos.js --force      # re-encode even if outputs exist
 *   node scripts/encode-blindspot-profile-videos.js name1 name2  # encode only the named bases
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..');
const SRC_DIR = path.join(REPO_ROOT, 'blindspot', 'img', 'players');
const SIZE = 720;            // square output edge
const DURATION = 4;          // seconds — short loop, hover-friendly
const WEBM_BITRATE = '650k'; // VP9 target
const MP4_BITRATE = '900k';  // H.264 target (slightly higher — H.264 is less efficient)

function which(cmd) {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout.split(/\r?\n/)[0].trim() : null;
}

function listSources() {
  if (!fs.existsSync(SRC_DIR)) return [];
  return fs.readdirSync(SRC_DIR)
    .filter(f => /\.(mp4|mov|webm|mkv)$/i.test(f))
    .map(f => ({
      base: path.basename(f, path.extname(f)),
      ext: path.extname(f).toLowerCase(),
      full: path.join(SRC_DIR, f)
    }));
}

function encode(srcFull, outFull, codec) {
  // Square center-crop, scale to SIZE, trim to DURATION, drop audio.
  // crop=min(iw\\,ih) ensures we always center-crop to a square regardless of input aspect.
  const vf = `crop=min(iw\\,ih):min(iw\\,ih),scale=${SIZE}:${SIZE},fps=30`;
  const args = [
    '-y',
    '-i', srcFull,
    '-t', String(DURATION),
    '-vf', vf,
    '-an'
  ];
  if (codec === 'webm') {
    args.push(
      '-c:v', 'libvpx-vp9',
      '-b:v', WEBM_BITRATE,
      '-deadline', 'good',
      '-cpu-used', '2',
      '-row-mt', '1'
    );
  } else if (codec === 'mp4') {
    args.push(
      '-c:v', 'libx264',
      '-b:v', MP4_BITRATE,
      '-preset', 'medium',
      '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart'
    );
  }
  args.push(outFull);
  const r = spawnSync('ffmpeg', args, { stdio: ['ignore', 'inherit', 'inherit'] });
  return r.status === 0;
}

function main() {
  if (!which('ffmpeg')) {
    console.error('ffmpeg not found on PATH. Install ffmpeg and re-run.');
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const force = args.includes('--force');
  const filter = args.filter(a => !a.startsWith('--'));

  const sources = listSources();
  if (!sources.length) {
    console.error(`No source videos found in ${SRC_DIR}`);
    process.exit(1);
  }

  const targets = filter.length
    ? sources.filter(s => filter.includes(s.base))
    : sources;

  if (!targets.length) {
    console.error(`No matching sources for: ${filter.join(', ')}`);
    process.exit(1);
  }

  let okCount = 0;
  let failCount = 0;

  for (const s of targets) {
    const webmOut = path.join(SRC_DIR, s.base + '.webm');
    const mp4Out = path.join(SRC_DIR, s.base + '.mp4');

    // Skip the MP4 output if it would clobber the source MP4 (same path).
    const mp4OutSafe = (s.full === mp4Out) ? null : mp4Out;

    let didAny = false;

    if (force || !fs.existsSync(webmOut)) {
      console.log(`[webm] ${s.base} -> ${path.relative(REPO_ROOT, webmOut)}`);
      if (!encode(s.full, webmOut, 'webm')) {
        console.error(`  FAILED webm encode for ${s.base}`);
        failCount++;
        continue;
      }
      didAny = true;
    } else {
      console.log(`[webm] ${s.base} — output exists, skipping (pass --force to redo)`);
    }

    if (mp4OutSafe && (force || !fs.existsSync(mp4OutSafe))) {
      console.log(`[mp4]  ${s.base} -> ${path.relative(REPO_ROOT, mp4OutSafe)}`);
      if (!encode(s.full, mp4OutSafe, 'mp4')) {
        console.error(`  FAILED mp4 encode for ${s.base}`);
        failCount++;
        continue;
      }
      didAny = true;
    } else if (mp4OutSafe) {
      console.log(`[mp4]  ${s.base} — output exists, skipping (pass --force to redo)`);
    }

    if (didAny) {
      const sizeKb = (file) => Math.round(fs.statSync(file).size / 1024);
      const webmKb = fs.existsSync(webmOut) ? sizeKb(webmOut) : 0;
      const mp4Kb = mp4OutSafe && fs.existsSync(mp4OutSafe) ? sizeKb(mp4OutSafe) : 0;
      console.log(`  ${s.base}: webm=${webmKb}KB mp4=${mp4Kb}KB`);
    }
    okCount++;
  }

  console.log(`\nDone. ${okCount} encoded, ${failCount} failed.`);
  process.exit(failCount === 0 ? 0 : 1);
}

main();
