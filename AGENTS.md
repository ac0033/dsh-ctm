# AGENTS.md — dsh-ctm（DeepSeek Harness 上下文管理器插件）

本文件记录这个仓库的固定工作流程和沉淀下来的经验教训。任何在此仓库工作的 agent 都必须遵守「固定流程」一节。

## 固定流程（每次任务必做）

1. **验证**：改完代码必须 `pnpm typecheck && pnpm test && pnpm build` 三条全绿，缺一不可。测试红或类型错时不许宣称完成。
2. **保存快照**：验证全绿后才 `git commit` + `git tag vN`（递增版本号）。提交用 `git -c user.name=... -c user.email=...`，不向仓库写入本地 git 配置。
3. **出问题就回退或修复**：验证不过时，要么修到绿，要么 `git reset --hard <上一个 tag>` 回退，不把半成品带进快照。
4. **审查再提交**：提交前亲自过一遍关键 diff，不凭子代理或自己的记忆提交。

## 子代理协作纪律

- 派单 brief 里写清确切文件路径、已拍板的设计决策和硬性约束，不让子代理重新设计已定方案。
- 子代理一律禁止 git 写操作；快照由主代理在复核后统一打。
- 子代理的产出必须亲自复核关键 diff 并重跑验证，不直接采信「全绿」的结论。
- 事实性结论（复杂度、行号、CSS 尺寸、文档出处）要抽查原始出处。历史教训：评估报告曾被抓出 O(n²·L²)（实际 O(n²·L)）、「2px 彩色边框」（实际 1px）、文档名张冠李戴等失实，定性对但细节夸大同样会误导决策。

## 工程约束

- **零运行时依赖**：package.json 不加 dependency。需要小工具函数就在本地实现并注明出处。测试只用已有的 vitest。
- **契约字段一律 optional**：`src/contract.ts` 新增字段必须 optional，保证新旧 client/host 混跑不炸。
- **新纯逻辑必须可导出 + 有单测**：surface 编辑、usage 汇总这类纯函数放独立模块导出，配 vitest 单测。
- **改行为必同步文档和文案**：README 的功能描述、`src/client/locales.ts` 的中英文案要一起改，文案要如实反映限制（比如角色降格），不粉饰。
- **样式只用 `--dsw-alias-*` 设计 token**：禁止 hex/rgba 字面量，保证插件跟随宿主主题。

## DSH 机制要点（已验证，别再重新调研）

- **model-visible ⟺ logged**：模型看到的就是日志里的表面（surface）节点；`deriveMessages` 只输出表面节点。
- **编辑生效路径**：编辑排队 → `agent/pre-step` 钩子落 surface `replace` 事件。不要用 llm/stream 拦截器改写请求（那是不落日志的红线行为）。
- **系统提示词**走 `system-prompt/assemble` 钩子，不走 surface 替换。
- **删除是 shadow**：replace 事件用占位节点占据被 shadow 的区间，日志保留所以可撤销。删 tool 结果必须用最小平衡区间（`minimalBalancedRange`）把携带 tool-call 的 assistant 消息一起吸收，否则模型看到悬空调用。
- **平衡区间会重叠**：同一条 assistant 消息携带多个 tool-call 时，删其中任一结果，区间会把兄弟结果一起吸收。所以 flush 必须是幂等的——目标已不在表面（被同批前序组或宿主 compaction shadow）的删除视为已满足，不能报错；入队时的 planEdit 校验通过不代表 flush 时目标还在。
- **角色降格**：日志 append-only，撤销回退/配对删除时内容只能以 user/message 身份恢复（第一条 replace 进占位、其余 append 补尾）。这是已知限制，README 有说明。
- **usage 口径**：三个桶互斥——未命中输入 / 缓存命中输入 / 输出，reasoning 是 output 的子集不单独计。优先读 tokenUsage 投影，事件折叠做兜底。
- **cordis 服务访问守卫**：Context 代理对「未在 inject 声明的服务属性」的读取直接抛 `cannot get property "X" without inject`——可选链救不了，抛错发生在属性访问时。可选服务的官方模式是 `ctx.inject(['service'], child => ...)` 子上下文（参考 dsh-goal）：服务存在才激活回调。教训：单测里的普通对象假 ctx 不会抛错，这类 bug 单测抓不到，`tests/helpers/fake-ctx.ts` 的 `cordisInjectGuard` 专门模拟这个守卫做回归。
- 不变量校验看 `D:/4_Projects/deepseek-harness/packages/core/session/src/invariant.ts`，surface fold 语义看同目录 `surface.ts`。`tests/helpers/fake-session.ts` 是逐条对齐这两个文件的假实现，改 DSH 相关逻辑时保持同步。

## 测试结构

- `tests/*.test.ts`：纯逻辑单测（contract、bigrams、usage、surface-edits、format 等）。
- `tests/integration.test.ts` + `tests/helpers/`：沙箱集成测试，用 FakeSession + 假 cordis ctx 驱动 host 真实启动流程和编辑瀑布，断言落在 deriveMessages 输出和日志可撤销性上。新增编辑类功能必须在这里补场景。

## 版本快照历史

- v0：A 档修复（unescape 数据损坏、拦截静默放行、系统提示词只读化、disposer、NaN、version 竞态）+ 19 测试
- v1：编辑迁移到 surface replace + pre-step；P2（bigram LRU、内存上限）
- v2：P3（notice 结构化、魔法数收敛、view 拆模块、视觉重构）
- v3：MECE token 口径（三桶 + 命中率，投影优先；轮/step 级实测，片段级估算标注）
- v4：步骤行去重数字
- v5：沙箱验证（最小平衡区间删除、可撤销回退、expectedVersion 并发保护、集成测试 8 场景）
- v6：修复加载崩溃（sessionProjections 未声明 inject 被 cordis 守卫拦截）；可选服务改走 ctx.inject 子上下文 + 守卫回归测试
- v7：批量删除兄弟 tool 结果不再报 target_not_on_surface（flush 幂等化）
- v8：CTM 占位消息归类修正（识别 source.plugin === 'ctm'，归用户输入栏 + protected 只读，不再混入系统提示词栏）
- v9：已回退区补收起按钮；片段卡片加复制按钮（宿主对话 UI 无回填输入框钩子，复制是回退后重发的手动路径）

## 已知遗留

- client 尚未发送 `expectedVersion`（host 侧保护是 opt-in 的）；`stale_version` 通知码在 client notices 里无映射，会显示原始码。
- 角色降格恢复的语义限制见 README「已知限制」。
- 宿主「对话」标签页是完整 transcript 视图（ui-conversation 包）：被 shadow/compaction 的内容按官方设计仍然显示，CTM 无法改变其渲染；Kimi Code 式「回退后回填输入框重新编辑」在 DSH 无对应钩子，官方近似是消息上的 fork（分叉新会话）。
