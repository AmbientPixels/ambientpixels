// Simple in-memory monthly calendar with Add/Edit modal
let calendarContainer = null;
let events = []; // { id, title, start: Date, end: Date, details }
let currentMonth = null;
let currentYear = null;
let editingId = null;

function uid() { return Math.random().toString(36).slice(2, 9); }

function toInputDateString(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function fromInputDateString(s) {
  if (!s) return null;
  const t = s.split('-');
  if (t.length !== 3) return null;
  const d = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
  return isNaN(d.getTime()) ? null : d;
}

function renderHeaderMonth(year, month) {
  const el = document.getElementById('current-month');
  if (!el) return;
  const d = new Date(year, month, 1);
  el.textContent = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

function renderMonthlyCalendar() {
  if (!calendarContainer) return;
  calendarContainer.innerHTML = '';

  const cal = document.createElement('div');
  cal.className = 'calendar-wrapper';

  const table = document.createElement('table');
  table.className = 'calendar';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  days.forEach(d => {
    const th = document.createElement('th');
    th.textContent = d;
    headRow.appendChild(th);
  });
  thead.appendChild(headRow);
  table.appendChild(thead);

  const firstOfMonth = new Date(currentYear, currentMonth, 1);
  const startingDay = firstOfMonth.getDay();
  const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

  let date = 1 - startingDay;
  for (let week = 0; week < 6; week++) {
    const tr = document.createElement('tr');
    for (let d = 0; d < 7; d++, date++) {
      const td = document.createElement('td');
      td.className = 'cal-day';
      const cellDate = new Date(currentYear, currentMonth, date);
      const dayLabel = document.createElement('div');
      dayLabel.className = 'cal-day-label';
      dayLabel.textContent = (cellDate.getMonth() === currentMonth && date > 0 && date <= daysInMonth) ? cellDate.getDate() : '';
      td.appendChild(dayLabel);

      td.addEventListener('click', (ev) => {
        if (ev.target && ev.target.classList && ev.target.classList.contains('cal-event')) return;
        openAddModal(cellDate);
      });

      const cellStart = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate(), 0,0,0);
      const cellEnd = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate(), 23,59,59);

      events.forEach((evnt) => {
        const evStart = new Date(evnt.start.getFullYear(), evnt.start.getMonth(), evnt.start.getDate(), 0,0,0);
        const evEnd = new Date(evnt.end.getFullYear(), evnt.end.getMonth(), evnt.end.getDate(), 23,59,59);
        if (evStart <= cellEnd && evEnd >= cellStart) {
          const evEl = document.createElement('div');
          evEl.className = 'cal-event';
          evEl.textContent = evnt.title;
          evEl.tabIndex = 0;
          evEl.setAttribute('role','button');
          evEl.addEventListener('click', (e) => { e.stopPropagation(); openDetailModal(evnt); });
          evEl.addEventListener('keydown', (ke) => { if (ke.key === 'Enter' || ke.key === ' ') { ke.stopPropagation(); openDetailModal(evnt); } });
          td.appendChild(evEl);
        }
      });

      tr.appendChild(td);
    }
    table.appendChild(tr);
  }

  cal.appendChild(table);
  calendarContainer.appendChild(cal);
}

function openAddModal(prefillDate) {
  editingId = null;
  const modal = document.getElementById('event-modal');
  const title = document.getElementById('ev-title');
  const start = document.getElementById('ev-start');
  const end = document.getElementById('ev-end');
  const details = document.getElementById('ev-details');
  if (!modal || !title || !start || !end || !details) return;

  title.value = '';
  details.value = '';
  if (prefillDate) {
    start.value = toInputDateString(prefillDate);
    end.value = toInputDateString(prefillDate);
  } else {
    start.value = '';
    end.value = '';
  }

  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
}

