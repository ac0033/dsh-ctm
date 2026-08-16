# dsh-ctm — Context Transparency Manager

把模型的「上下文」变成可见、可编辑、可评分的一等对象，作为 DeepSeek Harness 的自包含 bundle 插件发布。

## 特性

- **完整可见**：轮次 → 片段的流程图，按角色 / token / 缓存 / 有效性着色，markdown 渲染、分页。
- **实时刷新**：事件驱动（`useSession` 响应式订阅），新消息 / 工具结果 / 回合切换即时更新，非定时轮询。
- **初始系统提示词**：作为片段 0 在「系统提示词」框内展示一次——`request/header` 只记录一次、之后逐请求原样重发，并不逐轮重复注入；活体会话走 `requestHeader()`，历史会话走 `readSession()` 回退。可被替换编辑（见下）。
- **可编辑**：替换、删除、回滚、快照恢复、撤销、有效性标注（手动覆盖）。初始系统提示词可替换；其余系统注入内容（运行上下文等）与工具结果在界面上只读。
- **有效性引擎**：自动判定 `effective` / `redundant` / `stale` / `injected`，可手动覆盖。2-gram 相似度集合带 LRU 缓存（上限 500 条），不会每次请求全量重建。
- **真实生效（默认关）**：开启后，替换 / 删除 / 回滚不再拦截请求，而是作为 surface `replace` 事件在 `agent/pre-step` 写入会话日志（与官方 compaction 同一时机、同一机制），满足 DSH「model-visible ⟺ logged」不变量——replay / fork / token 计量自动与模型实际所见一致。编辑落日志前标记「待生效」；删除 / 回滚以占位 `user/message` 节点承载，assistant 修订以角色降格为 user 消息承载，均保持 tool-call/result 配对不被截断。撤销 = 未落日志的排队编辑直接出队，已落日志的编辑以原始内容构造反向 replace 事件（仅支持撤销最近一组操作）。落日志失败会记录日志并在视图顶部显示错误。
- **系统提示词编辑**：对片段 0 的替换存为 override，经 `system-prompt/assemble` waterfall 在下一次组装提示词时生效；`request/header` 新快照由 agent loop 自动落日志。
- **i18n**：中 / 英。
- **零耦合**：host↔client 走纯 HTTP `POST /ctm`，不依赖 Typert `@Remote` / `dsh-api-remotes`；运行时零依赖（tool 配对平衡校验为本地重新实现，不依赖 `@deepseek-ai/dsh-compaction`）。

## 架构

```
src/
├── contract.ts       # 共享契约：TS 类型 + Zod 运行时校验（单一事实来源）
├── host.ts           # host 半：POST /ctm 路由 + agent/pre-step、system-prompt/assemble 两个 waterfall
├── surface-edits.ts  # 编辑落日志层：replace 事件构造、tool 配对平衡、编辑队列应用（纯逻辑，可单测）
├── bigrams.ts        # 有效性引擎的 2-gram 集合 + LRU 缓存（纯逻辑，可单测）
└── client/           # browser 半：conversation.view 标签页 + fetch('/ctm')
```

- **`contract.ts`**：host 用它校验请求、client 用它校验响应。类型从 Zod schema 推导，运行时校验兜底跨版本兼容——社区插件独立更新的关键。新增字段一律 `.optional()`（如 segment 的 `pending`、state 的 `applyError`）。
- **`host.ts`**：通过 `webServer` 注册 `POST /ctm`，注入 `sessionQuery` / `sessions` / `tokenMeter`。从 `readSurface` 读表面事件（落日志后自动是编辑后表面），并从 `requestHeader()`（活体会话）或 `readSession()`（历史会话）读取系统提示词，作为片段 0 插入一次。「真实生效」开启时编辑进入 per-session 队列，在 `agent/pre-step` waterfall 里逐组 `session.append` 落日志（此时回合打开、请求尚未构建，编辑当次请求即生效；空闲会话的编辑先入队，下个 step 生效）。系统提示词 override 在 `system-prompt/assemble` waterfall 里替换整个 section 列表。内存有界：会话 store LRU 上限 50、快照 20 个/会话、回收站 50 条/会话。
- **`client/`**：在 `conversation.view` 注册「Context」标签页，所有操作经 `fetch('/ctm')` 往返，响应用 `ctmResponseSchema` 校验；用 `useSession` 响应式触发刷新。「待生效」徽章区分已入队未落日志与已生效的编辑。

## 线协议

`POST /ctm`，请求体是 `op` 判别联合（JSON），每个请求都带 `sessionId`：

| op | 额外字段 |
|----|---------|
| `getState` | — |
| `replace` | `segmentId`, `content`（界面上仅初始系统提示词与非系统注入片段可替换；「真实生效」开启时入队落日志） |
| `delete` | `segmentId` |
| `rollback` | `turnIndex` |
| `restore` | `snapshotId` |
| `reset` | — |
| `undo` | — |
| `override` | `segmentId`, `value`(string \| null) |
| `setRealtime` | `enabled` |

响应：`{ ok: true, state: CtmState } | { ok: false, error: string }`。

## 安装 / 卸载

```powershell
dsh plugin --profile <name> add @deepseek-ai/dsh-ctm
dsh plugin --profile <name> remove @deepseek-ai/dsh-ctm
```

`add` 自动把包写进 profile 的 `dependencies` + `dsh.profile.bundles`（因为它声明了 `dsh.bundle`），无需手改 `cordis.patch.yml`；`remove` 一并清掉依赖、bundle 层与 node_modules。

## 本地开发

```powershell
pnpm install
pnpm build            # 产出 dsh/index.js（host）+ dsh/client.js（client）
```

## 发布

- CI 在 publish 前执行 `pnpm build`（建议加 `"prepublishOnly": "pnpm build"`），社区用户拿到的是预构建的 `dsh/index.js` + `dsh/client.js`，零构建。
- 运行时零依赖：`zod` 已内联进两个 bundle，`react` 走 shell 的模块表。
- 换自己的 scope 时，同步改 `package.json` 的 `name` 和 `cordis.patch.yml` 里那行的 `name:`。
