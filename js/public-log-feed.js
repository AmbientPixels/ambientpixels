// public-log-feed.js
// Shared public-safe data access for Activity Log and Nova Preview
(function () {
  'use strict';

  function getApiBase() {
    return (window.location.hostname.indexOf('ambientpixels.ai') !== -1)
      ? 'https://ambientpixels-nova-api.azurewebsites.net/api'
      : '/api';
  }

  function ensureArray(payload) {
    if (Array.isArray(payload)) return payload;
    if (payload && Array.isArray(payload.entries)) return payload.entries;
    return [];
  }

  function fetchDailyLogFeed() {
    return fetch(getApiBase() + '/dailyLog')
      .then(function (res) {
        if (!res.ok) throw new Error('dailyLog fetch failed: ' + res.status);
        return res.json();
      })
      .then(ensureArray);
  }

  function fetchDailyLogByDate(date) {
    return fetch(getApiBase() + '/dailyLog?date=' + encodeURIComponent(date))
      .then(function (res) {
        if (res.status === 404) {
          var notFound = new Error('not_found');
          notFound.code = 'NOT_FOUND';
          throw notFound;
        }
        if (!res.ok) {
          var serverErr = new Error('server_error');
          serverErr.code = 'SERVER_ERROR';
          throw serverErr;
        }
        return res.json();
      });
  }

  window.PublicLogFeed = {
    getApiBase: getApiBase,
    fetchDailyLogFeed: fetchDailyLogFeed,
    fetchDailyLogByDate: fetchDailyLogByDate
  };
})();
