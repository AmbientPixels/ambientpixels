// TileForge Analytics Module
// Handles analytics display, file info, and statistics updates

// Update analytics dashboard
function updateAnalytics(analytics) {
  const elements = {
    totalLocales: document.getElementById('localeCount'),
    overflowCount: document.getElementById('overflowCount'),
    nearLimitCount: document.getElementById('nearLimitCount'),
    cleanCount: document.getElementById('cleanCount')
  };
  
  Object.entries(elements).forEach(([key, element]) => {
    if (element) {
      element.textContent = analytics[key];
    }
  });
}

// Update file information in analytics
function updateFileInfo(type, filename, info) {
  const fileInfoElement = document.getElementById('fileInfo');
  if (fileInfoElement) {
    const currentInfo = fileInfoElement.textContent;
    let newInfo = '';
    
    if (type === 'CSV') {
      newInfo = `CSV: ${filename} (${info} locales)`;
    } else if (type === 'Image') {
      newInfo = `Image: ${filename} (${info})`;
    }
    
    // Update or append file info
    if (currentInfo.includes(type)) {
      // Replace existing info for this type
      const lines = currentInfo.split('\n');
      const updatedLines = lines.map(line => 
        line.startsWith(type) ? newInfo : line
      );
      fileInfoElement.textContent = updatedLines.join('\n');
    } else {
      // Add new info
      fileInfoElement.textContent = currentInfo ? 
        `${currentInfo}\n${newInfo}` : newInfo;
    }
  }
}
