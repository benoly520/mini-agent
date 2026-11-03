import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { config } from '../../core/src/config.ts';
import { ENV_FILE } from '../../core/src/env.ts';
import { createSession, runAgent } from '../../core/src/agent.ts';
import type { AgentEvent } from '../../core/src/agent.ts';

/** 工具返回过长时截断显示，避免刷屏 */
function shorten(text: string, max = 160): string {
  const oneLine = text.replace(/\s+/g, ' ').trim();
  return oneLine.length > max ? `${oneLine.slice(0, max)}…` : oneLine;
}

/**
 * 把 agent 事件渲染到终端。
 * 返回一个函数，用于在每次问答结束后重置渲染状态。
 */
function createRenderer() {
  let wroteText = false;

  return {
    handle(event: AgentEvent) {
      if (event.type === 'text') {
        stdout.write(event.chunk);
        wroteText = true;
        return;
      }
      if (event.type === 'tool-start') {
        if (wroteText) {
          stdout.write('\n');
          wroteText = false;
        }
        stdout.write(`  -> 调用 ${event.name}(${event.args || '{}'})\n`);
        return;
      }
      if (event.type === 'tool-end') {
        stdout.write(`  <- 结果 ${shorten(event.output)}\n`);
      }
    },
    reset() {
      if (wroteText) stdout.write('\n');
      wroteText = false;
    },
  };
}

async function main(): Promise<void> {
  // 没有 Key 就立刻友好提示，而不是等报一堆堆栈信息
  if (!config.apiKey) {
    console.error('未检测到 LLM_API_KEY。');
    // 直接打印绝对路径：new clone 的用户不知道 code/.env 放在哪
    console.error(`请在该文件里填写 LLM_API_KEY：${ENV_FILE}`);
    console.error('若文件还不存在，先复制一份：cd code && cp .env.example .env');
    process.exit(1);
  }

  console.log('mini-agent 已启动（输入 /exit 退出，/clear 清空上下文）');
  console.log(`模型：${config.model}    接口：${config.baseUrl}\n`);

  const rl = createInterface({ input: stdin, output: stdout });
  const history = createSession();
  const renderer = createRenderer();

  // Ctrl+C 直接退出，避免卡在 fetch 里
  rl.on('SIGINT', () => {
    console.log('\n再见。');
    process.exit(0);
  });

  while (true) {
    let input = '';
    try {
      input = (await rl.question('\n你 > ')).trim();
    } catch {
      break; // readline 被关闭
    }

    if (input === '') continue;

    if (input === '/exit' || input === '/quit') {
      console.log('再见。');
      break;
    }

    if (input === '/clear') {
      history.length = 0;
      history.push(...createSession());
      console.log('上下文已清空。');
      continue;
    }

    try {
      await runAgent(history, input, (e) => renderer.handle(e));
      renderer.reset();
    } catch (err) {
      renderer.reset();
      // 面向用户的中文提示，详细的堆栈留给自己排查时再打开
      console.error(`请求失败：${(err as Error).message}`);
    }
  }

  rl.close();
}

main().catch((err) => {
  console.error(`程序异常退出：${(err as Error).message}`);
  process.exit(1);
});
