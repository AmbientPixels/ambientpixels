// ── Board View — Quarterly Board Packet ──
// Extracted from dashboard.html.
// Dependencies: AgentEngine (global), CompanyStore (global), DOM elements with board-* IDs.
(function () {
  'use strict';

  function escapeHtml(str) {
    var div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

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

    function renderBoard() {
      var year = parseInt(yearSel.value);
      var quarter = quarterSel.value;
      _bPacket = AgentEngine.getBoardPacket({ year: year, quarter: quarter });
      var s = new Date(_bPacket.dateRange.startISO), e = new Date(_bPacket.dateRange.endISO);
      rangeEl.textContent = _bPacket.quarterKey + '  ·  ' + s.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}) + ' – ' + e.toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      [_bRenderHeadline, _bRenderExecSummary, _bRenderGoals,
       function(){_bRenderDirSection('board-active-dirs','badge-active-dirs',_bPacket.directives.active);},
       function(){_bRenderDirSection('board-completed-dirs','badge-completed-dirs',_bPacket.directives.completed);},
       function(){_bRenderDirSection('board-pending-dirs','badge-pending-dirs',_bPacket.directives.pendingApproval);},
       _bRenderTeam, _bRenderBacklog, _bRenderCost, _bRenderContent,
       _bRenderDecisions, _bRenderRisks, _bRenderThroughput].forEach(function(fn){
        try { fn(); } catch(e) { console.warn('[Board] ' + (fn.name||'anon') + ' error:', e); }
      });
    }

    function _bRenderExecSummary() {
      document.getElementById('board-exec-summary').textContent = _bPacket.execSummary || 'No data available for this quarter.';
    }

    function _bRenderHeadline() {
      var el = document.getElementById('board-headline-stats');
      var objectives = AgentEngine.getObjectives ? AgentEngine.getObjectives() : [];
      var queue = AgentEngine.getApprovalQueue ? AgentEngine.getApprovalQueue() : [];
      var pending = queue.filter(function(q){return q.status==='pending';});
      var tasks = AgentEngine.getTasks ? AgentEngine.getTasks() : [];
      var doneTasks = tasks.filter(function(t){return t.status==='done';});
      var autoCompleted = doneTasks.filter(function(t){return !t.manuallyCompleted;}).length;
      var autonomyPct = doneTasks.length>0?Math.round((autoCompleted/doneTasks.length)*100):0;
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
        var pct=o.progressPercentage||0;
        var statusColors={on_track:'#34d399',at_risk:'#fbbf24',behind:'#ef4444',completed:'#c084fc'};
        var sColor=statusColors[o.status]||'#60a5fa';
        var barColor=pct>=75?'#34d399':pct>=40?'#fbbf24':'#60a5fa';
        html+='<div class="board-goal-card"><div class="board-goal-title">'+escapeHtml(o.title||'Untitled')+'</div>';
        html+='<div class="board-goal-meta">';
        if(o.quarter)html+='<span>Q'+o.quarter+'</span>';
        html+='<span style="color:'+sColor+';">'+(o.status||'active').replace(/_/g,' ')+'</span>';
        html+='<span>'+pct+'% complete</span>';
        if(o.linkedDirectives&&o.linkedDirectives.length>0)html+='<span>'+o.linkedDirectives.length+' project'+(o.linkedDirectives.length>1?'s':'')+'</span>';
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
        html+='<div><div class="board-agent-name">'+escapeHtml(a.name||aid)+'</div><div class="board-agent-role">'+escapeHtml(a.role||'')+'</div></div>';
        html+='<div class="board-agent-stat">'+doneTasks+' done · '+activeTasks+' active · '+calls+' calls</div></div>';
      });
      el.innerHTML=html;
    }

    function _bRenderBacklog() {
      var el = document.getElementById('board-backlog');
      var badge = document.getElementById('badge-backlog');
      var queue = AgentEngine.getApprovalQueue ? AgentEngine.getApprovalQueue() : [];
      var pending = queue.filter(function(q){return q.status==='pending';});
      badge.textContent = pending.length;
      if(pending.length===0){el.innerHTML='<div class="board-empty">No pending approvals.</div>';return;}
      var now=Date.now(); var totalWaitMs=0;
      pending.forEach(function(p){if(p.submittedAt)totalWaitMs+=now-new Date(p.submittedAt).getTime();});
      var avgWaitH=pending.length>0?Math.round(totalWaitMs/pending.length/3600000):0;
      var html='<div class="board-cost-row" style="margin-bottom:0.5rem;">';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#fbbf24;">'+pending.length+'</div><div class="board-cost-label">Pending</div></div>';
      html+='<div class="board-cost-item"><div class="board-cost-val" style="color:#ef4444;">'+avgWaitH+'h</div><div class="board-cost-label">Avg Wait</div></div></div>';
      pending.slice(0,5).forEach(function(p){
        html+='<div class="board-dir-card" style="font-size:0.7rem;"><div style="flex:1;min-width:0;"><span style="font-weight:600;">'+escapeHtml(p.taskTitle||p.title||p.taskId||'?')+'</span>';
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
          html+='<span>'+escapeHtml(name)+'</span><span style="opacity:0.5;">$'+c.cost.toFixed(3)+' · '+c.calls+' calls</span></div>';
        });
      }
      el.innerHTML=html||'<div class="board-empty">No cost data available.</div>';
    }

    function _bRenderContent() {
      var el = document.getElementById('board-content-pipeline');
      var docs=[]; try{docs=CompanyStore.getStateSync('ap_documents',[])||[];}catch(e){}
      var published=docs.filter(function(d){return d.status==='published';}).length;
      var draft=docs.filter(function(d){return d.status==='draft';}).length;
      var review=docs.filter(function(d){return d.status==='ready_for_approval'||d.status==='review';}).length;
      if(docs.length===0){el.innerHTML='<div class="board-empty">No content in pipeline.</div>';return;}
      var html='<div class="board-content-row">';
      html+='<div class="board-content-pill"><div class="board-content-pill-val" style="color:#34d399;">'+published+'</div><div class="board-content-pill-label">Published</div></div>';
      html+='<div class="board-content-pill"><div class="board-content-pill-val" style="color:#60a5fa;">'+draft+'</div><div class="board-content-pill-label">Drafts</div></div>';
      html+='<div class="board-content-pill"><div class="board-content-pill-val" style="color:#fbbf24;">'+review+'</div><div class="board-content-pill-label">In Review</div></div></div>';
      el.innerHTML=html;
    }

    function _bRenderDirSection(listId, badgeId, dirs) {
      var listEl=document.getElementById(listId); var badge=document.getElementById(badgeId);
      badge.textContent=dirs.length;
      if(dirs.length===0){listEl.innerHTML='<div class="board-empty">None for this quarter.</div>';return;}
      listEl.innerHTML='';
      dirs.forEach(function(d){
        var pColor=d.priority==='critical'?'#ef4444':d.priority==='high'?'#fbbf24':d.priority==='medium'?'#8A2BE2':'#34d399';
        var sColor=d.status==='active'?'#34d399':d.status==='completed'?'#c084fc':d.status==='pending-approval'?'#fbbf24':'#6b7280';
        var div=document.createElement('div'); div.className='board-dir-card';
        div.innerHTML='<div style="flex:1;min-width:0;"><div style="font-size:0.85rem;font-weight:600;">'+escapeHtml(d.title)+'</div><div style="display:flex;gap:0.4rem;flex-wrap:wrap;margin-top:3px;font-size:0.6rem;opacity:0.5;"><span style="color:'+sColor+';">'+d.status+'</span><span style="color:'+pColor+';">'+(d.priority||'medium')+'</span>'+(d.owner?'<span>Owner: '+d.owner+'</span>':'')+'</div></div>';
        listEl.appendChild(div);
      });
    }

    function _bRenderDecisions() {
      var listEl=document.getElementById('board-decisions'); var badge=document.getElementById('badge-decisions');
      badge.textContent=_bPacket.decisions.length;
      if(_bPacket.decisions.length===0){listEl.innerHTML='<div class="board-empty">No decisions recorded this quarter.</div>';return;}
      listEl.innerHTML='';
      _bPacket.decisions.forEach(function(d){
        var sColor=d.decisionStatus==='Approved'?'#34d399':d.decisionStatus==='Rejected'?'#f87171':d.decisionStatus==='Deferred'?'#fbbf24':'#60a5fa';
        var div=document.createElement('div'); div.className='board-dir-card';
        div.innerHTML='<div style="flex:1;min-width:0;"><div style="font-size:0.8rem;font-weight:600;">'+escapeHtml(d.title)+'</div><div style="font-size:0.6rem;opacity:0.5;margin-top:2px;">'+(d.topicKey?d.topicKey+' · ':'')+new Date(d.date).toLocaleDateString('en-US',{month:'short',day:'numeric'})+'</div></div><span style="font-size:0.55rem;padding:2px 8px;border-radius:4px;background:'+sColor+'18;color:'+sColor+';font-weight:600;white-space:nowrap;">'+d.decisionStatus+'</span>';
        listEl.appendChild(div);
      });
    }

    function _bRenderRisks() {
      var listEl=document.getElementById('board-risks'); var badge=document.getElementById('badge-risks');
      badge.textContent=_bPacket.risks.length;
      if(_bPacket.risks.length===0){listEl.innerHTML='<div class="board-empty">No risks identified this quarter.</div>';return;}
      listEl.innerHTML='';
      var sevColors={critical:'#ef4444',high:'#f87171',medium:'#fbbf24',low:'#34d399'};
      _bPacket.risks.slice(0,10).forEach(function(r){
        var sColor=sevColors[r.severity]||'#fbbf24';
        var div=document.createElement('div'); div.className='board-dir-card';
        div.innerHTML='<div style="flex:1;min-width:0;"><div style="font-size:0.8rem;">'+escapeHtml(r.description)+'</div><div style="font-size:0.6rem;opacity:0.4;margin-top:2px;">From: '+escapeHtml(r.standupTitle||'?')+'</div></div><span style="font-size:0.55rem;padding:2px 8px;border-radius:4px;background:'+sColor+'18;color:'+sColor+';font-weight:600;white-space:nowrap;">'+r.severity+'</span>';
        listEl.appendChild(div);
      });
    }

    function _bRenderThroughput() {
      var el=document.getElementById('board-throughput'); var tp=_bPacket.throughput;
      el.innerHTML=
        '<div class="board-stat"><div class="board-stat-val" style="color:#60a5fa;">'+tp.tasksCreated+'</div><div class="board-stat-label">Tasks Created</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#34d399;">'+tp.tasksCompleted+'</div><div class="board-stat-label">Tasks Completed</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#fbbf24;">'+tp.pendingApprovalTasks+'</div><div class="board-stat-label">Pending Approval</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#c084fc;">'+_bPacket.decisions.length+'</div><div class="board-stat-label">Decisions Made</div></div>'+
        '<div class="board-stat"><div class="board-stat-val" style="color:#f87171;">'+_bPacket.risks.length+'</div><div class="board-stat-label">Risks Logged</div></div>';
    }

    function copyBoardPacket() {
      if(!_bPacket)return;
      var lines=[]; lines.push('# '+_bPacket.quarterKey+' Board Packet'); lines.push('');
      lines.push('## Executive Summary'); lines.push(_bPacket.execSummary); lines.push('');
      var objectives=AgentEngine.getObjectives?AgentEngine.getObjectives():[];
      var tasks=AgentEngine.getTasks?AgentEngine.getTasks():[];
      var doneTasks=tasks.filter(function(t){return t.status==='done';});
      var autoCompleted=doneTasks.filter(function(t){return !t.manuallyCompleted;}).length;
      var autonomyPct=doneTasks.length>0?Math.round((autoCompleted/doneTasks.length)*100):0;
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

    renderBoard();
    renderBoardBtn.addEventListener('click', renderBoard);
    copyBoardBtn.addEventListener('click', copyBoardPacket);
    window.addEventListener('companystoreready', function () { renderBoard(); });
  }

  window.initBoardView = initBoardView;
})();
