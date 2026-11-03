# mini-agent

从 0 实现一个最小 AI Agent，用来学习 Agent 原理。
**不使用任何框架、不装任何运行时依赖**，只靠 TypeScript + 原生 `fetch`。

## 目录

| 路径 | 内容 |
| --- | --- |
| [`doc/`](./doc) | SDD 规范文档：需求 / 设计 / 任务 / Web 版规格 |
| [`code/core/`](./code/core) | Agent 核心：循环、模型调用、工具（不含界面） |
| [`code/cli/`](./code/cli) | 终端版（REPL + 流式输出） |
| [`code/web/`](./code/web) | Web 版（SSE + 单页面） |
| [`AGENTS.md`](./AGENTS.md) | 给 AI 助手的实现约束（禁止引入框架等） |

## 同一条核心，两种形态

```
        code/core/src/agent.ts        ← Agent 循环，唯一实现
              ↑            ↑
        code/cli/        code/web/    ← 只负责「事件怎么显示」
```

`runAgent(history, message, onEvent)` 的回调就是接缝：CLI 接到终端输出，Web 接到 HTTP 流。

## 先读文档

1. [`doc/001-requirements.md`](./doc/001-requirements.md) —— 要做什么、怎么算做完
2. [`doc/002-design.md`](./doc/002-design.md) —— 怎么做，含 4 个必踩的坑
3. [`doc/003-tasks.md`](./doc/003-tasks.md) —— 按什么顺序做，每步学到什么

形态层（同一个核心的外壳）：

4. [`doc/004-cli.md`](./doc/004-cli.md) —— 终端形态怎么实现
5. [`doc/005-web.md`](./doc/005-web.md) —— Web 形态怎么实现

完整索引见 [`doc/README.md`](./doc/README.md)。

## 快速开始

### 前置要求

| 项 | 要求 | 说明 |
| --- | --- | --- |
| Node | **≥ 22.18**（推荐 24.x） | 项目直接运行 `.ts`，依赖 Node 原生类型剥离 |
| 包管理器 | 可选 | pnpm / npm 都行；都不装就直接 `node src/index.ts` |
| 依赖安装 | **不需要** | 零运行时依赖；只有跑类型检查才需 `pnpm install` |

### 平台支持

macOS / Linux / Windows 11 均可直接运行。代码里没有任何平台绑定：

| 关注点 | 做法 |
| --- | --- |
| 路径 | 全部用 `import.meta.url` 解析，与当前目录、分隔符无关 |
| `.env` 编码 | 读取时剥离 UTF-8 BOM，兼容 CRLF 换行（Windows 记事本常见） |
| npm scripts | 只有 `node src/index.ts`，不含 `&&`、`>` 等 shell 语法 |
| 换行符 | `.gitattributes` 统一为 LF，避免跨平台假 diff |

唯一硬要求是 Node ≥ 22.18（需要原生运行 `.ts` 的能力）。

### 配置（首次必做）

`.env` 含密钥，已被 gitignore 排除，所以 **clone 下来是没有的**，必须自己生成：

```bash
cd code
cp .env.example .env
```

Windows 上 `cp` 不可用，用对应命令：

```powershell
Copy-Item .env.example .env          # PowerShell
copy .env.example .env               # cmd
```

然后编辑 `code/.env`，把 `LLM_API_KEY=` 后面填上自己的 Key
（智谱开放平台控制台获取）。两种形态共用这一份配置。

> 已经配好 Key 的机器**不要**再执行复制命令，会把真实 Key 覆盖成空模板。

### 启动

```bash
# 终端版
cd code/cli
pnpm start          # 或 npm start
# Web 版
cd code/web
pnpm start          # 或 npm start，打开 http://localhost:3000
```

三种方式完全等价：`pnpm start` / `npm start` / `node src/index.ts`。
选哪个取决于你机器上装了什么，行为一模一样。

### 安装依赖（仅类型检查需要）

运行时零依赖，**不 install 也能启动**。只有想跑类型检查时才需要装一次；
`cli` 和 `web` 是两个独立包，各装各的：

```bash
cd code/cli && pnpm install    # 或 npm install
cd code/web && pnpm install    # 或 npm install
```

装的是 `typescript` 和 `@types/node`，只给编辑器和 `tsc` 用，不参与运行。
`code/core/` 没有自己的 `node_modules`，它的类型由引用方（cli / web）的
`tsconfig.json` 通过 `include` 覆盖检查。

### 类型检查

```bash
cd code/cli && pnpm typecheck  # 或 npm run typecheck
cd code/web && pnpm typecheck
```
