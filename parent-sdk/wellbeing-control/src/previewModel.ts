/**
 * UI-independent preview model (doc 36 section 13). Agent 7's parent-web UI
 * consumes this to render a preview without needing to know delivery-surface
 * or redaction rules itself.
 *
 * The public/lock-screen preview defaults to a generic, non-revealing
 * presentation and never includes private custom-message text unless the
 * parent has explicitly selected a private presentation and the surface is
 * one this contract has verified is authorized to show it (doc 36 section 9,
 * section 13) -- adult-supervision-required messages are always redacted here.
 */

import { validateAdultSupervisionSurface } from './validators.js';
import type { CustomWellbeingMessage, LanguageTag, PreviewSurface } from './types.js';

export interface PreviewCard {
  readonly surface: PreviewSurface;
  readonly redacted: boolean;
  readonly title: string;
  readonly body: string;
  readonly languageTag: LanguageTag | null;
  readonly direction: 'ltr' | 'rtl';
}

const RTL_LANGUAGE_TAGS = new Set(['ar']);
const GENERIC_REDACTED_TITLE = 'Wellbeing reminder';
const GENERIC_REDACTED_BODY = 'You have a new wellbeing message.';

function directionFor(languageTag: LanguageTag): 'ltr' | 'rtl' {
  return RTL_LANGUAGE_TAGS.has(languageTag) ? 'rtl' : 'ltr';
}

function resolveText(message: CustomWellbeingMessage, languageTag: LanguageTag): { title: string; body: string } | null {
  const direct = message.languageTexts[languageTag];
  if (direct !== undefined) return direct;
  return null;
}

function buildsRedactedCard(surface: PreviewSurface, message: CustomWellbeingMessage): boolean {
  if (surface === 'LOCK_SCREEN_REDACTED') return true;
  if (surface === 'STANDARD_NOTIFICATION') {
    return validateAdultSupervisionSurface(message.delivery, 'STANDARD_NOTIFICATION').length > 0;
  }
  return false;
}

/**
 * Builds a preview card for one message/surface/language combination.
 * `languageTag` selects which language variant to show for non-redacted
 * surfaces; `ARABIC_RTL`/`ENGLISH` surface requests force `ar`/`en`
 * respectively regardless of the passed tag, matching doc 36's explicit
 * locale-oriented preview surfaces.
 */
export function buildPreviewCard(message: CustomWellbeingMessage, surface: PreviewSurface, languageTag: LanguageTag = 'en'): PreviewCard {
  const effectiveLanguageTag = surface === 'ARABIC_RTL' ? 'ar' : surface === 'ENGLISH' ? 'en' : languageTag;
  const normalizedSurface: PreviewSurface = surface === 'ARABIC_RTL' || surface === 'ENGLISH' ? 'IN_APP_SMALL_CARD' : surface;

  if (buildsRedactedCard(normalizedSurface, message)) {
    return {
      surface,
      redacted: true,
      title: GENERIC_REDACTED_TITLE,
      body: GENERIC_REDACTED_BODY,
      languageTag: null,
      direction: 'ltr',
    };
  }

  const text = resolveText(message, effectiveLanguageTag);
  if (text === null) {
    return {
      surface,
      redacted: true,
      title: GENERIC_REDACTED_TITLE,
      body: GENERIC_REDACTED_BODY,
      languageTag: null,
      direction: 'ltr',
    };
  }

  return {
    surface,
    redacted: false,
    title: text.title,
    body: text.body,
    languageTag: effectiveLanguageTag,
    direction: directionFor(effectiveLanguageTag),
  };
}