function openDetailModal(evnt) {
  editingId = evnt.id;
  const modal = document.getElementById('event-modal');
  const title = document.getElementById('ev-title');
  const start = document.getElementById('ev-start');
  const end = document.getElementById('ev-end');
  const details = document.getElementById('ev-details');
  if (!modal || !title || !start || !end || !details) return;

  title.value = evnt.title || '';
  start.value = toInputDateString(evnt.start);
  end.value = toInputDateString(evnt.end || evnt.start);
  details.value = evnt.details || '';

  modal.classList.add('open');
  modal.setAttribute('aria-hidden','false');
}

function closeModal() {
  const modal = document.getElementById('event-modal');
  if (!modal) return;
  modal.classList.remove('open');
  modal.setAttribute('aria-hidden','true');
}

function saveEventFromForm(e) {
  e.preventDefault();
  const title = document.getElementById('ev-title').value.trim();
  const startStr = document.getElementById('ev-start').value;
  const endStr = document.getElementById('ev-end').value;
  const details = document.getElementById('ev-details').value.trim();

  const start = fromInputDateString(startStr);
  const end = endStr ? fromInputDateString(endStr) : start;
  if (!start) { alert('Please enter a valid start date'); return; }

  if (editingId) {
    const idx = events.findIndex((x) => x.id === editingId);
    if (idx >= 0) {
      events[idx].title = title || events[idx].title;
      events[idx].start = start;
      events[idx].end = end || start;
      events[idx].details = details;
    }
  } else {
    const ev = { id: uid(), title: title || 'Event', start, end: end || start, details };
    events.push(ev);
  }

  closeModal();
  renderMonthlyCalendar();
}

