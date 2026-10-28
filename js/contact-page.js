// /contact/ — carry ?topic=... (e.g. from a Breakdown post) into the note's subject
(function () {
  var topic = new URLSearchParams(window.location.search).get('topic');
  var subject = document.querySelector('.contact-note input[name="subject"]');
  if (topic && subject) subject.value = 'topic: ' + topic.substring(0, 80);
})();
