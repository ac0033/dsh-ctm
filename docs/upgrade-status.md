# CTM 1.1 upgrade status

Implementation branch: `codex/context-workbench-1.1`.

## Stage 1 — environment

- Plugin baseline: `888cf78574b36a9eb582f2173bed0d1cf9266911`; matched remote main and clean before changes.
- Harness baseline: `183f08e9c6dde7e36cd2318eaee70b0da08fb35e` (0.1.5-rc.1), clean.
- Locked target: `dsh-v0.1.5-rc.2`, `fb2c4b9e698e30edb738bca4cf0618587db7d203`. Four-commit fast-forward; no local divergence.
- Private backup outside this repository contains both Git bundles and 56 DSH configuration/data files, individually SHA256 verified. Credentials and session contents must never enter this repository.
- Existing web profile links the local CTM checkout. No listener was found on port 3080 during preflight.
- Source updated and official full build passed (234 client artifacts recorded). Isolated ctm-verify profile installed the local plugin through dsh plugin add and started on port 3183. Daily environment has not been launched or migrated by this upgrade.

## Remaining gates

1. Environment baseline passed: full host build and isolated boot completed; all 56 original DSH files still match backup SHA256 values. Authenticated browser and real-session behavior acceptance remains part of the feature gates.
2. Review interactive reading-workbench prototype with the user before final UI integration.
3. Implement additive inspection/preview APIs, stable concurrency guards, official session subscriptions and completed-turn forks.
4. Run typecheck, tests, build, real-host behavior and browser checks.
5. Publish candidate and verify clean remote installs; switch local installation and verify; publish stable release.

Old tags and published contents remain untouched. Thirteen new local SemVer aliases were created after verifying all fourteen mappings (v12 already equals v1.0.0); see version-map.json. No tags, commits or releases have been pushed.

## Validation evidence

- Plugin baseline: pnpm typecheck, pnpm test (93 tests / 8 files), pnpm build all passed.
- Host: pnpm install --frozen-lockfile and pnpm run build passed; source remains clean at the official rc.2 commit.
- Isolated boot printed its authenticated Web launch URL. An unauthenticated index request correctly returns 401. POST /ctm with an invalid body returns 400; a missing-session read returns 500 (existing behavior, not a real-session correctness test).
- Prototype: docs/prototype/check.mjs passed light/dark, source filter, search/empty state, edit/queue simulation, history diff, fork dialog and 390px-width checks; no browser page errors. Screenshots were visually reviewed.
- Prototype runs at http://127.0.0.1:3182 using simulated data only. It does not call the CTM host or a model.
- User visual confirmation is pending, as required by the approved plan. Production feature implementation, candidate publication, remote installation acceptance and daily-environment switch remain unfinished.

## Reading prototype revision 2

- Replaced the default three-column workbench with a single reading column and three collapsed overview sections: guidance, earlier summary, and recent conversation.
- Kept the full ordered content view behind an explicit link; overview categories are labelled as an overview, not a final assembled request.
- Separated current content from change history. Source metadata appears after selecting an item; editing follows draft, impact preview, and explicit queue confirmation.
- Empty queue, technical metadata, and token/cache details are hidden until relevant. Historical comparison and fork remain simulated secondary flows.
- `docs/prototype/check-reader.mjs` passed interaction, draft preservation, history, filtering, light/dark, and 390px viewport checks with no page errors. Evidence: `docs/prototype/screenshots-v2/qa.json` and adjacent screenshots. Overview desktop/mobile and editing preview were visually inspected.
- Sources: `reader.css`, `reader.js`; regenerate `index.html` with `node docs/prototype/build-reader.mjs`. Original prototype is preserved in `v1.html`.
- This revision responds to the user's request to lower the learning cost. Visual confirmation remains pending; it has not been integrated into the production plugin.

## Reading prototype revision 3 — context first

- User rejected revision 2 because collapsing context into summaries removed the basis for understanding analysis and operations. Revision 2 is superseded.
- Default view now shows all eight fixture entries in source order, with full fixture text and code, roles, sources, and event positions inline. No category overview or collapsed message bodies precede the document.
- Navigation only locates entries. Analysis and editing attach to an entry; compression links to its change record. Statistics describe the same fixture rather than unrelated capacity numbers.
- Filters explicitly indicate an incomplete view. Fixture limitations (including unavailable request configuration, tool schemas and real file contents) are visible.
- check-context.mjs passed ordered entry, expanded code, filter coverage, edit queue, compression relation, light/dark and mobile checks. This remains a simulated prototype, not production context completeness acceptance.

## Reading prototype revision 4 — existing classification restored

- Inspected current src/client/model.ts, turn-node.tsx and view.tsx. Existing structure separates user input and system prompts, then groups execution content by turn and step. User requested keeping this structure with independently collapsible full content.
- Default prototype now uses user input, system prompts, compression records, and execution turns. Entries retain fixture order within each category. Missing fixture step IDs are explicitly labelled rather than inferred.
- Category headings show counts and estimated tokens for their own contents. Categories and entries independently expand/collapse; expand-all and collapse-all are available. No prose summary replaces the expandable original text or code.
- Original-order mode remains available for auditing the same eight entries. Classification is not presented as assembled request order.
- check-grouped.mjs passed completeness, ordering, collapse, code search, preview/queue, themes and mobile checks. Screenshots are in screenshots-v4. pnpm typecheck, pnpm test (93/93), pnpm build passed.
- Production integration and visual approval remain pending. This revision supersedes the flat default introduced in revision 3.
