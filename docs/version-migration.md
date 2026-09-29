# Version migration

Old development tags remain aliases. New SemVer tags point to the same commits; historical commits, package contents and existing release dates are never rewritten. Historical package versions can therefore differ from the new tag alias.

| Old | SemVer | Change |
|---|---|---|
| v0 | v0.1.0 | Corrected development baseline |
| v1 | v0.2.0 | Logged surface edits replace interception |
| v2 | v0.3.0 | Structured notices and UI redesign |
| v3 | v0.4.0 | Provider usage accounting |
| v4 | v0.4.1 | Step header cleanup |
| v5 | v0.5.0 | Balanced tool edits, restore groups, concurrency checks |
| v6 | v0.5.1 | Optional service injection fix |
| v7 | v0.5.2 | Idempotent overlapping deletions |
| v8 | v0.5.3 | Placeholder classification fix |
| v9 | v0.6.0 | Copy and history-collapse controls |
| v10 | v0.6.1 | Rollback marker correction |
| v11 | v1.0.0-rc.1 | Public package name and installation preparation |
| v12 | v1.0.0 (existing) | First public release |
| v13 | v1.0.1 | Session V3 compatibility fix |

The 0.x series names pre-public development snapshots, not stable API promises. Do not manufacture formal releases for each snapshot. Preserve v1.0.0's identity and original contents. Planned feature release: v1.1.0, preceded by v1.1.0-rc.1; neither is published merely because this document exists.

Resolve annotated tags to commits before comparing. For every alias, compare `git rev-parse <old>^{commit}` with `git rev-parse <alias>^{commit}`. An existing alias with a different target is a conflict: stop rather than overwrite. Push only explicit refs and verify their remote targets; never use blanket `git push --tags`.

Release archives must contain built host/client entrypoints and the bundle patch. Archive version, package manifest, release tag and SHA256 manifest must agree. Validate downloaded archives in a clean profile without a sibling source checkout before marking a release stable.

Compatible fixes increment PATCH; additive functionality and deprecation increment MINOR; incompatible public behavior requires MAJOR. Document host compatibility separately; do not imply support for untested future hosts.

Status: mapping reviewed against local/remote tags and commit history on 2026-09-11. Thirteen new local aliases are created and verified; v12 already matches v1.0.0. No aliases are pushed yet. See version-map.json. Publication waits for acceptance.
