/**
 * 启动时自动加载同目录的 .env 文件。
 *
 * 为什么需要它：Node 默认不会读 .env，只有 `node --env-file=.env` 才会。
 * 但那样的话 `node src/index.ts` 就会拿不到 Key——对新手太容易踩。
 * 这里用 Node 内置的 process.loadEnvFile（20.12+）把文件读进 process.env，
 * 于是怎么启动都能工作，也不需要 dotenv 这类依赖。
 *
 * 注意：必须被 config.ts 第一个 import，否则执行顺序会晚于读环境变量。
 */
// 从 core/src/env.ts 往上两级 = code/.env，cli 和 server 共用同一份配置
const envPath = new URL('../../.env', import.meta.url);

try {
  process.loadEnvFile(envPath);
} catch {
  // 文件不存在时静默跳过：允许只靠系统环境变量运行
}
