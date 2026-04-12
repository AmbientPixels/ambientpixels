// ── Board View — Quarterly Board Packet ──
// Extracted from dashboard.html.
// Dependencies: AgentEngine (global), CompanyStore (global), DOM elements with board-* IDs.
(function () {
  'use strict';

  function initBoardView() {
    var yearSel = document.getElementById('board-year');
    var quarterSel = document.getElementById('board-quarter');
    var renderBoardBtn = document.getElementById('board-render-btn');
    var copyBoardBtn = document.getElementById('board-copy-btn');
    var rangeEl = document.getElementById('board-range');
    if (!yearSel || !quarterSel) return;
    var nowYear = new Date().getFullYear();
    for (var y = nowYear - 2; y <= nowYear + 1; y++) {
      var opt = document.createElement('option'); opt.value = y; opt.textContent = y;
      if (y === nowYear) opt.selected = true; yearSel.appendChild(opt);
    }
    quarterSel.value = 'Q' + (Math.floor(new Date().getMonth() / 3) + 1);
    var _bPacket = null;

    // Risk Register filter state
    var _riskSeverity = '';       // '' = All, 'critical', 'high', 'medium', 'low'
    // TODO: standupTitle match for 'Daily' is fragile — update if standup naming changes
    var _riskSource = 'manual';   // 'all', 'manual' (excludes Daily Standup), 'automated'
    var _riskExpanded = false;    // false = top 5, true = all

    function renderBoard() {
      var year = parseInt(yearSel.value);
      var quarter = quarterSel.value;
      _bPacket = AgentEngine.getBoardPacket({ year: year, quarter: quarter });
      var s = new Date(_bPacket.dateRange.startISO), e = new Date(_bPacket.dateRange.endISO);
      rangeEl.textContent = _bPacket.quarterKey + '  ·  ' + s.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) + ' – ' + e.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      [_bRenderHeadline, _bRenderExecSummary, _bRenderGoals,
       function(){_bRenderDirSection('board-active-dirs','badge-active-dirs',_bPacket.directives.active, null);},
       function(){_bRenderDirSection('board-completed-dirs','badge-completed-dirs',_bPacket.directives.completed, 'sec-completed-dirs');},
       function(){_bRenderDirSection('board-pending-dirs','badge-pending-dirs',_bPacket.directives.pendingApproval, 'sec-pending-dirs');},
       _bRenderTeam, _bRenderBacklog, _bRenderCost,
       _bRenderDecisions, _bRenderRisks, _bRenderThroughput].forEach(function(fn){
        try { fn(); } catch(e) { console.warn('[Board] ' + (fn.name||'anon') + ' error:', e); }
      });
    }

    function _bRenderExecSummary() {
      var el = document.getElementById('board-exec-summary');
      var summary = _bPacket.execSummary || '';
      if (!summary) { el.innerHTML = '<div class="board-empty">No data available for this quarter.</div>'; return; }
      // Split run-on string into structured bullet points
      var parts = summary.split(/\.\s+/).filter(function(p) { return p.trim().length > 0; });
      var html = '<ul class="board-exec-list">';
      parts.forEach(function(p) {
        html += '<li>' + APUtils.esc(p.replace(/\.$/, '')) + '</li>';
      });
      html += '</ul>';
      el.innerHTML = html;
    }

    function _bRenderHeadline() {
      var el = document.getElementById('board-headline-stats');
      var objectives = AgentEngine.getObjectives ? AgentEngine.getObjectives() : [];
      var pending = (AgentEngine.getActions ? AgentEngine.getActions() : []).filter(function(a){return a.approval && a.approval.status==='pending';});
      var autonomyPct = AgentEngine.getAutonomyScore ? (AgentEngine.getAutonomyScore().score || 0) : 0;
      var sessions = AgentEngine.getSessionLog ? AgentEngine.getSessionLog() : [];
      var totalCost=0; sessions.forEach(function(s){if(s.cost)totalCost+=s.cost;});
      el.innerHTML =
        '<div class="board-stat"><div class="board-stat-val" style="color:#4ECDC4;">'+objectives.length+'</div><div class="board-stat-label">Goals</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#FF8C00;">'+_bPacket.directives.active.length+'</div><div class="board-stat-label">Active Projects</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#60a5fa;">'+_bPacket.throughput.tasksCreated+' / '+_bPacket.throughput.tasksCompleted+'</div><div class="board-stat-label">Tasks Created / Done</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#34d399;">'+autonomyPct+'%</div><div class="board-stat-label">Autonomy</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#fbbf24;">$'+totalCost.toFixed(2)+'</div><div class="board-stat-label">Total Spend</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#ef4444;">'+pending.length+'</div><div class="board-stat-label">Pending Approvals</div></div>';
    }

    function _bRenderGoals() {
      var el = document.getElementById('board-goals');
      var badge = document.getElementById('badge-goals');
      var objectives = AgentEngine.getObjectives ? AgentEngine.getObjectives() : [];
      badge.textContent = objectives.length;
      if (objectives.length===0){el.innerHTML='<div class="board-empty">No goals defined yet.</div>';return;}
      var html='';
      objectives.forEach(function(o){
        var progress = (typeof AgentEngine.getObjectiveProgress === 'function') ? AgentEngine.getObjectiveProgress(o.id) : null;
        var pct = progress ? progress.pct : (o.progressPercentage||0);
        var autoHealth = progress ? progress.health : 'neutral';
        var statusColors={on_track:'#34d399',at_risk:'#fbbf24',behind:'#ef4444',completed:'#c084fc'};
        var sColor=statusColors[o.status]||'#60a5fa';
        var barColor = autoHealth === 'good' ? '#34d399' : autoHealth === 'warn' ? '#fbbf24' : autoHealth === 'bad' ? '#ef4444' : '#60a5fa';
        var tasksMeta = progress ? (progress.primaryDoneTasks !== undefined ? progress.primaryDoneTasks : progress.doneTasks) + '/' + (progress.expectedTasks || progress.totalTasks) + ' tasks' : '';
        html+='<div class="board-goal-card"><div class="board-goal-title">'+APUtils.esc(o.title||'Untitled')+'</div>';
        html+='<div class="board-goal-meta">';
        html+='<span style="color:'+sColor+';">'+(o.status||'active').replace(/_/g,' ')+'</span>';
        html+='<span>'+pct+'% complete</span>';
        if(tasksMeta)html+='<span>'+tasksMeta+'</span>';
        if(progress&&progress.campaigns>0)html+='<span>'+progress.campaigns+' campaign'+(progress.campaigns!==1?'s':'')+'</span>';
        html+='</div><div class="board-progress-bar"><div class="board-progress-fill" style="width:'+pct+'%;background:'+barColor+';"></div></div></div>';
      });
      el.innerHTML=html;
    }

    function _bRenderTeam() {
      var el = document.getElementById('board-team');
      var reg = AgentEngine.getRegistry ? AgentEngine.getRegistry() : null;
      var agents = (reg&&reg.agents)?reg.agents:[];
      if(agents.length===0){el.innerHTML='<div class="board-empty">No agents loaded.</div>';return;}
      var tasks = AgentEngine.getTasks ? AgentEngine.getTasks() : [];
      var agentStats = AgentEngine.getAgentSessionStats ? AgentEngine.getAgentSessionStats() : {};
      var html='';
      agents.forEach(function(a){
        var aid=a.id||a.name;
        var doneTasks=tasks.filter(function(t){return(t.assignee===aid||t.assignee===(a.name||'').toLowerCase())&&t.status==='done';}).length;
        var activeTasks=tasks.filter(function(t){return(t.assignee===aid||t.assignee===(a.name||'').toLowerCase())&&t.status!=='done'&&t.status!=='backlog';}).length;
        var stat=agentStats[aid]; var calls=stat?stat.calls:0;
        html+='<div class="board-agent-card"><div class="board-agent-dot" style="background:'+(a.color||'#8A2BE2')+';"></div>';
        html+='<div><div class="board-agent-name">'+APUtils.esc(a.name||aid)+'</div><div class="board-agent-role">'+APUtils.esc(a.role||'')+'</div></div>';
        html+='<div class="board-agent-stat">'+doneTasks+' done · '+activeTasks+' active · '+calls+' calls</div></div>';
      });
      el.innerHTML=html;
    }

    function _bRenderBacklog() {
      var el = document.getElementById('board-backlog');
      var badge = document.getElementById('badge-backlog');
      var sec = document.getElementById('sec-backlog');
      var pending = (AgentEngine.getActions ? AgentEngine.getActions() : []).filter(function(a){return a.approval && a.approval.status==='pending';});
      badge.textContent = pending.length;
      if(pending.length===0){ if(sec) sec.style.display='none'; return; }
      if(sec) sec.style.display='';
      var now=Date.now(); var totalWaitMs=0;
      pending.forEach(function(p){if(p.submittedAt)totalWaitMs+=now-new Date(p.submittedAt).getTime();});
      var avgWaitH=pending.length>0?Math.round(totalWaitMs/pending.length/3600000):0;
      var html='<div class="board-cost-row" style="margin-bottom:0.5rem;">';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#fbbf24;">'+pending.length+'</div><div class="board-cost-label">Pending</div></div>';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#ef4444;">'+avgWaitH+'h</div><div class="board-cost-label">Avg Wait</div></div></div>';
      pending.slice(0,5).forEach(function(p){
        html+='<div class="board-dir-card" style="font-size:0.7rem;"><div style="flex:1;min-width:0;"><span style="font-weight:600;">'+APUtils.esc(p.taskTitle||p.title||p.taskId||'?')+'</span>';
        if(p.submittedAt)html+='<span style="opacity:0.35;font-size:0.55rem;margin-left:0.4rem;">'+new Date(p.submittedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</span>';
        html+='</div><span style="font-size:0.5rem;color:#fbbf24;">pending</span></div>';
      });
      if(pending.length>5)html+='<div style="font-size:0.55rem;opacity:0.3;padding:0.2rem 0;">+'+(pending.length-5)+' more</div>';
      el.innerHTML=html;
    }

    function _bRenderCost() {
      var el = document.getElementById('board-cost');
      var sessions = AgentEngine.getSessionLog ? AgentEngine.getSessionLog() : [];
      var totalCost=0,totalTokensIn=0,totalTokensOut=0,totalCalls=0;
      var perAgent={};
      sessions.forEach(function(s){totalCost+=s.cost||0;totalTokensIn+=s.inputTokens||0;totalTokensOut+=s.outputTokens||0;totalCalls++;
        var aid=s.agentId||'unknown';if(!perAgent[aid])perAgent[aid]={cost:0,calls:0};perAgent[aid].cost+=s.cost||0;perAgent[aid].calls++;});
      var html='<div class="board-cost-row" style="margin-bottom:0.5rem;">';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#fbbf24;">$'+totalCost.toFixed(2)+'</div><div class="board-cost-label">Total Spend</div></div>';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#60a5fa;">'+totalCalls+'</div><div class="board-cost-label">API Calls</div></div>';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#34d399;">'+Math.round((totalTokensIn+totalTokensOut)/1000)+'k</div><div class="board-cost-label">Total Tokens</div></div></div>';
      var agentKeys=Object.keys(perAgent).sort(function(a,b){return perAgent[b].cost-perAgent[a].cost;});
      if(agentKeys.length>0){
        html+='<div style="font-size:0.55rem;opacity:0.4;margin-bottom:0.25rem;">Per Agent</div>';
        agentKeys.slice(0,6).forEach(function(aid){
          var agent=AgentEngine.getAgent?AgentEngine.getAgent(aid):null;var name=agent?agent.name:aid;var c=perAgent[aid];
          html+='<div style="display:flex;justify-content:space-between;font-size:0.65rem;padding:0.15rem 0;border-bottom:1px solid rgba(255,255,255,0.03);">';
          html+='<span>'+APUtils.esc(name)+'</span><span style="opacity:0.5;">$'+c.cost.toFixed(3)+' · '+c.calls+' calls</span></div>';
        });
      }
      el.innerHTML=html||'<div class="board-empty">No cost data available.</div>';
    }

    function _bRenderDirSection(listId, badgeId, dirs, hideSectionId) {
      var listEl=document.getElementById(listId); var badge=document.getElementById(badgeId);
      badge.textContent=dirs.length;
      // Hide section when empty (if hideSectionId provided)
      if(dirs.length===0){
        if(hideSectionId){ var sec=document.getElementById(hideSectionId); if(sec) sec.style.display='none'; }
        else { listEl.innerHTML='<div class="board-empty">None for this quarter.</div>'; }
        return;
      }
      if(hideSectionId){ var secShow=document.getElementById(hideSectionId); if(secShow) secShow.style.display=''; }
      listEl.innerHTML='';
      dirs.forEach(function(d){
        var pColor=d.priority==='critical'?'#ef4444':d.priority==='high'?'#fbbf24':d.priority==='medium'?'#8A2BE2':'#34d399';
        var sColor=d.status==='active'?'#34d399':d.status==='completed'?'#c084fc':d.status==='pending-approval'?'#fbbf24':'#6b7280';
        var p = (typeof AgentEngine.getCampaignProgress === 'function') ? AgentEngine.getCampaignProgress(d.id) : null;
        var pct = p ? p.pct : 0;
        var barColor = p && p.signal === 'blocked' ? '#ef4444' : p && (p.signal === 'behind' || p.signal === 'at_risk' || p.signal === 'stale') ? '#fbbf24' : sColor;
        var taskInfo = p && p.total > 0 ? (p.primaryDone !== undefined ? p.primaryDone : p.done) + '/' + (p.expectedTotal || p.total) + ' done' : '';
        var div=document.createElement('div'); div.className='board-dir-card';
        div.innerHTML='<div style="flex:1;min-width:0;"><div style="font-size:0.85rem;font-weight:600;">'+APUtils.esc(d.title)+'</div><div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:3px;font-size:0.6rem;opacity:0.5;"><span style="color:'+sColor+';">'+d.status+'</span><span style="color:'+pColor+';">'+(d.priority||'medium')+'</span>'+(taskInfo?'<span>'+taskInfo+'</span>':'')+(d.owner?'<span>Owner: '+d.owner+'</span>':'')+'</div>'+(p&&p.total>0?'<div style="height:4px;border-radius:2px;background:rgba(255,255,255,0.06);margin-top:0.3rem;overflow:hidden;"><div style="height:100%;width:'+pct+'%;background:'+barColor+';border-radius:2px;"></div></div>':'')+'</div>';
        listEl.appendChild(div);
      });
    }

    function _bRenderDecisions() {
      var listEl=document.getElementById('board-decisions'); var badge=document.getElementById('badge-decisions');
      var sec=document.getElementById('sec-decisions');
      badge.textContent=_bPacket.decisions.length;
      if(_bPacket.decisions.length===0){ if(sec) sec.style.display='none'; return; }
      if(sec) sec.style.display='';
      listEl.innerHTML='';
      _bPacket.decisions.forEach(function(d){
        var sColor=d.decisionStatus==='Approved'?'#34d399':d.decisionStatus==='Rejected'?'#f87171':d.decisionStatus==='Deferred'?'#fbbf24':'#60a5fa';
        var div=document.createElement('div'); div.className='board-dir-card';
        div.innerHTML='<div style="flex:1;min-width:0;"><div style="font-size:0.8rem;font-weight:600;">'+APUtils.esc(d.title)+'</div><div style="font-size:0.6rem;opacity:0.5;margin-top:2px;">'+(d.topicKey?d.topicKey+' · ':'')+new Date(d.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</div></div><span style="font-size:0.55rem;padding:2px 8px;border-radius:4px;background:'+sColor+'18;color:'+sColor+';font-weight:600;white-space:nowrap;">'+d.decisionStatus+'</span>';
        listEl.appendChild(div);
      });
    }

    function _bRenderRisks() {
      var listEl=document.getElementById('board-risks'); var badge=document.getElementById('badge-risks');
      var allRisks = _bPacket.risks || [];
      badge.textContent=allRisks.length;
      if(allRisks.length===0){listEl.innerHTML='<div class="board-empty">No risks identified this quarter.</div>';return;}

      // Filter by severity
      var filtered = allRisks;
      if (_riskSeverity) {
        filtered = filtered.filter(function(r) { return r.severity === _riskSeverity; });
      }
      // Filter by source
      // TODO: standupTitle match for 'Daily' is fragile — update if standup naming changes
      if (_riskSource === 'manual') {
        filtered = filtered.filter(function(r) { return !r.standupTitle || r.standupTitle.indexOf('Daily') === -1; });
      } else if (_riskSource === 'automated') {
        filtered = filtered.filter(function(r) { return r.standupTitle && r.standupTitle.indexOf('Daily') !== -1; });
      }

      var totalFiltered = filtered.length;
      var displayRisks = _riskExpanded ? filtered : filtered.slice(0, 5);

      if (totalFiltered === 0) {
        listEl.innerHTML = '<div class="board-empty">No risks match current filters.</div>';
        return;
      }

      var sevColors={critical:'#ef4444',high:'#f87171',medium:'#fbbf24',low:'#34d399'};
      var html = '';
      displayRisks.forEach(function(r){
        var sColor=sevColors[r.severity]||'#fbbf24';
        var sevClass = (r.severity === 'critical' || r.severity === 'high') ? ' board-risk-card--high' : r.severity === 'medium' ? ' board-risk-card--medium' : ' board-risk-card--low';
        html += '<div class="board-dir-card' + sevClass + '">';
        html += '<div style="flex:1;min-width:0;"><div style="font-size:0.8rem;">'+APUtils.esc(r.description)+'</div><div style="font-size:0.6rem;opacity:0.4;margin-top:2px;">From: '+APUtils.esc(r.standupTitle||'?')+'</div></div>';
        html += '<span style="font-size:0.55rem;padding:2px 8px;border-radius:4px;background:'+sColor+'18;color:'+sColor+';font-weight:600;white-space:nowrap;">'+r.severity+'</span>';
        html += '</div>';
      });

      // Show All / Show Less toggle
      if (totalFiltered > 5) {
        html += '<button class="board-risk-toggle" onclick="window._boardRiskToggle()" style="font-size:0.6rem;padding:0.25rem 0.6rem;border-radius:4px;border:1px solid rgba(255,255,255,0.1);background:rgba(255,255,255,0.03);color:rgba(255,255,255,0.5);cursor:pointer;margin-top:0.3rem;font-family:inherit;">';
        html += _riskExpanded ? 'Show Less' : 'Show All (' + totalFiltered + ')';
        html += '</button>';
      }

      listEl.innerHTML = html;
    }

    // Expose risk toggle globally for inline onclick
    window._boardRiskToggle = function() {
      _riskExpanded = !_riskExpanded;
      _bRenderRisks();
    };

    function _bRenderThroughput() {
      var el=document.getElementById('board-throughput'); var tp=_bPacket.throughput;
      el.innerHTML=
        '<div class="board-stat"><div class="board-stat-val" style="color:#60a5fa;">'+tp.tasksCreated+'</div><div class="board-stat-label">Tasks Created</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#34d399;">'+tp.tasksCompleted+'</div><div class="board-stat-label">Tasks Completed</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#fbbf24;">'+tp.pendingApprovalTasks+'</div><div class="board-stat-label">Pending Approval</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#c084fc;">'+_bPacket.decisions.length+'</div><div class="board-stat-label">Decisions Made</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#f87171;">'+_bPacket.risks.length+'</div><div class="board-stat-label">Risks Logged</div></div>';
    }

    // Executive Plan removed — redundant with Goals + Active Projects sections

    function copyBoardPacket() {
      if(!_bPacket)return;
      var lines=[]; lines.push('# '+_bPacket.quarterKey+' Board Packet'); lines.push('');
      lines.push('## Executive Summary'); lines.push(_bPacket.execSummary); lines.push('');
      var objectives=AgentEngine.getObjectives?AgentEngine.getObjectives():[];
      var autonomyPct=AgentEngine.getAutonomyScore?(AgentEngine.getAutonomyScore().score||0):0;
      var sessions=AgentEngine.getSessionLog?AgentEngine.getSessionLog():[];
      var totalCost=0; sessions.forEach(function(s){if(s.cost)totalCost+=s.cost;});
      lines.push('## Key Metrics');
      lines.push('- Goals: '+objectives.length);
      lines.push('- Active Projects: '+_bPacket.directives.active.length);
      lines.push('- Autonomy: '+autonomyPct+'%');
      lines.push('- Total Spend: $'+totalCost.toFixed(2)); lines.push('');
      var text=lines.join('\n');
      if(navigator.clipboard){navigator.clipboard.writeText(text).then(function(){
        copyBoardBtn.innerHTML='<i class="fas fa-check"></i> Copied!';
        setTimeout(function(){copyBoardBtn.innerHTML='<i class="fas fa-clipboard"></i> Copy Board Packet';},2000);
      });}
    }

    // Wire risk filter controls
    var riskSevEl = document.getElementById('board-risk-severity');
    var riskSrcEl = document.getElementById('board-risk-source');
    if (riskSevEl) riskSevEl.addEventListener('change', function() { _riskSeverity = this.value; _riskExpanded = false; if (_bPacket) _bRenderRisks(); });
    if (riskSrcEl) riskSrcEl.addEventListener('change', function() { _riskSource = this.value; _riskExpanded = false; if (_bPacket) _bRenderRisks(); });

    renderBoard();
    renderBoardBtn.addEventListener('click', renderBoard);
    copyBoardBtn.addEventListener('click', copyBoardPacket);
    window.addEventListener('companystoreready', function () { renderBoard(); });
  }

  window.initBoardView = initBoardView;
})();
