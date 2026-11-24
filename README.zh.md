# dsh-hippocampus

[English](README.md) | [中文](README.zh.md)

[DSH](https://github.com/deepseek-ai/deepseek-harness)（DeepSeek Harness）的项目记忆 + 后台上下文管理插件——以事件溯源原生的方式，落地 [magic-context](https://github.com/cortexkit/magic-context)（OpenCode 的无限上下文 + 自管理记忆插件）背后的思想。本项目是独立实现，与 magic-context 项目没有隶属关系，也未经其认可；借鉴和改编了哪些内容见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。

海马体在你思考的时候负责记忆：跨会话的项目知识自动沉淀、注入、检索、后台整理；上下文压缩把摘要挪出热路径，step 边界永远不等模型调用。

**与 magic-context 四大子系统的对应关系：**

| magic-context 子系统 | dsh-hippocampus |
|---|---|
| 记忆（五分类项目记忆） | `ctx_memory` / `ctx_search` 工具 + 按项目的存储；每会话一次基线注入 |
| 召回（统一混合检索） | FTS5 bigram 全文 + 语义向量，RRF 融合 |
| 整理（dreamer） | 15 分钟后台 tick：对照代码库 verify 记忆、轮转 curate 分类 |
| 上下文管理（historian） | 通过 `CompactionEngine` 合同：后台分段摘要 + 衰减分档渲染，趁缓存失效时换上 |

关键的架构翻译：DSH 没有每请求消息重写 hook（请求是事件日志的纯函数——可重建性是契约而非疏漏），所以 magic-context 的逐 pass 重渲变成了「只追加事件 + 折叠时 replace」。见 [ADR-3](docs/adr/ADR-3-event-sourcing-contract.md)。

**文档：**[需求文档](docs/req/) · [架构决策](docs/adr/) · [设计笔记与业界调研](docs/tech/)

## 安装

```bash
dsh plugin --profile web add github:Edison-A-N/dsh-hippocampus
```

包里自带 bundle patch（`dsh.bundle.patch` + `cordis.patch.yml`）：它先停用 profile 宿主层的 `compaction-basic` 行（hippocampus 注册了 `compaction` 服务，cordis 不允许同名服务有第二个提供者），再插入 `hippocampus` 行。重启 DSH、刷新页面即可。记忆工具和后台压缩不需要任何配置；语义检索和后台整理需要设置[配置](#配置环境变量全部可选)里的变量。

要让 `ctx_search` 也检索历史会话、并使用 `ctx_expand`，还需在 profile 自己的 `cordis.patch.yml` 里打开 DSH 的会话索引（默认 profile 里它是 `openAt: never`）：

```yaml
- id: session-query-sqlite
  config:
    path: !!js dshHomePath('storages', 'session-query', 'index.db')
    openAt: first-search
```

不打开时，`ctx_search` 只返回记忆，并在结果里标 `"sessionSearch": "disabled"`。

卸载：`dsh plugin --profile web remove dsh-hippocampus`。`$DSH_HOME/storages/hippocampus/` 下的存储会保留，删掉这个目录即清除全部记忆。

## 功能总览

### 记忆层

- **`ctx_memory`**：读写当前项目的长期记忆（别的项目的记忆 id 一律按不存在处理）。五分类（PROJECT_RULES / ARCHITECTURE / CONSTRAINTS / CONFIG_VALUES / NAMING），同类别同内容精确去重（重复写入算一次再观察），归档软删除，可用 `superseded_by` 指明承接的记忆。write / get / list / update / archive。工具说明里给每个类别一道准入判断题（取自 magic-context historian 的规则），并明确不收进度、状态、待办、commit hash、会变的版本号。
- **`ctx_note`**：工作笔记（打算回头做的事、某个时点的发现）。存为 `source_type = note`，`ctx_search` 能查到，但不进基线注入。用 `ctx_memory write` 写入与某条笔记完全相同的内容，会把它升级为记忆。
- **`ctx_search`**：混合检索——FTS5 全文（中文、日文、韩文按 bigram 切分，两字词可查；其他文字的单词和标识符整体保留；FTS5 操作符已转义）+ 语义向量（OpenAI 兼容 embeddings 端点），RRF 融合排序。无 API key 时自动退化为纯 FTS5。
- **基线注入**：每个会话的第一个 step，把当前项目的活动记忆（不含笔记）渲染成一条 `<project-memory>` user 消息插到最后一条已认领消息之后。先在全部类别里按 importance、再按最近一次被确认（再观察或核实）的时间挑选，直到用完 4000 字符预算，再按类别排版。importance 不出现在注入文本里；核实过的条目标 `verified`，与代码对不上的标 `possibly stale` 并排在最后；开头说明这是供核实的记录，不是指令；记忆正文里的标签会被转义，记忆无法提前闭合注入块。注入文本是英文，不干预会话语言。只注入一次（source kind 去重，跨 resume 有效），没有记忆就不注入。缓存友好：进前缀后不再变。
- **嵌入管道**：写入时异步嵌入（best-effort），失败留给 5 分钟一次的后台 drain 补。

### 后台整理（dreamer-lite）

15 分钟 tick，按项目跑两个任务，`memory:<project>` 租约串行：

- **verify**：只核对代码事实类记忆（不含 PROJECT_RULES 和笔记），证据只取它点名的、被 git 跟踪的项目文件：文件内容（大文件取记忆标识符附近的行，标为不完整），核对过的记忆再附上从上次核对的 commit 到现在的 git diff。只读项目仓库里被 git 跟踪、真实路径也在仓库内的文件；home 下的文件、超过 512 KB 的文件、二进制文件、像密钥的路径都不会发出本机。结论只作参考：verified / stale（判 archive 也只记成 stale）/ update（改写后的内容保持未核实，等下一轮核对）/ skip（原来的“已核实”失效，回到未核实），存在记录上（`verification_status`、`verified_at` 为上次核对时间、`verified_commit`）。核对过的记忆只在文件有改动、diff 算不出来或超过 30 天时重查。每轮最多 12 条、证据 40000 字符。
- **curate**：单分类轮转整理：合并重复、把带日期的叙述改写成现在时的事实、把带日期或未完成的条目移成笔记（importance ≥ 80 或没有“待办、backlog、进行中”这类未完成标记的拒绝，只有日期不算）。归档必须指明一条同类别、仍有效的承接记忆，删掉一半以上内容的改写也要指明，否则宿主拒绝。

LLM 调用走 `ctx.llm.stream`（provider/model 经环境变量配置），结果只写插件自己的 SQLite，永不触碰活动会话的 surface。

### 后台上下文管理

`CompactionEngine` 后端，注册为 `ctx.compaction`（bundle patch 会停用 profile 宿主层的 `compaction-basic` 行，因为 cordis 遇到同名服务直接抛错）。做法照 magic-context 的 historian（[ADR-9](docs/adr/ADR-9-compartment-compaction.md)），**step 边界零模型调用**：

- **早总结、小块总结。** 保护尾之外还没总结的内容达到 3 × 触发预算（触发预算 = 可用上下文的 5%，夹在 5K–50K；可用上下文 = 窗口 × 65%）就在后台跑一次 historian，与压力高低无关。每次只读一块精简过的记录（工具调用写成 `TC:` 行、工具结果只留开头、推理丢掉），产出若干「分段」：每个工作单元一段，每段四档各自独立的摘要加一个重要度。不动 surface。
- **趁缓存反正失效时换上。** 待换上的分段在两种时候一次 replace 换上：provider 缓存已冷（距上次模型响应超过 `HIPPOCAMPUS_CACHE_TTL`，或该路由从不报告缓存用量），或压力到执行阈值（65%，`HIPPOCAMPUS_BACKGROUND_TRIGGER`）。这次 replace 把上一份 checkpoint 和新总结的原始区间合成一份新 checkpoint：`compaction/start → summary → user/message replace → end`，纯本地日志追加。
- **衰减渲染。** checkpoint 在历史预算内（可用上下文的 15%，`HIPPOCAMPUS_HISTORY_BUDGET`）渲染全部分段，每段用哪一档由 magic-context 的衰减曲线决定（半衰期 ∝ 2^((重要度−50)/25) / 预算压力）：近的、重要的保留全文，旧的例行工作缩成一行或归档。标题带原始事件 seq 区间，`ctx_expand` 能取回原文。
- **保护尾**（magic-context 公式）：30% × 可用上下文 × (1 − 压力)，夹在 [min(12K, 可用的 8%), min(96K, 可用的 40%)]；工具弧不切开。
- **统一按 provider token 计。** 压力和上面所有尺寸都按 provider 的真实 token 算，基数是输入容量（窗口减去请求的 maxTokens，最多扣窗口的 25%）。节点价格来自 token meter 的 字符/4 估算，再乘以本会话在最近一次 provider usage 时实测的比例（usage ÷ 那次请求的估算价）；中文、JSON 多的输出这个比例可达 1.7–2.4 倍。subagent 的任务 prompt（第一条真实用户消息，连同它前面的工作目录等通知）不会被压缩；fork 出来的 subagent 不在此列。
- **阻塞路径**：provider 溢出、压力 ≥ 95% 且没有待换上的分段、手动 `/compact`，都当场分块总结并立即换上。historian 产不出分段时回退到单份总结（ADR-7），保证一定能恢复。
- historian 失败会退避（30 秒起翻倍，最长 15 分钟），不会每步重试。`HIPPOCAMPUS_COMPACTION=checkpoint` 切回单份总结引擎。
- **工具输出回收**（[ADR-10](docs/adr/ADR-10-tool-output-reclaim.md)）。未总结区间里过期的工具结果换成占位文本（输出的首尾几行 + 指向原始 seq 的 `ctx_expand` 提示），不调用模型。结果后面已有 3 条真实用户消息，或之后的新内容达到可用上下文的 25%，就算过期；较早的 `read`/`grep`/`glob`/`web_fetch` 等结果，如果后面出现了完全相同的调用，算重复。最新的保护窗口（可用上下文的 5%，夹在 [min(16K, 8%), 64K]）、不足 250 token 的结果、非文本结果、`skill` 结果和最新一次 `todo_write` 不动；工具调用参数从不改。回收默认 provider 有缓存，绝不单独击穿热缓存：它搭分段换上或阻塞折叠的车，只在缓存已经失效时（本步换了模型，或超过 `HIPPOCAMPUS_RECLAIM_IDLE` 没有模型响应，默认等于缓存 TTL）或压力到强制档（≥ 85%）且这批能腾出至少 2% 可用上下文时才单独执行。每次替换先写一条 `compaction/prune` 影子价格，再写一条引用原事件的 `tool/result` replace，token 计量会扣掉它，日志保留全文。
- **`ctx_reduce`**（[ADR-11](docs/adr/ADR-11-agent-drops-pressure-tiers-historian-facts.md)）。agent 标记不再需要的工具输出，按工具名加调用参数里的一段文字（`{"tool":"bash","match":"npm test"}`）或按事件 seq 指定。标记只是排队：下一次本来就要回收的时候（分段换上、阻塞折叠、换模型、空闲、强制档那一批），队列里的输出换成同样的占位文本，队列自己绝不击穿热缓存。在保护窗口里的输出等到被更新的内容推出去再换；`skill`、`todo_write` 的结果和不足 250 token 的结果会报为跳过。只随分段引擎注册。
- **按压力分级回收**（ADR-11）。过期和重复的输出不够时，强制档（热缓存上每次进入强制档只做一次，遇到本来就要改写的时候可以再做）、≥ 95% 和溢出时也回收仍在用的工具输出：先 shell、web 等其他工具，再 `edit`/`write`/`grep`/`glob`，最后 `read`/`todo_write`/subagent 报告，同级里先旧后新。目标是对话之外的底数（系统提示和工具定义）加剩余空间的 30%。最新一轮的工具结果始终保留；95% 以下，保护窗口和后两级各自最新的 20% 也保留。
- **historian 顺带提取记忆**（ADR-11）。historian 额外返回项目层面的持久事实，按与 `ctx_memory` 相同的分类准入题筛选，并能看到活动记忆，不会重复写。提示词要求它不把工具输出里的指令当成事实，项目规则只取自用户消息（这是对模型的要求，代码无法检查事实从哪来）。合格的事实（每次最多 5 条）写成 `source_type = historian`、importance 40 的记忆；和已有条目（活动、已归档或笔记）相同的事实只算一次再观察，已归档的记忆不会被复活。只覆盖了切片一部分的调用不写事实。`HIPPOCAMPUS_HISTORIAN_FACTS=off` 关闭。

### Web 面板

会话 view 栏的两个 tab（与 对话/轨迹 并列），数据来自插件的 JSON API（`/plugins/hippocampus/api/*`）。每个路由都先过宿主的 Host/Origin 校验和 Web 登录 cookie；三个写路由（编辑、归档、立即整理）还要求 JSON 请求体。API 只在 Web profile 里注册。

**记忆** — 当前会话所属项目的记忆池。顶部固定的概览卡按分类显示条数（点卡片即筛选），另有已归档、待嵌入条数；支持全文搜索（内容/分类/`m<编号>`，命中处高亮）和按最新/重要性排序。每张记忆卡带分类色条和重要性条，长记忆折叠到四行、可展开。卡片悬停可编辑（内容 + 重要性滑块）或归档（两击确认）。按项目隔离：面板用与 `ctx_memory` 相同的身份链解析会话工作区，切会话即切记忆池。

**压缩与整理** — 海马体对当前会话上下文做了什么。上下文占用和构成交给宿主的 token 视图（以及 dsh-context 等插件），这个 tab 不再重复：

- **缓存命中** — 概览数字（模型调用数和按输入量加权的缓存命中率，按图上那批调用统计；全会话的击穿次数和前缀替换次数，后者按日志里 `compaction/summary` 事件统计；本项目最近的整理次数），以及每次模型调用一根堆叠柱（缓存读/缓存写/未缓存，柱高 = 输入量）；红点 = 击穿（该调用前发生了压缩替换，前缀重写）。
- **压缩记录** — 每次摘要调用的记录（模式、模型、遮蔽区间、usage、耗时、可展开的摘要全文），以及 append-only 日志里的 compaction 事件时间线。
- **后台整理** — dreamer 运行记录（任务、状态、改了什么），可只看失败项，支持立即验证/立即整理手动触发。

面板用的是宿主主题变量，浅色/深色主题跟随 DSH。

## 配置（环境变量，全部可选）

| 变量 | 作用 | 默认 |
|---|---|---|
| `HIPPOCAMPUS_EMBEDDING_API_KEY` | 语义检索的 API key；缺失则退化为纯 FTS5 | 无 |
| `HIPPOCAMPUS_EMBEDDING_BASE_URL` | OpenAI 兼容 embeddings 端点 base URL | `https://api.openai.com/v1` |
| `HIPPOCAMPUS_EMBEDDING_MODEL` | embedding 模型 id | `text-embedding-3-small` |
| `HIPPOCAMPUS_DREAMER_PROVIDER` / `_MODEL` | 后台 verify/curate 使用的 LLM provider/model；两者都配置后 dreamer 才会注册（任一缺失则完全不注册，无 interval、无 LLM 调用） | 无 |
| `HIPPOCAMPUS_DREAMER_MAX_TOKENS` | dreamer 单次调用 maxTokens | 4000 |
| `HIPPOCAMPUS_COMPACTION` | 设为 `checkpoint` 切回单份总结引擎（ADR-7） | compartments |
| `HIPPOCAMPUS_BACKGROUND_TRIGGER` | 执行阈值：可用上下文比例，也是强制换上待换分段的压力 | 0.65 |
| `HIPPOCAMPUS_CACHE_TTL` | provider 缓存有效期；空闲超过它就换上待换分段（`30s`、`5m`、`1h`、`never`） | 5m |
| `HIPPOCAMPUS_RECLAIM_IDLE` | 空闲超过它就单独回收过期工具输出，不必等分段换上；不能短于 `HIPPOCAMPUS_CACHE_TTL`。缓存保留 1 小时的路由改设 `HIPPOCAMPUS_CACHE_TTL=1h` | 同 `HIPPOCAMPUS_CACHE_TTL` |
| `HIPPOCAMPUS_HISTORY_BUDGET` | 渲染历史占可用上下文的比例 | 0.15 |
| `HIPPOCAMPUS_HISTORIAN_PROVIDER` / `_MODEL` | historian 用的模型；不设则用会话自己的模型 | 无 |
| `HIPPOCAMPUS_HISTORIAN_FACTS` | 设为 `off` 后 historian 不再写项目记忆 | 开 |
| `HIPPOCAMPUS_FORCE_COMMIT` / `HIPPOCAMPUS_RESUMMARIZE_GROWTH` | 仅单份总结引擎：强制提交压力 / 重新总结增长阈值 | 0.8 / 0.1 |

存储位置由 `DSH_HOME` 决定（默认 `~/.dsh`）：`$DSH_HOME/storages/hippocampus/memory.db`。

## 存储与身份

- SQLite（WAL + busy_timeout，多进程安全）：`$DSH_HOME/storages/hippocampus/memory.db`。目录以 `0700` 创建，数据库文件打开时设为 `0600`。
- 项目身份：git 根提交哈希（`git rev-list --max-parents=0 HEAD`），同一仓库所有 worktree 共享记忆池；非 git 目录用路径哈希；git 失败 60 秒冷却。根提交相同的两个仓库（fork，或保留了历史的副本）共用一个记忆池。

## 数据与隐私

存了什么（都在上面那一个数据库里）：

- 记忆和笔记（agent 通过 `ctx_memory` / `ctx_note` 写入的文本），开启语义检索时还有它们的向量；
- 每个会话的分段摘要和压缩记录（用户消息、助手消息和工具活动的摘要）；
- dreamer 运行记录（每次 verify/curate 改了什么）。

没有定时删除：归档的记忆、摘要和运行记录会一直保留，直到你删掉数据库。记忆是明文，不要让 agent 记住密钥。

哪些内容会离开本机（只走你配置的路由）：

- **historian 和压缩调用**：把会话的记录分块发给会话自己的模型，设了 `HIPPOCAMPUS_HISTORIAN_PROVIDER` / `_MODEL` 时发给它。historian 调用还会带上项目的活动记忆（用于事实去重，`HIPPOCAMPUS_HISTORIAN_FACTS=off` 时不发）。
- **dreamer 调用**（只有设了 `HIPPOCAMPUS_DREAMER_PROVIDER` 和 `_MODEL` 才会有）：发送记忆文本，以及 git 跟踪的项目文件片段和 diff，受[后台整理](#后台整理dreamer-lite)里写的文件限制约束。
- **嵌入调用**（只有设了 `HIPPOCAMPUS_EMBEDDING_API_KEY` 才会有）：把记忆文本和检索词发给 `HIPPOCAMPUS_EMBEDDING_BASE_URL`。

Web 面板不按项目隔离：DSH 是单用户的，登录后的浏览器能查看和编辑所有项目的记忆池。

## 环境要求

- **DSH 宿主**（[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)）0.2.2-rc.3 及以上的 0.2 版本（`engines.dsh`）：`ctx.llm` / `ctx.tools` 等服务由宿主提供，插件无法独立运行
- Node.js >= 22.19（`node:sqlite` 需要较新版本）

## 手动组合

推荐用 bundle patch 安装。如果要自己写这两行（比如 profile 只把本包当普通依赖），加上 bundle 自带的同样两条 patch：

```yaml
# cordis.patch.yml
- id: compaction-basic
  disabled: true
- insert:
    - id: hippocampus
      name: 'dsh-hippocampus'
```

## 开发

```sh
npm install
npm run build:client   # 把 client/src 打包成 lib/client.js
npm test               # 单测；设 DSH_HOST_NODE_MODULES=<dsh 安装目录>/node_modules/.pnpm/node_modules 可同时对真实 token meter 跑宿主契约测试
```

`lib/client.js` 会提交进仓库，因为 DSH 直接加载它；改了 `client/src` 要在同一次改动里重新构建。详见 [CONTRIBUTING.md](CONTRIBUTING.md)。

无 npm 运行时依赖：存储用 node 内置 `node:sqlite`；`@deepseek-ai/dsh-tools` / `dsh-llm` / `dsh-compaction` 在插件运行时由宿主 DSH 提供（裸名导入失败时走 repo-root 回退链解析），独立 `npm test` 不需要安装它们。

## 已知边界

- `@deepseek-ai/dsh-tools` / `dsh-llm` / `dsh-compaction` 的解析靠裸名 → repo root 回退链（pnpm link 依赖隔离，裸名从插件目录解析不到）。
- 基线注入是「本会话开头一次性快照」：会话中写入的新记忆要到下个会话才进基线。
- 后台摘要落地后，commit 等下一个超过 force 阈值的 pre-step（通常是下一个 step）；会话在 landed 前结束则丢弃该次摘要（下个会话重新触发）。
- 不实现（[ADR-11](docs/adr/ADR-11-agent-drops-pressure-tiers-historian-facts.md)）：推理内容清理、被后续编辑覆盖的旧编辑压缩、旧 assistant 文本压缩。三者都要改写 assistant 消息，DSH 不允许插件替换它们。

## 许可

[MIT](LICENSE)。部分内容改编自 MIT 许可的项目，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
