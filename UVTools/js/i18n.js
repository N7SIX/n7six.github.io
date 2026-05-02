// js/i18n.js
// Very light i18n loader with JSON files (lazy-load per language).
// Adds: window.i18nReady (Promise) and dispatches "i18n:ready" event.
// If locale fetch fails, a friendly error is shown in #infoBox.
// All comments in English.

(function () {
  const DEFAULT_LANG = localStorage.getItem('uv-k5-flasher-lang') || 'en';
  const supported = ['en', 'fr', 'zh']; // add other codes (it, es, de) when files exist

  // Load a locale JSON file, throws on file:// or fetch errors
  async function loadLocale(lang) {
    // Guard against file:// origin which blocks fetch
    if (location.protocol === 'file:') {
      throw new Error(
        'This page is opened via file://. Serve it over http://localhost or HTTPS so JSON fetch & Web Serial work.'
      );
    }

    const res = await fetch(`./locales/${lang}.json`, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Failed to load locale: ${lang}`);
    return res.json();
  }

  const i18n = {
    lang: DEFAULT_LANG,
    dict: {},
    // Initialize i18n: load default language, set selector, bind change handler
    async init() {
      await this.setLanguage(this.lang);
      const sel = document.getElementById('languageSelect');
      if (sel) sel.value = this.lang;
      this.bindSelector();
      // Broadcast ready so other modules can initialize safely
      window.dispatchEvent(new CustomEvent('i18n:ready', { detail: { lang: this.lang } }));
    },
    bindSelector() {
      const sel = document.getElementById('languageSelect');
      if (!sel) return;
      sel.addEventListener('change', async (e) => {