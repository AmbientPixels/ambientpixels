/**
 * adventure-share.js — StoryForge publish + share link module
 */
window.AdventureShare = (function () {
  'use strict';

  var GALLERY_API = '/api/storyforgegallery';
  var SHARE_API = '/api/storyforgeshare?adventure=';

  // Publish a completed adventure to the public gallery
  function publishAdventure(adventureId) {
    return fetch(GALLERY_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adventureId: adventureId })
    })
    .then(function (res) {
      if (!res.ok) {
        return res.json().then(function (data) {
          throw new Error(data.error || 'Publish failed (' + res.status + ')');
        });
      }
      return res.json();
    })
    .then(function (data) {
      if (!data.success) throw new Error(data.error || 'Unknown error');
      return data;
    });
  }

  // Build the share URL for an adventure
  function getShareUrl(adventureId) {
    return window.location.origin + SHARE_API + encodeURIComponent(adventureId);
  }

  // Copy share link to clipboard
  function copyShareLink(adventureId) {
    var url = getShareUrl(adventureId);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(url).then(function () { return url; });
    }
    // Fallback
    var ta = document.createElement('textarea');
    ta.value = url;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
    return Promise.resolve(url);
  }

  return {
    publishAdventure: publishAdventure,
    getShareUrl: getShareUrl,
    copyShareLink: copyShareLink
  };
})();
