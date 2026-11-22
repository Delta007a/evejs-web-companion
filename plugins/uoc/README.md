# Unified Operations Center

UOC is a Web Companion plugin for planning and running multi-pilot operations. Open **UOC** from the pinned plugin strip or the **Plugins** menu. The same-origin tab at `/uoc/` uses WC account access. The Plugin Host owns the backend and Bot Host owns hosted gameplay sessions independently of the tab.

| Center | Available workflows |
| --- | --- |
| Mining Command Center | Saved operations and fleet roles, laser and drone mining, hauling, Defender combat, settlement and Return Home. Configure optional supply preparation from Personal Hangar or Corporation Division 1–7. |
| Civilian Missions | Delivery and Mining profiles with saved settings, history and a one-mission Continue action for accepted missions. Open Civilian Missions from MCC. |
| Distribution Center | Shared hauler fleet with Manual Delivery, Collection and Supply. Manual Delivery and Collection support selected items or the entire source division. |
| Pilot Training | Saved pilot and fitting goals, skill requirements and hosted training. |
| Ship Provisioning | Inspect and review fits, qualify stock and apply reviewed equipment and supplies. |
| Combat Operations Center | In development. Existing bookmarks show that status. |

Plugin registration lives in `plugin.ts` and `views.ts`. Hosted runs and scoped routes are registered in `backend.ts`. Persistence uses the existing plugin data directory. The standalone page and its links are documented in [PAGE.md](PAGE.md).

UOC uses WC's public Plugin API and the standard build. Run `npm run build:web` to build the shared client, including the standalone UOC page. The unit tests use synthetic pilots and scoped fixtures. Gameplay results apply to the scenarios actually observed.
