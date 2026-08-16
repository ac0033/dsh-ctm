# dsh-ctm — Context Transparency Manager

把模型的「上下文」变成可见、可编辑、可评分的一等对象，作为 DeepSeek Harness 的自包含 bundle 插件发布。

## 特性

- **完整可见**：轮次 → 片段的流程图，按角色 / token / 缓存 / 有效性着色，markdown 渲染、分页。
- **实时刷新**：事件驱动（`useSession` 响应式订阅），新消息 / 工具结果 / 回合切换即时更新，非定时轮询。
- **初始系统提示词**：作为片段 0 在「系统提示词」框内展示一次——`request/header` 只记录一次、之后逐请求原样重发，并不逐轮重复注入；活体会话走 `requestHeader()`，历史会话走 `readSession()` 回退。
- **可编辑**：替换、删除、回滚、快照恢复、撤销、有效性标注（手动覆盖）。系统注入内容（系统提示词、运行上下文等）与工具结果只读。
- **有效性引擎**：自动判定 `effective` / `redundant` / `stale` / `injected`，可手动覆盖。
- **实时拦截（默认关）**：开启后编辑 / 删除 / 回滚真正写入模型输入，并保持 tool-call/result 配对不破坏协议。改写失败时会记录日志并在视图顶部显示警告（不会静默退回原始请求）；系统注入内容不参与实时改写。
- **i18n**：中 / 英。
- **零耦合**：host↔client 走纯 HTTP `POST /ctm`，不依赖 Typert `@Remote` / `dsh-api-remotes`。

## 架构

```
src/
├── contract.ts     # 共享契约：TS 类型 + Zod 运行时校验（单一事实来源）
├── host.ts         # host 半：POST /ctm 路由 + llm/stream 拦截器
└── client/         # browser 半：conversation.view 标签页 + fetch('/ctm')
```

- **`contract.ts`**：host 用它校验请求、client 用它校验响应。类型从 Zod schema 推导，运行时校验兜底跨版本兼容——社区插件独立更新的关键。
- **`host.ts`**：通过 `webServer` 注册 `POST /ctm`，注入 `sessionQuery` / `sessions` / `tokenMeter` / `llm`。从 `readSurface` 读表面事件，并从 `requestHeader()`（活体会话）或 `readSession()`（历史会话）读取系统提示词，作为片段 0 插入一次（逐轮的运行上下文/技能目录本就以 `user/message` 事件存在于表面）。宿主机级 `llm/stream` 监听器在「实时」开启时改写模型输入。
- **`client/`**：在 `conversation.view` 注册「Context」标签页，所有操作经 `fetch('/ctm')` 往返，响应用 `ctmResponseSchema` 校验；用 `useSession` 响应式触发刷新。

## 线协议

`POST /ctm`，请求体是 `op` 判别联合（JSON），每个请求都带 `sessionId`：

| op | 额外字段 |
|----|---------|
| `getState` | — |
| `replace` | `segmentId`, `content`（系统注入与工具结果只读，host 会拒绝） |
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
