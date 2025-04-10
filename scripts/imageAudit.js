// imageAudit.js – Nova scans for new image assets to update her awareness

const fs = require('fs');
const path = require('path');

const imageDirs = ['images', 'images/hero', 'images/cards'];
const outputFile = path.join(__dirname, '../data/image-inventory.json');
const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg'];

function getImages(dirPath, base = '') {
  const list = [];
  if (!fs.existsSync(dirPath)) return list;

  const files = fs.readdirSync(dirPath);

  for (const file of files) {
    const ext = path.extname(file).toLowerCase();
    if (imageExtensions.includes(ext)) {
      list.push(path.join(base, file));
    }
  }
  return list;
}

function buildInventory() {
  const inventory = {
    scannedAt: new Date().toISOString(),
    folders: []
  };

  for (const dir of imageDirs) {
    const fullPath = path.join(__dirname, '..', dir);
    const images = getImages(fullPath, dir);

    inventory.folders.push({
      folder: dir,
      count: images.length,
      files: images
    });
  }

  fs.writeFileSync(outputFile, JSON.stringify(inventory, null, 2));
  console.log(`✅ Nova's image inventory updated at /data/image-inventory.json`);
}

buildInventory();


