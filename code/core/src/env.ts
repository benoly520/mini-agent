import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

/**
 * 启动时自动加载 code/.env。
 *
 * 为什么不用 process.loadEnvFile：
 * 1. Windows 上用记事本保存的 .env 常带 UTF-8 BOM，BOM 会粘在第一个变量名上
 *    （`LLM_API_KEY` 变成 `\uFEFFLLM_API_KEY`），表现为 Key 看起来完全正常、
 *    请求却一直 401，排查起来极其痛苦；
 * 2. 自己读文件可以先剥掉 BOM，再交给内置的 parseEnv 解析，行为可控。
 *
 * 规则：已存在的环境变量优先，不被文件覆盖（与 node --env-file 一致）。
 * 注意：必须被 config.ts 第一个 import，否则执行顺序会晚于读环境变量。
 */
const ENV_PATH = new URL('../../.env', import.meta.url);

/** 配置文件的实际绝对路径。启动失败时直接告诉用户去哪找，比让人猜更省事 */
export const ENV_FILE = fileURLToPath(ENV_PATH);

try {
  const raw = readFileSync(fileURLToPath(ENV_PATH), 'utf8');
  const parsed = parseEnv(raw.replace(/^\uFEFF/, ''));

  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
} catch {
  // 文件不存在时静默跳过：允许只靠系统环境变量运行
}
