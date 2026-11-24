# mini-agent 复习速查手册

> 一份文档覆盖全部 7 篇原始文档（000~005 + README）的核心知识点。
> 用途：忘了很多细节时，10 分钟扫一遍找回感觉。**先看第 1 节，其余按需要跳读。**

---

## 1. 一句话心智模型（全项目的灵魂）

> **模型只做一件事：生成文本。**
> 所谓「工具调用」，不是模型调用了工具，而是模型**生成了一段符合约定的文本**，表达「我想调用某工具、用这些参数」。
> 真正干活的永远是你的代码。

推论（三个常见误解）：

| 误解 | 真相 |
| --- | --- |
| 模型能上网查天气 | 不能。数据是 `tools.ts` 用 `fetch` 拿到的 |
| 模型记得我们聊过什么 | 不记得。每次请求都要重发完整 `messages`；「记忆」就是你手里的数组 |
| temperature 调高会更聪明 | 只影响随机性。工具调用场景要调低（本项目 0.3） |

**分工口诀**：需要「真实数据」的地方 → 你的代码；需要「判断、表达、组织语言」的地方 → 模型。
**心法**：Agent 的智能在模型里，Agent 的能力在你的代码里。

---

## 2. 一次「明天天气」的完整数据流（最该记住的一张图）

模型被调用 **3 次**，每次看到的 `messages` 都比上一次更长：

```
用户输入"明天天气"
 messages[0] = {system: 人设+规则}
 messages[1] = {user: "明天天气"}
   ▼ 第1轮 → 模型返回 tool_calls: get_my_location
 messages[2] = {assistant, tool_calls:[...]}   ← 必须原样回传
 执行 get_my_location() → "北京，31.2,121.5"
 messages[3] = {tool, tool_call_id, content:"..."}
   ▼ 第2轮 → 模型返回 tool_calls: get_weather
 messages[4] = {assistant, tool_calls:[...]}
 执行 get_weather() → "北京 2026-11-04 晴 7~18℃"
 messages[5] = {tool, tool_call_id, content:"..."}
   ▼ 第3轮 → 模型返回正文，无 tool_calls → 循环结束
```

**核心洞察**：所谓「智能」，就是这个不断累积上下文的循环。第 2 轮的工具结果影响了第 3 轮的决策。

`finish_reason` 是判断信号：`tool_calls` = 「我没在回答，我在要求你替我做件事」；`stop` = 「我说完了」。

---

## 3. messages 数组的 4 种 role 与铁律

| role | 谁写的 | 关键时刻 |
| --- | --- | --- |
| `system` | 你 | 人设 + 规则（如「必须调工具，不许编造」），**裁剪上下文时永远保留** |
| `user` | 用户 | 每轮输入 |
| `assistant` | 模型 | 有 `tool_calls` 时 `content` 可为 `null`，但**那条消息必须原样塞回历史** |
| `tool` | **你的代码** | 带 `tool_call_id`，模型靠这条第一次看到工具结果 |

**铁律**：`assistant(tool_calls)` 与 `tool(result)` 必须成对出现、顺序不乱、`tool_call_id` 严格一致。
违反症状：服务端报 `tool_calls must be followed by tool messages`。

---

## 4. 三个必踩的坑（项目 80% 的学习价值）

### 坑一：流式下 tool_calls 是碎片，必须按 index 累加

非流式时 `arguments` 是完整 JSON；开 `stream: true` 后服务端把它切成很多片：

```
data: {... "index":0, "id":"call_1", "name":"get_weather", "arguments":""}
data: {... "index":0, "arguments":"{\"ci"}
data: {... "index":0, "arguments":"ty\":\"北"}
data: {... "index":0, "arguments":"京\"}"}
```

- `id` / `name` **只在第一片**出现
- `arguments` 必须 `+=`，用 `=` 会被覆盖成最后一片 → `JSON.parse` 报 `Unexpected end of JSON input`
- 多个工具并行靠 `index` 区分，**不能靠数组下标**
- 实现：`slots = new Map<number, ToolCall>()`

### 坑二：assistant 的 tool_calls 消息必须原样回传

只塞工具结果、忘了回传模型的「我要调工具」消息 → 服务端报错。成对、顺序、id 三者缺一不可。

### 坑三：SSE 数据会跨 chunk 断行

一次 `chunk` 可能把一行 JSON 从中间劈开，必须维护缓冲区只处理完整行：

