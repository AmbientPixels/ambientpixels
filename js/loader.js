// File: /js/loader.js – Load ALL scripts on ALL pages (dev mode)

document.addEventListener("DOMContentLoaded", () => {
    const allScripts = [
      'main',
      'nav',
      'theme',
      'init-header-footer',
      'modal-window',
      'nova-status',
      'nova-dashboard',
      'nova-mood-core',
      'nova-quotes',
      'nova-awareness-feed',
      'md-inject',
      'dreamEngine',
      'nova-ai',
      'project-dashboard',
      'nova-insights',
      'nova-pulse',
      'nova-interaction-log',
      'nova-telemetry-logger'
    ];
  
    allScripts.forEach(name => {
      const script = document.createElement('script');
      script.src = `/js/${name}.js`;
      script.defer = true;
      document.body.appendChild(script);
    });
  
    console.log(`[Loader] Injected all scripts (dev mode)`);
  });
  