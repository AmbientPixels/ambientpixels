const fs = require('fs');
const path = require('path');

// Directory to process
const targetDir = path.join(__dirname, 'projects');

// Pattern to match the banner container and its contents
const bannerPattern = /\s*<div class="banner-container"[\s\S]*?<\/div>\s*<\/div>\s*/g;

// Function to process each HTML file
function processFile(filePath) {
  try {
    let content = fs.readFileSync(filePath, 'utf8');
    const originalContent = content;
    
    // Remove the banner container and its contents
    content = content.replace(bannerPattern, '');
    
    // Only write the file if changes were made
    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, 'utf8');
      console.log(`Updated: ${filePath}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error);
    return false;
  }
}

// Function to find and process all HTML files in the directory
function processDirectory(directory) {
  let filesProcessed = 0;
  let filesModified = 0;
  
  try {
    const items = fs.readdirSync(directory, { withFileTypes: true });
    
    for (const item of items) {
      const fullPath = path.join(directory, item.name);
      
      if (item.isDirectory()) {
        // Skip node_modules and other non-essential directories
        if (!['node_modules', '.git', '.github'].includes(item.name)) {
          const result = processDirectory(fullPath);
          filesProcessed += result.filesProcessed;
          filesModified += result.filesModified;
        }
      } else if (item.name.endsWith('.html')) {
        filesProcessed++;
        if (processFile(fullPath)) {
          filesModified++;
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${directory}:`, error);
  }
  
  return { filesProcessed, filesModified };
}

// Run the script
// Run the script
console.log(`Starting to process HTML files in: ${targetDir}`);
const { filesProcessed, filesModified } = processDirectory(targetDir);
console.log(`\nProcess completed!`);
console.log(`Total files processed: ${filesProcessed}`);
console.log(`Files modified: ${filesModified}`);