```ts
buffer += decoder.decode(chunk, { stream: true });   // 中文被劈开时乱码就是漏了 { stream: true }
let nl = buffer.indexOf('\n');
while (nl !== -1) {
  const line = buffer.slice(0, nl).trim();
  buffer = buffer.slice(nl + 1);
  nl = buffer.indexOf('\n');
  if (!line.startsWith('data:')) continue;
  // ... JSON.parse 并处理
}
```

---

## 5. Agent 循环骨架（能默写出来就真懂了）

```ts
export async function runAgent(history, input, onEvent) {
  history.push({ role: 'user', content: input });
  for (let step = 1; step <= config.maxSteps; step++) {
    const result = await chat(history, toolSchemas, onText);
    if (result.toolCalls.length === 0) {          // A: 不要工具了 → 返回答案
      history.push({ role: 'assistant', content: result.text });
      return result.text;
    }
    history.push({ role: 'assistant', content: result.text || null,   // B: 原样回传
                   tool_calls: result.toolCalls });
    for (const call of result.toolCalls) {
      try { output = await runTool(name, args); }
      catch (err) { output = `错误：${err.message}`; }  // 工具报错回灌，不崩溃
      history.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }
  return `（已达到最大 ${config.maxSteps} 轮工具调用）`;  // 强制收尾，防死循环
}
```

---

## 6. 代码地图（职责 & 禁止事项）

| 文件 | 职责 | 禁止 |
| --- | --- | --- |
| `core/env.ts` | 启动时加载 `code/.env`，剥 BOM、兼容 CRLF | 不含业务逻辑；必须被 config.ts 第一个 import |
| `core/config.ts` | 集中读环境变量（baseUrl / key / model / maxSteps / temperature） | 不含业务逻辑 |
| `core/http.ts` | 带超时重试的 `fetchWithRetry`、`fetchJson` | 不含业务知识 |
| `core/location.ts` | 多源 IP 定位（ipapi.co → wttr.in），产出**坐标** | 不查天气、不碰模型 |
| `core/llm.ts` | 一次请求 + SSE 解析 → `{text, toolCalls}` | 不碰工具、不写循环 |
| `core/tools.ts` | 工具注册表 + `runTool()` 分发 | 不碰 LLM |
| `core/agent.ts` | 循环、消息累积、终止判断 | 不发 HTTP 细节、不看天气格式 |
| `cli/index.ts` | readline REPL + 事件渲染 | 不含 agent 逻辑 |
| `web/index.ts` | HTTP + SSE 推送 + 单页面 | 不含 agent 逻辑 |

**架构一句话**：`agent.ts` 只做「循环 + 决策」，`llm.ts` 只做「说话」，`tools.ts` 只做「干活」。
**接缝**：`runAgent(history, message, onEvent)` 的 `onEvent` —— CLI 接终端输出，Web 接 HTTP 流。删掉任一外壳，core 依然完整。

---

## 7. 关键设计决策速记

| 决策 | 为什么 |
| --- | --- |
| 定位返回**坐标**而非城市名 | 各服务写法不一（wttr.in 叫 `Shanghaishih`，Open-Meteo 叫 `Shanghai`）。机器之间传结构化数据，不传自然语言 |
| 工具报错回灌给模型 | 让它自己改参数重试（FR-11），而不是程序崩溃或编答案 |
| 定位多源失败就抛错 | 让模型反问用户城市，**绝不**用环境变量写死默认城市兜底；错误的天气比没有天气更糟 |
| 降级在工具内部，失败才上升到模型 | 多源探测不打扰用户；真正失败才让模型介入 |
| 零框架、原生 fetch | 框架会藏起请求体、流式解析、循环退出这些最该学的东西 |
| Web 用 SSE 不用 WebSocket | 数据单向，SSE 用普通 HTTP 即可；用 fetch 读流而非 EventSource（后者只支持 GET） |
| Agent 循环放服务端 | API Key 绝不下发浏览器 |

---

## 8. 配置项速查（`code/.env`）

| 变量 | 默认 | 作用 |
| --- | --- | --- |
| `LLM_API_KEY` | 无 | 必填，缺失时中文提示并退出（AC-6） |
| `LLM_BASE_URL` | `https://open.bigmodel.cn/api/paas/v4` | OpenAI 兼容端点 |
| `LLM_MODEL` | `glm-4.5-flash` | **必须支持工具调用**，否则会编造答案 |
| `AGENT_MAX_STEPS` | 5 | 防死循环烧钱 |
| `PORT`（web） | 3000 | Web 端口 |

温度固定 0.3；工具返回文本上限约 2000 字符。Node ≥ 22.18（原生运行 `.ts`，无需编译、无需 install）。

