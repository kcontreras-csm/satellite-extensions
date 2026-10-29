# Astroverse

A Satellite extension (`astroverse`).

- **Edit and save.** Satellite reloads the extension and the pages it runs on every time you save a file
  (switch this off under Settings > Extensions).
- **See what happens.** `console.log` output and errors show up under Settings > Extensions > Logs.
  For deeper debugging, Safari > Develop > (your Mac) > Satellite opens the web inspector.
- **Autocomplete.** `.satellite/` holds type definitions for the `satellite` API and a schema for
  `manifest.json`; VS Code uses them automatically.
- **Share it.** Copy this folder into the store repository and push; its GitHub Action lists it. Delete the
  `.satellite` folder first if you like (it is only for your editor).

Reference: `satellite.storage`, `satellite.settings`, `satellite.ui`, `satellite.shortcuts`, `satellite.notify`, `satellite.openExternal`, `satellite.salesforce`.
