import { frag, html, richText } from '../lib/html.mjs';
import { layout } from '../lib/components.mjs';

/** Public Child App landing page. Distribution remains hidden until owner config exists. */
export function render(ctx) {
  const t = ctx.t;
  const destination = ctx.childAppDistributionUrl;

  const hero = html`<section class="pw-hero pw-hero--compact">
    <div class="pw-container">
      <h1 class="pw-hero__title">${richText(t('childApp.title'))}</h1>
      <p class="pw-hero__lead">${richText(t('childApp.body'))}</p>
    </div>
  </section>`;

  const availability = destination
    ? html`<section class="pw-section pw-section--raised">
        <div class="pw-container">
          <p class="pw-section__lead">${richText(t('childApp.ready'))}</p>
          <div class="pw-cta-row">
            <a class="pw-btn pw-btn--primary" href="${destination}" rel="noreferrer">${t('childApp.downloadCta')}</a>
          </div>
        </div>
      </section>`
    : html`<section class="pw-section pw-section--raised">
        <div class="pw-container">
          <p class="pw-section__lead" role="status">${richText(t('childApp.unavailable'))}</p>
        </div>
      </section>`;

  return layout(ctx, { main: frag([hero, availability]) });
}
