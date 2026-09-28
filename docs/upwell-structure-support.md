# Upwell / player structure support

Web Companion (WC) could already recognize and dock at a player structure in
limited contexts, but destination pickers, saved routes, docked inventory, and
higher-level workflows still often assumed an NPC station. This integration
makes a structure that the selected pilot can access a first-class **dockable
location**, without treating every structure as a station with every service.

The shared location model keeps NPC station IDs and player structure IDs
distinct. Old station references in saved scripts, Mining Command Center (MCC)
destinations, and Pilot Training Home remain valid without migration. New
structure references persist by stable `structureID`, not display name.

## Capabilities and verification

| Capability | Structure support and verification |
| --- | --- |
| Search, travel, dock | **Live verified.** Accessible structures appear by name. Access is rechecked before travel; cross-system route, warp/approach, docking, and final `structureID` confirmation were exercised on an isolated Astrahus. The docked context identifies a structure without inventing an NPC station. |
| Personal hangar | **Live verified.** Ship-to-structure-hangar and reverse transfers were reread on both sides. |
| Corporation office and divisions | **Live verified.** An office was established through EveJS authority. Ship-to-selected-division and reverse transfers were checked. Strict corporate delivery rereads the exact division and ship holds: personal-hangar fallback cannot count as success. |
| Fitting | **Live verified.** A module was fitted, reread, and removed again at a structure with fitting service. |
| MCC parking and unloading | **Live verified.** `RETURN_HOME_DOCK`, `RETURN_HOME_UNLOAD_DOCK` to a personal hangar, and `RETURN_HOME_UNLOAD_DOCK` to an exact corporation division were exercised. Hauler Service and Self-Unload can use a qualified structure. Parking and delivery destinations remain separate. MCC unloads authorized mining freight holds, not unrelated ordinary cargo or equipment. |
| Pilot Training Home | **Mechanically and authority verified.** The accessible structure resolved in live EveJS state and Home configuration was saved. Home is configuration only: saving it does not move or teleport the pilot. A browser F5 reload was not part of final live acceptance. |
| Repair | **Service/quote verified.** No repair mutation was forced on an undamaged test ship. |
| Reprocessing | **Service/quote verified.** No destructive reprocessing of an unsuitable small test stack was forced. |
| Market | **External dependency blocked during QA.** The structure's market service was online, but the test world's global market daemon returned “Market is currently offline.” No transaction is claimed as live verified. |
| Industry | **Facility read verified.** The structure appeared as a manufacturing facility with the relevant online service. No manufacturing job was started just for QA. |
| Agent and mission destinations | **Intentionally NPC-station-only.** Docking access does not make a structure an agent station. |
| Compression, clones, repair-watch Home | **Intentionally not generalized.** Compression remains the existing ship/in-space feature; clone APIs stay separate; repair-watch Home remains NPC-station-only. |

The service state is checked per operation. Docking permission alone does not
prove an office, division rights, fitting, repair, reprocessing, market, or
industry access. Missing or offline services remain unavailable. Structure
discovery is limited to structures the selected pilot may dock at, and access
is checked again before a live route or dock action.

## Where the work lives

- **EveJS runtime patch:** adds narrow, authoritative structure discovery and
  service reads to the WC gateway.
- **WC server/BFF:** binds calls to the held pilot, checks access and destination
  capability, and orchestrates strict, verified transfers.
- **WC web client:** presents named station or structure destinations and shows
  only supported services in the docked context.
- **MCC and Pilot Training:** consume the same dockable-location model instead
  of keeping separate structure identities.

## Why does this require an EveJS server patch?

The stock EveJS **0.12.9** gateway did not expose all authority needed to find
accessible structures across systems and read their usable services safely.
WC source alone cannot supply that authority. The portable patches are shipped
in this WC repository for review; they are not a replacement EveJS distribution.

Apply [dockable-structure-search.patch](../runtime-patches/dockable-structure-search.patch)
first, then [accessible-structure-services.patch](../runtime-patches/accessible-structure-services.patch).
The first extends an explicit `GetMyDockableStructures(0)` request to return
access-filtered structures across systems; the omitted/current-system call keeps
its previous meaning. The second adds service reads and scoped office rental.

Together the two patches affect these EveJS runtime files:

