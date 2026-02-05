// TileForge Text Measurement Module
// Provides accurate visual text measurement to prevent headline overflow

// Create a canvas for text measurement
let measurementCanvas = null;
let measurementContext = null;

function initTextMeasurement() {
  if (!measurementCanvas) {
    measurementCanvas = document.createElement('canvas');
    measurementContext = measurementCanvas.getContext('2d');
  }
}

// Measure actual pixel width of text with specific font settings
function measureTextWidth(text, fontSize = '18px', fontFamily = 'system-ui, -apple-system, sans-serif', fontWeight = '600') {
  initTextMeasurement();
  
  // Set font properties to match tile title styling
  measurementContext.font = `${fontWeight} ${fontSize} ${fontFamily}`;
  
  // Measure the text width
  const metrics = measurementContext.measureText(text);
  return metrics.width;
}

// Get the available width for tile text (tile width minus padding)
function getTileTextWidth() {
  // Use template system if available, otherwise fallback to default
  if (typeof window.templateSystem !== 'undefined') {
    return window.templateSystem.getTextWidth();
  }
  
  // Fallback: Tile width: 280px, padding: 16px left + 16px right = 32px
  // Available text width: 280 - 32 = 248px
  return 248;
}

// Check if text will fit in one line without overflow
function willTextFit(text, fontSize = '18px', fontFamily = 'system-ui, -apple-system, sans-serif', fontWeight = '600') {
  const textWidth = measureTextWidth(text, fontSize, fontFamily, fontWeight);
  const availableWidth = getTileTextWidth();
  
  return {
    fits: textWidth <= availableWidth,
    textWidth: textWidth,
    availableWidth: availableWidth,
    overflowBy: Math.max(0, textWidth - availableWidth),
    utilizationPercent: Math.round((textWidth / availableWidth) * 100)
  };
}

// Advanced analysis for multi-line text (considering line-clamp: 2)
function analyzeTextLayout(text, fontSize = '18px', fontFamily = 'system-ui, -apple-system, sans-serif', fontWeight = '600') {
  const words = text.split(' ');
  const availableWidth = getTileTextWidth();
  const lines = [];
  let currentLine = '';
  
  for (const word of words) {
    const testLine = currentLine ? `${currentLine} ${word}` : word;
    const lineWidth = measureTextWidth(testLine, fontSize, fontFamily, fontWeight);
    
    if (lineWidth <= availableWidth) {
      currentLine = testLine;
    } else {
      if (currentLine) {
        lines.push(currentLine);
        currentLine = word;
      } else {
        // Single word is too long for one line
        lines.push(word);
        currentLine = '';
      }
    }
  }
  
  if (currentLine) {
    lines.push(currentLine);
  }
  
  // Get line clamp from template system
  let lineClamp = 2; // Default
  if (typeof window.templateSystem !== 'undefined') {
    const clamps = window.templateSystem.getLineClamps();
    lineClamp = clamps.title; // Use title clamp as default, will be overridden in analyzeTextVisually
  }
  
  return {
    lines: lines,
    lineCount: lines.length,
    willTruncate: lines.length > lineClamp,
    truncatedText: lines.slice(0, lineClamp).join(' '),
    hiddenText: lines.length > lineClamp ? lines.slice(lineClamp).join(' ') : '',
    maxLineWidth: Math.max(...lines.map(line => measureTextWidth(line, fontSize, fontFamily, fontWeight))),
    utilizationPercent: Math.round((Math.max(...lines.map(line => measureTextWidth(line, fontSize, fontFamily, fontWeight))) / availableWidth) * 100)
  };
}

// Get optimal character limits based on actual visual measurement
function getOptimalLimits() {
  // Test with 'W' characters to find conservative limit
  let maxWs = 0;
  for (let i = 1; i <= 50; i++) {
    const testText = 'W'.repeat(i);
    if (willTextFit(testText, '18px').fits) {
      maxWs = i;
    } else {
      break;
    }
  }
  
  // Test with average character width (using 'n' as average)
  let maxAverage = 0;
  for (let i = 1; i <= 100; i++) {
    const testText = 'n'.repeat(i);
    if (willTextFit(testText, '18px').fits) {
      maxAverage = i;
    } else {
      break;
    }
  }
  
  return {
    conservativeLimit: maxWs,        // Based on widest character 'W'
    averageLimit: maxAverage,        // Based on average character 'n'
    recommendedMax: Math.floor(maxAverage * 0.85),  // 85% of average for safety
    recommendedWarning: Math.floor(maxAverage * 0.70)  // 70% of average for warning
  };
}

// Enhanced text analysis that replaces the old character-count system
function analyzeTextVisually(title, subtitle) {
  // Get template-specific font settings
  let titleFont = { fontSize: '18px', fontWeight: '600' };
  let subtitleFont = { fontSize: '16px', fontWeight: '400' };
  let lineClamps = { title: 2, subtitle: 2 };
  
  if (typeof window.templateSystem !== 'undefined') {
    const fontSettings = window.templateSystem.getFontSettings();
    const templateClamps = window.templateSystem.getLineClamps();
    
    titleFont = fontSettings.title;
    subtitleFont = fontSettings.subtitle;
    lineClamps = templateClamps;
  }
  
  const titleAnalysis = analyzeTextLayout(title, titleFont.fontSize, 'system-ui, -apple-system, sans-serif', titleFont.fontWeight);
  const subtitleAnalysis = analyzeTextLayout(subtitle, subtitleFont.fontSize, 'system-ui, -apple-system, sans-serif', subtitleFont.fontWeight);
  
  // Update analysis with correct line clamps
  titleAnalysis.willTruncate = titleAnalysis.lineCount > lineClamps.title;
  titleAnalysis.truncatedText = titleAnalysis.lines.slice(0, lineClamps.title).join(' ');
  titleAnalysis.hiddenText = titleAnalysis.lineCount > lineClamps.title ? titleAnalysis.lines.slice(lineClamps.title).join(' ') : '';
  
  subtitleAnalysis.willTruncate = subtitleAnalysis.lineCount > lineClamps.subtitle;
  subtitleAnalysis.truncatedText = subtitleAnalysis.lines.slice(0, lineClamps.subtitle).join(' ');
  subtitleAnalysis.hiddenText = subtitleAnalysis.lineCount > lineClamps.subtitle ? subtitleAnalysis.lines.slice(lineClamps.subtitle).join(' ') : '';
  
  const issues = [];
  let status = 'clean';
  
  // Check title
  if (titleAnalysis.willTruncate) {
    issues.push(`Title will be truncated (${titleAnalysis.lineCount} lines, showing ${lineClamps.title})`);
    status = 'overflow';
  } else if (titleAnalysis.utilizationPercent > 90) {
    issues.push(`Title near width limit (${titleAnalysis.utilizationPercent}% of available space)`);
    if (status !== 'overflow') status = 'near-limit';
  }
  
  // Check subtitle
  if (subtitleAnalysis.willTruncate) {
    issues.push(`Subtitle will be truncated (${subtitleAnalysis.lineCount} lines, showing ${lineClamps.subtitle})`);
    status = 'overflow';
  } else if (subtitleAnalysis.utilizationPercent > 90) {
    issues.push(`Subtitle near width limit (${subtitleAnalysis.utilizationPercent}% of available space)`);
    if (status !== 'overflow') status = 'near-limit';
  }
  
  return {
    status,
    issues,
    title: titleAnalysis,
    subtitle: subtitleAnalysis,
    titleLength: title.length,
    subtitleLength: subtitle.length
  };
}
