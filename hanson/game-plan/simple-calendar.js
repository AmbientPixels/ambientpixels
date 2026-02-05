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
