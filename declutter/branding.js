// Case Page Declutter: hides the "Support Console" app name in the navigation
// bar and, if turned on in the settings, the org logo in the global header.
// branding.css does the hiding from classes on <html>. The app name is hidden
// until .sat-show-appname says otherwise, so it never flashes while the page
// loads. Wrapped in its own scope so nothing here can clash with content.js.
(() => {
  const root = document.documentElement;
  const DEFAULTS = { hideAppName: true, hideLogo: false };
  const state = { ...DEFAULTS };

  function apply() {
    root.classList.toggle('sat-show-appname', !state.hideAppName);
    root.classList.toggle('sat-hide-logo', state.hideLogo);
  }

  async function load() {
    for (const key of Object.keys(DEFAULTS)) {
      const value = await satellite.settings.get(key);
      state[key] = value == null ? DEFAULTS[key] : Boolean(value);
    }
    apply();
  }

  const reload = () => load().catch(error => console.error('[declutter] branding settings', error));

  // If anything rewrites <html class>, put our classes back.
  new MutationObserver(apply).observe(root, { attributes: true, attributeFilter: ['class'] });
  // Re-read the settings whenever they change in Satellite.
  satellite.settings.onChange(reload);

  apply();
  reload();
})();
