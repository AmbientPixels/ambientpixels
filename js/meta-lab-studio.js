// File: /js/meta-lab-studio.js

document.addEventListener('DOMContentLoaded', () => {
    // Everything inside this block is delayed until the DOM is ready
  
    let parsedData = [];
    let history = [];
    let redoStack = [];
    let isTableView = false;
    let isPrettyPrint = false;
    let compareMode = false;
    let currentFileIndex = 0;
    let compareIndices = [];
    let originalOutput = '';
  
    const textarea = document.getElementById('inputData');
    const outputDiv = document.getElementById('output');
    const statusDiv = document.getElementById('status')

// --- Event Listeners ---
textarea.addEventListener('dragover', (e) => {
  e.preventDefault();
  textarea.classList.add('dragover');
  statusDiv.textContent = 'Drop files to add!';
});
textarea.addEventListener('dragleave', () => {
  textarea.classList.remove('dragover');
  statusDiv.textContent = parsedData.length
    ? `${parsedData.length} file(s) loaded — drop more to append`
    : 'Ready to load files';
});
textarea.addEventListener('drop', (e) => {
  e.preventDefault();
  textarea.classList.remove('dragover');
  const files = Array.from(e.dataTransfer.files).filter(file => /\.(json|xml|txt)$/i.test(file.name));
  if (!files.length) {
    statusDiv.textContent = 'Only .json, .xml, or .txt files supported';
    statusDiv.style.color = '#ff6b6b';
    return;
  }
  readFiles(files);
});
textarea.addEventListener('input', () => setTimeout(parseAuto, 0));

// --- Core Functions ---
function readFiles(files) {
  let completed = 0;
  statusDiv.textContent = `Loading ${files.length} file(s)...`;
  statusDiv.style.color = '#89c2d9';

  files.forEach((file, index) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const content = e.target.result.trim();
        let data = content.startsWith('<') ? parseXML(content) : JSON.parse(content);
        parsedData.push({
          name: file.name,
          data,
          raw: isPrettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data),
          size: file.size,
          lastModified: file.lastModified,
        });
      } catch (error) {
        parsedData.push({
          name: file.name,
          error: error.message,
          raw: e.target.result,
          size: file.size,
          lastModified: file.lastModified,
        });
      }
      completed++;
      if (completed === files.length) {
        saveHistory();
        updateTextarea();
        renderTabs();
        showFile(parsedData.length - 1);
        enableControls();
      }
    };
    reader.readAsText(file);
  });
}

function parseXML(content) {
  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(content, "text/xml");
  if (xmlDoc.getElementsByTagName("parsererror").length > 0) {
    throw new Error("Invalid XML format");
  }
  return xmlToJson(xmlDoc.documentElement);
}

function xmlToJson(xml) {
  const obj = {};
  if (xml.nodeType === 1 && xml.attributes.length) {
    obj["@attributes"] = {};
    for (const attr of xml.attributes) {
      obj["@attributes"][attr.nodeName] = attr.nodeValue;
    }
  } else if (xml.nodeType === 3) {
    return xml.nodeValue.trim();
  }

  for (const node of xml.childNodes) {
    if (node.nodeName === "#text" && node.nodeValue.trim() === "") continue;
    const value = xmlToJson(node);
    if (!obj[node.nodeName]) {
      obj[node.nodeName] = value;
    } else {
      if (!Array.isArray(obj[node.nodeName])) {
        obj[node.nodeName] = [obj[node.nodeName]];
      }
      obj[node.nodeName].push(value);
    }
  }
  return obj;
}

function parseAuto() {
  const input = textarea.value.trim();
  outputDiv.innerHTML = '';
  parsedData = [];
  if (!input) return;

  try {
    let data = input.startsWith('<') ? parseXML(input) : JSON.parse(input);
    parsedData.push({
      name: 'Input',
      data,
      raw: isPrettyPrint ? JSON.stringify(data, null, 2) : JSON.stringify(data)
    });
    saveHistory();
    renderTabs();
    showFile(0);
    enableControls();
    statusDiv.textContent = '1 file processed — drop more to append';
  } catch (error) {
    outputDiv.innerHTML = `<p style="color:#ff6b6b;">Parse Error: ${escapeHtml(error.message)}</p>`;
    statusDiv.textContent = 'Error processing input';
    statusDiv.style.color = '#ff6b6b';
  }
}

function updateTextarea() {
  textarea.value = parsedData.map(item =>
    item.error ? `// Error in ${item.name}: ${item.error}\n${item.raw}` : (item.raw || JSON.stringify(item.data))
  ).join('\n\n');
}

function enableControls() {
  document.getElementById('exportSelect').disabled = parsedData.length === 0;
  document.getElementById('toggleCheckbox').disabled = parsedData.length === 0;
  document.getElementById('compareBtn').disabled = parsedData.length < 2;
}

