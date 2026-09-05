/**
 * PUBLIC-2r2 — PUBLIC VIDEO SCRIPTS (English).
 *
 * Two owner-commissioned videos, registered in src/content/videos.mjs and
 * rendered by videoBlock() in src/lib/components.mjs:
 *
 *   video.intro   "PCA Introduction"      60-90s   -> Home
 *   video.enroll  "How to Enroll with PCA" 60-120s -> How PCA Works
 *
 * THIS FILE IS THE SCRIPT *AND* THE ACCESSIBLE TRANSCRIPT. videoBlock renders
 * `transcript` as a visible ordered list in BOTH the available and unavailable
 * states, per the owner ruling that video must never be the only way to obtain
 * critical information. So every entry below is written as a spoken narration
 * line that also reads correctly as standalone text -- no camera directions, no
 * "SCENE 3:" prefixes, no numbering (the <ol> supplies the numbers).
 *
 * NEW COPY. Unlike the page tables, none of this is transcribed from
 * PCA_PUBLIC_CONTENT_EN.md v0.2 -- the approved documents contain no video
 * scripts. Every key here is authored, listed in the coordinator's newCopyKeys
 * report, and every Arabic counterpart is pending native sign-off (OD-12).
 *
 * VISUAL DIRECTION (kept in this comment, never in parent-facing text):
 *
 *   INTRO, scene by scene -- 1: everyday care in physical places (a hand held
 *   at a crossing, a school gate, a park). 2: the same family, same warmth,
 *   with a phone or tablet in frame. 3: an adult's hands and a child's, no
 *   face, no name, no biography (OD-04). 4-5: calm product motion -- a simple
 *   schedule filling in, a request arriving and being answered. 6-7: an
 *   abstract, friendly diagram of protection staying on the family side. 8:
 *   ordinary homes, varied and unglamorous. 9: the PCA mark and the CTA.
 *   EXPLICITLY FORBIDDEN by the owner: fear, hackers, hooded figures,
 *   distressed children, surveillance or monitoring-screen imagery.
 *
 *   ENROLL -- one clean, generic UI abstraction per scene (shapes and labels,
 *   not a real screen recording), plus a neutral device silhouette. NO real
 *   Android screenshots and NO physical-device footage may be produced or
 *   implied: PCA Child has not passed physical-device UAT, so mock visuals are
 *   the only honest option. Real recordings replace them only after that UAT
 *   passes -- and `available` in videos.mjs stays false until the recordings
 *   and caption files actually exist.
 *
 * CLAIM DISCIPLINE. Transcript entries are plain strings; videoBlock attaches
 * no per-line claim label, and none is wanted here. The card itself carries the
 * registered CLM-059 "Coming later" status while no recording exists, so a
 * parent is never told a video is playable when it is not.
 *
 * DEF-1. Scene 4 of the enrollment script uses the owner-approved replacement
 * sentence for iPhone/iPad (CLM-026) instead of the internal directive embedded
 * in the v0.2 source. No claim id, no security-review workflow and no
 * implementation instruction is ever spoken.
 *
 * FILE OWNERSHIP: exactly one writer owns this file. Do NOT edit
 * src/content/index.mjs, routes.mjs, claims.mjs, videos.mjs, build.mjs or any
 * shared component from here -- the coordinator registers content and owns those.
 */

export default {
  // No /video route exists; these satisfy the standard content-bundle contract
  // and give a future video/help route approved metadata. Nothing renders them
  // today -- layout() only reads seo keys for a routeId in routes.mjs.
  "video.seo.title": "PCA Videos — Introduction and Setup",
  "video.seo.description": "Two short PCA videos with full written transcripts: why PCA exists, and how to set up protection for your child step by step.",

  "video.intro.title": "PCA Introduction",
  "video.intro.summary": "A short introduction to why PCA exists, what it helps you do day to day, and how it is designed to protect your child without building a readable central profile of their activity.",
  "video.intro.transcript": [
    "Children are protected everywhere they go — at home, at school, in the places where they play.",
    "The digital spaces where they spend time deserve that same everyday care.",
    "PCA began with a father's concern for his own children, and the belief that online life should not be the exception.",
    "So PCA is built to help with the everyday things where the child's platform supports them: screen time, safer browsing, app and web controls, and schedules that suit your family.",
    "It can tell you when something needs your attention, and it gives your child a clear way to ask for more time or access.",
    "PCA also takes a different approach to privacy: it is designed to protect your child without building a readable central profile of them.",
    "Routine protection does not require PCA to collect your child's photos, videos, files or messages.",
    "We believe a safer digital world should not depend on a family's income, so affordability and broad access are part of how PCA is designed.",
    "Start protecting your child's digital spaces. See how PCA works, step by step."
  ],

  "video.enroll.title": "How to Enroll with PCA",
  "video.enroll.summary": "The whole setup walked through end to end, from creating your parent account to reviewing protection status, so you know what to expect before you begin.",
  "video.enroll.transcript": [
    "Start by creating your PCA Parent account with your email address and a password.",
    "Open your inbox and confirm your email address to activate the account.",
    "Add your child inside PCA Parent. You only need enough detail to tell one child's protection from another's.",
    "Choose the platform your child's device uses. Android is the planned first platform for PCA Child, and iPhone and iPad child protection is planned for a later release.",
    "Create an invitation for that child. The invitation is what links a device to your family and to no one else's.",
    "When PCA Child is released, you will install it and open it on your child's device.",
    "Enter the setup code from the invitation, or open the setup link, so the child device and your parent account are matched to each other.",
    "Confirm the connection on the child device and allow the permissions PCA needs to apply your rules.",
    "Back in PCA Parent, choose the protections that fit this child: screen time, schedules, and app or web controls where the platform supports them.",
    "Finally, review the protection status, so you can see whether protection is working and what needs your attention."
  ]
};
