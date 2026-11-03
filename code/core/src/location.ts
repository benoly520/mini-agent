import { fetchJson } from './http.ts';

/**
 * 定位结果。
 * 注意坐标才是主数据：城市名只是给人看的，不同服务给的写法可能完全不一样
 * （例如 wttr.in 会把上海写成 "Shanghaishih"），拿名字去查天气很容易匹配不上。
 */
export interface Location {
  city: string;
  region?: string;
  country?: string;
  latitude: number;
  longitude: number;
}

/**
 * 定位探测 1：ipapi.co。
 * 字段最全，但国内网络经常连不上，所以后面还有备用源。
 */
async function locateByIpapiCo(): Promise<Location> {
  const data = await fetchJson('https://ipapi.co/json/', 5_000);
  const latitude = Number(data.latitude);
  const longitude = Number(data.longitude);
  if (!data.city || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('返回结果缺少城市或坐标');
  }
  return {
    city: data.city,
    region: data.region,
    country: data.country_name,
    latitude,
    longitude,
  };
}

/**
 * 定位探测 2：wttr.in。
 * 按请求来源 IP 推断，j1 格式里带 nearest_area（含英文/拼音城市名和坐标）。
 */
async function locateByWttrIn(): Promise<Location> {
  const data = await fetchJson('https://wttr.in/?format=j1', 5_000);
  const area = data.nearest_area?.[0];
  const city = area?.areaName?.[0]?.value;
  const latitude = Number(area?.latitude);
  const longitude = Number(area?.longitude);
  if (!city || !Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    throw new Error('返回结果缺少城市或坐标');
  }
  return {
    city,
    region: area?.region?.[0]?.value,
    country: area?.country?.[0]?.value,
    latitude,
    longitude,
  };
}

/**
 * 依次尝试多个定位源，第一个成功就返回。
 *
 * 为什么不再用 MY_CITY 这类配置兜底：
 * 配置是给人看的，工具是给模型用的。能在工具内部消化的降级策略，
 * 就不要上升成新的配置项——否则每加一个场景就多一个环境变量，
 * 程序会越来越像脚本，而不是 agent。
 *
 * @returns 定位结果（含坐标）
 * @throws 全部失败时抛出，由模型决定是否反问用户城市
 */
export async function detectLocation(): Promise<Location> {
  const probes = [
    { name: 'ipapi.co', fn: locateByIpapiCo },
    { name: 'wttr.in', fn: locateByWttrIn },
  ];
  const failures: string[] = [];

  for (const probe of probes) {
    try {
      return await probe.fn();
    } catch (err) {
      failures.push(`${probe.name}：${(err as Error).message}`);
    }
  }

  throw new Error(`所有定位源都失败（${failures.join('；')}），请直接询问用户所在城市`);
}
