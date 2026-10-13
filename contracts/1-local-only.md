# Contract 1: local only

tapesketch starts from a codebase that had accounts, paid plans and a
server. Here it becomes free, open source (MIT) and served as a static
file. This development only removes code. Nothing about drawing, measuring
or exporting changes. The code stays in Spanish until contract 2.

## Invariants

1. **One file, no network.** Everything lives in `index.html`, with no
   dependencies. The app makes no requests: no `fetch`, no `sendBeacon`, no
   `/api/` routes. Checked by
   `grep -cE 'fetch\(|sendBeacon|/api/' index.html` → `0`.
2. **There is no such thing as a plan.** Everything is open to everyone:
   unlimited projects, PDF and PNG without watermark, parts list. No code
   asks about a plan, and there is no pricing panel and no account button.
3. **The visible name is `Tapesketch`.** It replaces every visible
   "Floor plan".
4. **No regressions.** `./pruebas.sh` (now `./test.sh`) is green at the end of every task.
   Tests that check a gate are rewritten to check the gate is gone; they are
   never deleted without a replacement.

## Section map of `index.html`

| Section | Fate |
|---|---|
| `solo lectura` (`/p/<token>`, `#lectura`) | removed |
| `analitica` (`apunta`, queue, `VISITA`) | removed, with every call |
| `nube` (session, sync, `bNube`) | removed; `base` is no longer written. No data carrying it can reach tapesketch (new origin), so nothing strips it |
| `planes` (`TIERS`, `ESCALERA`, `tengo`, `abrirPlan`, `#plan`, `bPlan`) | removed |
| `compartir` (`bCompartir`, read-only link) | removed |
| `marca de agua` (`MARCA_AGUA`, `conMarca`, `marcaPDF`, `marcaPNG`) | removed |
| `guardado`: `LIMITE_GRATIS`, `exigirSitio` | removed; creating a project has no gate |
| `listado de piezas` | kept, ungated |
| `pdf`: title block with name and company | kept, in `localStorage` only |
| `#avisoLocal` | kept and always shown: it is now always true |
| `bCuenta` (link to `/account`) | removed |
| Everything else | untouched |

## Tasks, in order

1. Watermark out.
2. Sharing and read-only view out.
3. Plans and cloud out, together, because `plan` lives inside the cloud
   code: panel, project limit, parts-list gate, `bPlan`, `bCuenta`, session
   and sync.
4. Analytics out.
5. Visible name `Tapesketch`.

Each task touches `index.html` and, where needed, its suites in `pruebas/`.
It is verified by `./pruebas.sh` plus the task's own `grep`.

## Out of scope

Translation (contract 2). README, license, hosting and domain. Mobile and
touch. The help panel covering the toolbar on narrow windows (pre-existing,
left alone).
