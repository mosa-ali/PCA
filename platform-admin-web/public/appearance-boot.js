try {
  // eslint-disable-next-line no-restricted-properties -- This persists only the non-secret appearance preference, never session data.
  const savedAppearance = window.localStorage.getItem('pca-platform-appearance');
  const appearance = ['dark', 'slate', 'light'].includes(savedAppearance) ? savedAppearance : 'dark';
  document.documentElement.dataset.appearance = appearance;
  document.documentElement.style.colorScheme = appearance === 'light' ? 'light' : 'dark';
} catch {
  document.documentElement.dataset.appearance = 'dark';
}