---

## 9. 错误排查决策树（比加日志更快）

| 症状 | 去哪查 |
| --- | --- |
| 模型不调工具、直接编答案 | `llm.ts` 请求体是否真传了 `tools`；模型名是否支持工具调用 |
| 工具被调但参数为空 | `readStream()` 里 `tool_calls.arguments` 是否按 `index` 用 `+=` 累加 |
| 第二轮报 `tool_calls must be followed by tool messages` | assistant 那条 tool_calls 消息有没有原样放回历史；`tool_call_id` 是否一致 |
| 回答断断续续 / 中文乱码 | SSE 缓冲区是否攒到 `\n` 才处理；`decode(chunk, { stream: true })` |
| 启动时一堆堆栈 | 缺 Key 时应在 CLI 里立刻中文提示并退出（AC-6） |
| 连不上 / fetch failed | `http.ts` 的 `fetchWithRetry` 只重试连接层抖动；超时不重试 |

**终极调试手段**：把整个 `messages` 用 `JSON.stringify` 打出来看一眼——你能读懂它，就说明你真的懂了 Agent。

---

## 10. 验收标准 AC-1~6（自测清单）

| AC | 输入 | 期望 |
| --- | --- | --- |
| 1 基础对话 | 「你好，用一句话介绍你自己」 | 流式中文回答，不触发工具 |
| 2 核心场景 | 「明天天气」 | 依次调用 `get_my_location` → `get_weather`（参数用定位的城市）→ 含城市/明天/温度/天气描述的回答，**数值能在 Open-Meteo 对上** |
| 3 多轮记忆 | 接着问「那后天呢」 | 复用上一轮城市，直接 `get_weather` 且 `date_offset=2` |
| 4 工具报错 | 「查一下 Noizeland 的天气」 | 不退出，显示错误，模型如实说查不到（别用「火星」测，真有同名地点） |
| 5 循环上限 | 模型连续 5 轮要工具 | 强制终止并提示已达上限 |
| 6 无 Key 保护 | 不配 Key 启动 | 立刻中文提示，不是堆栈 |

---

## 11. 两种形态对照

| | CLI（`code/cli`） | Web（`code/web`） |
| --- | --- | --- |
| 入口 | `readline` REPL | `node:http` + `GET /` + `POST /api/chat` |
| onEvent 去向 | `process.stdout.write` | SSE `event: text/tool/error/done` |
| 会话 | 一个 `history` 数组 | 一个进程级 `history` 数组（单用户 demo） |
| 关键细节 | `wroteText` 标记防止工具行粘句尾；`/clear` 用 `history.length=0` 原地清空（不要换引用） | 用 fetch 读流而非 EventSource；输入框在回答期间禁用 |

---

## 12. 学习阶段路线（`003-tasks.md`）

| 阶段 | 目标 | 状态 |
| --- | --- | --- |
| 0 | 最朴素的 LLM 调用（一次 POST） | ✅ 已合并实现 |
| 1 | REPL + 流式输出 | ✅ |
| 2 | 一个工具 + 单次调用 | ✅ |
| 3 | Agent 循环（多轮） | ✅ |
| 4 | 第二个工具（定位→天气两轮串联） | ✅ |
| 5 | **上下文管理 / 裁剪** | ⬜ 下一步 |
| 6 | 危险工具 + 权限确认 | ⬜ 可选进阶 |

> 当前仓库是阶段 0~4 的最小合并版。强烈建议**倒回去按顺序重写一遍**，每阶段单独 commit。

---

## 13. 每阶段结束的自查清单

- [ ] 不看注释，我还能讲清楚这段代码在干什么吗？
- [ ] 模型不调工具、瞎编答案，我知道去哪加日志排查吗？
- [ ] 我能不看文档，手写出 agent 循环的骨架吗？
- [ ] 这次改动里，有没有哪一行是「抄了但没懂」的？

> **抄了没懂的代码，等于没写。**

---

## 附：项目红线（AGENTS.md）

禁止引入任何 LLM/Agent 框架或运行时依赖（`dependencies` 必须为空）；禁止编译步骤；禁止硬编码 Key；禁止一次性重写整个项目；禁止提供「执行任意 shell 命令」的工具。
每次改动：单文件 ≤ 160 行、一次 < 100 行、中文 JSDoc、I/O 全 try-catch；交付时说明「改了什么 + 如何验证 + 核心知识点是什么」。
一次只做一个阶段——「能跑」不是目标，「你能读懂并复述」才是。
