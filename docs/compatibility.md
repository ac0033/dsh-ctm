# Harness compatibility

Target: official `dsh-v0.1.5-rc.2`, commit `fb2c4b9e698e30edb738bca4cf0618587db7d203`. This is an upstream release candidate. See [upgrade status](upgrade-status.md) for actual evidence; planned work is not a compatibility claim.

| Capability | Official integration | Planned CTM change |
|---|---|---|
| Installation | dsh.bundle, profile bundles, prepare or prebuilt archive | Validate both install routes |
| History | readSurface, snapshotEvents, eventAt, deriveMessages | Surface order and read-only historical inspection |
| Editing | agent/pre-step, logged replacements | Shared preview/execution plan, stale-preview rejection |
| System prompt | system-prompt/assemble, multiple system nodes | Distinguish recorded nodes and unassembled drafts |
| Browser | conversation.view and official session standard props | Remove chat.legacy.nodes subscription |
| Draft | inputActions.setDraft, useInput | Preserve existing drafts; no automatic send |
| Fork | Session Controller, completed-turn boundary | Official lineage; no duplicate creation after navigation failure |
| Usage | Provider usage, host projections | Cumulative billing separate from context occupancy |
| Theme | Semantic aliases, public controls | Light/dark, focus, narrow-screen behavior |

The rc.1→rc.2 source comparison shows no changes in the inspected session, agent-loop, system-prompt, ui-conversation, ui-slots or Session Controller source directories. This narrows the risk but does not replace runtime testing.

Chat already exposes system prompts and turn usage; Trajectory exposes event records, timings and request details. CTM focuses on active membership, provenance, changes and edit impact. Forking retains the host's completed-turn boundaries rather than implementing a custom session tree.

## Pinned references

- [Plugin publishing](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/user/develop/basic/publish.md)
- [Session](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/core/session/README.md)
- [Conversation UI](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/packages/client/ui-conversation/README.md)
- [Web styling](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.5-rc.2/docs/web-styling.md)

## Recovery

Preserve predecessor session generations. Restore the old host together with its pre-upgrade data copy; never open a migrated successor with an older host. The daily web profile uses a local CTM link, so candidate installation in an isolated profile is required before changing that installation.