function disableControls() {
  document.getElementById('exportSelect').disabled = true;
  document.getElementById('toggleCheckbox').disabled = true;
  document.getElementById('compareBtn').disabled = true;
}

function escapeHtml(unsafe) {
  return String(unsafe || '').replace(/[&<>"']/g, (m) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
  })[m]);
}

// --- View Functions ---
function renderJSON(data, level = 0) {
  let html = '<div class="section">';
  if (level === 0) html += '<h2>Data Structure</h2>';
  for (const [key, value] of Object.entries(data)) {
    if (key === '@attributes') {
      for (const [attrKey, attrValue] of Object.entries(value)) {
        html += `<div class="property"><label>${escapeHtml(attrKey)} (attr):</label> ${escapeHtml(String(attrValue))}</div>`;
      }
    } else if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      html += `<div class="property"><label>${escapeHtml(key)}:</label> ${escapeHtml(String(value))}</div>`;
    } else if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
      html += `<div class="property"><label>${escapeHtml(key)}:</label></div><div class="nested">`;
      if (Array.isArray(value)) {
        value.forEach((item, idx) => {
          html += `<h3>${escapeHtml(key)} [${idx}]</h3>`;
          html += renderJSON(item, level + 1);
        });
      } else {
        html += renderJSON(value, level + 1);
      }
      html += '</div>';
    }
  }
  html += '</div>';
  return html;
}

function renderTable(data) {
  let html = '<table><tr><th>Key</th><th>Value</th><th>Attributes</th></tr>';
  const rows = [];

  function flatten(obj, parent = '') {
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = parent ? `${parent}.${key}` : key;
      if (key === '@attributes') continue;
      let attrs = obj['@attributes']
        ? Object.entries(obj['@attributes']).map(([k, v]) => `${escapeHtml(k)}=${escapeHtml(v)}`).join(', ')
        : '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        rows.push([fullKey, String(value), attrs]);
      } else if (Array.isArray(value)) {
        value.forEach((item, idx) => flatten(item, `${fullKey}[${idx}]`));
      } else if (typeof value === 'object' && value !== null) {
        flatten(value, fullKey);
      }
    }
  }
  flatten(data);

  rows.forEach(([key, value, attrs]) => {
    html += `<tr><td>${escapeHtml(key)}</td><td>${escapeHtml(value)}</td><td>${escapeHtml(attrs)}</td></tr>`;
  });
  if (rows.length === 0) html += '<tr><td colspan="3">No data to display</td></tr>';
  html += '</table>';
  return html;
}

// --- Display and Actions ---
function showFile(index) {
  currentFileIndex = index;
  const item = parsedData[index];
  outputDiv.classList.remove('compare-mode');
  outputDiv.innerHTML = item && !item.error
    ? (isTableView ? renderTable(item.data) : renderJSON(item.data))
    : `<p style="color:#ff6b6b;">${item ? 'Error in ' + escapeHtml(item.name) : 'No data available'}</p>`;
  originalOutput = outputDiv.innerHTML;
  renderTabs();
  updateFileInfo(item);
  filterOutput();
}

function renderTabs() {
  const tabContainer = document.getElementById('tabContainer');
  tabContainer.innerHTML = '';
  parsedData.forEach((item, idx) => {
    const tab = document.createElement('div');
    tab.className = `tab ${idx === currentFileIndex ? 'active' : ''}`;
    tab.innerHTML = `${escapeHtml(item.name)} <span class="tab-close" onclick="closeTab(${idx}, event)">×</span>`;
    tab.onclick = (e) => {
      if (e.target.className !== 'tab-close') showFile(idx);
    };
    tabContainer.appendChild(tab);
  });
}

function closeTab(idx, event) {
  event.stopPropagation();
  saveHistory();
  parsedData.splice(idx, 1);
  if (parsedData.length === 0) {
    clearInput();
  } else {
    currentFileIndex = Math.min(idx, parsedData.length - 1);
    updateTextarea();
    renderTabs();
    showFile(currentFileIndex);
  }
}

function clearInput() {
  textarea.value = '';
  parsedData = [];
  history = [];
  redoStack = [];
  currentFileIndex = 0;
  outputDiv.innerHTML = '';
  document.getElementById('tabContainer').innerHTML = '';
  document.getElementById('fileInfo').innerHTML = '';
  disableControls();
}

// --- Tool Functions ---
function saveHistory() {
  history.push({ data: [...parsedData], text: textarea.value });
  redoStack = [];
}
function undo() {
  if (history.length > 1) {
    redoStack.push(history.pop());
    const prev = history[history.length - 1];
    parsedData = prev.data;
    textarea.value = prev.text;
    renderTabs();
    showFile(currentFileIndex);
  }
}
function redo() {
  if (redoStack.length) {
    const next = redoStack.pop();
    history.push(next);
    parsedData = next.data;
    textarea.value = next.text;
    renderTabs();
    showFile(currentFileIndex);
  }
}

// --- Placeholder: filterOutput(), validateData(), exportData() ---
});