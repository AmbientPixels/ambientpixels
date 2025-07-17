// imageAudit.js – Nova scans for new image assets to update her awareness
// Updated by Cascade 2025-07-16 - Added recursive directory scanning

const fs = require('fs');
const path = require('path');

// Base directory to start scanning from
const baseImageDir = 'images';
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

/**
 * Recursively get all directories starting from a base path
 * @param {string} basePath - The absolute base path to start from
 * @param {string} relativePath - The relative path from the base
 * @returns {string[]} - Array of directory paths relative to the base path
 */
function getAllDirs(basePath, relativePath) {
  const fullPath = path.join(basePath, relativePath);
  const dirs = [];
  
  // Only include the images directory and its subdirectories
  if (relativePath.startsWith(baseImageDir) || relativePath === baseImageDir || relativePath === '') {
    if (relativePath !== '') {
      dirs.push(relativePath);
    }
    
    try {
      if (fs.existsSync(fullPath) && fs.statSync(fullPath).isDirectory()) {
        const items = fs.readdirSync(fullPath);
        
        for (const item of items) {
          const itemPath = path.join(fullPath, item);
          const relItemPath = path.join(relativePath, item).replace(/\\/g, '/');
          
          if (fs.statSync(itemPath).isDirectory()) {
            dirs.push(...getAllDirs(basePath, relItemPath));
          }
        }
      }
    } catch (err) {
      console.error(`Error reading directory ${fullPath}:`, err);
    }
  }
  
  return dirs;
}

function buildInventory() {
  const inventory = {
    scannedAt: new Date().toISOString(),
    folders: []
  };

  // Get all directories recursively
  const basePath = path.join(__dirname, '..');
  const allDirs = getAllDirs(basePath, '');
  
  // Process each directory
  for (const dir of allDirs) {
    const fullPath = path.join(basePath, dir);
    const images = getImages(fullPath, dir);

    // Only add directories that contain images
    if (images.length > 0) {
      inventory.folders.push({
        folder: dir,
        count: images.length,
        files: images
      });
    }
  }

  // Calculate total image count
  const totalImages = inventory.folders.reduce((sum, folder) => sum + folder.count, 0);
  inventory.totalImages = totalImages;
  
  fs.writeFileSync(outputFile, JSON.stringify(inventory, null, 2));
  console.log(`✅ Nova's image inventory updated at /data/image-inventory.json`);
  console.log(`   Found ${totalImages} images in ${inventory.folders.length} folders`);
}

buildInventory();


