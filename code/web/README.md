# mini-agent（Web 版）

把 CLI 版验证过的 agent 核心，通过 SSE 推到浏览器。

## 跑起来

```bash
cd code/web
pnpm start        # 或 npm start / node src/index.ts，三者等价
```

打开 http://localhost:3000 ，输入「明天天气」。

要求 Node ≥ 22.18（直接运行 `.ts`，不需要 `install`）。
若要类型检查：`pnpm install && pnpm typecheck`。

配置（API Key / 模型）共用上一级的 `code/.env`，无需重复填写。
换端口：`PORT=8080 node src/index.ts`。

## 和 CLI 版的关系

```
core/src/agent.ts        ← 两边共用，一行不改
       ↑  ↑
   cli/    server/       ← 只负责「怎么把事件显示出来」
```

`runAgent(history, message, onEvent)` 的第三个参数就是接缝：

| 形态 | onEvent 接到哪 |
| --- | --- |
| CLI | `process.stdout.write` |
| Web | HTTP 响应流（SSE） |

## 接口

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/` | 单页面 |
| POST | `/api/chat` | body `{ message }`，返回 SSE 事件流 |

事件类型：`text` / `tool` / `error` / `done`，详见 `../../doc/005-web.md`。

## 文件

| 文件 | 职责 |
| --- | --- |
| `src/index.ts` | HTTP 服务 + SSE 推送（约 130 行） |
| `public/index.html` | 单页面，原生 JS，无框架无构建 |

## 注意

- 会话存在内存里，重启即清空；单用户 demo，多用户需要按 sessionId 分桶
- API Key 只在服务端使用，绝不进入前端