function initCalendar() {
  calendarContainer = document.getElementById('calendar-container');
  const today = new Date();
  currentMonth = today.getMonth();
  currentYear = today.getFullYear();
  renderHeaderMonth(currentYear, currentMonth);
  renderMonthlyCalendar();

  document.getElementById('prev-month').addEventListener('click', () => {
    if (currentMonth === 0) { currentMonth = 11; currentYear -= 1; } else currentMonth -= 1;
    renderHeaderMonth(currentYear, currentMonth);
    renderMonthlyCalendar();
  });
  document.getElementById('next-month').addEventListener('click', () => {
    if (currentMonth === 11) { currentMonth = 0; currentYear += 1; } else currentMonth += 1;
    renderHeaderMonth(currentYear, currentMonth);
    renderMonthlyCalendar();
  });

  const addBtn = document.getElementById('add-event');
  if (addBtn) addBtn.addEventListener('click', () => openAddModal());
  document.getElementById('modal-close')?.addEventListener('click', closeModal);
  document.getElementById('ev-cancel')?.addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
  document.getElementById('event-form')?.addEventListener('submit', saveEventFromForm);
  document.getElementById('modal-overlay')?.addEventListener('click', closeModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
}

document.addEventListener('DOMContentLoaded', initCalendar);

let allSheets = [];
let activeSheetIdx = 0;
let activeSheetHeaders = [];
let showRawTable = false;
let manualDateCol = -1;
let manualEndCol = -1;
let manualTitleCol = -1;

function excelSerialToJSDate(serial) {
  const utcDays = Math.floor(serial - 25569);
  const utcValue = utcDays * 86400;
  const fractionalDay = serial - Math.floor(serial);
  const seconds = Math.round(fractionalDay * 86400);
  return new Date((utcValue + seconds) * 1000);
}

// Render sheet rows as a table
function renderSheetAsTable(rows) {
  if (!calendarContainer) return;
  calendarContainer.innerHTML = '';

  if (rows.length === 0) {
    calendarContainer.textContent = 'No data in this sheet.';
    return;
  }

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const headers = (rows[0] || []).map((h, i) => {
    if (h === undefined || h === null || String(h).trim() === '') return `Column ${String.fromCharCode(65 + i)}`;
    return String(h);
  });

  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  const isDateHeader = (h) => /date|start|end|due/i.test(String(h || ''));

  rows.slice(1).forEach((r) => {
    const tr = document.createElement('tr');
    for (let ci = 0; ci < headers.length; ci++) {
      const td = document.createElement('td');
      let cell = r && r[ci] !== undefined ? r[ci] : '';

      if (isDateHeader(headers[ci]) && typeof cell === 'number') {
        try {
          const dt = excelSerialToJSDate(cell);
          cell = dt.toLocaleDateString();
        } catch (e) {
          // leave as-is
        }
      }

      td.textContent = (cell === null || cell === undefined || cell === '') ? '-' : String(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  calendarContainer.appendChild(table);
}

function updateActiveSheet(sheetIdx) {
  activeSheetIdx = sheetIdx;
  if (allSheets[sheetIdx]) {
    activeSheetHeaders = (allSheets[sheetIdx][0] || []).map((h) => (h === undefined || h === null ? '' : String(h).trim()));
    
    // Show mapping controls
    showColumnMapping();
    
    // Default to showing raw table
    if (showRawTable) {
      renderSheetAsTable(allSheets[sheetIdx]);
    } else {
      renderSheetAsTable(allSheets[sheetIdx]);
    }
  }
}

function showColumnMapping() {
  const mapping = document.getElementById('column-mapping');
  const colDateSel = document.getElementById('col-date');
  const colEndSel = document.getElementById('col-end');
  const colTitleSel = document.getElementById('col-title');

  if (!mapping || !colDateSel || !colEndSel || !colTitleSel) return;

  // Populate selectors
  [colDateSel, colEndSel, colTitleSel].forEach((sel) => {
    sel.innerHTML = '<option value="-1">-- None --</option>';
  let calendarContainer = null;
  let events = []; // { id, title, start: Date, end: Date, details }
  let currentMonth = null;
  let currentYear = null;
  let editingId = null;

  function uid() { return Math.random().toString(36).slice(2, 9); }

  function toInputDateString(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
  }

  function fromInputDateString(s) {
    const t = s.split('-');
    if (t.length !== 3) return null;
    const d = new Date(Number(t[0]), Number(t[1]) - 1, Number(t[2]));
    return isNaN(d.getTime()) ? null : d;
  }

  function renderHeaderMonth(year, month) {
    const el = document.getElementById('current-month');
    if (!el) return;
    const d = new Date(year, month, 1);
    el.textContent = d.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  }

  function renderMonthlyCalendar() {
    if (!calendarContainer) return;
    calendarContainer.innerHTML = '';

    const cal = document.createElement('div');
    cal.className = 'calendar-wrapper';

    const table = document.createElement('table');
    table.className = 'calendar';

    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    days.forEach(d => {
      const th = document.createElement('th');
      th.textContent = d;
      headRow.appendChild(th);
    });
    thead.appendChild(headRow);
    table.appendChild(thead);

    const firstOfMonth = new Date(currentYear, currentMonth, 1);
    const startingDay = firstOfMonth.getDay();
    const daysInMonth = new Date(currentYear, currentMonth + 1, 0).getDate();

    let date = 1 - startingDay;
    for (let week = 0; week < 6; week++) {
      const tr = document.createElement('tr');
      for (let d = 0; d < 7; d++, date++) {
        const td = document.createElement('td');
        td.className = 'cal-day';
        const cellDate = new Date(currentYear, currentMonth, date);
        const dayLabel = document.createElement('div');
        dayLabel.className = 'cal-day-label';
        dayLabel.textContent = (cellDate.getMonth() === currentMonth && date > 0 && date <= daysInMonth) ? cellDate.getDate() : '';
        td.appendChild(dayLabel);

        // allow clicking the cell to add event on that date
        td.addEventListener('click', (ev) => {
          if (ev.target && ev.target.classList && ev.target.classList.contains('cal-event')) return;
          openAddModal(cellDate);
        });

        // find events that intersect this date
        const cellStart = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate(), 0,0,0);
        const cellEnd = new Date(cellDate.getFullYear(), cellDate.getMonth(), cellDate.getDate(), 23,59,59);

        events.forEach((evnt) => {
          const evStart = new Date(evnt.start.getFullYear(), evnt.start.getMonth(), evnt.start.getDate(), 0,0,0);
          const evEnd = new Date(evnt.end.getFullYear(), evnt.end.getMonth(), evnt.end.getDate(), 23,59,59);
          if (evStart <= cellEnd && evEnd >= cellStart) {
            const evEl = document.createElement('div');
            evEl.className = 'cal-event';
            evEl.textContent = evnt.title;
            evEl.tabIndex = 0;
            evEl.setAttribute('role','button');
            evEl.addEventListener('click', (e) => { e.stopPropagation(); openDetailModal(evnt); });
            evEl.addEventListener('keydown', (ke) => { if (ke.key === 'Enter' || ke.key === ' ') { ke.stopPropagation(); openDetailModal(evnt); } });
            td.appendChild(evEl);
          }
        });

        tr.appendChild(td);
      }
      table.appendChild(tr);
    }

    cal.appendChild(table);
    calendarContainer.appendChild(cal);
  }

  function openAddModal(prefillDate) {
    editingId = null;
    const modal = document.getElementById('event-modal');
    const title = document.getElementById('ev-title');
    const start = document.getElementById('ev-start');
    const end = document.getElementById('ev-end');
    const details = document.getElementById('ev-details');
    if (!modal || !title || !start || !end || !details) return;

    title.value = '';
    details.value = '';
    if (prefillDate) {
      start.value = toInputDateString(prefillDate);
      end.value = toInputDateString(prefillDate);
    } else {
      start.value = '';
      end.value = '';
    }

    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }

  function openDetailModal(evnt) {
    editingId = evnt.id;
    const modal = document.getElementById('event-modal');
    const title = document.getElementById('ev-title');
    const start = document.getElementById('ev-start');
    const end = document.getElementById('ev-end');
    const details = document.getElementById('ev-details');
    if (!modal || !title || !start || !end || !details) return;

    title.value = evnt.title || '';
    start.value = toInputDateString(evnt.start);
    end.value = toInputDateString(evnt.end || evnt.start);
    details.value = evnt.details || '';

    modal.classList.add('open');
    modal.setAttribute('aria-hidden','false');
  }

  function closeModal() {
    const modal = document.getElementById('event-modal');
    if (!modal) return;
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden','true');
  }

  function saveEventFromForm(e) {
    e.preventDefault();
    const title = document.getElementById('ev-title').value.trim();
    const startStr = document.getElementById('ev-start').value;
    const endStr = document.getElementById('ev-end').value;
    const details = document.getElementById('ev-details').value.trim();

    const start = fromInputDateString(startStr);
    const end = endStr ? fromInputDateString(endStr) : start;
    if (!start) { alert('Please enter a valid start date'); return; }

    if (editingId) {
      const idx = events.findIndex((x) => x.id === editingId);
      if (idx >= 0) {
        events[idx].title = title || events[idx].title;
        events[idx].start = start;
        events[idx].end = end || start;
        events[idx].details = details;
      }
    } else {
      const ev = { id: uid(), title: title || 'Event', start, end: end || start, details };
      events.push(ev);
    }

    closeModal();
    renderMonthlyCalendar();
  }

  function initCalendar() {
    calendarContainer = document.getElementById('calendar-container');
    const today = new Date();
    currentMonth = today.getMonth();
    currentYear = today.getFullYear();
    renderHeaderMonth(currentYear, currentMonth);
    renderMonthlyCalendar();

    document.getElementById('prev-month').addEventListener('click', () => {
      if (currentMonth === 0) { currentMonth = 11; currentYear -= 1; } else currentMonth -= 1;
      renderHeaderMonth(currentYear, currentMonth);
      renderMonthlyCalendar();
    });
    document.getElementById('next-month').addEventListener('click', () => {
      if (currentMonth === 11) { currentMonth = 0; currentYear += 1; } else currentMonth += 1;
      renderHeaderMonth(currentYear, currentMonth);
      renderMonthlyCalendar();
    });

    document.getElementById('add-event').addEventListener('click', () => openAddModal());
    document.getElementById('modal-close').addEventListener('click', closeModal);
    document.getElementById('ev-cancel').addEventListener('click', (e) => { e.preventDefault(); closeModal(); });
    document.getElementById('event-form').addEventListener('submit', saveEventFromForm);
    document.getElementById('modal-overlay').addEventListener('click', closeModal);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeModal(); });
  }

  document.addEventListener('DOMContentLoaded', initCalendar);
    }
  });

  document.getElementById('prev-month').addEventListener('click', () => {
    if (currentMonth === 0) { currentMonth = 11; currentYear -= 1; } else currentMonth -= 1;
    renderHeaderMonth(currentYear, currentMonth);
    renderMonthlyCalendar(lastEvents, currentYear, currentMonth);
  });
  document.getElementById('next-month').addEventListener('click', () => {
    if (currentMonth === 11) { currentMonth = 0; currentYear += 1; } else currentMonth += 1;
    renderHeaderMonth(currentYear, currentMonth);
    renderMonthlyCalendar(lastEvents, currentYear, currentMonth);
  });
  document.getElementById('modal-close').addEventListener('click', closeEventModal);
  document.getElementById('modal-overlay').addEventListener('click', closeEventModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEventModal(); });
  document.getElementById('toggle-table').addEventListener('click', () => {
    showRawTable = !showRawTable;
    if (showRawTable && lastRows) renderRowsTable(lastRows);
    else renderMonthlyCalendar(lastEvents, currentYear, currentMonth);
  });
}

