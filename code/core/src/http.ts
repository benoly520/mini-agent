/**
 * 通用 HTTP 工具：带超时、带重试。
 * 单独抽出来是为了避免 tools.ts 和 location.ts 互相 import 形成循环依赖。
 */

/** 等待若干毫秒，用于重试退避 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 判断错误是否值得重试。
 * 只重试连接层抖动（连接被中间设备断开、临时不可达）；
 * 超时和服务端明确报错都不重试——重试只会让用户多等一遍。
 */
function isRetryable(err: unknown): boolean {
  const e = err as any;
  const name = String(e?.name ?? '');
  if (name === 'TimeoutError' || name === 'AbortError') return false;

  const code = String(e?.cause?.code ?? e?.cause?.errno ?? '');
  if (['ECONNRESET', 'ECONNREFUSED', 'EPIPE', 'UND_ERR_SOCKET'].includes(code)) {
    return true;
  }
  // Node 的 fetch 会把大多数连接问题统一包装成 TypeError: fetch failed
  return e instanceof TypeError;
}

/**
 * 把底层 cause 一起写进错误信息。
 * 否则你永远只能看到一句 fetch failed，完全无法排查。
 */
function describe(err: unknown): string {
  const e = err as any;
  const code = e?.cause?.code ?? e?.cause?.errno;
  const base = String(e?.message ?? '未知错误');
  return code ? `${base}（底层原因：${code}）` : base;
}

/**
 * 带重试的 fetch。
 *
 * 为什么需要：本地到远端的 TCP 连接可能被中间设备或服务端主动断开，
 * 复用到这种半关闭连接时就会抛 fetch failed——本项目的定位工具要跑 2~3 秒，
 * 正好横跨这段时间，所以第二轮回模型时特别容易踩到。
 * 此时响应还没开始，重试是安全的；流式读到一半就不能重试，所以只包住建连这一步。
 *
 * @param url 请求地址
 * @param init fetch 参数
 * @param maxAttempts 最多尝试次数
 * @returns Response（HTTP 4xx/5xx 不触发重试，由调用方判断）
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  maxAttempts = 3,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts || !isRetryable(err)) break;
      await sleep(400 * attempt); // 简单退避，避免瞬间连打
    }
  }

  throw new Error(describe(lastError));
}

/**
 * 带超时的 JSON 请求。
 * 不做重试：定位、天气这类场景已经有「多源回退」兜底，再叠加重试会让等待时间失控。
 *
 * @param url 请求地址
 * @param timeoutMs 超时毫秒数
 * @returns 解析后的 JSON
 */
export async function fetchJson(url: string, timeoutMs = 8_000): Promise<any> {
  const res = await fetch(url, {
    headers: { 'User-Agent': 'mini-agent-learning/0.1' },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) {
    throw new Error(`上游接口 ${res.status}`);
  }
  return res.json();
}
