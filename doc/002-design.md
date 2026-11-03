# 002 技术设计（How）

> SDD 第 2 步：把需求翻译成可执行的技术方案。
> 本文档包含**三个必须亲手踩的坑**，它们是这个项目 80% 的学习价值所在。

## 1. 总体架构

```
┌──────────────────────────────────────────────────────────┐
│  src/index.ts   REPL：读输入 → 调 agent → 打印结果        │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────▼────────────────────────────────┐
│  src/agent.ts   Agent 循环（本项目的心脏）                │
│                                                          │
│   messages ──► llm.chat() ──► 有 tool_calls?             │
│      ▲                            │ 否          │ 是      │
│      │                            ▼             ▼         │
│      │                      打印最终回答   执行工具        │
│      └──────── 把结果作为 tool 消息塞回去 ◄──────┘         │
└──────────┬──────────────────────────┬────────────────────┘
           │                          │
┌──────────▼──────────┐   ┌───────────▼─────────────────────┐
│  src/llm.ts         │   │  src/tools.ts                   │
│  fetch + SSE 解析   │   │  工具注册表 + get_weather 等     │
└──────────┬──────────┘   └───────────┬─────────────────────┘
           │                          │
           ▼                          ▼
    OpenAI 兼容 API           ipapi.co / open-meteo.com
```

**一句话总结架构**：`agent.ts` 只做「循环 + 决策」，`llm.ts` 只做「说话」，
`tools.ts` 只做「干活」。三者互不知道对方的内部细节。

## 2. 一次「明天天气」的完整时序

这是全项目最需要看懂的一张图。数字是消息数组 `messages` 的追加顺序。

```
用户输入："明天天气"
  │
  ├─ messages[0] = { role: "system",  content: "<人设 + 规则>" }
  ├─ messages[1] = { role: "user",    content: "明天天气" }
  │
  ▼ 第 1 轮请求
模型返回：{ content: null, tool_calls: [{ name: "get_my_location", arguments: "{}" }] }
  ├─ messages[2] = { role: "assistant", content: null, tool_calls: [...] }   ← 必须原样回传
  │  执行 get_my_location() → "北京市 北京 中国"
  ├─ messages[3] = { role: "tool", tool_call_id: "...", content: "北京市 北京 中国" }
  │
  ▼ 第 2 轮请求
模型返回：{ content: null, tool_calls: [{ name: "get_weather", arguments: '{"city":"北京","date_offset":1}' }] }
  ├─ messages[4] = { role: "assistant", content: null, tool_calls: [...] }
  │  执行 get_weather() → "北京 2026-11-04 晴 最高18℃ 最低7℃ 降水概率0%"
  ├─ messages[5] = { role: "tool", tool_call_id: "...", content: "北京 2026-11-04 晴 ..." }
  │
  ▼ 第 3 轮请求
模型返回：{ content: "你所在的北京明天是晴天，气温 7~18℃，早晚偏凉..." }   ← 无 tool_calls
  └─ 循环结束，返回这句话
```

**核心洞察**：Agent 循环里模型被调用了 **3 次**，每次看到的 `messages` 都比上一次更长。
所谓「智能」，就是这个不断累积上下文的过程。

## 3. 坑一：流式响应里 tool_calls 是碎片，必须自己拼接

这是全网教程最常漏掉、也是最容易卡住的点。

非流式时，`tool_calls[0].function.arguments` 是一个完整的 JSON 字符串。
但**开启 stream 后**，服务端会把它切成很多片，一片一片地推：

```
data: {"delta":{"tool_calls":[{"index":0,"id":"call_abc","function":{"name":"get_weather","arguments":""}}]}}
data: {"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\"ci"}}]}}
data: {"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ty\":\"北"}}]}}
data: {"delta":{"tool_calls":[{"index":0,"function":{"arguments":"京\"}"}}]}}
```

注意：

- `id` 和 `name` 只在**第一片**出现，后面都是 `undefined`
- `arguments` 必须用 `+=` 累加，用 `=` 会被覆盖成最后一片
- 多个工具并行调用时靠 `index` 区分，**不能靠数组下标**

正确写法（本项目 `llm.ts` 里的实现）：

```ts
const byIndex = new Map<number, ToolCall>();
for (const frag of delta.tool_calls ?? []) {
  const slot = byIndex.get(frag.index) ?? { id: '', name: '', arguments: '' };
  if (frag.id) slot.id = frag.id;                        // 只在第一片有值
  if (frag.function?.name) slot.name += frag.function.name;
  if (frag.function?.arguments) slot.arguments += frag.function.arguments;
  byIndex.set(frag.index, slot);
}
```

**典型症状**：不拼接就 `JSON.parse`，会报 `Unexpected end of JSON input`。踩过一次就永远记住了。

## 4. 坑二：assistant 的 tool_calls 消息必须原样回传

很多新手把工具结果塞进去，却忘了把模型上一条「我要调用工具」的消息也放回 `messages`。
结果服务端报错：`tool_calls must be followed by tool messages`。

规则：**assistant(tool_calls) 与 tool(result) 必须成对出现，顺序不能乱**，
且 `tool_call_id` 必须与 assistant 那条里的 `id` 严格一致。

## 5. 坑三：SSE 数据会跨 chunk 断行

`fetch` 返回的 `response.body` 是字节流，一次 `chunk` 不一定是一条完整的 `data: {...}`，
很可能把一行 JSON 从中间劈开。所以**必须维护缓冲区**，只处理以 `\n` 结尾的完整行：

```ts
buffer += decoder.decode(chunk, { stream: true });
while (buffer.includes('\n')) {
  const line = buffer.slice(0, buffer.indexOf('\n')).trim();
  buffer = buffer.slice(buffer.indexOf('\n') + 1);
  // 只处理完整行
}
```

