const WEATHER_TABLE = {
    spring: [
        { type: 'sunny', weight: 25, cn: '晴朗', en: 'Sunny', tempRange: [15, 25] },
        { type: 'cloudy', weight: 25, cn: '多云', en: 'Cloudy', tempRange: [12, 22] },
        { type: 'overcast', weight: 10, cn: '阴天', en: 'Overcast', tempRange: [10, 18] },
        { type: 'light_rain', weight: 15, cn: '小雨', en: 'Light Rain', tempRange: [10, 18] },
        { type: 'moderate_rain', weight: 8, cn: '中雨', en: 'Moderate Rain', tempRange: [8, 16] },
        { type: 'windy', weight: 8, cn: '大风', en: 'Windy', tempRange: [10, 20] },
        { type: 'foggy', weight: 5, cn: '雾', en: 'Foggy', tempRange: [8, 15] },
        { type: 'thunderstorm', weight: 3, cn: '雷暴', en: 'Thunderstorm', tempRange: [12, 20], extreme: true },
        { type: 'hail', weight: 1, cn: '冰雹', en: 'Hail', tempRange: [5, 15], extreme: true },
    ],
    summer: [
        { type: 'sunny_hot', weight: 20, cn: '晴热', en: 'Sunny & Hot', tempRange: [30, 38] },
        { type: 'partly_cloudy', weight: 15, cn: '晴间多云', en: 'Partly Cloudy', tempRange: [28, 35] },
        { type: 'cloudy', weight: 10, cn: '多云', en: 'Cloudy', tempRange: [26, 32] },
        { type: 'humid', weight: 10, cn: '闷热潮湿', en: 'Humid', tempRange: [28, 36] },
        { type: 'shower', weight: 10, cn: '阵雨', en: 'Shower', tempRange: [24, 30] },
        { type: 'moderate_rain', weight: 10, cn: '中雨', en: 'Moderate Rain', tempRange: [22, 28] },
        { type: 'heavy_rain', weight: 8, cn: '大雨', en: 'Heavy Rain', tempRange: [20, 26] },
        { type: 'thunderstorm', weight: 10, cn: '雷阵雨', en: 'Thunderstorm', tempRange: [22, 30] },
        { type: 'typhoon', weight: 2, cn: '台风', en: 'Typhoon', tempRange: [22, 28], extreme: true },
        { type: 'heatwave', weight: 5, cn: '高温热浪', en: 'Heatwave', tempRange: [36, 42], extreme: true },
    ],
    autumn: [
        { type: 'sunny', weight: 30, cn: '秋高气爽', en: 'Clear Autumn', tempRange: [12, 22] },
        { type: 'cloudy', weight: 20, cn: '多云', en: 'Cloudy', tempRange: [10, 20] },
        { type: 'overcast', weight: 10, cn: '阴天', en: 'Overcast', tempRange: [8, 16] },
        { type: 'light_rain', weight: 12, cn: '秋雨', en: 'Autumn Rain', tempRange: [8, 16] },
        { type: 'windy', weight: 13, cn: '秋风', en: 'Autumn Wind', tempRange: [8, 18] },
        { type: 'foggy', weight: 8, cn: '雾', en: 'Foggy', tempRange: [5, 14] },
        { type: 'frost', weight: 4, cn: '霜', en: 'Frost', tempRange: [0, 8] },
        { type: 'heavy_rain', weight: 3, cn: '暴雨', en: 'Heavy Rain', tempRange: [8, 14], extreme: true },
    ],
    winter: [
        { type: 'sunny_cold', weight: 20, cn: '晴冷', en: 'Sunny & Cold', tempRange: [-5, 5] },
        { type: 'cloudy', weight: 20, cn: '多云', en: 'Cloudy', tempRange: [-3, 5] },
        { type: 'overcast', weight: 15, cn: '阴天', en: 'Overcast', tempRange: [-5, 3] },
        { type: 'light_snow', weight: 10, cn: '小雪', en: 'Light Snow', tempRange: [-8, 0] },
        { type: 'moderate_snow', weight: 7, cn: '中雪', en: 'Moderate Snow', tempRange: [-10, -2] },
        { type: 'sleet', weight: 5, cn: '雨夹雪', en: 'Sleet', tempRange: [-2, 3] },
        { type: 'windy_cold', weight: 10, cn: '寒风刺骨', en: 'Biting Wind', tempRange: [-10, 0] },
        { type: 'foggy', weight: 5, cn: '大雾', en: 'Dense Fog', tempRange: [-3, 3] },
        { type: 'heavy_snow', weight: 5, cn: '大雪', en: 'Heavy Snow', tempRange: [-15, -5], extreme: true },
        { type: 'blizzard', weight: 2, cn: '暴风雪', en: 'Blizzard', tempRange: [-20, -8], extreme: true },
        { type: 'ice_storm', weight: 1, cn: '冰暴', en: 'Ice Storm', tempRange: [-10, -2], extreme: true },
    ],
};

