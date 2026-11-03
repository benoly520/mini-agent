// 必须放在读 process.env 之前，所以是文件的第一行
import './env.ts';

/**
 * 配置层：只负责从环境变量读取参数，不含任何业务逻辑。
 * 所有可调项都集中在这里，方便你一处修改、全局生效。
 */
export const config = {
  /** OpenAI 兼容接口地址。默认智谱 GLM，换厂商时只改 .env */
  baseUrl: process.env.LLM_BASE_URL ?? 'https://open.bigmodel.cn/api/paas/v4',
  /** 密钥，只能来自环境变量，绝不写死在代码里 */
  apiKey: process.env.LLM_API_KEY ?? '',
  /** 模型名。glm-4.5-flash 是智谱的免费档，支持工具调用 */
  model: process.env.LLM_MODEL ?? 'glm-4.5-flash',
  /** Agent 循环最大轮次，防止死循环烧钱 */
  maxSteps: Number(process.env.AGENT_MAX_STEPS ?? 5),
  /** 温度越低越稳定，工具调用场景不建议调高 */
  temperature: 0.3,
};
