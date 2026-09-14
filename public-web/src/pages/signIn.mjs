import { html, layout, richText } from '../lib/components.mjs';

export function render(ctx) {
  const t = ctx.t;
  return layout(ctx, { main: html`
    <section class="pw-hero"><div class="pw-container">
      <h1 class="pw-hero__title">${richText(t('signIn.hero.title'))}</h1>
      <p class="pw-hero__lead">${richText(t('signIn.hero.body'))}</p>
    </div></section>
    <section class="pw-section pw-section--raised"><div class="pw-container pw-card-grid">
      <article class="pw-card"><h2 class="pw-card__title">${richText(t('signIn.parent.title'))}</h2><p class="pw-card__body">${richText(t('signIn.parent.body'))}</p><a class="pw-btn pw-btn--primary" href="/parent/login/">${t('signIn.parent.cta')}</a></article>
      <article class="pw-card"><h2 class="pw-card__title">${richText(t('signIn.admin.title'))}</h2><p class="pw-card__body">${richText(t('signIn.admin.body'))}</p><a class="pw-btn pw-btn--primary" href="/platform-admin/login/">${t('signIn.admin.cta')}</a></article>
    </div></section>` });
}