const GEO_CACHE = {};
const WEATHER_CACHE = {};

const WMO_MAP = {
    0: { type: 'sunny', cn: '晴朗', en: 'Clear', extreme: false },
    1: { type: 'partly_cloudy', cn: '晴间多云', en: 'Mainly Clear', extreme: false },
    2: { type: 'cloudy', cn: '多云', en: 'Partly Cloudy', extreme: false },
    3: { type: 'overcast', cn: '阴天', en: 'Overcast', extreme: false },
    45: { type: 'foggy', cn: '雾', en: 'Fog', extreme: false },
    48: { type: 'foggy', cn: '雾凇', en: 'Rime Fog', extreme: false },
    51: { type: 'light_rain', cn: '小雨', en: 'Light Drizzle', extreme: false },
    53: { type: 'light_rain', cn: '小雨', en: 'Moderate Drizzle', extreme: false },
    55: { type: 'moderate_rain', cn: '中雨', en: 'Dense Drizzle', extreme: false },
    56: { type: 'sleet', cn: '雨夹雪', en: 'Freezing Drizzle', extreme: false },
    57: { type: 'sleet', cn: '雨夹雪', en: 'Dense Freezing Drizzle', extreme: false },
    61: { type: 'light_rain', cn: '小雨', en: 'Slight Rain', extreme: false },
    63: { type: 'moderate_rain', cn: '中雨', en: 'Rain', extreme: false },
    65: { type: 'heavy_rain', cn: '大雨', en: 'Heavy Rain', extreme: true },
    66: { type: 'sleet', cn: '冻雨', en: 'Freezing Rain', extreme: true },
    67: { type: 'sleet', cn: '冻雨', en: 'Heavy Freezing Rain', extreme: true },
    71: { type: 'light_snow', cn: '小雪', en: 'Slight Snow', extreme: false },
    73: { type: 'moderate_snow', cn: '中雪', en: 'Snow', extreme: false },
    75: { type: 'heavy_snow', cn: '大雪', en: 'Heavy Snow', extreme: true },
    77: { type: 'snow', cn: '雪粒', en: 'Snow Grains', extreme: false },
    80: { type: 'shower', cn: '阵雨', en: 'Rain Showers', extreme: false },
    81: { type: 'shower', cn: '阵雨', en: 'Moderate Showers', extreme: false },
    82: { type: 'heavy_rain', cn: '暴雨', en: 'Violent Showers', extreme: true },
    85: { type: 'light_snow', cn: '阵雪', en: 'Snow Showers', extreme: false },
    86: { type: 'heavy_snow', cn: '暴雪', en: 'Heavy Snow Showers', extreme: true },
    95: { type: 'thunderstorm', cn: '雷暴', en: 'Thunderstorm', extreme: true },
    96: { type: 'thunderstorm', cn: '雷暴夹冰雹', en: 'Thunderstorm with Hail', extreme: true },
    99: { type: 'thunderstorm', cn: '强雷暴夹冰雹', en: 'Heavy Thunderstorm with Hail', extreme: true },
};

function getSeason(month) {
    if ([3, 4, 5].includes(month)) return 'spring';
    if ([6, 7, 8].includes(month)) return 'summer';
    if ([9, 10, 11].includes(month)) return 'autumn';
    return 'winter';
}

function weightedRandom(items) {
    const total = items.reduce((s, i) => s + i.weight, 0);
    let r = Math.random() * total;
    for (const item of items) {
        r -= item.weight;
        if (r <= 0) return item;
    }
    return items[items.length - 1];
}

