import { config } from './config.ts';
import { fetchWithRetry } from './http.ts';

/**
 * 消息结构，严格对齐 OpenAI 的 chat 协议。
 * 注意 tool 消息必须带 tool_call_id，否则服务端会报错。
 */
export interface Message {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  /** 仅 assistant 消息可能有：它「要求」调用哪些工具 */
  tool_calls?: ToolCall[];
  /** 仅 tool 消息有这个字段：对应哪一次工具调用 */
  tool_call_id?: string;
}

/** 模型请求调用一个工具时使用的结构 */
export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** 我们声明给模型看的工具描述（JSON Schema） */
export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

/** 一次请求的结果：文本 + 模型要求的工具调用 */
export interface ChatResult {
  text: string;
  toolCalls: ToolCall[];
}

/**
 * 调用模型，支持流式输出。
 *
 * 为什么自己写而不是用 SDK：只有亲手拼请求体、亲手解析 SSE，
 * 你才会真正理解「流式」和「工具调用」在协议层是怎么表达的。
 *
 * @param messages 完整对话历史（每次都要整段发过去，模型没有记忆）
 * @param tools 可用工具列表；传空数组表示纯聊天
 * @param onText 每收到一小段文本就回调，用于打字机效果
 * @returns 最终拼接好的文本，以及模型要求调用的工具
 */
export async function chat(
  messages: Message[],
  tools: ToolSchema[],
  onText?: (chunk: string) => void,
): Promise<ChatResult> {
  const body: Record<string, unknown> = {
    model: config.model,
    messages,
    temperature: config.temperature,
    stream: true,
  };
  // 没有工具时不要传 tools 字段，部分厂商会因此报错
  if (tools.length > 0) {
    body.tools = tools;
  }

  let res: Response;
  try {
    res = await fetchWithRetry(`${config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify(body),
      // 超时兜底，避免网络卡住时程序永远挂着
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    throw new Error(`连接模型服务失败（已自动重试）：${(err as Error).message}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`模型接口返回 ${res.status}：${detail.slice(0, 300)}`);
  }
  if (!res.body) {
    throw new Error('模型没有返回响应体');
  }

  return readStream(res.body, onText);
}

/**
 * 解析 SSE 流。
 *
 * 三个必须注意的点：
 * 1. 数据会跨 chunk 断行 —— 必须用缓冲区攒到 \n 再处理；
 * 2. 中文可能被劈成两半 —— decode 必须传 { stream: true }；
 * 3. tool_calls 是分片的 —— 必须按 index 累加字符串，不能直接覆盖。
 */
async function readStream(
  stream: ReadableStream<Uint8Array>,
  onText?: (chunk: string) => void,
): Promise<ChatResult> {
  let text = '';
  let buffer = '';
  const decoder = new TextDecoder();
  // 用 Map 按 index 存放，因为一次回复可能要求调用多个工具
  const slots = new Map<number, ToolCall>();

  for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
    buffer += decoder.decode(chunk, { stream: true });

    let nl = buffer.indexOf('\n');
    while (nl !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      nl = buffer.indexOf('\n');

      // SSE 每行形如 "data: {...}"，空行和注释行直接跳过
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '' || payload === '[DONE]') continue;

      let json: any;
      try {
        json = JSON.parse(payload);
      } catch {
        continue; // 半行数据，等下一轮缓冲区补齐
      }

      const delta = json.choices?.[0]?.delta;
      if (!delta) continue;

      // 注意：思考型模型（如 glm-4.5-flash）会先推 delta.reasoning_content，
      // 那是模型的内部思考过程。本项目只取正文 content，刻意忽略它。
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        text += delta.content;
        onText?.(delta.content);
      }

      // 关键：工具调用是碎片的，逐片拼装
      for (const frag of delta.tool_calls ?? []) {
        const index: number = frag.index ?? 0;
        const slot =
          slots.get(index) ??
          ({ id: '', type: 'function', function: { name: '', arguments: '' } } as ToolCall);
        if (frag.id) slot.id = frag.id; // 只有第一片带 id
        if (frag.function?.name) slot.function.name += frag.function.name;
        if (frag.function?.arguments) slot.function.arguments += frag.function.arguments;
        slots.set(index, slot);
      }
    }
  }

  return { text, toolCalls: [...slots.values()] };
}
