// CardForge production build script - minification
// Created: 2025-07-06

const fs = require('fs');
const path = require('path');
const { minify } = require('terser');
const CleanCSS = require('clean-css');
const glob = require('glob');

// Configuration
const config = {
  jsDir: path.join(__dirname, '../cardforge/js'),
  cssDir: path.join(__dirname, '../cardforge/css'),
  outputJsDir: path.join(__dirname, '../dist/cardforge/js'),
  outputCssDir: path.join(__dirname, '../dist/cardforge/css'),
  excludeFiles: [
    // Files that should not be minified
    'msal-browser.min.js'
  ]
};

// Ensure output directories exist
function ensureDirectoryExists(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
    console.log(`Created directory: ${dir}`);
  }
}

// Process JavaScript files
async function minifyJs() {
  console.log('Minifying JavaScript files...');
  
  ensureDirectoryExists(config.outputJsDir);
  
  // Get all JS files
  const jsFiles = glob.sync(`${config.jsDir}/**/*.js`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of jsFiles) {
    const fileName = path.basename(file);
    
    // Skip excluded files
    if (config.excludeFiles.includes(fileName)) {
      console.log(`Skipping excluded file: ${fileName}`);
      
      // Copy the file without modification
      const targetPath = path.join(config.outputJsDir, fileName);
      fs.copyFileSync(file, targetPath);
      console.log(`Copied: ${fileName}`);
      continue;
    }
    
    try {
      const code = fs.readFileSync(file, 'utf8');
      
      // Minify with terser
      const minified = await minify(code, {
        compress: {
          drop_console: true,
          drop_debugger: true
        },
        mangle: true,
        output: {
          comments: false
        }
      });
      
      // Write minified file
      const targetPath = path.join(config.outputJsDir, fileName);
      fs.writeFileSync(targetPath, minified.code);
      
      const originalSize = Buffer.byteLength(code, 'utf8');
      const minifiedSize = Buffer.byteLength(minified.code, 'utf8');
      const savingsPercent = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
      
      console.log(`Minified: ${fileName} (${savingsPercent}% saved)`);
      successCount++;
    } catch (error) {
      console.error(`Error processing ${fileName}:`, error);
      errorCount++;
      
      // Copy the original file as fallback
      const targetPath = path.join(config.outputJsDir, fileName);
      fs.copyFileSync(file, targetPath);
      console.log(`Copied original: ${fileName} (due to error)`);
    }
  }
  
  console.log(`JavaScript minification complete: ${successCount} successes, ${errorCount} errors`);
}

// Process CSS files
async function minifyCss() {
  console.log('Minifying CSS files...');
  
  ensureDirectoryExists(config.outputCssDir);
  
  // Get all CSS files
  const cssFiles = glob.sync(`${config.cssDir}/**/*.css`);
  
  let successCount = 0;
  let errorCount = 0;
  
  for (const file of cssFiles) {
    const fileName = path.basename(file);
    
    // Skip excluded files
    if (config.excludeFiles.includes(fileName)) {
      console.log(`Skipping excluded file: ${fileName}`);
      
      // Copy the file without modification
      const targetPath = path.join(config.outputCssDir, fileName);
      fs.copyFileSync(file, targetPath);
      console.log(`Copied: ${fileName}`);
      continue;
    }
    
    try {
      const code = fs.readFileSync(file, 'utf8');
      
      // Minify with clean-css
      const minified = new CleanCSS({
        compatibility: '*',
        level: 2
      }).minify(code);
      
      // Write minified file
      const targetPath = path.join(config.outputCssDir, fileName);
      fs.writeFileSync(targetPath, minified.styles);
      
      const originalSize = Buffer.byteLength(code, 'utf8');
      const minifiedSize = Buffer.byteLength(minified.styles, 'utf8');
      const savingsPercent = ((originalSize - minifiedSize) / originalSize * 100).toFixed(1);
      
      console.log(`Minified: ${fileName} (${savingsPercent}% saved)`);
      successCount++;
    } catch (error) {
      console.error(`Error processing ${fileName}:`, error);
      errorCount++;
      
      // Copy the original file as fallback
      const targetPath = path.join(config.outputCssDir, fileName);
      fs.copyFileSync(file, targetPath);
      console.log(`Copied original: ${fileName} (due to error)`);
    }
  }
  
  console.log(`CSS minification complete: ${successCount} successes, ${errorCount} errors`);
}

// Main function
async function main() {
  console.log('Starting CardForge production build - minification');
  
  try {
    // Process JS and CSS
    await minifyJs();
    await minifyCss();
    
    console.log('Build completed successfully!');
  } catch (error) {
    console.error('Build failed:', error);
    process.exit(1);
  }
}

// Run the script
main();
