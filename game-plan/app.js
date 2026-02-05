// Event Calendar — app.js
// Uses localStorage, accessible dialogs, simple month grid, CRUD, export/import, theming
(function(){
  'use strict';

  // Utilities
  const qs = s=>document.querySelector(s);
  const qsa = s=>Array.from(document.querySelectorAll(s));
  const uid = ()=>Date.now().toString(36)+Math.random().toString(36).slice(2,8);
  const lget = k=>JSON.parse(localStorage.getItem(k)||'null');
  const lset = (k,v)=>localStorage.setItem(k,JSON.stringify(v));
  const toLocalDate = (d)=>{
    const pad = n=>(n+'').padStart(2,'0');
    return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`;
  };

  // Custom Dialog System
  let dialogResolve = null;
  function showDialog(message, type = 'alert', options = {}) {
    return new Promise((resolve) => {
      dialogResolve = resolve;
      const modal = qs('#dialog-modal');
      const icon = qs('#dialog-icon');
      const msg = qs('#dialog-message');
      const okBtn = qs('#dialog-ok');
      const cancelBtn = qs('#dialog-cancel');
      
      msg.textContent = message;
      
      // Set icon based on type
      if(type === 'confirm' || type === 'delete') {
        icon.textContent = '⚠️';
        cancelBtn.style.display = 'inline-block';
        okBtn.textContent = options.okText || 'Confirm';
        if(type === 'delete') {
          okBtn.className = 'dialog-btn danger';
          okBtn.textContent = options.okText || 'Delete';
        } else {
          okBtn.className = 'dialog-btn primary';
        }
      } else if(type === 'success') {
        icon.textContent = '✅';
        cancelBtn.style.display = 'none';
        okBtn.className = 'dialog-btn primary';
        okBtn.textContent = 'OK';
      } else if(type === 'error') {
        icon.textContent = '❌';
        cancelBtn.style.display = 'none';
        okBtn.className = 'dialog-btn primary';
        okBtn.textContent = 'OK';
      } else {
        icon.textContent = 'ℹ️';
        cancelBtn.style.display = 'none';
        okBtn.className = 'dialog-btn primary';
        okBtn.textContent = 'OK';
      }
      
      modal.setAttribute('aria-hidden', 'false');
      modal.style.display = 'block';
      okBtn.focus();
    });
  }
  
  function closeDialog(result) {
    const modal = qs('#dialog-modal');
    modal.setAttribute('aria-hidden', 'true');
    modal.style.display = 'none';
    if(dialogResolve) {
      dialogResolve(result);
      dialogResolve = null;
    }
  }
  
  // Bind dialog buttons after DOM ready
  function bindDialogUI() {
    qs('#dialog-ok')?.addEventListener('click', () => closeDialog(true));
    qs('#dialog-cancel')?.addEventListener('click', () => closeDialog(false));
    qs('#dialog-modal-overlay')?.addEventListener('click', () => closeDialog(false));
  }

  // Platform colors (defined early for use in notifications)
  const platformColors = {
    'Xbox desktop app (Garrison)': '#0067c5',
    'Console': '#ff6b35',
    'Xbox mobile home': '#1abc9c',
    'Mobile Store Editorial': '#e535ab',
    'Mobile Store Spotlight': '#f7931e',
    'Other': '#9a7fd1'
  };

  // ============ TIME TRACKING SYSTEM ============
  const TIME_ENTRIES_KEY = 'store_calendar.timeEntries';
  let timeEntries = lget(TIME_ENTRIES_KEY) || []; // Array of { id, eventId, date, hours, note }
  
  // Timer state
  let timerState = {
    running: false,
    paused: false,
    eventId: null,
    eventTitle: null,
    startTime: null,
    pausedTime: 0, // Accumulated time while paused
    intervalId: null
  };
  
  function saveTimeEntries() {
    lset(TIME_ENTRIES_KEY, timeEntries);
  }
  
  // Add a time entry
  function addTimeEntry(eventId, hours, note = '') {
    const entry = {
      id: uid(),
      eventId,
      date: toLocalDate(new Date()),
      hours: parseFloat(hours) || 0,
      note
    };
    timeEntries.push(entry);
    saveTimeEntries();
    
    // Update event's actual time
    updateEventActualTime(eventId);
    return entry;
  }
  
  // Delete a time entry
  function deleteTimeEntry(entryId) {
    const entry = timeEntries.find(e => e.id === entryId);
    if(entry) {
      timeEntries = timeEntries.filter(e => e.id !== entryId);
      saveTimeEntries();
      updateEventActualTime(entry.eventId);
    }
  }
  
  // Update event's actual time from entries
  function updateEventActualTime(eventId) {
    const eventEntries = timeEntries.filter(e => e.eventId === eventId);
    const totalHours = eventEntries.reduce((sum, e) => sum + e.hours, 0);
    
    const event = state.events.find(e => e.id === eventId);
    if(event) {
      event.actualTime = Math.round(totalHours * 100) / 100;
      saveState();
    }
  }
  
  // Get time entries for an event
  function getEventTimeEntries(eventId) {
    return timeEntries.filter(e => e.eventId === eventId);
  }
  
  // Render time entries list in the event form
  function renderEventTimeEntries(eventId) {
    const container = qs('#time-entries-list');
    if(!container) return;
    
    const entries = getEventTimeEntries(eventId);
    
    if(entries.length === 0) {
      container.innerHTML = '<p class="empty-message" style="color:var(--muted);font-size:0.85rem;text-align:center;padding:8px;">No time logged yet. Use the fields above to log time.</p>';
      return;
    }
    
    container.innerHTML = entries.map(entry => `
      <div class="time-entry-item" data-entry-id="${entry.id}">
        <span class="time-entry-date">${new Date(entry.date).toLocaleDateString()}</span>
        <span class="time-entry-hours">${entry.hours.toFixed(2)}h</span>
        <span class="time-entry-note">${entry.note || ''}</span>
        <button type="button" class="time-entry-delete" title="Delete entry">✕</button>
      </div>
    `).join('');
    
    // Bind delete buttons
    container.querySelectorAll('.time-entry-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const entryId = btn.closest('.time-entry-item').dataset.entryId;
        deleteTimeEntry(entryId);
        renderEventTimeEntries(eventId);
        // Update actual time field
        const event = state.events.find(ev => ev.id === eventId);
        if(event) {
          const fldActual = qs('#fld-actual-time');
          if(fldActual) fldActual.value = event.actualTime || 0;
        }
      });
    });
  }
  
  // Timer functions
  function startTimer(eventId, eventTitle) {
    if(timerState.running) {
      // Stop current timer first
      stopTimer();
    }
    
    timerState = {
      running: true,
      paused: false,
      eventId,
      eventTitle,
      startTime: Date.now(),
      pausedTime: 0,
      intervalId: setInterval(updateTimerDisplay, 1000)
    };
    
    updateTimerUI();
    updateTimerDisplay();
  }
  
  function pauseTimer() {
    if(!timerState.running || timerState.paused) return;
    
    timerState.paused = true;
    timerState.pausedTime += Date.now() - timerState.startTime;
    clearInterval(timerState.intervalId);
    
    updateTimerUI();
  }
  
  function resumeTimer() {
    if(!timerState.paused) return;
    
    timerState.paused = false;
    timerState.startTime = Date.now();
    timerState.intervalId = setInterval(updateTimerDisplay, 1000);
    
    updateTimerUI();
  }
  
  function stopTimer() {
    if(!timerState.running && !timerState.paused) return;
    
    clearInterval(timerState.intervalId);
    
    // Calculate total time
    let totalMs = timerState.pausedTime;
    if(!timerState.paused && timerState.startTime) {
      totalMs += Date.now() - timerState.startTime;
    }
    
    const hours = totalMs / (1000 * 60 * 60);
    
    if(hours > 0.01 && timerState.eventId) { // At least ~30 seconds
      addTimeEntry(timerState.eventId, hours, 'Timer session');
      renderTimeView();
    }
    
    // Reset timer
    timerState = {
      running: false,
      paused: false,
      eventId: null,
      eventTitle: null,
      startTime: null,
      pausedTime: 0,
      intervalId: null
    };
    
    updateTimerUI();
    updateTimerDisplay();
  }
  
  function updateTimerDisplay() {
    const display = qs('#timer-time');
    if(!display) return;
    
    let totalMs = timerState.pausedTime;
    if(timerState.running && !timerState.paused && timerState.startTime) {
      totalMs += Date.now() - timerState.startTime;
    }
    
    const totalSeconds = Math.floor(totalMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    display.textContent = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:${String(seconds).padStart(2,'0')}`;
  }
  
  function updateTimerUI() {
    const widget = qs('#timer-widget');
    const startBtn = qs('#timer-start');
    const pauseBtn = qs('#timer-pause');
    const stopBtn = qs('#timer-stop');
    const eventName = qs('#timer-event-name');
    
    if(!widget) return;
    
    widget.classList.remove('running', 'paused');
    
    if(timerState.running && !timerState.paused) {
      widget.classList.add('running');
      startBtn.style.display = 'none';
      pauseBtn.style.display = 'flex';
      stopBtn.style.display = 'flex';
      eventName.textContent = timerState.eventTitle || 'Tracking...';
    } else if(timerState.paused) {
      widget.classList.add('paused');
      startBtn.style.display = 'flex';
      startBtn.textContent = '▶';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'flex';
      eventName.textContent = timerState.eventTitle + ' (paused)';
    } else {
      startBtn.style.display = 'flex';
      startBtn.textContent = '▶';
      pauseBtn.style.display = 'none';
      stopBtn.style.display = 'none';
      eventName.textContent = 'No event selected';
    }
  }
  
  function bindTimerUI() {
    const startBtn = qs('#timer-start');
    const pauseBtn = qs('#timer-pause');
    const stopBtn = qs('#timer-stop');
    
    startBtn?.addEventListener('click', () => {
      if(timerState.paused) {
        resumeTimer();
      } else if(!timerState.running) {
        // Show dialog to select event
        showTimerEventSelector();
      }
    });
    
    pauseBtn?.addEventListener('click', pauseTimer);
    stopBtn?.addEventListener('click', stopTimer);
    
    // Start timer from view modal
    qs('#view-start-timer')?.addEventListener('click', () => {
      if(viewingEvent) {
        startTimer(viewingEvent.id, viewingEvent.title);
        closeViewModal();
      }
    });
    
    // Manual time entry from edit form
    qs('#add-manual-time')?.addEventListener('click', () => {
      const hoursInput = qs('#manual-time-hours');
      const noteInput = qs('#manual-time-note');
      const hours = parseFloat(hoursInput?.value) || 0;
      const note = noteInput?.value?.trim() || 'Manual entry';
      
      if(hours <= 0) {
        showDialog('Please enter a valid number of hours', 'error');
        return;
      }
      
      // Get the event ID from the form
      const eventId = fldId?.value;
      if(!eventId) {
        showDialog('Please save the event first before logging time', 'error');
        return;
      }
      
      // Check if event exists (for edit mode)
      const existingEvent = state.events.find(e => e.id === eventId);
      if(!existingEvent) {
        showDialog('Please save the event first before logging time', 'error');
        return;
      }
      
      addTimeEntry(eventId, hours, note);
      
      // Clear inputs
      if(hoursInput) hoursInput.value = '';
      if(noteInput) noteInput.value = '';
      
      // Refresh the time entries display
      renderEventTimeEntries(eventId);
      
      // Update actual time field
      const fldActual = qs('#fld-actual-time');
      if(fldActual && existingEvent) {
        fldActual.value = existingEvent.actualTime || 0;
      }
      
      showDialog(`Logged ${hours}h for "${existingEvent.title}"`, 'alert');
    });
  }
  
  async function showTimerEventSelector() {
    // For simplicity, start timer on currently selected day's first event
    // or show a simple prompt
    const todayEvents = state.events.filter(e => e.date === state.selectedDate);
    if(todayEvents.length > 0) {
      startTimer(todayEvents[0].id, todayEvents[0].title);
    } else {
      await showDialog('Select an event from the calendar and use "Start Timer" in the event details.', 'alert');
    }
  }
  
  // Time view rendering
  function renderTimeView() {
    const totalLogged = qs('#total-time-logged');
    const totalEstimated = qs('#total-estimated');
    const timeEfficiency = qs('#time-efficiency');
    const eventsTracked = qs('#events-tracked');
    const platformBars = qs('#platform-time-bars');
    const statusBars = qs('#status-time-bars');
    const recentList = qs('#recent-entries-list');
    const monthLabel = qs('#month-label');
    
    if(!totalLogged) return; // View not in DOM
    
    // Get selected period
    const activePeriod = qs('.time-period-btn.active')?.dataset.period || 'week';
    const now = new Date();
    let startDate;
    let periodLabel;
    
    if(activePeriod === 'week') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      periodLabel = `Last 7 Days (${startDate.toLocaleDateString(undefined, {month:'short',day:'numeric'})} - ${now.toLocaleDateString(undefined, {month:'short',day:'numeric'})})`;
    } else if(activePeriod === 'month') {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      periodLabel = `Last 30 Days (${startDate.toLocaleDateString(undefined, {month:'short',day:'numeric'})} - ${now.toLocaleDateString(undefined, {month:'short',day:'numeric'})})`;
    } else {
      startDate = new Date(0); // All time
      periodLabel = 'All Time';
    }
    
    // Update month label to show current time period
    if(monthLabel) monthLabel.textContent = periodLabel;
    
    const startDateStr = toLocalDate(startDate);
    
    // Filter entries by period
    const periodEntries = timeEntries.filter(e => e.date >= startDateStr);
    const periodEventIds = [...new Set(periodEntries.map(e => e.eventId))];
    const periodEvents = state.events.filter(e => periodEventIds.includes(e.id));
    
    // Calculate stats
    const totalLoggedHours = periodEntries.reduce((sum, e) => sum + e.hours, 0);
    const totalEstimatedHours = periodEvents.reduce((sum, e) => sum + (e.estimatedTime || 0), 0);
    const eventsWithTime = periodEvents.filter(e => e.actualTime > 0).length;
    
    totalLogged.textContent = formatHours(totalLoggedHours);
    totalEstimated.textContent = formatHours(totalEstimatedHours);
    eventsTracked.textContent = eventsWithTime;
    
    if(totalEstimatedHours > 0 && totalLoggedHours > 0) {
      const efficiency = Math.round((totalEstimatedHours / totalLoggedHours) * 100);
      timeEfficiency.textContent = efficiency + '%';
      timeEfficiency.style.color = efficiency >= 100 ? '#22c55e' : efficiency >= 80 ? '#f59e0b' : '#ef4444';
    } else {
      timeEfficiency.textContent = '—';
      timeEfficiency.style.color = '';
    }
    
    // Time by platform
    const platformTime = {};
    periodEntries.forEach(entry => {
      const event = state.events.find(e => e.id === entry.eventId);
      if(event && event.platform) {
        const platforms = event.platform.split(', ');
        platforms.forEach(p => {
          platformTime[p] = (platformTime[p] || 0) + entry.hours;
        });
      }
    });
    
    const maxPlatformTime = Math.max(...Object.values(platformTime), 1);
    platformBars.innerHTML = Object.entries(platformTime)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([platform, hours]) => {
        const color = platformColors[platform] || platformColors['Other'];
        const pct = (hours / maxPlatformTime) * 100;
        return `
          <div class="time-bar">
            <div class="time-bar-label">${platform.replace(/\s*\([^)]*\)/g, '')}</div>
            <div class="time-bar-track">
              <div class="time-bar-fill" style="width:${pct}%;background:${color}">
                <span class="time-bar-value">${formatHours(hours)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('') || '<div class="empty-notifications">No time logged yet</div>';
    
    // Time by status
    const statusTime = {};
    const statusColors = {
      'Planning': '#3b82f6',
      'Pending assets': '#f59e0b',
      'Ready for production': '#22c55e',
      'Build is cooking': '#f59e0b',
      'In QC': '#8b5cf6',
      'Cooked and booked': '#22c55e',
      'Canceled': '#ef4444'
    };
    
    periodEntries.forEach(entry => {
      const event = state.events.find(e => e.id === entry.eventId);
      if(event) {
        const status = event.prodStatus || event.preProdStatus || 'No status';
        statusTime[status] = (statusTime[status] || 0) + entry.hours;
      }
    });
    
    const maxStatusTime = Math.max(...Object.values(statusTime), 1);
    statusBars.innerHTML = Object.entries(statusTime)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 6)
      .map(([status, hours]) => {
        const color = statusColors[status] || '#6b7280';
        const pct = (hours / maxStatusTime) * 100;
        return `
          <div class="time-bar">
            <div class="time-bar-label">${status}</div>
            <div class="time-bar-track">
              <div class="time-bar-fill" style="width:${pct}%;background:${color}">
                <span class="time-bar-value">${formatHours(hours)}</span>
              </div>
            </div>
          </div>
        `;
      }).join('') || '<div class="empty-notifications">No time logged yet</div>';
    
    // Recent entries
    const recentEntries = [...periodEntries]
      .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id))
      .slice(0, 10);
    
    recentList.innerHTML = recentEntries.map(entry => {
      const event = state.events.find(e => e.id === entry.eventId);
      if(!event) return '';
      const platform = event.platform ? event.platform.split(', ')[0] : 'Other';
      const color = platformColors[platform] || platformColors['Other'];
      return `
        <div class="recent-entry">
          <span class="recent-entry-date">${formatDateNice(entry.date)}</span>
          <span class="recent-entry-event">${event.title}</span>
          <span class="recent-entry-platform" style="background:${color}">${platform.replace(/\s*\([^)]*\)/g, '')}</span>
          <span class="recent-entry-hours">${formatHours(entry.hours)}</span>
        </div>
      `;
    }).join('') || '<div class="empty-notifications">No recent entries</div>';
  }
  
  function formatHours(hours) {
    if(hours < 1) {
      return Math.round(hours * 60) + 'm';
    }
    return Math.round(hours * 10) / 10 + 'h';
  }
  
  function bindTimeViewUI() {
    qsa('.time-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        qsa('.time-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        renderTimeView();
      });
    });
  }
  // ============ END TIME TRACKING SYSTEM ============

  // ============ ALERT/NOTIFICATION SYSTEM ============
  const ALERTS_KEY = 'store_calendar.alerts';
  let firedAlerts = lget(ALERTS_KEY) || {}; // Track which alerts have been shown { eventId_alertTime: true }
  let alertCheckInterval = null;
  
  function saveAlerts() {
    lset(ALERTS_KEY, firedAlerts);
  }
  
  // Get alert time in minutes before event
  function getAlertLabel(minutes) {
    if(minutes === '' || minutes === null || minutes === undefined) return null;
    const m = parseInt(minutes);
    if(m === 0) return 'At event time';
    if(m === 15) return '15 min before';
    if(m === 30) return '30 min before';
    if(m === 60) return '1 hour before';
    if(m === 120) return '2 hours before';
    if(m === 1440) return '1 day before';
    if(m === 2880) return '2 days before';
    if(m === 10080) return '1 week before';
    return `${m} min before`;
  }
  
  // Calculate when an alert should fire
  function getAlertFireTime(event) {
    if(!event.alert && event.alert !== 0) return null;
    const alertMinutes = parseInt(event.alert);
    
    // Get event datetime
    const eventDate = event.date;
    const eventTime = event.startTime || '09:00'; // Default to 9 AM if no time set
    const eventDateTime = new Date(`${eventDate}T${eventTime}`);
    
    // Subtract alert minutes
    const alertTime = new Date(eventDateTime.getTime() - (alertMinutes * 60 * 1000));
    return alertTime;
  }
  
  // Check for alerts that need to fire
  function checkAlerts() {
    if(!state || !state.events) return;
    
    const now = new Date();
    const upcomingAlerts = [];
    
    state.events.forEach(ev => {
      if(!ev.alert && ev.alert !== 0) return;
      
      const alertTime = getAlertFireTime(ev);
      if(!alertTime) return;
      
      const alertKey = `${ev.id}_${ev.alert}`;
      const eventDateTime = new Date(`${ev.date}T${ev.startTime || '09:00'}`);
      
      // Check if alert should fire (alert time has passed but event hasn't)
      if(now >= alertTime && now < eventDateTime && !firedAlerts[alertKey]) {
        // Fire the alert!
        firedAlerts[alertKey] = Date.now();
        saveAlerts();
        showToast(ev);
        requestBrowserNotification(ev);
      }
      
      // Collect upcoming alerts for the panel (within next 7 days)
      const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
      if(alertTime > now && alertTime < sevenDaysFromNow && !firedAlerts[alertKey]) {
        upcomingAlerts.push({ event: ev, alertTime, alertKey });
      }
    });
    
    updateNotificationBadge(upcomingAlerts.length);
    return upcomingAlerts;
  }
  
  // Show toast notification
  function showToast(event) {
    let container = qs('.toast-container');
    if(!container) {
      container = document.createElement('div');
      container.className = 'toast-container';
      document.body.appendChild(container);
    }
    
    const toast = document.createElement('div');
    toast.className = 'toast';
    
    const alertLabel = getAlertLabel(event.alert);
    const eventTime = event.startTime ? formatTime(event.startTime) : 'All day';
    
    toast.innerHTML = `
      <div class="toast-icon">🔔</div>
      <div class="toast-body">
        <div class="toast-title">${event.title}</div>
        <div class="toast-message">${alertLabel} • ${eventTime} on ${formatDateNice(event.date)}</div>
      </div>
      <button class="toast-close" aria-label="Dismiss">✕</button>
    `;
    
    const closeBtn = toast.querySelector('.toast-close');
    closeBtn.addEventListener('click', () => toast.remove());
    
    // Click toast to open event
    toast.addEventListener('click', (e) => {
      if(e.target !== closeBtn) {
        openViewModal(event);
        toast.remove();
      }
    });
    
    container.appendChild(toast);
    
    // Auto-dismiss after 10 seconds
    setTimeout(() => {
      if(toast.parentNode) toast.remove();
    }, 10000);
  }
  
  // Request browser notification permission and show
  function requestBrowserNotification(event) {
    if(!('Notification' in window)) return;
    
    if(Notification.permission === 'granted') {
      showBrowserNotification(event);
    } else if(Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if(permission === 'granted') {
          showBrowserNotification(event);
        }
      });
    }
  }
  
  function showBrowserNotification(event) {
    const alertLabel = getAlertLabel(event.alert);
    const eventTime = event.startTime ? formatTime(event.startTime) : 'All day';
    
    const notification = new Notification('Game Plan Alert', {
      body: `${event.title}\n${alertLabel} • ${eventTime}`,
      icon: '📅',
      tag: event.id
    });
    
    notification.onclick = () => {
      window.focus();
      openViewModal(event);
      notification.close();
    };
  }
  
  // Format date nicely
  function formatDateNice(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  
  // Update notification badge
  function updateNotificationBadge(count) {
    const badge = qs('#notification-badge');
    if(!badge) return;
    
    if(count > 0) {
      badge.textContent = count > 99 ? '99+' : count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  }
  
  // Render notifications panel
  function renderNotificationsPanel() {
    const list = qs('#notifications-list');
    if(!list) return;
    
    let upcomingAlerts = checkAlerts() || [];
    
    // Filter out dismissed alerts
    upcomingAlerts = upcomingAlerts.filter(({ alertKey }) => !firedAlerts[alertKey]);
    
    if(upcomingAlerts.length === 0) {
      list.innerHTML = '<div class="empty-notifications">No upcoming alerts</div>';
      updateNotificationBadge(0);
      return;
    }
    
    // Sort by alert time
    upcomingAlerts.sort((a, b) => a.alertTime - b.alertTime);
    
    list.innerHTML = upcomingAlerts.map(({ event, alertTime, alertKey }) => {
      const alertLabel = getAlertLabel(event.alert);
      const eventTime = event.startTime ? formatTime(event.startTime) : 'All day';
      const timeUntil = getTimeUntilAlert(alertTime);
      const platforms = event.platform ? event.platform.split(', ')[0] : 'Other';
      const color = platformColors[platforms] || platformColors['Other'];
      
      return `
        <div class="notification-item" data-event-id="${event.id}">
          <div class="notification-icon" style="color:${color}">📅</div>
          <div class="notification-content">
            <div class="notification-title">${event.title}</div>
            <div class="notification-meta">
              <span class="notification-time">${eventTime} on ${formatDateNice(event.date)}</span>
            </div>
            <div class="notification-meta">
              <span>Alert: ${alertLabel}</span>
              <span class="notification-alert-badge">${timeUntil}</span>
            </div>
          </div>
          <button class="notification-dismiss" data-alert-key="${alertKey}" aria-label="Dismiss">✕</button>
        </div>
      `;
    }).join('');
    
    // Bind click handlers
    list.querySelectorAll('.notification-item').forEach(item => {
      const eventId = item.dataset.eventId;
      item.addEventListener('click', (e) => {
        if(!e.target.classList.contains('notification-dismiss')) {
          const ev = state.events.find(x => x.id === eventId);
          if(ev) openViewModal(ev);
          toggleNotificationsPanel(false);
        }
      });
    });
    
    list.querySelectorAll('.notification-dismiss').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const alertKey = btn.dataset.alertKey;
        firedAlerts[alertKey] = Date.now(); // Mark as dismissed
        saveAlerts();
        renderNotificationsPanel();
      });
    });
  }
  
  // Get human-readable time until alert
  function getTimeUntilAlert(alertTime) {
    const now = new Date();
    const diff = alertTime - now;
    
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);
    
    if(days > 0) return `in ${days}d`;
    if(hours > 0) return `in ${hours}h`;
    if(minutes > 0) return `in ${minutes}m`;
    return 'now';
  }
  
  // Toggle notifications panel
  function toggleNotificationsPanel(show) {
    const panel = qs('#notifications-panel');
    if(!panel) return;
    
    const isVisible = panel.style.display !== 'none';
    
    if(show === undefined) {
      show = !isVisible;
    }
    
    if(show) {
      renderNotificationsPanel();
      panel.style.display = 'block';
      // Close when clicking outside
      setTimeout(() => {
        document.addEventListener('click', closeNotificationsPanelOnClickOutside);
      }, 0);
    } else {
      panel.style.display = 'none';
      document.removeEventListener('click', closeNotificationsPanelOnClickOutside);
    }
  }
  
  function closeNotificationsPanelOnClickOutside(e) {
    const panel = qs('#notifications-panel');
    const btn = qs('#notifications-btn');
    if(panel && !panel.contains(e.target) && !btn.contains(e.target)) {
      toggleNotificationsPanel(false);
    }
  }
  
  // Bind notification UI
  function bindNotificationUI() {
    const btn = qs('#notifications-btn');
    const clearAllBtn = qs('#clear-all-notifications');
    
    btn?.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleNotificationsPanel();
    });
    
    clearAllBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      // Mark all upcoming as dismissed
      const upcomingAlerts = checkAlerts() || [];
      upcomingAlerts.forEach(({ alertKey }) => {
        firedAlerts[alertKey] = Date.now();
      });
      saveAlerts();
      renderNotificationsPanel();
    });
    
    // Start checking alerts every minute
    checkAlerts();
    alertCheckInterval = setInterval(checkAlerts, 60000);
    
    // Request notification permission on first interaction
    document.addEventListener('click', function requestPermissionOnce() {
      if('Notification' in window && Notification.permission === 'default') {
        Notification.requestPermission();
      }
      document.removeEventListener('click', requestPermissionOnce);
    }, { once: true });
  }
  // ============ END ALERT SYSTEM ============

  // Duplicate an event - create a new event with same data but new ID
  async function duplicateEvent(ev) {
    const confirmed = await showDialog('Duplicate this event?', 'confirm');
    if (!confirmed) return;
    
    const newEvent = {
      ...ev,
      id: uid(),
      title: ev.title + ' (Copy)'
    };
    // Deep copy arrays
    if(ev.links) newEvent.links = ev.links.map(l => ({...l}));
    if(ev.assets) newEvent.assets = [...ev.assets];
    if(ev.tags) newEvent.tags = [...ev.tags];
    
    state.events.push(newEvent);
    saveState();
    render();
    renderDayEvents();
    
    // Close view modal if open
    const viewModal = qs('#view-modal');
    if(viewModal) viewModal.setAttribute('aria-hidden', 'true');
    
    // Open edit modal for the duplicated event
    openModalForEdit(newEvent);
  }

  // Default settings
  const defaultSettings = {
    theme: 'dark',
    defaultView: 'month',
    weekStartsOn: 0, // 0 = Sunday, 1 = Monday
    timeFormat: '12h',
    showWeekends: true,
    compactView: false,
    autoTrackStatus: true // Auto-track time on status changes
  };

  // State
  const STATE_KEY = 'store_calendar.v1';
  const SETTINGS_KEY = 'store_calendar.settings';
  let state = lget(STATE_KEY) || null;
  let settings = lget(SETTINGS_KEY) || {...defaultSettings};
  // Ensure all settings exist (for upgrades)
  settings = {...defaultSettings, ...settings};
  lset(SETTINGS_KEY, settings);
  
  const defaultTheme = settings.theme || 'dark';
  let currentView = localStorage.getItem('currentView') || settings.defaultView || 'month';
  if(!state){
    state = {
      events: seedEvents(),
      selectedDate: toLocalDate(new Date()),
      filterPlatforms: [],
      search: '',
      theme: defaultTheme
    };
    lset(STATE_KEY, state);
  } else if(!state.theme){
    state.theme = defaultTheme;
    lset(STATE_KEY, state);
  }

  // Migration: remove any events that reference the old 'Web' platform
  if(Array.isArray(state.events)){
    const hadWeb = state.events.some(e => (e.platform||'').toLowerCase().includes('web'));
    if(hadWeb){
      state.events = state.events.filter(e => !((e.platform||'').toLowerCase().includes('web')));
      lset(STATE_KEY, state);
    }
  }

  // Elements
  const monthGrid = qs('#month-grid');
  const weekGrid = qs('#week-grid');
  const dayView = qs('#day-view');
  const gridView = qs('#grid-view');
  const monthLabel = qs('#month-label');
  const prevBtn = qs('#prev-month');
  const nextBtn = qs('#next-month');
  const todayBtn = qs('#today');
  const addBtn = qs('#add-event');
  const modal = qs('#modal');
  const modalOverlay = qs('#modal-overlay');
  const modalClose = qs('#modal-close');
  const form = qs('#event-form');
  const fldDate = qs('#fld-date');
  const fldEndDate = qs('#fld-enddate');
  const fldTitle = qs('#fld-title');
  const fldId = qs('#fld-id');
  const fldStart = qs('#fld-start');
  const fldEnd = qs('#fld-end');
  const fldFrequency = qs('#fld-frequency');
  const fldSlot = qs('#fld-slot');
  const fldHeadline = qs('#fld-headline');
  const fldSub = qs('#fld-sub');
  const fldLoc = qs('#fld-loc');
  const fldNotes = qs('#fld-notes');
  const fldTags = qs('#fld-tags');
  const dayEvents = qs('#day-events');
  const selectedDay = qs('#selected-day');
  const monthGridNode = monthGrid;
  const searchInput = qs('#search');
  const platformFilters = qs('#platform-filters');
  const exportBtn = qs('#export-json');
  const exportCsvBtn = qs('#export-csv');
  const importInput = qs('#import-file');
  const themeToggle = qs('#theme-toggle');
  
  // Settings elements
  const settingsBtn = qs('#settings-btn');
  const settingsModal = qs('#settings-modal');
  const settingsModalOverlay = qs('#settings-modal-overlay');
  const settingsModalClose = qs('#settings-modal-close');
  const settingTheme = qs('#setting-theme');
  const settingDefaultView = qs('#setting-default-view');
  const settingWeekStart = qs('#setting-week-start');
  const settingTimeFormat = qs('#setting-time-format');
  const settingShowWeekends = qs('#setting-show-weekends');
  const settingCompactView = qs('#setting-compact-view');
  const settingAutoTrackStatus = qs('#setting-auto-track-status');
  const settingsReset = qs('#settings-reset');
  const settingsSave = qs('#settings-save');

  // View modal elements
  const viewModal = qs('#view-modal');
  const viewModalOverlay = qs('#view-modal-overlay');
  const viewModalClose = qs('#view-modal-close');
  const viewEditBtn = qs('#view-edit');
  const viewDeleteBtn = qs('#view-delete');
  let viewingEvent = null;

  // Calendar view state
  let viewDate = new Date(state.selectedDate);
  let editingEventId = null;

  // Init
  applyTheme(settings.theme === 'system' ? getSystemTheme() : settings.theme);
  applySettings();
  renderPlatformChips();
  bindUI();
  bindSettingsUI();
  bindViewModalUI();
  bindDialogUI();
  bindNotificationUI();
  bindTimerUI();
  bindTimeViewUI();
  bindWelcomeModal();
  render();
  renderDayEvents();
  showWelcomeIfNeeded();

  // --- functions ---
  
  // Welcome Modal
  function showWelcomeIfNeeded() {
    const hideWelcome = localStorage.getItem('store_calendar.hideWelcome');
    if (hideWelcome !== 'true') {
      showWelcomeModal();
    }
  }
  
  function showWelcomeModal() {
    const modal = qs('#welcome-modal');
    const dontShow = qs('#welcome-dont-show');
    if (modal) {
      // Reset the checkbox when showing
      if (dontShow) dontShow.checked = false;
      modal.removeAttribute('aria-hidden');
      modal.style.display = 'block';
      // Focus the get started button after modal is visible
      setTimeout(() => qs('#welcome-get-started')?.focus(), 0);
    }
  }
  
  function closeWelcomeModal() {
    const modal = qs('#welcome-modal');
    const dontShow = qs('#welcome-dont-show');
    if (dontShow && dontShow.checked) {
      localStorage.setItem('store_calendar.hideWelcome', 'true');
    }
    if (modal) {
      modal.style.display = 'none';
      modal.setAttribute('aria-hidden', 'true');
    }
  }
  
  function bindWelcomeModal() {
    qs('#welcome-get-started')?.addEventListener('click', closeWelcomeModal);
    qs('#welcome-modal-close')?.addEventListener('click', closeWelcomeModal);
    qs('#welcome-modal-overlay')?.addEventListener('click', closeWelcomeModal);
  }
  
  function seedEvents(){
    // 8 seed events across dates
    const today = new Date();
    const to = d=>toLocalDate(d);
    const e = (d,title,platform,slot,endD)=>({
      id: uid(), date: to(d), endDate: endD?to(endD):null, title, platform, slotNumber: slot||0, headline:'', subHeadline:'', targeting:'', locLink:'', links:[], assets:[], notes:'', tags:[]
    });
    return [
      e(new Date(today), 'Launch Banner', 'Xbox desktop app (Garrison)', 1),
      e(new Date(today.getFullYear(), today.getMonth(), today.getDate()+1), 'Console Spotlight', 'Console', 2),
      e(new Date(today.getFullYear(), today.getMonth(), today.getDate()+2), 'Mobile Store Spotlight', 'Mobile Store Spotlight', 3, new Date(today.getFullYear(), today.getMonth(), today.getDate()+3)),
      e(new Date(today.getFullYear(), today.getMonth(), today.getDate()-3), 'Holiday Tile', 'Xbox desktop app (Garrison)', 0),
      e(new Date(today.getFullYear(), today.getMonth(), 1), 'Month Start', 'Other', 4, new Date(today.getFullYear(), today.getMonth(), 5)),
      e(new Date(today.getFullYear(), today.getMonth(), 15), 'Mid-month Event', 'Xbox desktop app (Garrison)', 0),
      e(new Date(today.getFullYear(), today.getMonth()+1, 2), 'Next Month Teaser', 'Console', 1),
      e(new Date(today.getFullYear(), today.getMonth(), today.getDate()+6), 'Week Promo', 'Other', 2, new Date(today.getFullYear(), today.getMonth(), today.getDate()+8))
    ];
  }

  function bindUI(){
    prevBtn.addEventListener('click', ()=>{ 
      if(currentView==='month' || currentView==='grid') viewDate.setMonth(viewDate.getMonth()-1); 
      else if(currentView==='week') viewDate.setDate(viewDate.getDate()-7);
      else if(currentView==='day') viewDate.setDate(viewDate.getDate()-1);
      else if(currentView==='time') viewDate.setMonth(viewDate.getMonth()-1);
      render(); 
    });
    nextBtn.addEventListener('click', ()=>{ 
      if(currentView==='month' || currentView==='grid') viewDate.setMonth(viewDate.getMonth()+1); 
      else if(currentView==='week') viewDate.setDate(viewDate.getDate()+7);
      else if(currentView==='day') viewDate.setDate(viewDate.getDate()+1);
      else if(currentView==='time') viewDate.setMonth(viewDate.getMonth()+1);
      render(); 
    });
    todayBtn.addEventListener('click', ()=>{ viewDate = new Date(); render(); });
    addBtn.addEventListener('click', ()=>openModalForNew());
    modalClose.addEventListener('click', closeModal);
    modalOverlay.addEventListener('click', closeModal);
    form.addEventListener('submit', onSave);
    // Bind all cancel buttons (top and bottom)
    qsa('.cancel-btn').forEach(btn => btn.addEventListener('click', closeModal));
    qs('#add-link').addEventListener('click', addLinkField);
    qs('#add-asset').addEventListener('click', addAssetField);
    searchInput.addEventListener('input', ()=>{ state.search = searchInput.value.trim().toLowerCase(); saveState(); render(); renderDayEvents(); });
    exportBtn.addEventListener('click', onExportJSON);
    exportCsvBtn?.addEventListener('click', onExportCSV);
    importInput.addEventListener('change', onImport);
    themeToggle.addEventListener('click', toggleTheme);
    document.addEventListener('keydown', e=>{ if(e.key==='Escape') closeModal(); });
    // Add event on selected day button
    qs('#add-event-day')?.addEventListener('click', ()=>{ openModalForNew(state.selectedDate || toLocalDate(new Date())); });
    // View toggle buttons
    qsa('.view-btn').forEach(btn=>btn.addEventListener('click', ()=>{ currentView = btn.dataset.view; localStorage.setItem('currentView', currentView); render(); }));
  }

  function addLinkField(){
    const linksList = qs('#links-list');
    const container = document.createElement('div'); container.className='repeat-item'; container.style.display='flex'; container.style.gap='4px';
    const label = document.createElement('input'); label.type='text'; label.placeholder='Label'; label.style.flex='1';
    const url = document.createElement('input'); url.type='url'; url.placeholder='URL'; url.style.flex='1';
    const remove = document.createElement('button'); remove.type='button'; remove.textContent='✕'; remove.addEventListener('click', ()=>container.remove());
    container.appendChild(label); container.appendChild(url); container.appendChild(remove);
    linksList.appendChild(container);
  }

  function addAssetField(){
    const assetsList = qs('#assets-list');
    const container = document.createElement('div'); container.className='repeat-item'; container.style.display='flex'; container.style.gap='4px';
    const url = document.createElement('input'); url.type='url'; url.placeholder='Asset URL'; url.style.flex='1';
    const remove = document.createElement('button'); remove.type='button'; remove.textContent='✕'; remove.addEventListener('click', ()=>container.remove());
    container.appendChild(url); container.appendChild(remove);
    assetsList.appendChild(container);
  }

  function saveState(){ lset(STATE_KEY, state); }

  function renderPlatformChips(){
    // Build platform list from the form checkboxes so the selector matches the form options
    const boxes = qsa('input[name="platforms"]');
    const platforms = [];
    boxes.forEach(cb=>{ if(cb && cb.value && !platforms.includes(cb.value)) platforms.push(cb.value); });

    platformFilters.innerHTML='';
    const all = document.createElement('button');
    all.textContent='All'; all.className='chip';
    all.addEventListener('click', ()=>{ state.filterPlatforms=[]; saveState(); render(); renderPlatformChips(); renderDayEvents(); });
    platformFilters.appendChild(all);

    platforms.forEach(p=>{
      const btn = document.createElement('button'); btn.textContent=p; btn.className='chip';
      btn.style.borderColor = platformColors[p] || platformColors['Other'];
      const active = state.filterPlatforms.includes(p);
      if(active){
        btn.classList.add('active');
        btn.style.backgroundColor = platformColors[p] || platformColors['Other'];
        btn.style.color = 'white';
      }
      btn.addEventListener('click', ()=>{
        if(state.filterPlatforms.includes(p)) state.filterPlatforms = state.filterPlatforms.filter(x=>x!==p); else state.filterPlatforms.push(p);
        saveState(); render(); renderPlatformChips(); renderDayEvents();
      });
      platformFilters.appendChild(btn);
    });
  }

  function openModalForNew(dateStr){
    editingEventId = null;
    qs('#modal-title').textContent = 'Add Event';
    form.reset();
    fldDate.value = dateStr || state.selectedDate || toLocalDate(new Date());
    fldId.value = uid();
    if(fldFrequency) fldFrequency.value = 'One-time';
    // Clear time tracking fields
    const fldEstimated = qs('#fld-estimated-time');
    const fldActual = qs('#fld-actual-time');
    if(fldEstimated) fldEstimated.value = '';
    if(fldActual) fldActual.value = '';
    // Clear time entries list and manual entry inputs
    const entriesList = qs('#time-entries-list');
    if(entriesList) entriesList.innerHTML = '<p class="empty-message" style="color:var(--muted);font-size:0.85rem;text-align:center;padding:8px;">Save the event first, then log time.</p>';
    const manualHours = qs('#manual-time-hours');
    const manualNote = qs('#manual-time-note');
    if(manualHours) manualHours.value = '';
    if(manualNote) manualNote.value = '';
    showModal();
  }

  function openModalForEdit(ev){
    editingEventId = ev.id;
    qs('#modal-title').textContent = 'Edit Event';
    fldDate.value = ev.date;
    fldEndDate.value = ev.endDate||'';
    const fldType = qs('#fld-type'); if(fldType) fldType.value = ev.eventType || 'Regular';
    if(fldFrequency) fldFrequency.value = ev.frequency || '';
    const fldRecurrence = qs('#fld-recurrence'); if(fldRecurrence) fldRecurrence.value = ev.recurrence || '';
    fldTitle.value = ev.title||'';
    fldId.value = ev.id||'';
    const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : [];
    qsa('input[name="platforms"]').forEach(cb=>{
      cb.checked = platforms.includes(cb.value);
    });
    fldStart.value = ev.startTime||'';
    fldEnd.value = ev.endTime||'';
    fldSlot.value = ev.slotNumber||'';
    fldHeadline.value = ev.headline||'';
    fldSub.value = ev.subHeadline||'';
    // Status fields
    const preProdSelect = qs('#fld-preprod-status');
    const prodSelect = qs('#fld-prod-status');
    if(preProdSelect) preProdSelect.value = ev.preProdStatus || '';
    if(prodSelect) prodSelect.value = ev.prodStatus || '';
    // Alert field
    const fldAlert = qs('#fld-alert');
    if(fldAlert) fldAlert.value = ev.alert !== undefined && ev.alert !== null ? ev.alert : '';
    fldLoc.value = ev.locLink||'';
    const fldAdo = qs('#fld-ado'); if(fldAdo) fldAdo.value = ev.adoLink||'';
    fldNotes.value = ev.notes||'';
    fldTags.value = (ev.tags||[]).join(',');
    qs('#links-list').innerHTML='';
    (ev.links||[]).forEach(link=>{
      const container = document.createElement('div'); container.className='repeat-item'; container.style.display='flex'; container.style.gap='4px';
      const label = document.createElement('input'); label.type='text'; label.value=link.label||''; label.placeholder='Label'; label.style.flex='1';
      const url = document.createElement('input'); url.type='url'; url.value=link.url||''; url.placeholder='URL'; url.style.flex='1';
      const remove = document.createElement('button'); remove.type='button'; remove.textContent='✕'; remove.addEventListener('click', ()=>container.remove());
      container.appendChild(label); container.appendChild(url); container.appendChild(remove);
      qs('#links-list').appendChild(container);
    });
    qs('#assets-list').innerHTML='';
    (ev.assets||[]).forEach(asset=>{
      const container = document.createElement('div'); container.className='repeat-item'; container.style.display='flex'; container.style.gap='4px';
      const url = document.createElement('input'); url.type='url'; url.value=asset||''; url.placeholder='Asset URL'; url.style.flex='1';
      const remove = document.createElement('button'); remove.type='button'; remove.textContent='✕'; remove.addEventListener('click', ()=>container.remove());
      container.appendChild(url); container.appendChild(remove);
      qs('#assets-list').appendChild(container);
    });
    // Time tracking fields
    const fldEstimated = qs('#fld-estimated-time');
    const fldActual = qs('#fld-actual-time');
    if(fldEstimated) fldEstimated.value = ev.estimatedTime || '';
    if(fldActual) fldActual.value = ev.actualTime || '';
    // Render time entries for this event
    renderEventTimeEntries(ev.id);
    showModal();
  }

  function showModal(){
    modal.setAttribute('aria-hidden','false');
    modal.style.display='block';
    setTimeout(()=>qs('#fld-title').focus(),40);
  }

  function closeModal(){
    modal.setAttribute('aria-hidden','true');
    modal.style.display='none';
  }

  async function onSave(e){
    e.preventDefault();
    const id = fldId.value.trim() || uid();
    const date = fldDate.value;
    if(!date){ await showDialog('Date is required', 'error'); return; }
    const title = fldTitle.value.trim();
    if(!title){ await showDialog('Title is required', 'error'); return; }

    const platforms = Array.from(qsa('input[name="platforms"]:checked')).map(cb=>cb.value);
    const platform = platforms.length > 0 ? platforms.join(', ') : 'Other';

    const links = Array.from(qs('#links-list').querySelectorAll('.repeat-item')).map(item=>{
      const inputs = item.querySelectorAll('input');
      return {label: inputs[0].value.trim(), url: inputs[1].value.trim()};
    }).filter(l=>l.label && l.url);

    const assets = Array.from(qs('#assets-list').querySelectorAll('.repeat-item')).map(item=>{
      const input = item.querySelector('input');
      return input.value.trim();
    }).filter(Boolean);

    const estimatedTime = parseFloat(qs('#fld-estimated-time')?.value) || 0;
    const actualTime = parseFloat(qs('#fld-actual-time')?.value) || 0;
    
    const newPreProdStatus = qs('#fld-preprod-status')?.value || '';
    const newProdStatus = qs('#fld-prod-status')?.value || '';

    const obj = {
      id, date, endDate: fldEndDate.value||null, eventType: qs('#fld-type')?.value || 'Regular', frequency: Number(fldFrequency?.value) || 0, recurrence: qs('#fld-recurrence')?.value || '', title, platform, startTime: fldStart.value, endTime: fldEnd.value,
      slotNumber: Number(fldSlot.value)||0, headline: fldHeadline.value, subHeadline: fldSub.value,
      preProdStatus: newPreProdStatus, prodStatus: newProdStatus,
      alert: qs('#fld-alert')?.value !== '' ? Number(qs('#fld-alert')?.value) : null,
      locLink: fldLoc.value, adoLink: qs('#fld-ado')?.value || '', notes: fldNotes.value, tags: fldTags.value.split(',').map(s=>s.trim()).filter(Boolean), links, assets,
      estimatedTime, actualTime
    };

    if(editingEventId){
      const idx = state.events.findIndex(x=>x.id===editingEventId);
      if(idx>-1) {
        const existingEvent = state.events[idx];
        
        // Auto-track time on status changes (if enabled)
        const now = Date.now();
        const autoTrack = settings.autoTrackStatus !== false;
        
        // Terminal/completion statuses - time stops when reaching these
        const preProdCompleteStatuses = ['Ready for production', 'Canceled'];
        const prodCompleteStatuses = ['Cooked and booked', 'Canceled'];
        
        // Check pre-production status change
        if(autoTrack && existingEvent.preProdStatus && newPreProdStatus && existingEvent.preProdStatus !== newPreProdStatus) {
          // Only log time if we're NOT coming from a complete status (can't re-start a finished task)
          if(!preProdCompleteStatuses.includes(existingEvent.preProdStatus)) {
            const startTime = existingEvent.preProdStatusChangedAt || existingEvent.createdAt || now;
            const hours = (now - startTime) / (1000 * 60 * 60);
            if(hours >= 0.01) { // At least ~30 seconds
              const isComplete = preProdCompleteStatuses.includes(newPreProdStatus);
              const label = isComplete 
                ? `Pre-prod complete: ${existingEvent.preProdStatus} → ${newPreProdStatus} ✓`
                : `Pre-prod: ${existingEvent.preProdStatus} → ${newPreProdStatus}`;
              addTimeEntry(id, hours, label);
            }
          }
        }
        
        // Check production status change
        if(autoTrack && existingEvent.prodStatus && newProdStatus && existingEvent.prodStatus !== newProdStatus) {
          // Only log time if we're NOT coming from a complete status
          if(!prodCompleteStatuses.includes(existingEvent.prodStatus)) {
            const startTime = existingEvent.prodStatusChangedAt || existingEvent.createdAt || now;
            const hours = (now - startTime) / (1000 * 60 * 60);
            if(hours >= 0.01) { // At least ~30 seconds
              const isComplete = prodCompleteStatuses.includes(newProdStatus);
              const label = isComplete
                ? `Prod complete: ${existingEvent.prodStatus} → ${newProdStatus} ✓`
                : `Prod: ${existingEvent.prodStatus} → ${newProdStatus}`;
              addTimeEntry(id, hours, label);
            }
          }
        }
        
        // Update status change timestamps (only if NOT moving to a complete status - timer stops)
        if(existingEvent.preProdStatus !== newPreProdStatus) {
          // If moving to complete status, don't update timestamp (timer is stopped)
          // If moving away from complete status, start fresh timer
          obj.preProdStatusChangedAt = preProdCompleteStatuses.includes(newPreProdStatus) ? null : now;
        } else {
          obj.preProdStatusChangedAt = existingEvent.preProdStatusChangedAt;
        }
        
        if(existingEvent.prodStatus !== newProdStatus) {
          // If moving to complete status, don't update timestamp (timer is stopped)
          obj.prodStatusChangedAt = prodCompleteStatuses.includes(newProdStatus) ? null : now;
        } else {
          obj.prodStatusChangedAt = existingEvent.prodStatusChangedAt;
        }
        
        // Preserve createdAt
        obj.createdAt = existingEvent.createdAt;
        
        state.events[idx] = Object.assign(existingEvent, obj);
      }
    } else {
      // New event - set initial timestamps
      const now = Date.now();
      obj.createdAt = now;
      if(newPreProdStatus) obj.preProdStatusChangedAt = now;
      if(newProdStatus) obj.prodStatusChangedAt = now;
      state.events.push(obj);
    }
    saveState(); closeModal(); render(); renderDayEvents(); renderPlatformChips();
  }

  function render(){
    const timeView = qs('#time-view');
    const dashboardView = qs('#dashboard-view');
    const viewLabel = qs('#current-view-label');
    monthGrid.style.display = currentView==='month'?'grid':'none';
    weekGrid.style.display = currentView==='week'?'grid':'none';
    dayView.style.display = currentView==='day'?'block':'none';
    gridView.style.display = currentView==='grid'?'block':'none';
    if(timeView) timeView.style.display = currentView==='time'?'block':'none';
    if(dashboardView) dashboardView.style.display = currentView==='dashboard'?'block':'none';
    // Update active button
    qsa('.view-btn').forEach(b=>b.classList.toggle('active', b.dataset.view===currentView));
    // Update current view label
    const viewLabels = { month: '📅 Month View', week: '📆 Week View', day: '📋 Day View', grid: '📊 Grid View', time: '⏱️ Time View', dashboard: '📊 Dashboard' };
    if(viewLabel) viewLabel.textContent = viewLabels[currentView] || currentView;
    // Sync selectedDate with viewDate when in day view
    if(currentView==='day') {
      state.selectedDate = toLocalDate(viewDate);
      saveState();
      renderDayEvents();
    }
    if(currentView==='month') renderCalendar();
    else if(currentView==='week') renderWeekView();
    else if(currentView==='day') renderDayView();
    else if(currentView==='grid') renderGridView();
    else if(currentView==='time') renderTimeView();
    else if(currentView==='dashboard') renderDashboard();
  }

  function renderWeekView(){
    weekGrid.innerHTML='';
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const date = viewDate.getDate();
    // Get start of the current week based on settings
    const curr = new Date(year, month, date);
    let dayOffset = curr.getDay();
    if(settings.weekStartsOn === 1) {
      dayOffset = dayOffset === 0 ? 6 : dayOffset - 1;
    }
    const first = curr.getDate() - dayOffset;
    const weekStart = new Date(year, month, first);
    const dayNames = getDayNames();
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    
    const weekEnd = new Date(weekStart); weekEnd.setDate(weekStart.getDate() + 6);
    monthLabel.textContent = `Week of ${monthNames[weekStart.getMonth()]} ${weekStart.getDate()} - ${weekEnd.getDate()}`;
    
    for(let i=0;i<7;i++){
      const d = new Date(weekStart); d.setDate(weekStart.getDate()+i);
      // Skip weekends if setting is off
      if(!settings.showWeekends && (d.getDay() === 0 || d.getDay() === 6)) continue;
      
      const iso = toLocalDate(d);
      const dayNode = document.createElement('div'); dayNode.className='week-day';
      const header = document.createElement('div'); header.className='week-day-header';
      const dayIndex = settings.weekStartsOn === 1 ? (d.getDay() === 0 ? 6 : d.getDay() - 1) : d.getDay();
      header.innerHTML = `<div>${dayNames[dayIndex]}</div><div>${d.getDate()}</div>`;
      dayNode.appendChild(header);
      
      const evs = state.events.filter(ev=>eventCoversDay(ev, iso) && applyFilters(ev));
      evs.slice(0,8).forEach(ev=>{
        const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
        const color = platformColors[platforms[0]] || platformColors['Other'];
        const b = document.createElement('button'); b.className='week-event';
        b.textContent = ev.title;
        b.style.backgroundColor = color;
        b.title = ev.title;
        b.addEventListener('click', ()=>{ state.selectedDate = iso; saveState(); renderDayEvents(); openViewModal(ev); });
        dayNode.appendChild(b);
      });
      
      if(iso === toLocalDate(new Date())) dayNode.style.borderColor = 'var(--accent)';
      dayNode.addEventListener('click', ()=>{ state.selectedDate = iso; saveState(); renderDayEvents(); });
      dayNode.addEventListener('dblclick', ()=>{ state.selectedDate = iso; saveState(); openModalForNew(iso); });
      weekGrid.appendChild(dayNode);
    }
  }

  function renderDayView(){
    dayView.innerHTML='';
    const iso = toLocalDate(viewDate);
    const dateObj = new Date(iso + 'T00:00:00');
    
    // Update month label to show current day
    monthLabel.textContent = dateObj.toLocaleDateString(undefined, {weekday:'long', month:'long', day:'numeric', year:'numeric'});
    
    const header = document.createElement('div'); header.className='day-view-header';
    header.textContent = dateObj.toLocaleDateString(undefined, {weekday:'long',month:'long',day:'numeric',year:'numeric'});
    dayView.appendChild(header);
    
    const events = eventsForDay(iso).filter(applyFilters).sort((a,b)=>{
      if(!a.startTime && !b.startTime) return a.slotNumber-b.slotNumber;
      if(!a.startTime) return 1;
      if(!b.startTime) return -1;
      return a.startTime.localeCompare(b.startTime);
    });
    
    if(events.length===0){
      const empty = document.createElement('div'); empty.className='empty-state'; empty.textContent='No events for this day';
      dayView.appendChild(empty);
      return;
    }
    
    // Group by time slot
    const byTime = {};
    events.forEach(ev=>{
      const key = ev.startTime || 'All day';
      if(!byTime[key]) byTime[key] = [];
      byTime[key].push(ev);
    });
    
    Object.keys(byTime).sort().forEach(timeSlot=>{
      const slotDiv = document.createElement('div'); slotDiv.className='day-time-slot';
      const timeLabel = document.createElement('div'); timeLabel.className='day-time-label'; 
      timeLabel.textContent = timeSlot === 'All day' ? timeSlot : formatTime(timeSlot);
      const eventsDiv = document.createElement('div'); eventsDiv.className='day-events-at-time';
      
      byTime[timeSlot].forEach(ev=>{
        const card = document.createElement('div'); card.className='day-time-event'; card.style.cursor='pointer';
        const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
        card.style.borderLeftColor = platformColors[platforms[0]] || platformColors['Other'];
        
        const title = document.createElement('div'); title.className='day-time-event-title'; title.textContent = ev.title;
        card.appendChild(title);
        
        if(platforms.length>0){
          const platformsDiv = document.createElement('div'); platformsDiv.className='day-time-event-platforms'; platformsDiv.textContent = platforms.join(', ');
          card.appendChild(platformsDiv);
        }
        
        if(ev.endTime) {
          const timeRange = document.createElement('div'); timeRange.style.fontSize='0.75rem'; timeRange.style.color='var(--muted)'; timeRange.style.marginTop='2px';
          timeRange.textContent = `${formatTime(ev.startTime)||'--'} - ${formatTime(ev.endTime)||'--'}`;
          card.appendChild(timeRange);
        }
        
        // Click card to view details\n        card.addEventListener('click', (e)=>{ if(e.target.tagName!=='BUTTON') openViewModal(ev); });
        
        // Quick actions
        const actions = document.createElement('div'); actions.style.display='flex'; actions.style.gap='4px'; actions.style.marginTop='4px';
        const edit = document.createElement('button'); edit.textContent='Edit'; edit.style.fontSize='0.75rem'; edit.style.padding='2px 6px'; edit.style.background='var(--accent)'; edit.style.color='white'; edit.style.border='none'; edit.style.borderRadius='3px'; edit.style.cursor='pointer';
        edit.addEventListener('click', (e)=>{ e.stopPropagation(); openModalForEdit(ev); });
        const del = document.createElement('button'); del.textContent='Delete'; del.style.fontSize='0.75rem'; del.style.padding='2px 6px'; del.style.background='var(--danger)'; del.style.color='white'; del.style.border='none'; del.style.borderRadius='3px'; del.style.cursor='pointer';
        del.addEventListener('click', async (e)=>{ e.stopPropagation(); if(await showDialog('Delete event?', 'delete')){ state.events = state.events.filter(x=>x.id!==ev.id); saveState(); render(); renderDayEvents(); } });
        actions.appendChild(edit); actions.appendChild(del);
        card.appendChild(actions);
        
        eventsDiv.appendChild(card);
      });
      
      slotDiv.appendChild(timeLabel); slotDiv.appendChild(eventsDiv);
      dayView.appendChild(slotDiv);
    });
  }

  // Dashboard rendering
  function renderDashboard() {
    const timestamp = qs('#dashboard-timestamp');
    const today = new Date();
    const todayStr = toLocalDate(today);
    
    // Update timestamp
    if(timestamp) timestamp.textContent = today.toLocaleString();
    
    // Update month label
    monthLabel.textContent = 'All Events Overview';
    
    const allEvents = state.events;
    const completedStatuses = ['Cooked and booked'];
    const canceledStatuses = ['Canceled'];
    
    // Calculate KPIs
    const totalEvents = allEvents.length;
    const completedEvents = allEvents.filter(e => e.prodStatus === 'Cooked and booked').length;
    const canceledEvents = allEvents.filter(e => e.preProdStatus === 'Canceled' || e.prodStatus === 'Canceled').length;
    const activeEvents = totalEvents - completedEvents - canceledEvents;
    const completionRate = totalEvents > 0 ? Math.round((completedEvents / totalEvents) * 100) : 0;
    const totalHours = timeEntries.reduce((sum, e) => sum + e.hours, 0);
    
    // Update KPI cards
    const kpiTotal = qs('#kpi-total-events');
    const kpiActive = qs('#kpi-active-events');
    const kpiCompleted = qs('#kpi-completed-events');
    const kpiRate = qs('#kpi-completion-rate');
    const kpiTime = qs('#kpi-total-hours');
    
    if(kpiTotal) kpiTotal.textContent = totalEvents;
    if(kpiActive) kpiActive.textContent = activeEvents;
    if(kpiCompleted) kpiCompleted.textContent = completedEvents;
    if(kpiRate) kpiRate.textContent = completionRate + '%';
    if(kpiTime) kpiTime.textContent = formatHours(totalHours);
    
    // Render Pipeline
    renderPipeline();
    
    // Render Platform Chart
    renderPlatformChart();
    
    // Render Deadlines
    renderDeadlines();
    
    // Render Month Stats
    renderMonthStats();
    
    // Render Data Quality
    renderDataQuality();
    
    // Render Recent Events
    renderRecentEvents();
  }
  
  function renderPipeline() {
    const preProdContainer = qs('#pipeline-preprod');
    const prodContainer = qs('#pipeline-prod');
    
    if(!preProdContainer || !prodContainer) return;
    
    const allEvents = state.events;
    
    // Pre-production stages
    const preProdStages = [
      { status: 'Planning', class: 'planning', label: 'Planning' },
      { status: 'Pending assets', class: 'pending', label: 'Pending Assets' },
      { status: 'Ready for production', class: 'ready', label: 'Ready' }
    ];
    
    preProdContainer.innerHTML = preProdStages.map((stage, i) => {
      const count = allEvents.filter(e => e.preProdStatus === stage.status).length;
      const arrow = i < preProdStages.length - 1 ? '<div class="pipeline-arrow">→</div>' : '';
      return `<div class="pipeline-stage ${stage.class}">
        <div class="pipeline-stage-count">${count}</div>
        <div class="pipeline-stage-label">${stage.label}</div>
      </div>${arrow}`;
    }).join('');
    
    // Production stages
    const prodStages = [
      { status: 'Build is cooking', class: 'cooking', label: 'Cooking' },
      { status: 'In QC', class: 'qc', label: 'In QC' },
      { status: 'Cooked and booked', class: 'published', label: 'Published' }
    ];
    
    prodContainer.innerHTML = prodStages.map((stage, i) => {
      const count = allEvents.filter(e => e.prodStatus === stage.status).length;
      const arrow = i < prodStages.length - 1 ? '<div class="pipeline-arrow">→</div>' : '';
      return `<div class="pipeline-stage ${stage.class}">
        <div class="pipeline-stage-count">${count}</div>
        <div class="pipeline-stage-label">${stage.label}</div>
      </div>${arrow}`;
    }).join('');
  }
  
  function renderPlatformChart() {
    const container = qs('#dashboard-platform-chart');
    if(!container) return;
    
    const allEvents = state.events;
    const platformCounts = {};
    
    allEvents.forEach(ev => {
      const platforms = ev.platform ? ev.platform.split(', ').map(p => p.trim()) : ['Other'];
      platforms.forEach(p => {
        platformCounts[p] = (platformCounts[p] || 0) + 1;
      });
    });
    
    const sorted = Object.entries(platformCounts).sort((a, b) => b[1] - a[1]);
    const maxCount = sorted.length > 0 ? sorted[0][1] : 1;
    
    if(sorted.length === 0) {
      container.innerHTML = '<div class="empty-state">No platform data</div>';
      return;
    }
    
    container.innerHTML = sorted.map(([platform, count]) => {
      const pct = Math.round((count / maxCount) * 100);
      const color = platformColors[platform] || platformColors['Other'];
      return `<div class="platform-bar">
        <div class="platform-bar-label" title="${platform}">${platform}</div>
        <div class="platform-bar-track">
          <div class="platform-bar-fill" style="width:${pct}%;background:${color}"></div>
        </div>
        <div class="platform-bar-count">${count}</div>
      </div>`;
    }).join('');
  }
  
  function renderDeadlines() {
    const container = qs('#dashboard-deadlines');
    if(!container) return;
    
    const today = new Date();
    const todayStr = toLocalDate(today);
    
    // Get events with end dates in the future that aren't completed
    const upcoming = state.events
      .filter(e => {
        const endDate = e.endDate || e.date;
        return endDate >= todayStr && e.prodStatus !== 'Cooked and booked' && e.prodStatus !== 'Canceled';
      })
      .map(e => {
        const endDate = new Date((e.endDate || e.date) + 'T23:59:59');
        const diffMs = endDate - today;
        const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
        return { ...e, daysLeft: diffDays, endDateStr: e.endDate || e.date };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 8);
    
    if(upcoming.length === 0) {
      container.innerHTML = '<div class="empty-state">No upcoming deadlines</div>';
      return;
    }
    
    container.innerHTML = upcoming.map(ev => {
      let urgency = 'normal';
      let daysText = ev.daysLeft + ' days';
      if(ev.daysLeft <= 0) {
        urgency = 'urgent';
        daysText = ev.daysLeft === 0 ? 'Today!' : Math.abs(ev.daysLeft) + ' days ago';
      } else if(ev.daysLeft <= 3) {
        urgency = 'urgent';
      } else if(ev.daysLeft <= 7) {
        urgency = 'soon';
      }
      
      return `<div class="deadline-item ${urgency}">
        <div class="deadline-title" title="${ev.title}">${ev.title}</div>
        <div class="deadline-date">${ev.endDateStr}</div>
        <div class="deadline-days ${urgency}">${daysText}</div>
      </div>`;
    }).join('');
  }
  
  function renderMonthStats() {
    const monthCreated = qs('#month-created');
    const monthCompleted = qs('#month-completed');
    const monthUpcoming = qs('#month-upcoming');
    
    if(!monthCreated) return;
    
    const today = new Date();
    const monthStart = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-01`;
    const monthEnd = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${new Date(today.getFullYear(), today.getMonth()+1, 0).getDate()}`;
    const todayStr = toLocalDate(today);
    
    // Events created this month (using date field as proxy)
    const created = state.events.filter(e => e.date >= monthStart && e.date <= monthEnd).length;
    
    // Completed this month
    const completed = state.events.filter(e => {
      const endDate = e.endDate || e.date;
      return endDate >= monthStart && endDate <= monthEnd && e.prodStatus === 'Cooked and booked';
    }).length;
    
    // Upcoming this month
    const upcoming = state.events.filter(e => {
      const startDate = e.date;
      return startDate >= todayStr && startDate <= monthEnd && e.prodStatus !== 'Cooked and booked';
    }).length;
    
    monthCreated.textContent = created;
    monthCompleted.textContent = completed;
    monthUpcoming.textContent = upcoming;
  }
  
  function renderDataQuality() {
    const container = qs('#data-quality');
    if(!container) return;
    
    const allEvents = state.events;
    const total = allEvents.length || 1;
    
    const metrics = [
      { label: 'Has Headline', count: allEvents.filter(e => e.headline && e.headline.trim()).length },
      { label: 'Has Assets', count: allEvents.filter(e => e.assets && e.assets.length > 0).length },
      { label: 'Has Est. Time', count: allEvents.filter(e => e.estimatedTime && e.estimatedTime > 0).length },
      { label: 'Has Status', count: allEvents.filter(e => e.preProdStatus || e.prodStatus).length },
      { label: 'Has Links', count: allEvents.filter(e => (e.links && e.links.length > 0) || e.locLink || e.adoLink).length }
    ];
    
    container.innerHTML = metrics.map(m => {
      const pct = Math.round((m.count / total) * 100);
      let quality = 'good';
      if(pct < 50) quality = 'poor';
      else if(pct < 80) quality = 'medium';
      
      return `<div class="quality-item">
        <div class="quality-label">${m.label}</div>
        <div class="quality-track">
          <div class="quality-fill ${quality}" style="width:${pct}%"></div>
        </div>
        <div class="quality-percent">${pct}%</div>
      </div>`;
    }).join('');
  }
  
  function renderRecentEvents() {
    const container = qs('#dashboard-recent');
    if(!container) return;
    
    const recent = [...state.events]
      .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
      .slice(0, 6);
    
    if(recent.length === 0) {
      container.innerHTML = '<div class="empty-state">No events yet</div>';
      return;
    }
    
    container.innerHTML = recent.map(ev => {
      const platforms = ev.platform ? ev.platform.split(', ').map(p => p.trim()) : ['Other'];
      const color = platformColors[platforms[0]] || platformColors['Other'];
      
      return `<div class="recent-event-item">
        <div class="recent-event-title">${ev.title}</div>
        <div class="recent-event-platform" style="background:${color}">${platforms[0]}</div>
        <div class="recent-event-date">${ev.date}</div>
      </div>`;
    }).join('');
  }

  function renderGridView(){
    gridView.innerHTML='';
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    const monthStart = `${year}-${String(month+1).padStart(2,'0')}-01`;
    const monthEnd = `${year}-${String(month+1).padStart(2,'0')}-${new Date(year, month+1, 0).getDate()}`;
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    
    // Update month label in header
    monthLabel.textContent = `${monthNames[month]} ${year}`;
    
    // Add prominent header inside grid view
    const gridHeader = document.createElement('div');
    gridHeader.className = 'grid-view-header';
    gridHeader.innerHTML = `
      <h3 class="grid-view-title">📊 ${monthNames[month]} ${year}</h3>
      <span class="grid-view-subtitle">Use ◀ ▶ to navigate months</span>
    `;
    gridView.appendChild(gridHeader);
    
    // Filter events that overlap with the current month
    const allEvents = state.events.filter(ev => {
      if(!applyFilters(ev)) return false;
      const evStart = ev.date;
      const evEnd = ev.endDate || ev.date;
      // Event overlaps month if it starts before month ends AND ends after month starts
      return evStart <= monthEnd && evEnd >= monthStart;
    }).sort((a,b)=>a.date.localeCompare(b.date) || (a.startTime||'').localeCompare(b.startTime||''));
    
    // Add event count badge
    const countBadge = document.createElement('div');
    countBadge.className = 'grid-event-count';
    countBadge.textContent = `${allEvents.length} event${allEvents.length !== 1 ? 's' : ''} in ${monthNames[month]}`;
    gridView.appendChild(countBadge);
    
    if(allEvents.length===0){
      const empty = document.createElement('div'); empty.className='empty-state'; empty.textContent='No events for this month. Use ◀ ▶ to navigate to other months.';
      gridView.appendChild(empty);
      return;
    }
    
    const table = document.createElement('table'); table.className='grid-table';
    
    // Header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    const headers = ['Start', 'End', 'Title', 'Platforms', 'Pre-prod', 'Prod', 'Slot', 'Frequency', 'Headline', 'Actions'];
    headers.forEach(h=>{
      const th = document.createElement('th'); th.textContent=h; headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);
    
    // Body
    const tbody = document.createElement('tbody');
    allEvents.forEach(ev=>{
      const tr = document.createElement('tr');
      
      // Start (Date + Time)
      const startCell = document.createElement('td');
      startCell.textContent = ev.date + (ev.startTime ? ' ' + formatTime(ev.startTime) : '');
      tr.appendChild(startCell);
      
      // End (Date + Time)
      const endCell = document.createElement('td');
      if(ev.endDate || ev.endTime){
        const endDatePart = ev.endDate || ev.date;
        const endTimePart = ev.endTime ? ' ' + formatTime(ev.endTime) : '';
        endCell.textContent = endDatePart + endTimePart;
      } else {
        endCell.textContent = '--';
      }
      tr.appendChild(endCell);
      
      // Title
      const titleCell = document.createElement('td'); titleCell.textContent = ev.title; tr.appendChild(titleCell);
      
      // Platforms
      const platformCell = document.createElement('td');
      const platformContainer = document.createElement('div');
      platformContainer.className = 'grid-platforms';
      const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
      platforms.forEach(p=>{
        const tag = document.createElement('span'); tag.className='grid-platform-tag';
        tag.textContent = p; tag.style.backgroundColor = platformColors[p] || platformColors['Other'];
        platformContainer.appendChild(tag);
      });
      platformCell.appendChild(platformContainer);
      tr.appendChild(platformCell);
      
      // Pre-production Status
      const preProdCell = document.createElement('td');
      if(ev.preProdStatus) {
        const badge = document.createElement('span');
        badge.className = 'grid-status-badge';
        badge.textContent = ev.preProdStatus;
        badge.setAttribute('data-status', ev.preProdStatus);
        preProdCell.appendChild(badge);
      } else {
        preProdCell.textContent = '--';
      }
      tr.appendChild(preProdCell);
      
      // Production Status
      const prodCell = document.createElement('td');
      if(ev.prodStatus) {
        const badge = document.createElement('span');
        badge.className = 'grid-status-badge';
        badge.textContent = ev.prodStatus;
        badge.setAttribute('data-status', ev.prodStatus);
        prodCell.appendChild(badge);
      } else {
        prodCell.textContent = '--';
      }
      tr.appendChild(prodCell);
      
      // Slot
      const slotCell = document.createElement('td'); slotCell.textContent = ev.slotNumber||'--'; tr.appendChild(slotCell);
      
      // Frequency (combined: "Regular 6x/daily")
      const freqCell = document.createElement('td');
      const freqParts = [];
      freqParts.push(ev.eventType || 'Regular');
      if(ev.frequency) freqParts.push(ev.frequency + 'x');
      if(ev.recurrence) freqParts[freqParts.length > 1 ? freqParts.length - 1 : 0] += '/' + ev.recurrence.toLowerCase();
      freqCell.textContent = freqParts.join(' ') || '--';
      tr.appendChild(freqCell);
      
      // Headline
      const headlineCell = document.createElement('td'); headlineCell.textContent = ev.headline||'--'; tr.appendChild(headlineCell);
      
      // Actions
      const actionsCell = document.createElement('td');
      const copyBtn = document.createElement('button'); copyBtn.textContent='Duplicate'; copyBtn.addEventListener('click', ()=>duplicateEvent(ev));
      const editBtn = document.createElement('button'); editBtn.textContent='Edit'; editBtn.addEventListener('click', ()=>openModalForEdit(ev));
      const delBtn = document.createElement('button'); delBtn.textContent='Delete'; delBtn.addEventListener('click', async ()=>{ if(await showDialog('Delete event?', 'delete')){ state.events = state.events.filter(x=>x.id!==ev.id); saveState(); render(); renderDayEvents(); } });
      const actionsDiv = document.createElement('div'); actionsDiv.className='grid-actions'; actionsDiv.appendChild(copyBtn); actionsDiv.appendChild(editBtn); actionsDiv.appendChild(delBtn);
      actionsCell.appendChild(actionsDiv);
      tr.appendChild(actionsCell);
      
      // Double-click row to view details
      tr.style.cursor = 'pointer';
      tr.addEventListener('dblclick', (e)=>{ if(e.target.tagName !== 'BUTTON') openViewModal(ev); });
      
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    gridView.appendChild(table);
  }

  function eventCoversDay(ev, dateStr){
    if(!ev.date || ev.date > dateStr) return false;
    if(ev.endDate && ev.endDate < dateStr) return false;
    return ev.date <= dateStr && (!ev.endDate || dateStr <= ev.endDate);
  }

  function renderCalendar(){
    monthGridNode.innerHTML='';
    const year = viewDate.getFullYear();
    const month = viewDate.getMonth();
    monthLabel.textContent = viewDate.toLocaleString(undefined,{month:'long',year:'numeric'});

    const first = new Date(year,month,1);
    let startDay = first.getDay();
    // Adjust for week start setting
    if(settings.weekStartsOn === 1) {
      startDay = startDay === 0 ? 6 : startDay - 1;
    }
    const daysInMonth = new Date(year,month+1,0).getDate();

    // Add day headers based on week start setting
    const dayNames = getDayNames();
    const filteredDayNames = settings.showWeekends ? dayNames : dayNames.filter(d => d !== 'Sat' && d !== 'Sun');
    
    // previous month days
    const prevDays = startDay;
    const total = Math.ceil((prevDays+daysInMonth)/7)*7;
    const startDate = new Date(year,month,1-prevDays);

    for(let i=0;i<total;i++){
      const d = new Date(startDate); d.setDate(startDate.getDate()+i);
      // Skip weekends if setting is off
      if(!settings.showWeekends && (d.getDay() === 0 || d.getDay() === 6)) continue;
      
      const dayNode = document.createElement('div'); dayNode.className='day';
      if(d.getMonth()!==month) dayNode.classList.add('other-month');
      const iso = toLocalDate(d);
      const dayNumber = document.createElement('div'); dayNumber.className='day-number'; dayNumber.textContent = d.getDate();
      dayNode.appendChild(dayNumber);

      const evs = state.events.filter(ev=>eventCoversDay(ev, iso) && applyFilters(ev));
      // show up to 6 events per day for better visibility
      evs.slice(0,6).forEach(ev=>{
        const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
        const color = platformColors[platforms[0]] || platformColors['Other'];
        const b = document.createElement('button'); b.className='event-chip'; 
        b.textContent = platforms.length > 1 ? `${ev.title} (${platforms.length})` : ev.title;
        b.title = ev.title;
        b.style.backgroundColor = color;
        b.addEventListener('click', ()=>{ state.selectedDate = iso; saveState(); renderDayEvents(); openViewModal(ev); });
        dayNode.appendChild(b);
      });

      if(evs.length>6){
        const more = document.createElement('div'); more.textContent = `+${evs.length-6} more`; more.className='more'; more.style.fontSize='0.8rem'; dayNode.appendChild(more);
      }

      if(iso === toLocalDate(new Date())) dayNode.classList.add('today');
      dayNode.addEventListener('click', ()=>{ state.selectedDate = iso; saveState(); renderDayEvents(); });
      dayNode.addEventListener('dblclick', ()=>{ state.selectedDate = iso; saveState(); openModalForNew(iso); });
      monthGridNode.appendChild(dayNode);
    }
  }

  function eventsForDay(iso){ 
    return state.events.filter(e=>{
      if(!e.date || e.date > iso) return false;
      if(e.endDate && e.endDate < iso) return false;
      return e.date <= iso && (!e.endDate || iso <= e.endDate);
    });
  }

  function applyFilters(ev){
    if(state.search){ const s=state.search; if(!(ev.title||'').toLowerCase().includes(s) && !(ev.id||'').toLowerCase().includes(s) && !((ev.headline||'').toLowerCase().includes(s))) return false; }
    if(state.filterPlatforms.length>0){
      const eventPlatforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
      const hasMatch = eventPlatforms.some(p=>state.filterPlatforms.includes(p));
      if(!hasMatch) return false;
    }
    return true;
  }

  function renderDayEvents(){
    const iso = state.selectedDate || toLocalDate(new Date());
    const dateObj = new Date(iso + 'T00:00:00');
    selectedDay.textContent = dateObj.toLocaleDateString();
    const list = eventsForDay(iso).filter(applyFilters).sort((a,b)=>a.slotNumber-b.slotNumber);
    dayEvents.innerHTML='';
    if(list.length===0){ qs('#empty-state').style.display='block'; return; } else qs('#empty-state').style.display='none';
    list.forEach(ev=>{
      const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
      const card = document.createElement('article'); card.className='event-card'; card.style.cursor='pointer';
      card.style.borderLeftColor = platformColors[platforms[0]] || platformColors['Other'];
      const h = document.createElement('h3'); h.textContent = ev.title; card.appendChild(h);
      const platformTags = document.createElement('div'); platformTags.className='platform-tags';
      platforms.forEach(p=>{
        const tag = document.createElement('span'); tag.className='platform-tag'; tag.textContent = p;
        tag.style.backgroundColor = platformColors[p] || platformColors['Other'];
        platformTags.appendChild(tag);
      });
      card.appendChild(platformTags);
      const meta = document.createElement('div'); meta.className='meta'; meta.textContent = `Slot ${ev.slotNumber}` + (ev.frequency?` · ${ev.frequency}`:''); card.appendChild(meta);
      if(ev.headline) { const p = document.createElement('p'); p.textContent = ev.headline; card.appendChild(p); }
      if(ev.endDate) { const dateRange = document.createElement('div'); dateRange.className='date-range'; dateRange.textContent = `${ev.date} to ${ev.endDate}`; card.appendChild(dateRange); }
      
      // Click card to view details
      card.addEventListener('click', (e)=>{ if(e.target.tagName!=='BUTTON') openViewModal(ev); });
      
      const actions = document.createElement('div'); actions.className='card-actions';
      const view = document.createElement('button'); view.textContent='View'; view.addEventListener('click', (e)=>{ e.stopPropagation(); openViewModal(ev); });
      const copy = document.createElement('button'); copy.textContent='Duplicate'; copy.addEventListener('click', (e)=>{ e.stopPropagation(); duplicateEvent(ev); });
      const edit = document.createElement('button'); edit.textContent='Edit'; edit.addEventListener('click', (e)=>{ e.stopPropagation(); openModalForEdit(ev); });
      const del = document.createElement('button'); del.textContent='Delete'; del.addEventListener('click', async (e)=>{ e.stopPropagation(); if(await showDialog('Delete event?', 'delete')){ state.events = state.events.filter(x=>x.id!==ev.id); saveState(); render(); renderDayEvents(); } });
      actions.appendChild(view); actions.appendChild(copy); actions.appendChild(edit); actions.appendChild(del); card.appendChild(actions);
      dayEvents.appendChild(card);
    });
  }

  function onExportJSON(){
    const data = JSON.stringify(state.events, null, 2);
    const blob = new Blob([data], {type:'application/json'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'events.json'; a.click();
    URL.revokeObjectURL(url);
  }

  function onExportCSV(){
    const headers = ['id','date','endDate','title','platform','startTime','endTime','slotNumber','eventType','frequency','recurrence','preProdStatus','prodStatus','headline','subHeadline','targeting','locLink','adoLink','notes','tags','links','assets'];
    const escapeCSV = (val) => {
      if(val === null || val === undefined) return '';
      const str = String(val);
      if(str.includes(',') || str.includes('"') || str.includes('\n')) return '"' + str.replace(/"/g, '""') + '"';
      return str;
    };
    const rows = state.events.map(ev => {
      return headers.map(h => {
        let val = ev[h];
        if(h === 'tags' && Array.isArray(val)) val = val.join(';');
        if(h === 'links' && Array.isArray(val)) val = val.map(l => l.label + '|' + l.url).join(';');
        if(h === 'assets' && Array.isArray(val)) val = val.join(';');
        return escapeCSV(val);
      }).join(',');
    });
    const csv = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'events.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  function parseCSV(text){
    const lines = [];
    let current = '';
    let inQuotes = false;
    for(let i = 0; i < text.length; i++){
      const ch = text[i];
      if(ch === '"'){ 
        if(inQuotes && text[i+1] === '"'){ current += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if(ch === '\n' && !inQuotes){
        lines.push(current); current = '';
      } else {
        current += ch;
      }
    }
    if(current) lines.push(current);
    return lines.map(line => {
      const cells = []; let cell = ''; let inQ = false;
      for(let i = 0; i < line.length; i++){
        const ch = line[i];
        if(ch === '"'){ if(inQ && line[i+1] === '"'){ cell += '"'; i++; } else inQ = !inQ; }
        else if(ch === ',' && !inQ){ cells.push(cell); cell = ''; }
        else cell += ch;
      }
      cells.push(cell);
      return cells;
    });
  }

  function onImport(e){
    const f = e.target.files && e.target.files[0];
    if(!f) return;
    const isCSV = f.name.toLowerCase().endsWith('.csv');
    const rdr = new FileReader();
    rdr.onload = ()=>{
      try{
        let incoming = [];
        if(isCSV){
          const rows = parseCSV(rdr.result);
          if(rows.length < 2) throw new Error('CSV has no data rows');
          const headers = rows[0].map(h => h.trim());
          for(let i = 1; i < rows.length; i++){
            const row = rows[i];
            if(row.length === 0 || (row.length === 1 && !row[0])) continue;
            const obj = {};
            headers.forEach((h, idx) => {
              let val = row[idx] || '';
              if(h === 'tags') val = val ? val.split(';').map(s=>s.trim()).filter(Boolean) : [];
              else if(h === 'links') val = val ? val.split(';').map(l => { const [label,url] = l.split('|'); return {label:label||'',url:url||''}; }).filter(l=>l.url) : [];
              else if(h === 'assets') val = val ? val.split(';').map(s=>s.trim()).filter(Boolean) : [];
              else if(h === 'slotNumber') val = Number(val) || 0;
              obj[h] = val;
            });
            incoming.push(obj);
          }
        } else {
          incoming = JSON.parse(rdr.result);
          if(!Array.isArray(incoming)) throw new Error('Invalid JSON format');
        }
        // merge strategy: append with new ids if missing
        incoming.forEach(it=>{
          if(!it.id) it.id = uid();
          if(!state.events.some(x=>x.id===it.id)) state.events.push(it);
        });
        saveState(); render(); renderDayEvents(); renderPlatformChips();
        importInput.value='';
        showDialog('Imported '+incoming.length+' events', 'success');
      }catch(err){ showDialog('Import failed: '+err.message, 'error'); }
    };
    rdr.readAsText(f);
  }

  function toggleTheme(){
    state.theme = (state.theme==='dark')?'light':'dark';
    applyTheme(state.theme); localStorage.setItem('theme', state.theme); saveState();
  }

  function applyTheme(t){
    if(t==='dark') document.documentElement.classList.add('dark'); else document.documentElement.classList.remove('dark');
    themeToggle.setAttribute('aria-pressed', t==='dark'?'true':'false');
  }

  function getSystemTheme(){
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applySettings(){
    // Apply compact view
    if(settings.compactView){
      document.body.classList.add('compact-events');
    } else {
      document.body.classList.remove('compact-events');
    }
    // Apply show weekends
    if(!settings.showWeekends){
      document.body.classList.add('hide-weekends');
    } else {
      document.body.classList.remove('hide-weekends');
    }
  }

  function bindSettingsUI(){
    if(!settingsBtn) return;
    
    settingsBtn.addEventListener('click', openSettingsModal);
    settingsModalOverlay?.addEventListener('click', closeSettingsModal);
    settingsModalClose?.addEventListener('click', closeSettingsModal);
    settingsSave?.addEventListener('click', saveSettings);
    settingsReset?.addEventListener('click', resetSettings);
    
    // Listen for system theme changes
    if(window.matchMedia){
      window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', ()=>{
        if(settings.theme === 'system'){
          applyTheme(getSystemTheme());
        }
      });
    }
  }

  function openSettingsModal(){
    if(!settingsModal) return;
    // Populate current settings
    if(settingTheme) settingTheme.value = settings.theme;
    if(settingDefaultView) settingDefaultView.value = settings.defaultView;
    if(settingWeekStart) settingWeekStart.value = settings.weekStartsOn.toString();
    if(settingTimeFormat) settingTimeFormat.value = settings.timeFormat;
    if(settingShowWeekends) settingShowWeekends.checked = settings.showWeekends;
    if(settingCompactView) settingCompactView.checked = settings.compactView;
    if(settingAutoTrackStatus) settingAutoTrackStatus.checked = settings.autoTrackStatus !== false;
    
    // Show welcome checkbox - checked means show it (inverse of hideWelcome)
    const showWelcomeCheckbox = qs('#setting-show-welcome');
    const hideWelcome = localStorage.getItem('store_calendar.hideWelcome') === 'true';
    if(showWelcomeCheckbox) showWelcomeCheckbox.checked = !hideWelcome;
    
    settingsModal.setAttribute('aria-hidden', 'false');
    settingsModal.style.display = 'block';
  }

  function closeSettingsModal(){
    if(!settingsModal) return;
    settingsModal.setAttribute('aria-hidden', 'true');
    settingsModal.style.display = 'none';
  }

  function saveSettings(){
    settings.theme = settingTheme?.value || 'dark';
    settings.defaultView = settingDefaultView?.value || 'month';
    settings.weekStartsOn = parseInt(settingWeekStart?.value || '0', 10);
    settings.timeFormat = settingTimeFormat?.value || '12h';
    settings.showWeekends = settingShowWeekends?.checked ?? true;
    settings.compactView = settingCompactView?.checked ?? false;
    settings.autoTrackStatus = settingAutoTrackStatus?.checked ?? true;
    
    // Save show welcome preference (inverse logic: checked = show, so hideWelcome = !checked)
    const showWelcomeCheckbox = qs('#setting-show-welcome');
    if(showWelcomeCheckbox) {
      if(showWelcomeCheckbox.checked) {
        localStorage.removeItem('store_calendar.hideWelcome');
      } else {
        localStorage.setItem('store_calendar.hideWelcome', 'true');
      }
    }
    
    lset(SETTINGS_KEY, settings);
    
    // Apply theme
    const themeToApply = settings.theme === 'system' ? getSystemTheme() : settings.theme;
    state.theme = themeToApply;
    applyTheme(themeToApply);
    saveState();
    
    // Apply other settings
    applySettings();
    
    // Re-render calendar
    render();
    renderDayEvents();
    
    closeSettingsModal();
  }

  async function resetSettings(){
    if(!await showDialog('Reset all settings to defaults?', 'confirm')) return;
    settings = {...defaultSettings};
    lset(SETTINGS_KEY, settings);
    
    // Update form
    if(settingTheme) settingTheme.value = settings.theme;
    if(settingDefaultView) settingDefaultView.value = settings.defaultView;
    if(settingWeekStart) settingWeekStart.value = settings.weekStartsOn.toString();
    if(settingTimeFormat) settingTimeFormat.value = settings.timeFormat;
    if(settingShowWeekends) settingShowWeekends.checked = settings.showWeekends;
    if(settingCompactView) settingCompactView.checked = settings.compactView;
    if(settingAutoTrackStatus) settingAutoTrackStatus.checked = settings.autoTrackStatus;
    
    // Apply
    applyTheme(settings.theme);
    state.theme = settings.theme;
    saveState();
    applySettings();
    render();
    renderDayEvents();
  }

  // Format time based on settings
  function formatTime(timeStr){
    if(!timeStr) return '';
    if(settings.timeFormat === '24h') return timeStr;
    // Convert 24h to 12h
    const [h, m] = timeStr.split(':').map(Number);
    const period = h >= 12 ? 'PM' : 'AM';
    const hour12 = h % 12 || 12;
    return `${hour12}:${String(m).padStart(2,'0')} ${period}`;
  }

  // Get day names based on week start setting
  function getDayNames(){
    const names = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
    if(settings.weekStartsOn === 1){
      return ['Mon','Tue','Wed','Thu','Fri','Sat','Sun'];
    }
    return names;
  }

  // View Modal functions
  function bindViewModalUI(){
    if(!viewModal) return;
    viewModalOverlay?.addEventListener('click', closeViewModal);
    viewModalClose?.addEventListener('click', closeViewModal);
    
    // Bind all edit buttons (top and bottom)
    viewModal.querySelectorAll('.view-edit-btn').forEach(btn => {
      btn.addEventListener('click', ()=>{ 
        const ev = viewingEvent;
        if(ev){ closeViewModal(); openModalForEdit(ev); } 
      });
    });
    
    // Bind all delete buttons (top and bottom)
    viewModal.querySelectorAll('.view-delete-btn').forEach(btn => {
      btn.addEventListener('click', async ()=>{
        const ev = viewingEvent;
        if(ev && await showDialog('Delete this event?', 'delete')){
          state.events = state.events.filter(x=>x.id!==ev.id);
          saveState(); closeViewModal(); render(); renderDayEvents();
        }
      });
    });
    
    // Bind all duplicate buttons (top and bottom)
    viewModal.querySelectorAll('.view-copy-btn').forEach(btn => {
      btn.addEventListener('click', ()=>{
        if(!viewingEvent) return;
        const ev = viewingEvent;
        closeViewModal();
        duplicateEvent(ev);
      });
    });
    
    // Copy buttons - copy from actual event data
    viewModal.querySelectorAll('.copy-btn').forEach(btn=>{
      btn.addEventListener('click', (e)=>{
        e.stopPropagation();
        if(!viewingEvent) return;
        
        const targetId = btn.dataset.copy;
        let textToCopy = '';
        
        if(targetId === 'view-headline'){
          textToCopy = viewingEvent.headline || '';
        } else if(targetId === 'view-subheadline'){
          textToCopy = viewingEvent.subHeadline || '';
        } else if(targetId === 'view-loc'){
          textToCopy = viewingEvent.locLink || '';
        } else if(targetId === 'view-ado'){
          textToCopy = viewingEvent.adoLink || '';
        } else if(targetId === 'view-links'){
          // Get all links as text (label: url format)
          textToCopy = (viewingEvent.links || []).map(l => l.url).join('\n');
        } else if(targetId === 'view-assets'){
          // Get all assets as text
          textToCopy = (viewingEvent.assets || []).join('\n');
        }
        
        if(!textToCopy) return;
        
        navigator.clipboard.writeText(textToCopy).then(()=>{
          btn.classList.add('copied');
          setTimeout(()=> btn.classList.remove('copied'), 1500);
        }).catch(err=>{
          console.error('Copy failed:', err);
        });
      });
    });
  }

  function openViewModal(evOrId){
    if(!viewModal || !evOrId) return;
    
    // Always get fresh event data from state by ID
    const eventId = typeof evOrId === 'string' ? evOrId : evOrId.id;
    const ev = state.events.find(e => e.id === eventId);
    if(!ev) return;
    
    viewingEvent = ev;
    
    // Populate fields
    qs('#view-title').textContent = ev.title || 'Untitled Event';
    
    // Platforms
    const platformsContainer = qs('#view-platforms');
    platformsContainer.innerHTML = '';
    const platforms = ev.platform ? ev.platform.split(', ').map(p=>p.trim()) : ['Other'];
    platforms.forEach(p=>{
      const tag = document.createElement('span');
      tag.className = 'view-platform-tag';
      tag.textContent = p;
      tag.style.backgroundColor = platformColors[p] || platformColors['Other'];
      platformsContainer.appendChild(tag);
    });
    
    // Basic fields
    qs('#view-date').textContent = ev.date ? formatDisplayDate(ev.date) : '';
    qs('#view-enddate').textContent = ev.endDate ? formatDisplayDate(ev.endDate) : '';
    qs('#view-starttime').textContent = ev.startTime ? formatTime(ev.startTime) : '';
    qs('#view-endtime').textContent = ev.endTime ? formatTime(ev.endTime) : '';
    qs('#view-id').textContent = ev.id || '';
    qs('#view-slot').textContent = ev.slotNumber || '';
    
    // Combined frequency display: "Regular 6x/Daily"
    const freqCombined = qs('#view-frequency-combined');
    if(freqCombined){
      const parts = [];
      parts.push(ev.eventType || 'Regular');
      if(ev.frequency) parts.push(ev.frequency + 'x');
      if(ev.recurrence) parts[parts.length > 1 ? parts.length - 1 : 0] += '/' + ev.recurrence.toLowerCase();
      freqCombined.textContent = parts.join(' ');
    }
    
    // Alert
    const viewAlert = qs('#view-alert');
    if(viewAlert) {
      viewAlert.textContent = getAlertLabel(ev.alert) || 'No alert';
    }
    
    qs('#view-targeting').textContent = ev.targeting || '';
    
    // Status fields with badges
    const preProdStatus = qs('#view-preprod-status');
    const prodStatus = qs('#view-prod-status');
    preProdStatus.textContent = ev.preProdStatus || '';
    preProdStatus.setAttribute('data-status', ev.preProdStatus || '');
    prodStatus.textContent = ev.prodStatus || '';
    prodStatus.setAttribute('data-status', ev.prodStatus || '');
    
    qs('#view-headline').textContent = ev.headline || '';
    qs('#view-subheadline').textContent = ev.subHeadline || '';
    
    // LOC Link
    const locLink = qs('#view-loc');
    if(ev.locLink){
      locLink.href = ev.locLink;
      locLink.textContent = ev.locLink;
    } else {
      locLink.href = '';
      locLink.textContent = '';
    }
    
    // ADO Deliverable
    const adoLink = qs('#view-ado');
    if(adoLink){
      if(ev.adoLink){
        adoLink.href = ev.adoLink;
        adoLink.textContent = ev.adoLink;
      } else {
        adoLink.href = '';
        adoLink.textContent = '';
      }
    }
    
    // Links
    const linksContainer = qs('#view-links');
    linksContainer.innerHTML = '';
    if(ev.links && ev.links.length > 0){
      ev.links.forEach(link=>{
        const item = document.createElement('div');
        item.className = 'view-link-item';
        const a = document.createElement('a');
        a.href = link.url;
        a.target = '_blank';
        a.textContent = link.label || link.url;
        item.appendChild(a);
        linksContainer.appendChild(item);
      });
    } else {
      linksContainer.innerHTML = '<span class="view-value"></span>';
    }
    
    // Assets
    const assetsContainer = qs('#view-assets');
    assetsContainer.innerHTML = '';
    if(ev.assets && ev.assets.length > 0){
      ev.assets.forEach(asset=>{
        const a = document.createElement('a');
        a.className = 'view-asset-item';
        a.href = asset;
        a.target = '_blank';
        a.textContent = asset;
        assetsContainer.appendChild(a);
      });
    } else {
      assetsContainer.innerHTML = '<span class="view-value"></span>';
    }
    
    // Notes
    qs('#view-notes').textContent = ev.notes || '';
    
    // Tags
    const tagsContainer = qs('#view-tags');
    tagsContainer.innerHTML = '';
    if(ev.tags && ev.tags.length > 0){
      ev.tags.forEach(tag=>{
        const span = document.createElement('span');
        span.className = 'view-tag';
        span.textContent = tag;
        tagsContainer.appendChild(span);
      });
    } else {
      tagsContainer.innerHTML = '<span class="view-value"></span>';
    }
    
    // Time Tracking
    const viewEstimated = qs('#view-estimated-time');
    const viewActual = qs('#view-actual-time');
    const viewRemaining = qs('#view-time-remaining');
    
    if(viewEstimated && viewActual && viewRemaining) {
      const estimated = ev.estimatedTime || 0;
      const actual = ev.actualTime || 0;
      const remaining = Math.max(0, estimated - actual);
      
      viewEstimated.textContent = estimated > 0 ? `${estimated.toFixed(1)}h` : '-';
      viewActual.textContent = actual > 0 ? `${actual.toFixed(2)}h` : '-';
      viewRemaining.textContent = estimated > 0 ? `${remaining.toFixed(1)}h` : '-';
      
      // Color code remaining based on status
      if(estimated > 0 && actual > estimated) {
        viewRemaining.style.color = 'var(--error-color)';
        viewRemaining.textContent = `${(actual - estimated).toFixed(1)}h over`;
      } else if(estimated > 0 && remaining < estimated * 0.2) {
        viewRemaining.style.color = 'var(--warning-color)';
      } else {
        viewRemaining.style.color = '';
      }
    }
    
    // Time entries in view modal
    const viewTimeEntries = qs('#view-time-entries');
    if(viewTimeEntries) {
      const entries = getEventTimeEntries(ev.id);
      if(entries.length > 0) {
        viewTimeEntries.innerHTML = entries.slice(0, 5).map(entry => `
          <div class="view-time-entry">
            <span>${new Date(entry.date).toLocaleDateString()}</span>
            <span>${entry.hours.toFixed(2)}h</span>
            <span>${entry.note || ''}</span>
          </div>
        `).join('');
        if(entries.length > 5) {
          viewTimeEntries.innerHTML += `<div class="view-time-entry-more">+${entries.length - 5} more entries</div>`;
        }
      } else {
        viewTimeEntries.innerHTML = '';
      }
    }
    
    viewModal.setAttribute('aria-hidden', 'false');
    viewModal.style.display = 'block';
  }

  function closeViewModal(){
    if(!viewModal) return;
    viewModal.setAttribute('aria-hidden', 'true');
    viewModal.style.display = 'none';
    viewingEvent = null;
  }

  function formatDisplayDate(dateStr){
    if(!dateStr) return '';
    const d = new Date(dateStr + 'T00:00:00');
    return d.toLocaleDateString(undefined, {weekday:'short', month:'short', day:'numeric', year:'numeric'});
  }

})();