function randomInRange(min, max) {
    return Math.round(min + Math.random() * (max - min));
}

export function rollWeather(month) {
    const season = getSeason(month);
    const table = WEATHER_TABLE[season] || WEATHER_TABLE.spring;
    const picked = weightedRandom(table);
    const temp = randomInRange(picked.tempRange[0], picked.tempRange[1]);
    return {
        type: picked.type,
        cn: picked.cn,
        en: picked.en,
        temp,
        extreme: !!picked.extreme,
        season,
        source: 'roll',
    };
}

export function shouldRerollWeather(oldDateStr, newDateStr, oldWeather, newLocation) {
    if (!oldWeather || !oldDateStr || !newDateStr) return true;
    if (oldDateStr !== newDateStr) return true;
    if (oldWeather.location && newLocation && oldWeather.location !== newLocation) return true;
    return false;
}

export async function getWeatherForDate(dateStr, locationName, settings, previousWeather) {

    const location = normalizeLocationName(locationName || settings.defaultCity || '');
    if (!location) {
        const month = parseInt(dateStr.slice(5, 7));
        return rollWeather(month);
    }

    const cacheKey = `${location}_${dateStr}`;
    if (WEATHER_CACHE[cacheKey]) {
        const cached = WEATHER_CACHE[cacheKey];
        return applyContinuity(cached, previousWeather, settings);
    }

    const geo = await geocodeLocation(location);
    if (!geo) {
        const month = parseInt(dateStr.slice(5, 7));
        return rollWeather(month);
    }

    const target = new Date(dateStr + 'T00:00:00');
    const today = new Date();
    const todayStr = formatDate(today);
    let data = null;

    if (dateStr <= todayStr) {
        data = await fetchArchiveWeather(geo, dateStr);
    } else {
        data = await fetchForecastWeather(geo, dateStr);
        if (!data) {
            const fallbackYear = today.getFullYear() - 1;
            const fallbackDateStr = `${fallbackYear}-${dateStr.slice(5)}`;
            data = await fetchArchiveWeather(geo, fallbackDateStr);
            if (data) {
                const yearsDiff = target.getFullYear() - fallbackYear;
                const warming = yearsDiff * 0.02;
                data.temp = data.temp + warming;
            }
        }
    }

    let weather;
    if (data) {
        weather = {
            type: data.type,
            cn: data.cn,
            en: data.en,
            temp: data.temp,
            extreme: data.extreme,
            season: getSeason(target.getMonth() + 1),
            source: data.source,
            location,
            wmoCode: data.wmoCode,
            isRainy: data.isRainy,
        };
    } else {
        const month = parseInt(dateStr.slice(5, 7));
        weather = rollWeather(month);
        weather.location = location;
    }

    WEATHER_CACHE[cacheKey] = weather;
    return applyContinuity(weather, previousWeather, settings);
}

async function geocodeLocation(name) {
    if (GEO_CACHE[name]) return GEO_CACHE[name];
    try {
        const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(name)}&count=1&language=zh&format=json`;
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        if (data && data.results && data.results.length > 0) {
            const r = data.results[0];
            const info = {
                name: r.name,
                latitude: r.latitude,
                longitude: r.longitude,
                country: r.country,
            };
            GEO_CACHE[name] = info;
            return info;
        }
    } catch (e) { }
    return null;
}

async function fetchArchiveWeather(geo, dateStr) {
    const url = `https://archive-api.open-meteo.com/v1/archive?latitude=${geo.latitude}&longitude=${geo.longitude}&start_date=${dateStr}&end_date=${dateStr}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        return parseOpenMeteoDaily(data, dateStr, 'archive');
    } catch (e) { }
    return null;
}

