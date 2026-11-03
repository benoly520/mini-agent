# AGENTS.md — 给 AI 助手的项目约束

> 本文件对本仓库内所有 AI 生成/修改代码的行为**强制生效**。
> 如果你是被要求实现某个功能的 AI，请先读完本文件再动手。

## 0. 这个项目的目的

这是一个**教学项目**。用户是编程小白，目标是通过亲手实现来学习 AI Agent 原理。

**因此：「能跑」不是唯一目标，「用户能读懂并复述」才是。**

## 1. 硬性禁止（违反即视为任务失败）

- ❌ 禁止引入任何 LLM / Agent 框架或 SDK：
  `langchain`、`@langchain/*`、`llamaindex`、`openai`、`@anthropic-ai/sdk`、
  `ai`（Vercel AI SDK）、`@ai-sdk/*`、`langgraph`、`crewai`、`mastra`、`voltagent` 等。
- ❌ 禁止引入任何运行时依赖。`package.json` 的 `dependencies` 必须保持为空。
  （`devDependencies` 只允许 `typescript` 和 `@types/node`：它们只用于编辑器类型提示
  和 `pnpm typecheck`，运行时不参与。删掉 `node_modules` 后 `node src/index.ts` 仍须能跑。）
- ❌ 禁止使用需要编译步骤的方案（webpack / rollup / tsc 构建产物）。
  本项目依赖 Node ≥ 22.18 原生运行 `.ts` 文件。
- ❌ 禁止使用 TUI 库（`ink`、`blessed`、`chalk` 以外的花哨渲染）。
- ❌ 禁止硬编码 API Key 或将其写入任何被提交的文件。
- ❌ 禁止一次性重写整个项目。见第 3 条。
- ❌ 禁止提供「执行任意 shell 命令」的工具。

## 2. 必须遵守

- ✅ 每次改动前，先读 `doc/001-requirements.md` 和 `doc/002-design.md`，
  确认改动没有偏离既定设计。**文档是唯一事实来源**。
- ✅ 单个源文件 ≤ 160 行。超过就拆。
- ✅ 代码风格：2 空格缩进、单引号、语句结尾分号、中文注释。
- ✅ 每个函数上方写中文 JSDoc，说明「做什么、参数含义、为什么这么写」。
- ✅ 所有可能失败的 I/O 必须 `try-catch`，并向用户输出**中文**的友好错误信息。
- ✅ 修改 `llm.ts` / `agent.ts` 的核心逻辑时，必须在回复里解释「为什么这样改」，
  而不是只给代码。
- ✅ 新增工具时，`description` 必须写清楚「什么情况下该调用我」——
  这是写给模型看的提示词。

## 3. 分步交付纪律

- 一次只实现 `doc/003-tasks.md` 中的**一个阶段**。
- 每次改动控制在 100 行以内（新增 + 修改）。
- 交付时必须包含三部分：
  1. 改了哪些文件、为什么
  2. **如何验证**（具体到输入什么、期望看到什么）
  3. 「这一步的核心知识点是什么」
- 如果用户的请求会导致跨越多个阶段，先拆分并询问，不要擅自合并。

## 4. 当你不确定时

- 优先保持**简单可读**，而不是「工程完备」。这是教学项目，不是生产项目。
- 需要引入新概念（如 `AbortController`）时，先用一句话解释，再使用。
- 发现文档与需求冲突，先指出冲突，由用户裁决，不要自行选择。

## 5. 目录约定

```
mini-agent/
├── doc/                    # SDD 文档：核心层 + 形态层，见 doc/README.md
│   ├── 001-requirements.md
│   ├── 002-design.md
│   ├── 003-tasks.md
│   ├── 004-cli.md
│   ├── 005-web.md
│   └── README.md
├── code/
│   ├── core/src/           # Agent 核心，不含任何界面
│   │   ├── agent.ts        # Agent 循环（唯一实现）
│   │   ├── llm.ts          # 模型 HTTP + SSE 解析
│   │   ├── tools.ts        # 工具注册表
│   │   ├── location.ts     # 多源 IP 定位（产出坐标）
│   │   ├── http.ts         # 带超时/重试的 HTTP
│   │   ├── env.ts          # 自动加载 .env
│   │   └── config.ts       # 环境变量
│   ├── cli/src/index.ts    # 终端版：REPL 渲染
│   ├── web/                # Web 版：SSE 推送 + 单页面
│   │   ├── src/index.ts
│   │   └── public/index.html
│   ├── .env                # 真实配置（gitignored）
│   └── .env.example
└── ...
```

> 命名约定：目录按**运行形态**命名（`core` / `cli` / `web`），不要用 `client` / `server`
> 这类前后端对立的名字——本项目不存在客户端-服务端关系，只是同一个核心的两种外壳。

## 6. 验证命令

```bash
# 配置在 code/ 下，两种形态共用
cd code && cp .env.example .env    # 填入 LLM_API_KEY

# 终端版
cd cli && node src/index.ts

# Web 版
cd web && node src/index.ts        # http://localhost:3000
```

无 Key 启动时应输出中文提示而非堆栈，这本身也是一条验收标准（AC-6）。