并且解码要用 `{ stream: true }`，否则一个中文字符被劈成两半时会变成乱码。

## 6. 工具注册表设计

每个工具就是一个普通对象，四个字段：

```ts
{
  name: 'get_weather',
  description: '查询某个城市某天的天气。用户问天气时必须调用。',
  parameters: { type: 'object', properties: {...}, required: [...] },  // JSON Schema
  run: async (args) => '返回给模型看的纯文本',
}
```

`description` 是**写给模型看的提示词**，写得好不好直接决定它会不会在正确的时机调用。
`run` 永远返回字符串——因为 `tool` 角色的消息 `content` 只能是字符串。

**两个已实现的工具**：

| 工具 | 实现 | 返回示例 |
| --- | --- | --- |
| `get_my_location` | 多源探测：`ipapi.co/json/` → `wttr.in/?format=j1`，返回城市名 **+ 经纬度**；全失败则报错让模型反问用户 | `Shanghaishih，Shanghai，China。经纬度：31.22,121.46` |
| `get_weather` | 有坐标直接用坐标查 forecast；只有城市名时先走 Open-Meteo geocoding 转坐标 | `北京 2026-11-04 晴，最高18℃、最低7℃、降水概率0%` |

**为什么定位要返回坐标而不是城市名**：各服务对同一地点的写法完全不同——
wttr.in 把上海叫 `Shanghaishih`，Open-Meteo 叫 `Shanghai`，中文是 `上海`。
拿名字去二次匹配必然踩坑（实测 `Shanghaishih` 查不到天气）。
坐标是唯一无歧义的机器可读标识，让定位工具直接产出坐标，整条链路才稳。
这也是真实工程里「机器之间传结构化数据，不传自然语言」的典型例子。

天气数据用 Open-Meteo 的好处：**免费、无需注册、无需 Key**，非常适合练手。

## 7. 模块职责

| 文件 | 职责 | 禁止做的事 |
| --- | --- | --- |
| `src/env.ts` | 启动时用 `process.loadEnvFile` 自动加载同目录 `.env` | 不含业务逻辑 |
| `src/config.ts` | 读环境变量、校验、导出常量 | 不含业务逻辑 |
| `src/http.ts` | 带超时/重试的 HTTP 工具（`fetchWithRetry`、`fetchJson`） | 不含业务知识 |
| `src/location.ts` | 多源 IP 定位，产出 `{ city, latitude, longitude }` | 不查天气、不碰模型 |
| `src/llm.ts` | 一次 HTTP 请求 + SSE 解析 → 返回 `{ text, toolCalls }` | 不碰工具、不写循环 |
| `src/tools.ts` | 工具定义 + `runTool(name, args)` 分发 | 不碰 LLM |
| `src/agent.ts` | 循环、消息累积、终止判断 | 不发 HTTP 细节、不看天气数据格式 |
| `src/index.ts` | readline REPL、渲染、异常兜底 | 不含 agent 逻辑 |

## 8. 错误处理策略

| 场景 | 处理 |
| --- | --- |
| 缺 API Key | `src/env.ts` 自动加载 `.env` 后 Key 仍为空时，立即中文提示并退出，不打印堆栈 |
| 模型接口 4xx/5xx | 读出响应体，抛出含状态码的中文错误 |
| 模型接口连接抖动（`fetch failed`） | `http.ts` 的 `fetchWithRetry` 自动重试 3 次（400/800ms 退避），并把底层 `cause.code` 写进错误信息 |
| 超时 | **不重试**。`AbortSignal.timeout` 触发说明对端很慢，重试只会让用户多等一遍 |
| 工具内部报错 | **不**向上抛，捕获后把 `错误：xxx` 作为 tool 结果返回给模型，让它自己改（对应 FR-11） |
| 外部接口超时 | `http.ts` 统一用 `AbortSignal.timeout` 兜底：通用 8s，定位类接口 5s |
| 定位源 1 失败 | 静默降级到下一个源（`ipapi.co` → `wttr.in`），不打扰用户、不暴露给模型 |
| **定位全部失败** | 抛出 `所有定位源都失败（…），请直接询问用户所在城市`。模型据此反问用户，**不得**编造地点 |
| 城市名匹配不到 | 抛出 `找不到城市「xxx」，请换一个更常见的城市名，或改用经纬度`。模型可换名重试或改用坐标 |
| `get_weather` 既无坐标也无城市名 | 直接抛错，**不猜默认值**（这正是当初删掉 `MY_CITY` 的原因） |
| 用户 Ctrl+C | 捕获 `SIGINT`，友好退出 |

**设计原则**：降级发生在工具内部（多源探测），失败才上升到模型（反问用户）。
任何一层都不允许「悄悄编一个合理答案」——错误的天气比没有天气更糟糕。

## 9. 关键参数

| 参数 | 值 | 理由 |
| --- | --- | --- |
| `maxSteps` | 5 | 够用且能兜住死循环；正常任务 1~3 轮 |
| `temperature` | 0.3 | 工具调用场景要稳定，不要发散 |
| `stream` | true | 为了 FR-8 |
| 工具返回文本上限 | 约 2000 字符 | 防止一次塞爆上下文 |

## 10. 为什么坚持不用框架

框架确实省事，但会把下面这些**全部藏起来**，你就学不到东西了：

- 请求体长什么样、`tools` 字段怎么填（→ 你自己拼 JSON 才会）
- 流式怎么解析、tool_calls 怎么拼（→ 上面三个坑）
- 循环在哪退出、什么时候该强制终止
- `messages` 数组到底长什么样（→ 这是 Agent 调试的全部真相）

等这 200 行你自己写透之后，再去看 LangChain 源码，你会发现它核心也就是这些。
