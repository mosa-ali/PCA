# 15 — App Usage, Browser and YouTube Visibility

## Reporting contract

**FR-ACT-01.** PCA reports only evidence it can lawfully and technically obtain. Each parent-facing record includes `source`, `coverage`, `precision`, `capture interval`, `permission/capability status`, and `retention state`. “Unavailable” is a valid result; missing evidence must never be displayed as zero use.

| Source | What PCA may report | Must not claim |
|---|---|---|
| Android UsageStats, with user-granted usage access | app/package usage aggregates and events available to the OS API | complete semantic activity inside the app or a non-bypassable control in Standard Mode. |
| iOS Family Controls / Device Activity, authorized and entitled | selected app/category/web-domain activity through Apple privacy-preserving tokens/reports | unrestricted bundle-level history or universal web history. |
| PCA Safe Browser | navigation it controls, with local URL/title/history policy | activity in unrelated browsers/apps. |
| Network/domain filter | destinations/domain-level evidence when available | full encrypted HTTPS URLs, content or video titles. |
| PCA controlled YouTube viewing | playback attempts/events and video IDs initiated inside that experience | the child’s complete normal YouTube-app watch history. |

Child-visible “What parents can see” wording is generated from this same capability state and therefore differs by platform/mode.

## App-usage normalization

The child agent converts raw supported OS signals into local `UsageSession` records: opaque platform app token/package where available, start/end or aggregate interval, source, confidence, policy scope and gaps. It deduplicates overlapping signals and preserves a `coverage_gap` rather than inventing an end time. Reboot, revoked usage access, OS history pruning, time change, unsupported device and process restart create an integrity/status event.

Only a parent-authorized, end-to-end encrypted family sync may copy those records to the parent device. PCA services do not persist readable app-use timelines. Parent reports distinguish “app usage only” from “content visited”; an app duration does not reveal messages, screens, searches, videos or contacts within the app.

## Browser visibility

PCA Safe Browser is a distinct, transparent product surface. It may retain full URL/title/history locally according to the family retention setting. Other-browser reporting remains domain-only or unavailable according to the active filtering capability. HTTPS path/query content is not inferred from ordinary network observation, and PCA does not use consumer TLS interception as a default design.

## YouTube: two deliberately different modes

### Mode A — Normal YouTube application

**VERIFIED_WITH_LIMITATION.** PCA can report YouTube application duration where the platform’s app-usage capability permits and can direct/configure platform or YouTube safety controls where they are available. It must label this as `app usage only`. It cannot fabricate an exact watched-video list from normal-app usage or network traffic.

The YouTube Data API exposes documented channel, playlist, video and related resources; its `playlists.list(mine=true)` endpoint can return playlists owned by an authenticated user with OAuth authorization. That existence is not a contract for a complete, exact, or normal-app watch-history feed. PCA must not rely on any returned playlist—whether a historical/watch-history-looking playlist appears for an account or not—as the child’s complete normal-app history, and must not advertise it as such. Product discovery must also respect account age, parental supervision, consent and API-scope rules.

### Mode B — PCA-controlled YouTube viewing experience

**REQUIRES_FURTHER_OWNER_DECISION and terms verification before release.** Where officially supported and legally/commercially approved, PCA may launch a compliant official YouTube embedded/player experience. Because PCA initiates the playback, it can maintain a local event for the chosen video ID, resolved title/channel metadata when permitted, start/stop/player-state events, observed duration and errors. This is “PCA-controlled viewing observed,” not proof the entire video was watched and not a record of viewing in the normal YouTube app.

The experience must retain the standard player features, attribution/branding, player UI and playback integrity required by the current YouTube API Services Terms and Developer Policies. It must not obscure player controls, alter or suppress ads, restrict standard player functionality, falsely identify the playback origin, or gate viewing with an unrelated reward/action. Some videos cannot be embedded; error results such as embedding-disabled content must be presented honestly. A release gate must re-verify the current Terms, Developer Policies, Required Minimum Functionality, IFrame API and any applicable account/child-directed-service rules.

## YouTube policy and privacy controls

Mode B selection is driven by deterministic parent policy first: approved channels/videos/playlists where available, age profile, search/content settings offered by YouTube, and a parent local allow/deny decision. It must not claim that an embed parameter or SafeSearch is a universal parental-control boundary. Optional on-device analysis applies only to metadata/content PCA is allowed to inspect, never as the sole safeguard.

Mode B events remain encrypted on family devices under the same retention/deletion controls as app activity. They are exportable only by the authorized parent. Parent reports label every item `Mode B—PCA-controlled`, include source/coverage and distinguish “started”, “played state observed”, and “completed signal observed”; no label says “watched” unless a documented evidence rule supports it.

## Acceptance and release evidence

**Acceptance evidence:** revoke/restore each platform permission; demonstrate report labels for every visibility state; prove no full YouTube history is shown in Mode A; test Mode B player errors, backgrounding, skips and partial playback; test deletion/export locally; and obtain a documented current YouTube terms/policy review before enabling Mode B in any production build.
