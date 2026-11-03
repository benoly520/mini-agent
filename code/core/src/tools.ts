import type { ToolSchema } from './llm.ts';
import { fetchJson } from './http.ts';
import { detectLocation } from './location.ts';

/**
 * 工具注册表。
 *
 * 一条铁律：`run` 永远返回字符串。
 * 因为 tool 消息的 content 只接受字符串，模型看到的就是这段文字。
 */
interface Tool {
  schema: ToolSchema;
  run: (args: Record<string, any>) => Promise<string>;
}

/** WMO 天气代码转中文，模型看不懂数字代码，必须翻译 */
const WEATHER_CODE: Record<number, string> = {
  0: '晴', 1: '大致晴朗', 2: '多云', 3: '阴',
  45: '有雾', 48: '雾凇',
  51: '小毛毛雨', 53: '毛毛雨', 55: '大毛毛雨',
  56: '冻毛毛雨', 57: '强冻毛毛雨',
  61: '小雨', 63: '中雨', 65: '大雨',
  66: '冻雨', 67: '强冻雨',
  71: '小雪', 73: '中雪', 75: '大雪', 77: '米雪',
  80: '小阵雨', 81: '阵雨', 82: '强阵雨',
  85: '小阵雪', 86: '强阵雪',
  95: '雷暴', 96: '雷暴伴小冰雹', 99: '雷暴伴大冰雹',
};

const tools: Tool[] = [
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_my_location',
        description:
          '获取用户当前所在的位置，返回城市名和经纬度。当用户没有明确说出地点（例如只说“明天天气”）时，必须先调用它。',
        parameters: { type: 'object', properties: {}, required: [] },
      },
    },
    async run() {
      const loc = await detectLocation();
      const place = [loc.city, loc.region, loc.country].filter(Boolean).join('，');
      // 明确提示模型优先用坐标：城市名的写法各服务不统一，坐标才是可靠值
      return `${place}。经纬度：${loc.latitude},${loc.longitude}（查天气请优先使用这组坐标）`;
    },
  },
  {
    schema: {
      type: 'function',
      function: {
        name: 'get_weather',
        description:
          '查询某地某一天的天气预报。用户问天气时必须调用，不要凭记忆回答。' +
          '如果已有经纬度（例如来自 get_my_location），优先传 latitude/longitude；否则才传 city。',
        parameters: {
          type: 'object',
          properties: {
            city: {
              type: 'string',
              description: '城市名（中文或英文均可），例如 北京、Shanghai。有坐标时可省略',
            },
            latitude: {
              type: 'number',
              description: '纬度。与 longitude 一起使用，优先级高于 city',
            },
            longitude: {
              type: 'number',
              description: '经度。与 latitude 一起使用',
            },
            date_offset: {
              type: 'integer',
              description: '0 表示今天，1 表示明天，2 表示后天，默认 0',
              enum: [0, 1, 2],
            },
          },
          required: [],
        },
      },
    },
    async run(args) {
      const offset = Number(args.date_offset ?? 0);
      if (![0, 1, 2].includes(offset)) throw new Error('date_offset 只能是 0、1、2');

      // 有坐标就走坐标，跳过「名字 → 坐标」这一步，避免名字匹配失败
      let latitude = Number(args.latitude);
      let longitude = Number(args.longitude);
      let placeName = String(args.city ?? '').trim();

      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        if (!placeName) throw new Error('需要提供 city，或同时提供 latitude 和 longitude');
        const geoUrl =
          'https://geocoding-api.open-meteo.com/v1/search' +
          `?name=${encodeURIComponent(placeName)}&count=1&language=zh&format=json`;
        const geo = await fetchJson(geoUrl);
        const place = geo.results?.[0];
        if (!place) {
          throw new Error(`找不到城市「${placeName}」，请换一个更常见的城市名，或改用经纬度`);
        }
        latitude = place.latitude;
        longitude = place.longitude;
        placeName = place.name;
      }

      // 只传坐标时没有城市名，给个可读占位，避免返回文本开头空着
      if (!placeName) placeName = `坐标 ${latitude},${longitude}`;

      const wxUrl =
        'https://api.open-meteo.com/v1/forecast' +
        `?latitude=${latitude}&longitude=${longitude}` +
        '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
        '&timezone=auto&forecast_days=3';
      const wx = await fetchJson(wxUrl);

      const daily = wx.daily;
      const date = daily?.time?.[offset];
      if (!date) throw new Error('天气数据为空，可能是该地区不支持预报');

      const code = daily.weather_code[offset];
      const label = WEATHER_CODE[code] ?? `未知天气(${code})`;
      const high = Math.round(daily.temperature_2m_max[offset]);
      const low = Math.round(daily.temperature_2m_min[offset]);
      const rain = daily.precipitation_probability_max?.[offset] ?? 0;

      return `${placeName} ${date}：${label}，最低 ${low}℃，最高 ${high}℃，降水概率 ${rain}%`;
    },
  },
];

/** 传给模型的工具清单（不含实现，只有描述） */
export const toolSchemas: ToolSchema[] = tools.map((t) => t.schema);

/**
 * 按名字执行工具。
 * 参数来自模型，是字符串形式的 JSON，必须自己解析；解析失败要给出明确错误。
 */
export async function runTool(name: string, rawArgs: string): Promise<string> {
  const tool = tools.find((t) => t.schema.function.name === name);
  if (!tool) throw new Error(`不存在名为 ${name} 的工具`);

  let args: Record<string, any> = {};
  if (rawArgs && rawArgs.trim() !== '') {
    try {
      args = JSON.parse(rawArgs);
    } catch {
      throw new Error(`参数不是合法 JSON：${rawArgs.slice(0, 100)}`);
    }
  }
  return tool.run(args);
}
