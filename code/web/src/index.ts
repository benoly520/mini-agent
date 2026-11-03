import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { createSession, runAgent } from '../../core/src/agent.ts';

/**
 * Web 版入口：把 agent 的事件流通过 SSE 推给浏览器。
 *
 * 关键设计：agent 逻辑一行都不用改。
 * CLI 版是把事件打印到终端，Web 版是把同样的事件写进 HTTP 流——
 * 这正是把 core 和交互层拆开之后白拿的好处。
 */

const PORT = Number(process.env.PORT ?? 3000);
const INDEX_FILE = new URL('../public/index.html', import.meta.url);

/** 单用户 demo：整个进程共用一份会话历史（多用户需要按 sessionId 分桶） */
const history = createSession();

/**
 * 读取请求体。
 * 限制 1MB，避免异常请求把内存撑爆。
 */
async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;

  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > 1024 * 1024) throw new Error('请求体过大');
    chunks.push(buf);
  }

  return Buffer.concat(chunks).toString('utf8');
}

/**
 * 发送一条 SSE 事件。
 * 格式固定为 `event: 名称\ndata: JSON\n\n`，两个换行才表示一条事件结束。
 */
function sse(res: ServerResponse, event: string, data: unknown): void {
  res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

/** 处理一次对话请求：边跑 agent 边把事件推给浏览器 */
async function handleChat(req: IncomingMessage, res: ServerResponse): Promise<void> {
  let message = '';

  try {
    const body = await readBody(req);
    message = String(JSON.parse(body).message ?? '').trim();
  } catch {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '请求格式错误' }));
    return;
  }

  if (!message) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '消息不能为空' }));
    return;
  }

  // 长连接、不缓存：SSE 的标准响应头
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
  });

  try {
    await runAgent(history, message, (e) => {
      if (e.type === 'text') {
        sse(res, 'text', { chunk: e.chunk });
      } else if (e.type === 'tool-start') {
        sse(res, 'tool', { phase: 'start', name: e.name, args: e.args });
      } else if (e.type === 'tool-end') {
        sse(res, 'tool', { phase: 'end', name: e.name, output: e.output });
      }
      // step 事件对 UI 没意义，直接忽略
    });
    sse(res, 'done', {});
  } catch (err) {
    // 错误也走 SSE，前端能显示成一条消息，而不是让请求静默失败
    sse(res, 'error', { message: (err as Error).message });
  }

  res.end();
}

const server = createServer(async (req, res) => {
  const path = (req.url ?? '/').split('?')[0];

  try {
    if (req.method === 'GET' && (path === '/' || path === '/index.html')) {
      const html = await readFile(INDEX_FILE, 'utf8');
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    if (req.method === 'POST' && path === '/api/chat') {
      await handleChat(req, res);
      return;
    }

    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('Not Found');
  } catch (err) {
    if (!res.headersSent) res.writeHead(500);
    res.end(`服务端错误：${(err as Error).message}`);
  }
});

server.listen(PORT, () => {
  console.log(`mini-agent web 已启动：http://localhost:${PORT}`);
  console.log('关闭用 Ctrl+C');
});
