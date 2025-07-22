// Script to generate image-manifest.json for CardForge
// Usage: node scripts/generate-image-manifest.js

const fs = require('fs');
const path = require('path');

// Directory containing image packs
const imagesDir = path.resolve(__dirname, '../../images/image-packs');
// Output manifest path
const manifestPath = path.resolve(__dirname, '../image-manifest.json');
// Supported extensions
const exts = ['.png', '.jpg', '.jpeg', '.gif'];

function walk(dir, filelist = []) {
  const files = fs.readdirSync(dir);
  files.forEach(file => {
    const filepath = path.join(dir, file);
    const stat = fs.statSync(filepath);
    if (stat.isDirectory()) {
      walk(filepath, filelist);
    } else if (exts.includes(path.extname(file).toLowerCase())) {
      // Build URL path relative to project root
      const parts = filepath.split(path.sep);
      const idx = parts.indexOf('images');
      if (idx !== -1) {
        const relPath = parts.slice(idx).join('/');
        filelist.push(`/${relPath}`);
      }
    }
  });
  return filelist;
}

// Generate manifest
console.log(`Scanning images in ${imagesDir} ...`);
const images = walk(imagesDir);

// Write manifest file
fs.writeFileSync(manifestPath, JSON.stringify(images, null, 2));
console.log(`Generated manifest with ${images.length} entries at ${manifestPath}`);
