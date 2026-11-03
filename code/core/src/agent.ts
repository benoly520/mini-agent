import { config } from './config.ts';
import { chat } from './llm.ts';
import type { Message } from './llm.ts';
import { runTool, toolSchemas } from './tools.ts';

/** 系统提示词：模型的行为边界都在这里定义 */
const SYSTEM_PROMPT = `你是一个中文助理，名字叫 mini-agent。
规则：
1. 涉及天气、地点、时间等实时信息时，必须调用工具获取，严禁凭记忆编造。
2. 用户没有说明地点时，先调用 get_my_location；若它报错就直接询问用户所在城市，不要编造。
   它返回的经纬度请优先传给 get_weather 的 latitude/longitude 参数。
3. 工具返回错误时，尝试修正参数或换个城市再试；仍失败就如实告知用户。
4. 回答简洁友好，控制在 100 字以内。`;

/** Agent 执行过程中向外抛出的事件，用来在终端显示进度 */
export type AgentEvent =
  | { type: 'step'; step: number }
  | { type: 'text'; chunk: string }
  | { type: 'tool-start'; name: string; args: string }
  | { type: 'tool-end'; name: string; output: string };

/**
 * 创建一个空会话，返回的消息数组就是「上下文」本身。
 * @returns 仅含 system 消息的历史数组
 */
export function createSession(): Message[] {
  return [{ role: 'system', content: SYSTEM_PROMPT }];
}

/**
 * Agent 主循环 —— 整个项目的心脏。
 *
 * 逻辑就三句话：
 *   问模型 → 它要工具就执行并把结果塞回历史 → 它不要工具就把回答返回。
 * 所谓「智能」，本质就是这个不断累积上下文的循环。
 *
 * @param history 会话历史，会被原地追加，实现多轮记忆
 * @param input 用户这一轮的输入
 * @param onEvent 事件回调，用于渲染进度
 * @returns 模型最终的文本回答
 */
export async function runAgent(
  history: Message[],
  input: string,
  onEvent: (e: AgentEvent) => void,
): Promise<string> {
  history.push({ role: 'user', content: input });

  for (let step = 1; step <= config.maxSteps; step++) {
    onEvent({ type: 'step', step });

    const result = await chat(history, toolSchemas, (chunk) => {
      onEvent({ type: 'text', chunk });
    });

    // 情况 A：模型不再要工具，直接给出答案，循环结束
    if (result.toolCalls.length === 0) {
      history.push({ role: 'assistant', content: result.text });
      return result.text;
    }

    // 情况 B：模型要求调用工具。
    // 这条 assistant 消息必须原样放回历史，且要与下面的 tool 消息成对出现。
    history.push({
      role: 'assistant',
      content: result.text || null,
      tool_calls: result.toolCalls,
    });

    for (const call of result.toolCalls) {
      const name = call.function.name;
      onEvent({ type: 'tool-start', name, args: call.function.arguments });

      let output: string;
      try {
        output = await runTool(name, call.function.arguments);
      } catch (err) {
        // 工具报错不向上抛，而是告诉模型，让它自己想办法（对应需求 FR-11）
        output = `错误：${(err as Error).message}`;
      }

      onEvent({ type: 'tool-end', name, output });
      history.push({ role: 'tool', tool_call_id: call.id, content: output });
    }
  }

  // 循环到上限还没收敛，强制收尾，避免程序卡死
  const fallback = `（已达到最大 ${config.maxSteps} 轮工具调用，我先停在这里）`;
  history.push({ role: 'assistant', content: fallback });
  return fallback;
}
