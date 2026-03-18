import { getChatState } from './state.js';

const TIME_KEYS_DEFAULT = ['time', 'date', '时间', '日期', 'datetime'];
const SCENE_KEYS_DEFAULT = ['scene', 'location', '场景', '地点', '地区', 'place'];
const LOCATION_KEYS_DEFAULT = ['location', '地点', '地区', 'place', '城市', 'city'];

export function autoDetectFormat(messageText) {
    const result = {
        tagWrapper: null,
        fields: [],
        timeKey: null,
        sceneKey: null,
        locationKey: null,
    };

    const tagMatch = messageText.match(/<([a-zA-Z_][\w-]*)>([\s\S]*?)<\/\1>/);
    if (tagMatch) {
        result.tagWrapper = tagMatch[1];
        messageText = tagMatch[2];
    }

    const lines = messageText.split('\n');
    const kvPattern = /^([a-zA-Z\u4e00-\u9fff_]+)\s*[:：]\s*(.+)$/;

    for (const line of lines) {
        const m = line.trim().match(kvPattern);
        if (!m) continue;
        const keyLower = m[1].toLowerCase();
        result.fields.push({ key: m[1], value: m[2].trim() });
        if (!result.timeKey && TIME_KEYS_DEFAULT.includes(keyLower)) {
            result.timeKey = m[1];
        }
        if (!result.sceneKey && SCENE_KEYS_DEFAULT.includes(keyLower)) {
            result.sceneKey = m[1];
        }
        if (!result.locationKey && LOCATION_KEYS_DEFAULT.includes(keyLower)) {
            result.locationKey = m[1];
        }
    }
    return result;
}

export function parseTimeValue(raw, baseDateStr = null) {
    if (!raw) return null;
    const s = raw.trim();
    const dateMatch = s.match(/(\d{4})[.\-\/年](\d{1,2})[.\-\/月](\d{1,2})[日]?/);
    if (dateMatch) {
        const year = parseInt(dateMatch[1]);
        const month = parseInt(dateMatch[2]);
        const day = parseInt(dateMatch[3]);

        const timeMatches = [...s.matchAll(/(\d{1,2}):(\d{2})/g)];
        let hour = 8, minute = 0;
        if (timeMatches.length > 0) {
            hour = parseInt(timeMatches[0][1]);
            minute = parseInt(timeMatches[0][2]);
        }

        let endHour = null, endMinute = null;
        const crossDay = /次日|翌日|next\s*day/i.test(s);
        if (timeMatches.length > 1) {
            endHour = parseInt(timeMatches[1][1]);
            endMinute = parseInt(timeMatches[1][2]);
        }

        const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

        return {
            date: new Date(year, month - 1, day, hour, minute),
            year, month, day, hour, minute,
            endHour, endMinute, crossDay,
            dateStr,
            timeStr,
            iso: `${dateStr}T${timeStr}:00`,
        };
    }

    const lunarParsed = parseLunarTimeValue(s, baseDateStr);
    if (lunarParsed) return lunarParsed;

    return null;
}