async function fetchForecastWeather(geo, dateStr) {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&daily=temperature_2m_max,temperature_2m_min,weather_code&timezone=auto`;
    try {
        const resp = await fetch(url);
        if (!resp.ok) return null;
        const data = await resp.json();
        return parseOpenMeteoDaily(data, dateStr, 'forecast');
    } catch (e) { }
    return null;
}

function parseOpenMeteoDaily(data, dateStr, source) {
    if (!data || !data.daily || !data.daily.time) return null;
    const idx = data.daily.time.indexOf(dateStr);
    if (idx < 0) return null;

    const maxTemp = data.daily.temperature_2m_max?.[idx];
    const minTemp = data.daily.temperature_2m_min?.[idx];
    const wmoCode = data.daily.weather_code?.[idx];

    if (maxTemp === undefined || minTemp === undefined) return null;

    const temp = Math.round((maxTemp + minTemp) / 2);
    const info = WMO_MAP[wmoCode] || { type: 'cloudy', cn: '多云', en: 'Cloudy', extreme: false };
    const isRainy = isRainyType(info.type);

    return {
        type: info.type,
        cn: info.cn,
        en: info.en,
        temp,
        extreme: info.extreme,
        wmoCode,
        isRainy,
        source,
    };
}

function isRainyType(type) {
    return ['light_rain', 'moderate_rain', 'heavy_rain', 'shower', 'thunderstorm', 'sleet'].includes(type);
}

function applyContinuity(baseWeather, previousWeather, settings) {
    if (!previousWeather) return baseWeather;
    if (!settings.weatherContinuity || Math.random() > settings.weatherContinuity / 100) return baseWeather;

    let temp = baseWeather.temp;
    const prevTemp = previousWeather.temp;
    const jitter = settings.weatherTempJitter || 0;
    const adjust = Math.max(-2, Math.min(2, prevTemp - temp)) * 0.5;
    temp = Math.round(temp + adjust + (Math.random() * jitter * 2 - jitter));

    let type = baseWeather.type;
    if (baseWeather.isRainy) {
        if (Math.random() < 0.7 + (settings.weatherRainBias || 0) / 100) {
            type = baseWeather.type;
        } else {
            type = previousWeather.type || baseWeather.type;
        }
    } else {
        if (previousWeather.isRainy && Math.random() < 0.3) {
            type = previousWeather.type;
        } else {
            type = baseWeather.type;
        }
    }

    return {
        ...baseWeather,
        type,
        temp,
    };
}

function normalizeLocationName(raw) {
    if (!raw) return '';
    let s = raw.trim();
    s = s.replace(/[·•\|]/g, ' ');
    s = s.split(/[\s,，、/]/)[0];
    s = s.replace(/(市|省|自治区|特别行政区|县|区)$/g, '');
    return s;
}

export function getWeatherPrompt(weather) {
    if (!weather) return '';
    let lines = [];
    lines.push(`当前天气：${weather.cn}（${weather.en}），气温约${weather.temp}°C`);

    if (weather.extreme) {
        lines.push(`⚠ 极端天气警报！${weather.cn}可能严重影响角色出行与安全。`);
        lines.push('可能出现：交通中断、停电、建筑受损等意外事件。角色应当做出合理的应对反应。');
    } else {
        const impacts = getWeatherImpact(weather.type);
        if (impacts) lines.push(`天气影响：${impacts}`);
    }
    return lines.join('\n');
}

function getWeatherImpact(type) {
    const map = {
        light_rain: '可能需要撑伞，户外活动略受影响',
        moderate_rain: '户外活动受限，路面湿滑',
        heavy_rain: '不宜外出，注意防涝',
        shower: '短时降雨，可能突然开始又突然停止',
        thunderstorm: '电闪雷鸣，不宜在空旷处停留',
        foggy: '能见度低，出行需小心',
        windy: '大风天气，注意高空坠物',
        windy_cold: '寒风凛冽，需要厚衣保暖',
        humid: '空气闷热黏腻，容易出汗',
        sunny_hot: '烈日当空，注意防晒和补水',
        heatwave: '极端高温，尽量避免室外活动',
        light_snow: '薄雪覆盖，路面可能结冰',
        moderate_snow: '积雪较厚，出行困难',
        heavy_snow: '大雪封路，交通瘫痪',
        sleet: '雨雪交加，路面极度湿滑',
        frost: '地面结霜，清晨寒冷',
        hail: '冰雹来袭，注意躲避',
        typhoon: '台风登陆，严禁外出',
        blizzard: '暴风雪肆虐，所有出行暂停',
        ice_storm: '冰暴危险，树枝和电线可能断裂',
    };
    return map[type] || '';
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
