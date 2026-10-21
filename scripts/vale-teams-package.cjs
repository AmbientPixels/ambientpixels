// Builds the "Vale" Teams app (manifest + icons) for upload as a custom app.
// Usage: node scripts/vale-teams-package.cjs <Vale Bot application (client) id>
// Writes teams/vale/{manifest.json,color.png,outline.png}; zip those three files (not the folder):
//   powershell Compress-Archive -Force -Path teams/vale/* -DestinationPath teams/vale.zip
// Plan: docs/superpowers/plans/2026-10-20-vale-teams-chat.md
'use strict';
const fs = require('fs');
const path = require('path');
const sharp = require(path.join(__dirname, '..', 'api', 'node_modules', 'sharp'));

const appId = process.argv[2];
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(appId || '')) {
  console.error('Give the Vale Bot application (client) id, e.g. node scripts/vale-teams-package.cjs 1234abcd-...');
  process.exit(1);
}
const out = path.join(__dirname, '..', 'teams', 'vale');
fs.mkdirSync(out, { recursive: true });

const manifest = {
  $schema: 'https://developer.microsoft.com/en-us/json-schemas/teams/v1.17/MicrosoftTeams.schema.json',
  manifestVersion: '1.17',
  version: '1.0.0',
  id: appId,
  developer: {
    name: 'AmbientPixels',
    websiteUrl: 'https://www.ambientpixels.ai',
    privacyUrl: 'https://www.ambientpixels.ai/privacy.html',
    termsOfUseUrl: 'https://www.ambientpixels.ai/terms.html'
  },
  name: { short: 'Vale', full: 'Vale, Chief of Staff' },
  description: {
    short: "Chad's chief of staff: what the team is doing and what needs him.",
    full: 'Vale looks at the AmbientPixels agent team on Chad\'s behalf: what is waiting on him, how campaigns are pacing, who has work queued and what happened today. She answers only Chad.'
  },
  icons: { color: 'color.png', outline: 'outline.png' },
  accentColor: '#0C0C0C',
  bots: [{ botId: appId, scopes: ['personal'], supportsFiles: false, isNotificationOnly: false }],
  permissions: ['identity'],
  validDomains: []
};
fs.writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Icons in the AmbientPixels style: the 3x3 pixel grid with a bright centre, white on black.
const dots = (size, r, fill) => {
  const step = size / 4; let s = '';
  for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) {
    const centre = x === 2 && y === 2, cardinal = x === 2 || y === 2;
    const op = centre ? 1 : cardinal ? 0.55 : 0.22;
    s += '<circle cx="' + x * step + '" cy="' + y * step + '" r="' + (centre ? r * 1.35 : r) + '" fill="' + fill + '" fill-opacity="' + op + '"/>';
  }
  return s;
};
const color = '<svg xmlns="http://www.w3.org/2000/svg" width="192" height="192"><rect width="192" height="192" fill="#0C0C0C"/>' + dots(192, 11, '#F4F4F4') + '</svg>';
const outline = '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">' + dots(32, 2.2, '#FFFFFF').replace(/fill-opacity="[^"]+"/g, 'fill-opacity="1"') + '</svg>';

(async () => {
  await sharp(Buffer.from(color)).png().toFile(path.join(out, 'color.png'));
  await sharp(Buffer.from(outline)).png().toFile(path.join(out, 'outline.png'));
  console.log('Wrote', out, '- now zip manifest.json, color.png, outline.png (the files, not the folder).');
})();
