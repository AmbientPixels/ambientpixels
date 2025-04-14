// File: /js/nova-interaction-log.js — Tracks user interaction patterns for Nova's awareness system

(function () {
    const interactionData = {
      clicks: 0,
      idleTime: 0,
      lastActive: Date.now(),
      lastClickTime: null,
      scrollDepth: 0,
      interactionLog: []
    };
  
    // Detect clicks
    document.addEventListener('click', () => {
      interactionData.clicks++;
      interactionData.lastClickTime = new Date().toISOString();
      interactionData.lastActive = Date.now();
      interactionData.interactionLog.push({
        type: 'click',
        timestamp: new Date().toISOString()
      });
    });
  
    // Track scroll depth
    document.addEventListener('scroll', () => {
      const depth = Math.max(
        interactionData.scrollDepth,
        Math.floor(window.scrollY / document.body.scrollHeight * 100)
      );
      interactionData.scrollDepth = depth;
      interactionData.lastActive = Date.now();
    });
  
    // Idle time calculator
    setInterval(() => {
      const now = Date.now();
      const idle = now - interactionData.lastActive;
      if (idle >= 10000) {
        interactionData.idleTime += 10;
        interactionData.interactionLog.push({
          type: 'idle',
          duration: 10,
          timestamp: new Date().toISOString()
        });
      }
    }, 10000);
  
    // Expose data for Nova awareness scripts
    window.NovaInteraction = {
      getLog: () => interactionData,
      resetLog: () => {
        interactionData.clicks = 0;
        interactionData.idleTime = 0;
        interactionData.scrollDepth = 0;
        interactionData.interactionLog = [];
        interactionData.lastActive = Date.now();
      }
    };
  })();
  