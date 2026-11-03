# mini-agent（终端版）

从 0 实现的最小 AI Agent。**零框架、零运行时依赖、零编译**。

本目录只负责交互（`src/index.ts`），agent 核心在 [`../core`](../core)，
同一套核心也被 [`../web`](../web) 的 Web 版复用。

## 跑起来（2 步）

```bash
cd code/cli
pnpm start        # 或 npm start / node src/index.ts，三者等价
```

配置在上一级 `code/.env`（智谱 GLM-4.5-Flash 免费档）。
换机器时执行 `cd code && cp .env.example .env`，再填入自己的 Key。

要求 Node ≥ 22.18（直接运行 `.ts`，不需要 `npm install`，也不需要 `tsx`）。
若要类型检查：`pnpm install && pnpm typecheck`（或 `npm install` / `npm run typecheck`）。

然后输入：

```
你 > 明天天气
```

看到的过程类似：

```
  -> 调用 get_my_location({})
  <- 结果 Shanghaishih，Shanghai，China。经纬度：31.222,121.458
  -> 调用 get_weather({"latitude":31.222,"longitude":121.458,"date_offset":1})
  <- 结果 坐标 31.222,121.458 2026-11-04：小阵雨，最低 17℃，最高 20℃，降水概率 100%
明天上海小阵雨，气温17-20℃，降水概率100%，记得带伞！
```

`->` 是向工具发请求，`<-` 是工具把结果交还模型。

## 命令

| 输入 | 作用 |
| --- | --- |
| 任意问题 | 对话（自动判断要不要调工具） |
| `/clear` | 清空上下文，重新开始 |
| `/exit` | 退出 |
| Ctrl+C | 立即退出 |

## 当前模型

`code/.env` 里配的是智谱 **glm-4.5-flash**（免费档，支持工具调用）：

| 项 | 值 |
| --- | --- |
| 接口 | `https://open.bigmodel.cn/api/paas/v4` |
| 模型 | `glm-4.5-flash` |

它是**思考型模型**：每次回答前会先内部推理几秒（服务端推 `delta.reasoning_content`），
本项目只展示最终正文、刻意忽略思考过程，所以提问后短暂停顿属正常，不是卡死。

## 换成其他模型（可选）

任何 OpenAI 兼容端点都能用，只改 `.env`，代码一行不动。

**本地跑（Ollama）**：装好 [Ollama](https://ollama.com) 并 `ollama pull qwen2.5:7b`：

```bash
LLM_BASE_URL=http://localhost:11434/v1
LLM_API_KEY=ollama
LLM_MODEL=qwen2.5:7b
```

## 免费外部接口

天气和定位都不需要注册申请 Key：

| 工具 | 用的接口 |
| --- | --- |
| `get_my_location` | `ipapi.co` → `wttr.in` 多源探测，返回城市名 + 经纬度 |
| `get_weather` | `open-meteo.com`（免费、无需 Key） |

## 文件职责

| 文件 | 干什么 |
| --- | --- |
| `src/index.ts` | 终端交互：读输入、把 agent 事件打印出来 |
| `../core/src/agent.ts` | **Agent 循环**，项目核心 |
| `../core/src/llm.ts` | 调模型 + 解析流式返回 |
| `../core/src/tools.ts` | 工具的声明与实现 |
| `../core/src/location.ts` | 多源 IP 定位，产出经纬度 |
| `../core/src/http.ts` | HTTP 工具：超时 + 连接失败自动重试 |
| `../core/src/env.ts` | 自动加载 `code/.env`（所以不必加 `--env-file`） |
| `../core/src/config.ts` | 读环境变量 |

## 怎么验证它真的在干活

1. 问「明天天气」→ 看到两次工具调用，最终温度能在 [open-meteo](https://open-meteo.com) 上对上
2. 问「那后天呢」→ 复用上一轮的地点，`date_offset` 变成 2
3. 问「查一下 Noizeland 的天气」→ 程序不崩溃，工具返回「找不到城市」
4. 故意把 `code/.env` 里的 Key 改错 → 提示「模型接口返回 401」，而不是一堆堆栈

## 下一步

这是「合并版」。要真正学会，请打开 [`../../doc/003-tasks.md`](../../doc/003-tasks.md)，
**倒回去按阶段 0→1→2→3 各重写一遍**，每一阶段单独提交。
