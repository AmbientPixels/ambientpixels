// socialPlatforms.js — the canonical social platform lists, in one place.
//
// WHY THIS EXISTS
//
// The same array was written out by hand in roughly twenty files, and adding a platform
// meant finding all twenty. It has now failed twice in two days, both silently:
//
//   - `SOCIAL_PLATFORMS_ENABLED` (an Azure app setting, invisible to grep) never got
//     'facebook', so four CEO-approved scheduled posts would have been skipped with one
//     log line and left `pending` forever.
//   - `proposalDecide/materialize.js VALID_TASK_TYPES` never got 'social_facebook', so an
//     approved Facebook campaign silently materialized as a Bluesky campaign.
//
// Neither raised an error. That is the failure mode this module exists to stop: a missing
// list entry does not break anything loudly, it just quietly drops a channel.
//
// THE LISTS ARE NOT INTERCHANGEABLE. They differ by CAPABILITY, not by preference, and
// each one is named for the question it answers. Picking the wrong one is how Instagram
// ends up being handed a link it cannot render.
//
// Frontend note: this is a CommonJS module for the API only. `modules/company/js/*` and
// `js/company-schemas.js` keep their own copies because the browser cannot require() —
// when a platform is added, those still need updating by hand. Named here so that is a
// known duplication rather than a forgotten one.

// Every platform with an adapter, whether or not it can post by itself.
const ALL = ['x', 'linkedin', 'bluesky', 'reddit', 'facebook', 'instagram'];

// Platforms an executor can actually publish to without a human. Reddit is excluded: it
// is in actionsScheduler's _manualPlatforms and the CEO posts it by hand from the outbox.
const AUTO_PUBLISH = ['x', 'linkedin', 'bluesky', 'facebook', 'instagram'];

// Platforms that appear in analytics: follower counts, week-over-week deltas, engagement
// rollups, the weekly snapshot. Reddit has no account-stats puller.
const ANALYTICS = ['x', 'linkedin', 'bluesky', 'facebook', 'instagram'];

// Platforms whose post metrics can be re-read after publishing (outcome attribution).
const METRICS = ['x', 'twitter', 'bluesky', 'reddit', 'facebook', 'instagram'];

// Platforms where a URL in the post body is CLICKABLE.
//
// Instagram is deliberately absent. Captions render URLs as plain text, so a link posted
// there is dead on arrival — which is why instagram.js refuses any caption containing one.
// Anything that generates link-carrying posts (blog promotion, campaign link shapes) must
// use THIS list, not AUTO_PUBLISH, or it will queue posts the executor is going to reject.
const LINK_CAPABLE = ['x', 'linkedin', 'bluesky', 'reddit', 'facebook'];

// Platforms we harvest human replies/comments from into `engagementReplies`.
const REPLY_HARVEST = ['bluesky', 'facebook'];

// Platforms that render an ANIMATED image in-feed, and the container format each one
// actually animates. Absence means "send a still" — never "send it anyway and hope".
//
// The format is per-platform because the same file does NOT work everywhere:
//   x        — x.js maps image/gif -> tweet_gif (animated) but image/webp -> tweet_image
//              (STATIC). Sending X a WebP produces a still with none of the cost saved.
//   bluesky  — DELIBERATELY ABSENT. An animated WebP is ~118KB and clears its 1MB blob
//              limit eightfold, but whether the app animates an uploaded WebP rather than
//              flattening it to one frame is UNVERIFIED. Add it only after a real post
//              proves it. GIF is not an option: 1.2MB at 720x900, over the limit.
//   instagram— absent, and not a size problem. Motion there means Reels, which needs an
//              MP4 and a media_type=REELS container instagram.js does not build.
//   linkedin/reddit — not investigated.
const ANIMATED_IMAGE_FORMAT = {
  x: 'gif'
};

// taskType (`social_instagram`) ↔ platform (`instagram`), both directions.
const TASK_TYPE_BY_PLATFORM = {
  x: 'social_x',
  linkedin: 'social_linkedin',
  bluesky: 'social_bluesky',
  reddit: 'social_reddit',
  facebook: 'social_facebook',
  instagram: 'social_instagram'
};

const PLATFORM_BY_TASK_TYPE = Object.keys(TASK_TYPE_BY_PLATFORM).reduce(function (acc, p) {
  acc[TASK_TYPE_BY_PLATFORM[p]] = p;
  return acc;
}, {});

const SOCIAL_TASK_TYPES = ALL.map(function (p) { return TASK_TYPE_BY_PLATFORM[p]; });

// Display labels, so a dashboard never renders a bare slug.
const LABELS = {
  x: 'X', linkedin: 'LinkedIn', bluesky: 'Bluesky',
  reddit: 'Reddit', facebook: 'Facebook', instagram: 'Instagram'
};

module.exports = {
  ALL,
  AUTO_PUBLISH,
  ANALYTICS,
  METRICS,
  LINK_CAPABLE,
  REPLY_HARVEST,
  ANIMATED_IMAGE_FORMAT,
  TASK_TYPE_BY_PLATFORM,
  PLATFORM_BY_TASK_TYPE,
  SOCIAL_TASK_TYPES,
  LABELS
};
