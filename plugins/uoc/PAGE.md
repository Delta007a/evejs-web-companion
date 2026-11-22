# Standalone Operations Center

Choose **UOC** in Farmer’s pinned plugins or the **Plugins** menu to open `/uoc/` in a separate browser tab. Each center has a bookmarkable URL. `npm run build:web` and `node plugins/uoc/build-page.mjs --with-core` build the same WC entry, including the registered UOC page.

UOC reads the saved account and character directory in this browser. The list itself needs no sign-in. When you choose a pilot or open an account-scoped view, UOC uses the existing WC account-only login for the relevant saved account. Its authorization stays in the UOC tab’s memory. Pilot selection in UOC verifies the current roster and control before handing the pilot to an operation.

WC Bot Host and the existing owner services handle gameplay sessions. A pilot already controlled by another browser tab keeps its owner. Distribution workspaces remain scoped to their respective owners.
