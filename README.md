# EveJS Web Client

This experimental integration builds on [Farmer's original Web Companion](https://github.com/rrfarmer/evejs-web-companion)
and [Tokeiito's subsequent extensions](https://github.com/Tokeiito/evejs-web-companion).
They created the foundation; Delta's additions below continue that work.

- **[Pilot Training](docs/pilot-training.md)** at `/pilot-training`: new or existing
  trainees, up to three corporation-fitting qualification contracts per role, direct
  skill purchase, optional corporation onboarding/funding and reviewed queue application.
- **[Mining Command Center](docs/mining-command-center.md)** at `/mining-command-center`:
  coordinated Belt/Ore Anomaly/Ice operations, Hauler Service or Self-Unload, Fleet
  Parking, locality/resource preferences, Travel Assist and hosted timing/recovery.

GAS, adjacent scouting, dedicated operation Defender execution, equipment provisioning,
citadel relocation, a general role taxonomy and production password registration are
not implemented. See [integration history and verification](docs/DELTA-INTEGRATION.md) and
[Pilot Training runtime setup](docs/pilot-training-runtime-setup.md) before upgrading.
`/goblin-factory` remains a compatibility redirect to `/pilot-training`.

A **no-graphics, browser-based client for EveJS** — play EVE Online through
a web page instead of the retail 3D client, by driving the **same service calls the
retail client makes** against the same EveJS handlers.

EveJS is the game server and the sole authority. This app is an *alternate client*, not
another simulation: it renders no 3D scene and runs no game logic of its own. It shows
you the game as lists, panels, and a HUD, and every action it takes is a real retail
call the server validates exactly as it would for the retail client.

> Full scope, architecture, and per-milestone history live in
> [docs/web-client-scope-and-roadmap.md](docs/web-client-scope-and-roadmap.md) and
> [docs/afk-session-log.md](docs/afk-session-log.md).

## Why a browser client — the vision

A retail EVE client is a heavy 3D application: one process, one machine, a lot of GPU.
This client is a **web page talking to a thin bridge**. That single change unlocks three
things the retail client can't do easily:

1. **Multibox from one browser.** Each account is just a tab. Open ten tabs, sign into
   ten accounts, and you're flying ten characters at once — no VMs, no client copies, no
   GPU. One tab ≙ one client ≙ one account.
2. **Automate with sharable, block-built bots.** Instead of third-party injectors, the
   automation is a first-class feature: build a bot from ready-made **blocks** (like
   Lego), validate it, and export it as a small JSON file you can share. See
   [The Bot Builder](#the-bot-builder).
3. **Run several pilots.** Bots can run in the browser or under an approved WC
   server-hosted grant. WC sequences their actions; EveJS validates and executes
   them. Closing a browser does not stop a delegated server-hosted run.

EveJS remains the game authority. Browser and hosted WC controllers share that
authority boundary and must respect session ownership and graceful cleanup.

## Architecture — the thin bridge

```
  Browser (Svelte + Vite)                 ← pilot workspaces and control planes
        │  fetch POST /api/bridge/*
        ▼
  Web BFF  (src/server.js, :26500)        ← bridge, sessions and approved hosted bots
        │  the retail {service, method} call tuple
        ▼
  EveJS gateway (eve.js, :26002)          ← the retail Handle_* handlers, unchanged
        │
        ▼
  EveJS  = the game, the sole authority   ← owns all state + validation + persistence
```

- **Bridge-only.** Gameplay reads and mutations use purpose-built WC endpoints and
  the EveJS gateway (retail call tuples, bound objects, persistent sessions, flight,
  chat). Reference data also uses
  login-gated read-only static routes (`/api/map/*`, `/api/names`, `/api/agents/find`)
  that serve EveJS's static reference export the way retail resolves names from its local
  static DB. The web process **never** touches gameplay SQLite.
- **Deny-by-default, with a large pre-wired surface.** The gateway carries an allowlist of
  `{service, method}` pairs; a call not on it is refused. The checked cross-repo manifest
  currently pins **716 allowlisted pairs**, including **351 writes** that the generic call
  seam refuses and purpose-built BFF routes must own. The older “588/588” sweep was
  complete against its curated inventory, **not against all of ClientCodeGrabber/Latest**:
  a 2026-07-27 re-audit found 15 `fleetObjectHandler` methods and two `fleetProxy` methods
  used by Latest but absent from that inventory. Treat plumbing as broad coverage, not a
  full-parity guarantee; re-audit the relevant Latest call sites when adding a feature.
- **The client is a pure reader of one store.** State lives in a framework-agnostic
  reactive store (`web/src/store/clientStore.ts`); all fetch/decode is in
  `web/src/app/flow.ts`; the Svelte components never write state, they read it.
- **Two spatial shells.** The whole UI follows one flag — *docked* vs *in space*:
  `StationShell` (station interior: services rail, ship hangar, undock) and `SpaceShell`
  (a HUD: locked-target brackets, overview, capacitor + shield/armor/hull, module rack,
  dock), with a persistent Neocom rail of the panels reachable in both states.

## The Bot Builder

Automation is built into the client, not bolted on. A bot is an **ordered list of blocks
that repeat as a whole, plus a row of "watches" checked every moment** — Lego for EVE
routines.

- **Blocks (macros)** are high-level, named actions from a catalog — `undock`,
  `travel-to-station`, `mine-at-belt`, `deliver-ore`, `refine-ore`, `find-combat-agent`,
  `request-mission` / `accept-mission` / `turn-in-mission`, `fight-the-rats`,
  `salvage-wrecks`, `warp-to-anomaly`, `restart-extractors`, and more. Each block is a
  sentence a player understands, not a script API.
- **Watches** are conditions checked continuously that interrupt the loop to respond —
  e.g. *shield below 50% → repair*, *hostiles on grid → launch drones*, *hull below 50% →
  dock and pause*. They make a bot safe without hand-coding a state machine.
- **Sharable.** A bot is a small JSON document (`web/src/bots/scriptCodec.ts`) you can
  export, hand to someone, and import — no code, no injector. Example bots ship in
  `web/src/bots/exampleBots.ts` ("Mining day", "Delivery runs").
- **Built on tested pure logic.** The catalog, validator, text/sentence rendering, and
  JSON codec are pure, unit-tested modules under `web/src/bots/`, so the builder shows you
  exactly the logic the runner will execute.

**Where it stands:** the builder (`web/src/ui/BotBuilder.svelte`) shapes, validates and
imports/exports scripts. The script runner executes them in browser or hosted WC
sessions, sequencing authoritative calls and observations. MCC Standard profiles use
that runner. Hosted execution requires an approved duration and keeps its own lifecycle
after the browser closes.

## Run

Requires Node ≥ 22.18 (the TypeScript unit tests run natively under `node --test` via type
stripping). EveJS must be running so its gateway is listening on `:26002`.

Pilot Training's live session/acquisition features additionally require the supported
EveJS 0.12.9 [runtime patches](docs/pilot-training-runtime-setup.md). Set `EVEJS_ROOT`
in your ignored `.env` to your mutable gameplay copy. Updating WC does not install
those runtime patches automatically.

```bash
npm install
npm run build:web   # typecheck (tsc) + Vite build into public/dist/ (git-ignored)
npm start           # the BFF on http://127.0.0.1:26500
```

Open `http://127.0.0.1:26500` and sign in with an existing EveJS **account name** and
**any password** (emulator-style "who cares" login — passwords are not checked; unknown
account creation depends on EveJS development policy). Pilot Training separates
existing-only login from its explicit **+ New trainee** flow; this is not production
password registration. The login screen pings the server's health check once on load and
won't let you attempt a login while EveJS is offline.

For UI iteration, use the hot-reloading dev server instead:

```bash
npm run dev:web     # Vite on :5173, proxies /api to the BFF; run `npm start` alongside it
npm test            # node --test over the JS + web/**/*.test.ts suites
```

## Setup — the easy way

If you just want to play, you do not need any of the section below. Start your EveJS
server however you normally do, then double-click:

```text
SetupWebClient.bat
```

It finds your EveJS folder, works out whether the server is running natively or in
Docker, asks the one question it cannot answer for you (run the client directly or in
Docker), sets up the connection between them, starts it, and tells you the address to
open. Run it again any time — it only changes what actually needs changing.

After that, day to day:

```text
StartWebClient.bat          start it
StartWebClient.bat stop     stop it
StartWebClient.bat check    say exactly what is wrong if it will not connect
```

The rest of this section is what those scripts are doing, and how to do it by hand.

## Docker (optional)

Running this BFF in a container is optional — `npm start` above stays fully supported.
EveJS itself may be native or in Docker independently, so there are four combinations,
and **all four work**. Which one you are in decides exactly two settings.

| EveJS | This BFF | Command | `EVEJS_WEB_GATEWAY_TOKEN` |
| --- | --- | --- | --- |
| native | native | `npm start` | not needed |
| **Docker** | native | `npm start` | **required** |
| native | **Docker** | `docker compose up --build -d` | not needed (set it anyway) |
| **Docker** | **Docker** | `docker compose -f compose.yaml -f compose.evejs-docker.yaml up --build -d` | **required** |

Whatever the combination, `npm run doctor` names the broken link and what to change:

```bash
npm run doctor
```

### Why a token, and why the symptom is confusing

EveJS's gateway authorizes a token-less caller **only when the peer's socket address is
`127.0.0.1`/`::1`** (`authorizeGatewayRequest` in `server/src/_secondary/express/evejsWebGateway.js`).
That is not a property of the URL you dialled — it is the address EveJS observes on the
other end of the socket, and Docker rewrites it:

| Direction | Address EveJS sees | Token-less? |
| --- | --- | --- |
| host → host | `127.0.0.1` | yes |
| host → published port of a container | `172.x.0.1` (bridge gateway) | **no** |
| container → container | `172.x.0.3` (peer container) | **no** |
| container → host via `host.docker.internal` | `127.0.0.1` (Docker Desktop) | yes |

So moving *EveJS* into Docker breaks a BFF that was working a minute ago, on the same
`http://127.0.0.1:26002/...` URL, with the port open and the process healthy. Every probe
you would reach for says "fine" and the gateway answers `401`.

The fix is one shared secret. Put the **same** value in `.env` here and in `eve.js/.env`,
then restart both:

```bash
powershell -Command "[Convert]::ToBase64String((1..32|%{Get-Random -Max 256}))"
```

Setting it unconditionally is the recommendation. EveJS ignores an incoming token when its
own `EVEJS_WEB_GATEWAY_TOKEN` is unset and falls back to the loopback rule, so a token that
is not needed costs nothing — and you stop having to think about which combination you are
in. Note the push channel (live notifications and chat) enforces this too, on a *narrower*
rule than the request routes; without a token the UI silently degrades to polling.

### The other two Docker gotchas

- **`127.0.0.1` inside a container is the container.** `compose.yaml` therefore targets
  `host.docker.internal`, and the overlay targets `evejs-server` — the network alias
  `eve.js/compose.yaml` puts on its `server` service. Do not hand-edit these back to
  loopback. (On *native Linux* Docker, `host.docker.internal` maps to the docker0 bridge
  and cannot reach a host listener bound to `127.0.0.1` at all — there, run EveJS in Docker
  too and use the overlay.)
- **Static names come off disk, not the gateway.** Type/station/system names are read from
  the gameStore tables and the SDE. `compose.yaml` bind-mounts `EVEJS_ROOT` read-only at
  `/srv/evejs`; the overlay instead mounts EveJS's own `evejs-data` volume, which is the
  authoritative copy the running server was built from. Missing data is not fatal — reads
  degrade to empty tables and the UI shows raw ids.

Both compose files publish `127.0.0.1:26500` only, matching EveJS's own loopback-only
publishing rule. `docker compose down` stops the BFF; the `evejs-web-poc-data` volume keeps
sessions, the web-user store, the bot scripts and the icon cache across rebuilds.

## Multibox

Each browser tab holds its own per-tab session token, so **N tabs = N independent
clients**. Sign a different account into each tab and fly them side by side. The BFF holds
each tab's persistent EveJS session server-side and never drives movement for a tab that
has no browser connected — the same duplicate-login and control rules as retail apply
(a character already online elsewhere is refused with the server's own message unless
login-takeover is enabled).

## Configuration

Defaults assume both repos live side by side (e.g. under `.../GitHub/eve.js` and
`.../GitHub/evejs-web-poc`). Optional environment variables:

```text
PORT=26500
HOST=127.0.0.1                 # 0.0.0.0 to host on a LAN/WAN (trusted-environment emulator)
EVEJS_ROOT=/path/to/eve.js
EVEJS_GATEWAY_URL=http://127.0.0.1:26002/_evejs-web/v1
EVEJS_WEB_GATEWAY_TOKEN=
EVEJS_ICON_CACHE_DIR=/path/to/evejs-web-poc/data/icon-cache
```

Hardening is deliberately out of scope — this is a trusted-environment emulator client
(see roadmap section 6).

## Local icon cache

Item/ship icons fall back to `https://images.evetech.net`. To cache them locally (served
from `/icon-cache/...`), run the scraper:

```bash
node scripts/cache-icons.js --dry-run
node scripts/cache-icons.js --rate-limit 60/min --limit 200   # scan the gamestore
node scripts/cache-icons.js --types 34,670,11                 # specific typeIDs (e.g. overview 404s)
node scripts/cache-icons.js --source all-types --rate-limit 60/min --limit 500
```

Cached files land under the git-ignored `data/icon-cache/`; a manifest is written to
`data/icon-cache/manifest.json`. The default `gamestore` source scans the current EveJS
gamestore for the icons the app is likely to show; if the overview logs a 404 for a typeID
it didn't cover (celestials, beacons, effects), pass those IDs with `--types`.

## Repo map

```
src/                 the web BFF (Express) — routes, the bridge, session holding
  server.js            the BFF + /api/bridge/* + /api/health
web/                 the Svelte front-end
  src/app/flow.ts      all fetch/decode; the AppFlow the components call
  src/store/           the reactive client store (single source of truth)
  src/bridge/          per-call decoders (raw retail bytes → typed store events)
  src/ui/              the shells (StationShell/SpaceShell), Neocom, panels, BotBuilder
  src/nav/             the in-browser bot loops (autopilot, mining, mission) + route solver
  src/bots/            the block bot model: script, macro catalog, validator, codec, examples
scripts/cache-icons.js  the local icon scraper
docs/                the scope/roadmap, wire contract, and session log
```

## Status

- **Bridge:** broad, deny-by-default coverage — 716 pairs are contract-pinned across the
  two repositories and generic browser calls cannot execute any of the 351 classified
  writes. This is **not full Latest parity**; the known fleet delta is 17 methods, and
  feature work should verify its own Latest call sequence before assuming coverage.
- **UI:** two-shell docked/in-space client with live panels, Neocom, and a health-gated,
  centered login.
- **Bots:** the block Bot Builder (shape / validate / share) plus live in-browser
  autopilot, mining, and mission loops; the generic block runner is next.