export function extractFromMessage(messageText, settings) {
    const result = { time: null, scene: null, location: null, rawTime: null, eraYear: null };
    let content = messageText;

    if (settings.tagWrapper) {
        const re = new RegExp(`<${escapeRegex(settings.tagWrapper)}>([\\s\\S]*?)<\\/${escapeRegex(settings.tagWrapper)}>`);
        const m = content.match(re);
        if (m) content = m[1];
    }

    const cs = getChatState();
    let baseDateStr = null;
    if (settings.customStartTime) {
        const t = parseTimeValue(settings.customStartTime);
        if (t) baseDateStr = t.dateStr;
    }
    if (!baseDateStr && cs.currentTime) {
        baseDateStr = cs.currentTime.split('T')[0];
    }
    if (!baseDateStr && settings.worldEra === 'ancient') {
        const y = getOrCreateRandomBaseYear();
        baseDateStr = `${y}-01-01`;
    }

    if (settings.timeRegexCustom) {
        try {
            const m = content.match(new RegExp(settings.timeRegexCustom));
            if (m) {
                const g = pickCaptureGroup(m);
                result.rawTime = (g || m[0]).trim();
                result.time = parseTimeValue(result.rawTime, baseDateStr);
            }
        } catch (_) { }
    }

    if (!result.time && settings.timeKey) {
        const re = new RegExp(escapeRegex(settings.timeKey) + '\\s*[:：]\\s*(.+)', 'im');
        const m = content.match(re);
        if (m) {
            result.rawTime = m[1].trim();
            result.time = parseTimeValue(result.rawTime, baseDateStr);
        }
    }

    if (!result.time) {
        for (const k of TIME_KEYS_DEFAULT) {
            const re = new RegExp(escapeRegex(k) + '\\s*[:：]\\s*(.+)', 'im');
            const m = content.match(re);
            if (m) {
                result.rawTime = m[1].trim();
                result.time = parseTimeValue(result.rawTime, baseDateStr);
                if (result.time) break;
            }
        }
    }

    if (settings.sceneRegexCustom) {
        try {
            const m = content.match(new RegExp(settings.sceneRegexCustom));
            if (m) {
                const g = pickCaptureGroup(m);
                result.scene = (g || m[0]).trim();
            }
        } catch (_) { }
    }

    if (!result.scene && settings.sceneKey) {
        const re = new RegExp(escapeRegex(settings.sceneKey) + '\\s*[:：]\\s*(.+)', 'im');
        const m = content.match(re);
        if (m) result.scene = m[1].trim();
    }

    if (!result.scene) {
        for (const k of SCENE_KEYS_DEFAULT) {
            const re = new RegExp(escapeRegex(k) + '\\s*[:：]\\s*(.+)', 'im');
            const m = content.match(re);
            if (m) {
                result.scene = m[1].trim();
                break;
            }
        }
    }

    if (settings.locationRegexCustom) {
        try {
            const m = content.match(new RegExp(settings.locationRegexCustom));
            if (m) {
                const g = pickCaptureGroup(m);
                result.location = (g || m[0]).trim();
            }
        } catch (_) { }
    }

    if (!result.location && settings.locationKey) {
        const re = new RegExp(escapeRegex(settings.locationKey) + '\\s*[:：]\\s*(.+)', 'im');
        const m = content.match(re);
        if (m) result.location = m[1].trim();
    }

    if (!result.location) {
        for (const k of LOCATION_KEYS_DEFAULT) {
            const re = new RegExp(escapeRegex(k) + '\\s*[:：]\\s*(.+)', 'im');
            const m = content.match(re);
            if (m) {
                result.location = m[1].trim();
                break;
            }
        }
    }

    if (settings.stripNSFWProgress && result.scene) {
        result.scene = sanitizeScene(result.scene);
    }

    if (!result.location && result.scene) {
        result.location = result.scene;
    }

    const eraInfo = detectEraYearInfo(result.rawTime || content);
    if (eraInfo) result.eraYear = eraInfo;

    return result;
}

export function detectEraYearInfo(text) {
    if (!text) return null;
    const re = /([^\d\s]{1,12})([零一二三四五六七八九十百千元0-9]+)年/;
    const m = text.match(re);
    if (!m) return null;
    const label = m[1].trim();
    const yearNum = parseChineseNumber(m[2]);
    if (!label || !yearNum) return null;
    return { label, yearNum };
}