// keep old table renderer for raw view
function renderRowsTable(rows) {
  if (!calendarContainer) return;
  calendarContainer.innerHTML = '';

  const table = document.createElement('table');
  const thead = document.createElement('thead');
  const headerRow = document.createElement('tr');

  const headers = (rows[0] || []).map((h, i) => {
    if (h === undefined || h === null || String(h).trim() === '') return `Column ${String.fromCharCode(65 + i)}`;
    return String(h);
  });

  headers.forEach((h) => {
    const th = document.createElement('th');
    th.textContent = h;
    headerRow.appendChild(th);
  });
  thead.appendChild(headerRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  const isDateHeader = (h) => /date|start|end|due/i.test(String(h || ''));

  // For each data row, create cells
  rows.slice(1).forEach((r) => {
    const tr = document.createElement('tr');
    for (let ci = 0; ci < headers.length; ci++) {
      const td = document.createElement('td');
      let cell = r && r[ci] !== undefined ? r[ci] : '';

      // If header suggests a date column and value is a number, convert Excel serial to JS date
      if (isDateHeader(headers[ci]) && typeof cell === 'number') {
        try {
          const dt = excelSerialToJSDate(cell);
          cell = dt.toLocaleDateString();
        } catch (e) {
          // leave cell as-is
        }
      }

      td.textContent = (cell === null || cell === undefined || cell === '') ? '-' : String(cell);
      tr.appendChild(td);
    }
    tbody.appendChild(tr);
  });

  table.appendChild(tbody);
  calendarContainer.appendChild(table);
}


// File input handling and Excel parsing
document.addEventListener('DOMContentLoaded', () => {
  calendarContainer = document.getElementById('calendar-container');
  const fileInput = document.getElementById('excel-file');
  const errorMessageEl = document.getElementById('error-message');
  const weekSelect = document.getElementById('week-select');
  const weekControls = document.getElementById('week-controls');
  const applyMapBtn = document.getElementById('apply-mapping');
  const toggleViewBtn = document.getElementById('toggle-view');

  // Modal close handlers
  document.getElementById('modal-close')?.addEventListener('click', closeEventModal);
  document.getElementById('modal-overlay')?.addEventListener('click', closeEventModal);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeEventModal(); });

  // Toggle between raw table and calendar view
  toggleViewBtn?.addEventListener('click', () => {
    showRawTable = !showRawTable;
    if (activeSheetIdx >= 0 && allSheets[activeSheetIdx]) {
      if (showRawTable) {
        renderSheetAsTable(allSheets[activeSheetIdx]);
      } else {
        const mapping = document.getElementById('column-mapping');
        if (mapping?.style.display !== 'none') {
          const dateCol = parseInt(document.getElementById('col-date').value);
          const endCol = parseInt(document.getElementById('col-end').value);
          const titleCol = parseInt(document.getElementById('col-title').value);
          const events = parseSheetToEvents(allSheets[activeSheetIdx], dateCol, endCol, titleCol);
          renderWeekCalendar(events);
        }
      }
    }
  });

  // Apply column mapping and render calendar
  applyMapBtn?.addEventListener('click', () => {
    manualDateCol = parseInt(document.getElementById('col-date').value);
    manualEndCol = parseInt(document.getElementById('col-end').value);
    manualTitleCol = parseInt(document.getElementById('col-title').value);

    if (manualDateCol < 0) {
      alert('Please select a Date column.');
      return;
    }

    if (activeSheetIdx >= 0 && allSheets[activeSheetIdx]) {
      const events = parseSheetToEvents(allSheets[activeSheetIdx], manualDateCol, manualEndCol, manualTitleCol);
      showRawTable = false;
      renderWeekCalendar(events);
    }
  });

  if (!fileInput) return;

  const showError = (msg) => {
    if (errorMessageEl) errorMessageEl.textContent = msg;
    else console.warn(msg);
  };

  const clearError = () => {
    if (errorMessageEl) errorMessageEl.textContent = '';
  };

  fileInput.addEventListener('change', (e) => {
    clearError();
    const file = e.target.files && e.target.files[0];
    if (!file) return;

    const name = (file.name || '').toLowerCase();
    if (!name.endsWith('.xls') && !name.endsWith('.xlsx')) {
      showError('Unsupported file type. Please upload an .xlsx or .xls file.');
      return;
    }

    const reader = new FileReader();
    reader.onload = (evt) => {
      try {
        const data = evt.target.result;
        const wb = XLSX.read(data, { type: 'array' });

        if (!wb.SheetNames || wb.SheetNames.length === 0) {
          showError('No sheets found in the workbook.');
          return;
        }

        // Read all sheets as data
        allSheets = wb.SheetNames.map((sheetName) => {
          const ws = wb.Sheets[sheetName];
          return XLSX.utils.sheet_to_json(ws, { header: 1 });
        });

        // Populate week selector
        weekSelect.innerHTML = '';
        wb.SheetNames.forEach((name, idx) => {
          const opt = document.createElement('option');
          opt.value = idx;
          opt.textContent = name;
          weekSelect.appendChild(opt);
        });

        weekSelect.addEventListener('change', (ce) => {
          updateActiveSheet(parseInt(ce.target.value));
        });

        // Show controls and render first sheet
        if (weekControls) weekControls.style.display = 'block';
        updateActiveSheet(0);
        clearError();
      } catch (err) {
        const msg = (err && err.message) ? err.message : String(err);
        if (/encrypt|encryption|encrypted|EncryptionInfo|ECMA-376/i.test(msg)) {
          showError('Cannot parse file: it appears to be password-protected or encrypted. Remove protection or upload an unencrypted copy.');
        } else {
          showError('Error parsing Excel file. See console for details.');
          console.error('Error parsing Excel file:', err);
        }
      }
    };

    reader.onerror = (err) => {
      showError('Error reading file.');
      console.error('FileReader error', err);
    };
    reader.readAsArrayBuffer(file);
  });
});