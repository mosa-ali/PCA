import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { Link, useLocation } from 'react-router-dom';
import { GUIDE_CATEGORIES, GUIDE_TOPIC_BY_ID, GUIDE_TOPICS } from '../../guide/guideTopics';
import type { GuideAvailability, GuideTopic } from '../../guide/guideTypes';
import './parentGuide.css';

function translatedList(t: TFunction, key: string): string[] {
  const value = t(key, { returnObjects: true });
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

function translatedText(t: TFunction, key: string): string {
  const value = t(key);
  return typeof value === 'string' ? value : '';
}

function topicMatches(
  topic: GuideTopic,
  query: string,
  t: TFunction,
): boolean {
  const contentKey = topic.contentKey;
  const searchText = [
    translatedText(t, `${contentKey}.title`),
    translatedText(t, `${contentKey}.summary`),
    translatedText(t, `${contentKey}.purpose`),
    translatedText(t, `${contentKey}.when`),
    translatedText(t, `${contentKey}.next`),
    translatedText(t, `${contentKey}.important`),
    ...translatedList(t, `${contentKey}.actions`),
    ...translatedList(t, `${contentKey}.steps`),
    ...topic.searchTerms,
  ].join(' ').toLocaleLowerCase();

  return query
    .toLocaleLowerCase()
    .split(/\s+/u)
    .filter(Boolean)
    .every((term) => searchText.includes(term));
}

function AvailabilityBadge({ availability, label }: { availability: GuideAvailability; label: string }) {
  return (
    <span className={`guide-availability guide-availability--${availability}`}>
      {label}
    </span>
  );
}

function TopicSection({ heading, children }: { heading: string; children: ReactNode }) {
  return (
    <section className="guide-topic-section">
      <h4>{heading}</h4>
      {children}
    </section>
  );
}

function TopicCard({ topic, t }: { topic: GuideTopic; t: TFunction }) {
  const contentKey = topic.contentKey;
  const actions = translatedList(t, `${contentKey}.actions`);
  const steps = translatedList(t, `${contentKey}.steps`);
  const relatedTopics = topic.relatedTopicIds
    .map((id) => GUIDE_TOPIC_BY_ID.get(id))
    .filter((related): related is GuideTopic => related !== undefined);

  return (
    <article className="guide-topic" id={`guide-topic-${topic.id}`}>
      <div className="guide-topic-heading">
        <div>
          <h3>{t(`${contentKey}.title`)}</h3>
          <p className="guide-topic-summary">{t(`${contentKey}.summary`)}</p>
        </div>
        <AvailabilityBadge availability={topic.availability} label={t(`guide.availability.${topic.availability}`)} />
      </div>

      <div className="guide-topic-content">
        <TopicSection heading={t('guide.whatFor')}>
          <p>{t(`${contentKey}.purpose`)}</p>
        </TopicSection>
        <TopicSection heading={t('guide.whenToUse')}>
          <p>{t(`${contentKey}.when`)}</p>
        </TopicSection>

        {actions.length > 0 && (
          <TopicSection heading={t('guide.whatYouCanDo')}>
            <ul>
              {actions.map((action) => <li key={action}>{action}</li>)}
            </ul>
          </TopicSection>
        )}

        {steps.length > 0 && (
          <TopicSection heading={t('guide.howToUse')}>
            <ol>
              {steps.map((step) => <li key={step}>{step}</li>)}
            </ol>
          </TopicSection>
        )}

        <TopicSection heading={t('guide.whatHappensNext')}>
          <p>{t(`${contentKey}.next`)}</p>
        </TopicSection>

        <TopicSection heading={t('guide.importantToKnow')}>
          <p>{t(`${contentKey}.important`)}</p>
        </TopicSection>
      </div>

      <footer className="guide-topic-footer">
        {topic.openPagePath && (
          <Link className="btn btn-secondary guide-open-link" to={topic.openPagePath}>
            {t('guide.openPage')}
          </Link>
        )}
        {relatedTopics.length > 0 && (
          <div className="guide-related">
            <h4>{t('guide.relatedTopics')}</h4>
            <ul>
              {relatedTopics.map((related) => (
                <li key={related.id}>
                  <a href={`#guide-topic-${related.id}`}>{t(`${related.contentKey}.title`)}</a>
                </li>
              ))}
            </ul>
          </div>
        )}
      </footer>
    </article>
  );
}

export default function ParentGuide() {
  const { t } = useTranslation();
  const location = useLocation();
  const [query, setQuery] = useState('');

  const searchResults = useMemo(() => {
    const trimmedQuery = query.trim();
    if (!trimmedQuery) return [];
    return GUIDE_TOPICS.filter((topic) => topicMatches(topic, trimmedQuery, t));
  }, [query, t]);

  useEffect(() => {
    if (!location.hash) return;
    const targetId = decodeURIComponent(location.hash.slice(1));
    const target = document.getElementById(targetId);
    if (!target) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    window.requestAnimationFrame(() => target.scrollIntoView({ behavior: reducedMotion ? 'auto' : 'smooth', block: 'start' }));
  }, [location.hash]);

  return (
    <div className="guide-page">
      <header className="guide-hero">
        <p className="guide-eyebrow">{t('guide.eyebrow')}</p>
        <h1 id="parent-guide-title">{t('guide.title')}</h1>
        <p className="guide-intro">{t('guide.intro')}</p>
        <div className="guide-search" role="search" aria-label={t('guide.searchLabel')}>
          <label htmlFor="guide-search-input" className="visually-hidden">{t('guide.searchLabel')}</label>
          <input
            id="guide-search-input"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('guide.searchPlaceholder')}
            aria-controls={query.trim() ? 'guide-search-results' : undefined}
          />
          {query && (
            <button type="button" className="btn btn-secondary guide-clear-search" onClick={() => setQuery('')}>
              {t('guide.clearSearch')}
            </button>
          )}
        </div>
      </header>

      {query.trim() && (
        <section className="guide-search-results" id="guide-search-results" aria-labelledby="guide-search-results-title">
          <h2 id="guide-search-results-title">{t('guide.searchResults', { count: searchResults.length })}</h2>
          {searchResults.length === 0 ? (
            <p>{t('guide.noResults')}</p>
          ) : (
            <ul>
              {searchResults.map((topic) => (
                <li key={topic.id}>
                  <a href={`#guide-topic-${topic.id}`}>
                    <span>{t(`${topic.contentKey}.title`)}</span>
                    <span>{t(`${topic.contentKey}.summary`)}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <div className="guide-layout">
        <aside className="guide-contents" aria-labelledby="guide-contents-title">
          <h2 id="guide-contents-title">{t('guide.contents')}</h2>
          <nav aria-label={t('guide.contents')}>
            <ol>
              {GUIDE_CATEGORIES.map((category) => (
                <li key={category.id}>
                  <a href={`#guide-category-${category.id}`}>{t(category.titleKey)}</a>
                </li>
              ))}
            </ol>
          </nav>
        </aside>

        <div className="guide-topic-groups">
          {GUIDE_CATEGORIES.map((category) => {
            const topics = GUIDE_TOPICS.filter((topic) => topic.category === category.id);
            return (
              <section key={category.id} id={`guide-category-${category.id}`} className="guide-category" aria-labelledby={`guide-category-title-${category.id}`}>
                <h2 id={`guide-category-title-${category.id}`}>{t(category.titleKey)}</h2>
                <div className="guide-topic-list">
                  {topics.map((topic) => <TopicCard key={topic.id} topic={topic} t={t} />)}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