| File | Purpose |
| --- | --- |
| `server/src/services/structure/structureDirectoryService.js` | Returns only dockable structure IDs and online service IDs available to the selected pilot. It does not disclose arbitrary owner-only operational details. |
| `server/src/_secondary/express/evejsWebGatewayRuntime.js` | Allowlists the narrow service read and existing `officeManager.RentOffice` call through WC's gateway. |
| `server/contracts/evejs-web-bridge-contract.json` | Declares the matching allowed bridge calls so WC and EveJS agree on the interface. |

The contract path above is the actual path in the shipped patch. WC exposes
`RentOffice` through a confirmation-gated route bound to the held pilot and
location. An independent review found and fixed a possible generic bridge-call
bypass before publication: an ordinary arbitrary bridge call cannot use that
write authority. The patches add no ACL editor, structure-management backdoor,
or unrestricted remote-call access. A corporation transfer additionally checks
the selected corporation, office, division rights, and exact post-transfer
destination; it cannot silently succeed by falling back to personal inventory.

## Install on EveJS 0.12.9

Use a **mutable runtime copy**, such as your normal `EveJS-0.12.9` installation
or a separate `EveJS-0.12.9-test` copy. Keep a clean reference available and
back up the three affected files before applying patches. WC source changes
alone cannot provide the access-scoped, all-system structure search and service
read.

From the root of the mutable EveJS runtime, replace `/path/to/wc` with the
location of this WC checkout (quote the path if it contains spaces):

```sh
git apply --check "/path/to/wc/runtime-patches/dockable-structure-search.patch"
git apply "/path/to/wc/runtime-patches/dockable-structure-search.patch"
git apply --check "/path/to/wc/runtime-patches/accessible-structure-services.patch"
git apply "/path/to/wc/runtime-patches/accessible-structure-services.patch"
```

Use [runtime-hashes.json](../runtime-patches/runtime-hashes.json) to compare the
clean-reference, intermediate search-patch, and audited composed-runtime
SHA-256 values. The manifest also records hashes for other WC runtime patches;
one final digest is meaningful only for the matching patch composition. Inspect
any local differences before applying to a customized runtime. If a patch may
already be installed, `git apply --reverse --check "path/to/patch.patch"` tests that
possibility without changing files.

Restart EveJS through your **normal launcher/startup/mod-loader path**, then
start or update WC through its normal process. Do not bypass the mod loader to
test this change. Select a pilot that already has docking access and verify
that its structure appears by name in WC destination search. Access and online
services can differ by pilot and structure.

### Roll back

Stop EveJS. If the patched files still match, reverse the patches in opposite
order from the EveJS runtime root:

```sh
git apply --reverse "/path/to/wc/runtime-patches/accessible-structure-services.patch"
git apply --reverse "/path/to/wc/runtime-patches/dockable-structure-search.patch"
```

Otherwise restore the backed-up files. Restart through the same normal
launcher/mod-loader path. These patches target **EveJS 0.12.9**; for another
EveJS version, review and port the semantic changes rather than blindly
applying the file diffs.

## About this Delta branch

The public [`delta/tokeiito-integration`](https://github.com/Delta007a/evejs-web-companion/tree/delta/tokeiito-integration)
branch builds on [Farmer's original Web Companion](https://github.com/rrfarmer/evejs-web-companion),
[Tokeiito's substantial extensions](https://github.com/Tokeiito/evejs-web-companion),
and further Delta work. Farmer created the upstream project; Tokeiito's work
forms the lineage this integration originally used; Delta added features such
as Pilot Training, MCC, shared Upwell support, and further safety/performance
changes. Credit for the base work remains with Farmer and Tokeiito.

This branch is public for testing, review, experimentation, feedback, and use
by private-server operators willing to apply the documented runtime patches.
It is **not** a PR to Farmer or Tokeiito, a request to merge the whole Delta
tree, or a claim that this integration history is ready for upstream merge.
Farmer's upstream has since merged a substantial series of Tokeiito changes.
The next stage is to audit Farmer's current code, classify Delta changes as
already upstream, overlapping, Delta-only, obsolete, or dependencies, then
adapt the useful features to that current architecture in clean, reviewable
groups. That future work is a forward port, not a replay of this branch's
history; its PR order will follow the audit and actual dependencies.