function parseLunarTimeValue(text, baseDateStr) {
    const baseYear = getBaseYear(baseDateStr);
    if (!baseYear) return null;

    const md = parseLunarMonthDay(text);
    if (!md) return null;

    const { month, day } = md;
    const { hour, minute } = parseShichen(text);

    let dateStr = `${baseYear}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;

    const cd = window.chineseDays;
    if (cd && typeof cd.getSolarDateFromLunar === 'function') {
        const res = cd.getSolarDateFromLunar(dateStr);
        if (res && res.date) {
            dateStr = res.date;
        }
    }

    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const d = new Date(`${dateStr}T${timeStr}:00`);
    if (isNaN(d.getTime())) return null;

    return {
        date: d,
        year: d.getFullYear(),
        month: d.getMonth() + 1,
        day: d.getDate(),
        hour, minute,
        endHour: null, endMinute: null, crossDay: false,
        dateStr,
        timeStr,
        iso: `${dateStr}T${timeStr}:00`,
    };
}

function parseLunarMonthDay(text) {
    const m = text.match(/(闰)?(正|一|二|三|四|五|六|七|八|九|十|冬|腊)月/);
    const d = text.match(/(初一|初二|初三|初四|初五|初六|初七|初八|初九|初十|十一|十二|十三|十四|十五|十六|十七|十八|十九|二十|廿一|廿二|廿三|廿四|廿五|廿六|廿七|廿八|廿九|三十)/);
    if (!m || !d) return null;

    const monthMap = { 正:1, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9, 十:10, 冬:11, 腊:12 };
    const dayMap = {
        初一:1, 初二:2, 初三:3, 初四:4, 初五:5, 初六:6, 初七:7, 初八:8, 初九:9, 初十:10,
        十一:11, 十二:12, 十三:13, 十四:14, 十五:15, 十六:16, 十七:17, 十八:18, 十九:19, 二十:20,
        廿一:21, 廿二:22, 廿三:23, 廿四:24, 廿五:25, 廿六:26, 廿七:27, 廿八:28, 廿九:29, 三十:30
    };

    const month = monthMap[m[2]];
    const day = dayMap[d[1]];
    if (!month || !day) return null;
    return { month, day };
}

function parseShichen(text) {
    const map = {
        子:23, 丑:1, 寅:3, 卯:5, 辰:7, 巳:9,
        午:11, 未:13, 申:15, 酉:17, 戌:19, 亥:21
    };
    const m = text.match(/([子丑寅卯辰巳午未申酉戌亥])时(一刻|二刻|三刻|四刻)?/);
    if (!m) return { hour: 8, minute: 0 };
    const hour = map[m[1]] ?? 8;
    const keMap = { 一刻:0, 二刻:15, 三刻:30, 四刻:45 };
    const minute = keMap[m[2]] ?? 0;
    return { hour, minute };
}

function getBaseYear(baseDateStr) {
    if (!baseDateStr) return null;
    const m = baseDateStr.match(/^(\d{4})-/);
    if (!m) return null;
    return parseInt(m[1]);
}

function getOrCreateRandomBaseYear() {
    const cs = getChatState();
    if (cs.randomBaseYear) return cs.randomBaseYear;
    const min = 2000;
    const max = 2099;
    cs.randomBaseYear = Math.floor(Math.random() * (max - min + 1)) + min;
    return cs.randomBaseYear;
}

function parseChineseNumber(str) {
    if (!str) return null;
    if (/^\d+$/.test(str)) return parseInt(str);
    if (str === '元') return 1;
    const numMap = { 零:0, 一:1, 二:2, 三:3, 四:4, 五:5, 六:6, 七:7, 八:8, 九:9 };
    const unitMap = { 十:10, 百:100, 千:1000 };
    let total = 0;
    let current = 0;
    for (const ch of str) {
        if (numMap.hasOwnProperty(ch)) {
            current = numMap[ch];
        } else if (unitMap[ch]) {
            const unit = unitMap[ch];
            if (current === 0) current = 1;
            total += current * unit;
            current = 0;
        } else if (ch === '元') {
            return 1;
        }
    }
    total += current;
    return total > 0 ? total : null;
}

function pickCaptureGroup(m) {
    if (!m || m.length <= 1) return m && m[1] ? m[1] : null;
    for (let i = m.length - 1; i >= 1; i--) {
        if (m[i] !== undefined && m[i] !== null && String(m[i]).trim() !== '') {
            return m[i];
        }
    }
    return m[1] || null;
}

function sanitizeScene(scene) {
    let s = scene;
    s = s.replace(/(?:性爱进度|NSFW进度)\s*[:：]?\s*\d+\/10/gi, '');
    s = s.replace(/\b\d+\/10\b/g, '');
    s = s.replace(/\s{2,}/g, ' ').trim();
    return s;
}

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
