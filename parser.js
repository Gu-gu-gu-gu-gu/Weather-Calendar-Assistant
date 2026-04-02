import { getChatState } from './state.js';

const TIME_KEYS_DEFAULT = ['time', 'date', '时间', '日期', 'datetime', 'when', 'timestamp'];
const LOCATION_KEYS_DEFAULT = [
    'location',
    '地点',
    '地区',
    'place',
    '城市',
    'city',
    'where',
    'region',
    'area',
];

export function autoDetectFormat(messageText) {
    const result = {
        tagWrapper: null,
        fields: [],
        timeKey: null,
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
        if (!result.locationKey && LOCATION_KEYS_DEFAULT.includes(keyLower)) {
            result.locationKey = m[1];
        }
    }
    return result;
}

export function parseTimeValue(raw, baseDateStr = null) {
    if (!raw) return null;
    const s = raw.trim();

    let res = parseDateWithYMD(s);
    if (res) return res;

    res = parseDateWithMonthName(s);
    if (res) return res;

    res = parseDateWithMDY(s);
    if (res) return res;

    res = parseEraDateWithYMD(s, baseDateStr);
    if (res) return res;

    const lunarParsed = parseLunarTimeValue(s, baseDateStr);
    if (lunarParsed) return lunarParsed;

    res = parseTimeOnly(s, baseDateStr);
    if (res) return res;

    return null;
}

function parseDateWithYMD(s) {
    const dateMatch = s.match(/(\d{4})[.\-\/年](\d{1,2})[.\-\/月](\d{1,2})[日]?/);
    if (!dateMatch) return null;

    const year = parseInt(dateMatch[1]);
    const month = parseInt(dateMatch[2]);
    const day = parseInt(dateMatch[3]);

    const { hour, minute, endHour, endMinute, crossDay } = parseClockFromString(s);
    return buildTimeResult(year, month, day, hour, minute, endHour, endMinute, crossDay);
}

function parseDateWithMonthName(s) {
    const m = s.match(
        /\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\s+(\d{1,2})(?:st|nd|rd|th)?\,?\s*(\d{4})/i
    );
    if (!m) return null;

    const monthMap = {
        jan: 1,
        january: 1,
        feb: 2,
        february: 2,
        mar: 3,
        march: 3,
        apr: 4,
        april: 4,
        may: 5,
        jun: 6,
        june: 6,
        jul: 7,
        july: 7,
        aug: 8,
        august: 8,
        sep: 9,
        sept: 9,
        september: 9,
        oct: 10,
        october: 10,
        nov: 11,
        november: 11,
        dec: 12,
        december: 12,
    };

    const monthKey = String(m[1]).toLowerCase();
    const month = monthMap[monthKey];
    const day = parseInt(m[2]);
    const year = parseInt(m[3]);

    if (!month || !day || !year) return null;

    const { hour, minute, endHour, endMinute, crossDay } = parseClockFromString(s);
    return buildTimeResult(year, month, day, hour, minute, endHour, endMinute, crossDay);
}

function parseDateWithMDY(s) {
    const m = s.match(/\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})\b/);
    if (!m) return null;

    let month = parseInt(m[1]);
    let day = parseInt(m[2]);
    const year = parseInt(m[3]);

    if (month > 12 && day <= 12) {
        const tmp = month;
        month = day;
        day = tmp;
    }

    const { hour, minute, endHour, endMinute, crossDay } = parseClockFromString(s);
    return buildTimeResult(year, month, day, hour, minute, endHour, endMinute, crossDay);
}

function parseEraDateWithYMD(s, baseDateStr) {
    const m = s.match(
        /([^\d\s]{1,12})([零一二三四五六七八九十百千元0-9]+)年\s*(\d{1,2})月\s*(\d{1,2})日/
    );
    if (!m) return null;

    const label = m[1].trim();
    const yearNum = parseChineseNumber(m[2]);
    const month = parseInt(m[3]);
    const day = parseInt(m[4]);
    if (!label || !yearNum || !month || !day) return null;

    const cs = getChatState();
    let baseYear = getBaseYear(baseDateStr);
    if (!baseYear) baseYear = new Date().getFullYear();

    let gregorianYear = baseYear;
    if (cs.eraYearLabel && cs.eraYearBase && cs.eraYearBaseGregorian && cs.eraYearLabel === label) {
        gregorianYear = cs.eraYearBaseGregorian + (yearNum - cs.eraYearBase);
    } else {
        gregorianYear = baseYear;
    }

    const { hour, minute, endHour, endMinute, crossDay } = parseClockFromString(s);
    return buildTimeResult(gregorianYear, month, day, hour, minute, endHour, endMinute, crossDay);
}

function parseTimeOnly(s, baseDateStr) {
    if (!baseDateStr) return null;
    const base = baseDateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!base) return null;

    const { hour, minute, endHour, endMinute, crossDay, hasTime } = parseClockFromString(s);
    if (!hasTime) return null;

    const year = parseInt(base[1]);
    const month = parseInt(base[2]);
    const day = parseInt(base[3]);
    return buildTimeResult(year, month, day, hour, minute, endHour, endMinute, crossDay);
}

function parseClockFromString(s) {
    const matches = [];
    const re = /(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/gi;
    let m;
    while ((m = re.exec(s)) !== null) {
        const hasColon = m[2] !== undefined;
        const hasAmPm = !!m[3];
        if (!hasColon && !hasAmPm) continue;

        let hour = parseInt(m[1]);
        let minute = m[2] ? parseInt(m[2]) : 0;

        if (hasAmPm) {
            const ap = m[3].toLowerCase();
            if (ap === 'pm' && hour < 12) hour += 12;
            if (ap === 'am' && hour === 12) hour = 0;
        }

        matches.push({ hour, minute });
    }

    let hour = 8,
        minute = 0;
    let endHour = null,
        endMinute = null;

    if (matches.length > 0) {
        hour = matches[0].hour;
        minute = matches[0].minute;
    }
    if (matches.length > 1) {
        endHour = matches[1].hour;
        endMinute = matches[1].minute;
    }

    const crossDay = /次日|翌日|next\s*day/i.test(s);
    return { hour, minute, endHour, endMinute, crossDay, hasTime: matches.length > 0 };
}

function buildTimeResult(year, month, day, hour, minute, endHour, endMinute, crossDay) {
    const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    return {
        date: new Date(year, month - 1, day, hour, minute),
        year,
        month,
        day,
        hour,
        minute,
        endHour,
        endMinute,
        crossDay,
        dateStr,
        timeStr,
        iso: `${dateStr}T${timeStr}:00`,
    };
}

function parseWorldTagBlock(text) {
    if (!text) return null;
    let m = text.match(
        /\[\[\s*WORLD\s*\]\]([\s\S]*?)(\[\[\s*\/\s*WORLD\s*\]\]|\[\[\\\/WORLD\]\]|$)/i
    );
    if (!m) {
        m = text.match(/<\s*WORLD\s*>([\s\S]*?)(<\s*\/\s*WORLD\s*>|$)/i);
    }
    if (!m) return null;

    const inner = m[1];
    const data = { time: '', location: '' };
    const re =
        /([a-zA-Z\u4e00-\u9fff_]+)\s*[:=：]\s*([\s\S]*?)(?=\s*(?:\||｜|;|；|\n|\r|\[\[\s*\/\s*WORLD\s*\]\]|<\s*\/\s*WORLD\s*>|$))/g;
    let match;
    while ((match = re.exec(inner)) !== null) {
        const key = String(match[1]).trim().toLowerCase();
        const val = cleanExtractedFieldValue(match[2]);
        if (!val) continue;
        if (['time', 'date', 'datetime', '时间', '日期', 'when', 'timestamp'].includes(key))
            data.time = val;
        if (['location', 'place', 'city', '地点', '地区', 'where', 'region', 'area'].includes(key))
            data.location = val;
    }
    if (!data.time && !data.location) return null;
    return data;
}

function stripMVUBlocks(text) {
    if (!text) return '';
    let s = String(text);
    s = s.replace(/<UpdateVariable>[\s\S]*?<\/UpdateVariable>/gi, '');
    s = s.replace(/<UpdateCharacter>[\s\S]*?<\/UpdateCharacter>/gi, '');
    s = s.replace(/<UpdateChat>[\s\S]*?<\/UpdateChat>/gi, '');
    return s;
}

function cleanExtractedFieldValue(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/^\s*[|｜;；]+\s*/, '');
    s = s.replace(/\s*(\[\[\s*\/\s*WORLD\s*\]\]|\[\[\\\/WORLD\]\]|<\s*\/\s*WORLD\s*>)+\s*$/gi, '');
    s = s.replace(/\s*[|｜;；]+\s*$/g, '');
    return s.trim();
}

function matchKeyValueBounded(text, key) {
    if (!text || !key) return '';
    try {
        const re = new RegExp(
            escapeRegex(key) +
                '\\s*[:=：]\\s*([\\s\\S]*?)(?=\\s*(?:\\||｜|;|；|\\n|\\r|\\[\\[\\s*\\/\\s*WORLD\\s*\\]\\]|<\\s*\\/\\s*WORLD\\s*>|$))',
            'im'
        );
        const m = text.match(re);
        if (!m) return '';
        return cleanExtractedFieldValue(m[1]);
    } catch (_) {
        return '';
    }
}

export function extractFromMessage(messageText, settings) {
    const result = { time: null, location: null, rawTime: null, eraYear: null };
    let content = stripMVUBlocks(messageText);

    if (settings.tagWrapper) {
        const re = new RegExp(
            `<${escapeRegex(settings.tagWrapper)}>([\\s\\S]*?)<\\/${escapeRegex(settings.tagWrapper)}>`
        );
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

    const worldTag = parseWorldTagBlock(content);
    if (worldTag) {
        if (worldTag.time) {
            result.rawTime = cleanExtractedFieldValue(worldTag.time);
            result.time = parseTimeValue(result.rawTime, baseDateStr);
        }
        if (worldTag.location) result.location = cleanExtractedFieldValue(worldTag.location);
        const eraInfo = detectEraYearInfo(result.rawTime || content);
        if (eraInfo) result.eraYear = eraInfo;
    }

    if (settings.worldTagMode && (result.time || result.location)) {
        return result;
    }
    if (result.time || result.location) {
        return result;
    }

    const hasCustomTimeRegex = !!settings.timeRegexCustom;

    if (hasCustomTimeRegex) {
        try {
            const m = content.match(new RegExp(settings.timeRegexCustom));
            if (m) {
                const g = pickCaptureGroup(m);
                result.rawTime = cleanExtractedFieldValue((g || m[0]).trim());
                result.time = parseTimeValue(result.rawTime, baseDateStr);
            }
        } catch (_) {}
    }

    if (!hasCustomTimeRegex && !result.time && settings.timeKey) {
        const v = matchKeyValueBounded(content, settings.timeKey);
        if (v) {
            result.rawTime = v;
            result.time = parseTimeValue(result.rawTime, baseDateStr);
        }
    }

    if (!hasCustomTimeRegex && !result.time) {
        for (const k of TIME_KEYS_DEFAULT) {
            const v = matchKeyValueBounded(content, k);
            if (v) {
                result.rawTime = v;
                result.time = parseTimeValue(result.rawTime, baseDateStr);
                if (result.time) break;
            }
        }
    }

    if (settings.locationRegexCustom) {
        try {
            const m = content.match(new RegExp(settings.locationRegexCustom));
            if (m) {
                const g = pickCaptureGroup(m);
                result.location = cleanExtractedFieldValue((g || m[0]).trim());
            }
        } catch (_) {}
    }

    if (!result.location && settings.locationKey) {
        const v = matchKeyValueBounded(content, settings.locationKey);
        if (v) result.location = v;
    }

    if (!result.location) {
        for (const k of LOCATION_KEYS_DEFAULT) {
            const v = matchKeyValueBounded(content, k);
            if (v) {
                result.location = v;
                break;
            }
        }
    }

    if (!result.location) {
        const free = detectLocationFreeForm(content);
        if (free) result.location = free;
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
        hour,
        minute,
        endHour: null,
        endMinute: null,
        crossDay: false,
        dateStr,
        timeStr,
        iso: `${dateStr}T${timeStr}:00`,
    };
}

function parseLunarMonthDay(text) {
    const m = text.match(/(闰)?(正|一|二|三|四|五|六|七|八|九|十|冬|腊)月/);
    const d = text.match(
        /(初一|初二|初三|初四|初五|初六|初七|初八|初九|初十|十一|十二|十三|十四|十五|十六|十七|十八|十九|二十|廿一|廿二|廿三|廿四|廿五|廿六|廿七|廿八|廿九|三十)(日|号)?/
    );
    if (!m || !d) return null;

    const monthMap = {
        正: 1,
        一: 1,
        二: 2,
        三: 3,
        四: 4,
        五: 5,
        六: 6,
        七: 7,
        八: 8,
        九: 9,
        十: 10,
        冬: 11,
        腊: 12,
    };
    const dayMap = {
        初一: 1,
        初二: 2,
        初三: 3,
        初四: 4,
        初五: 5,
        初六: 6,
        初七: 7,
        初八: 8,
        初九: 9,
        初十: 10,
        十一: 11,
        十二: 12,
        十三: 13,
        十四: 14,
        十五: 15,
        十六: 16,
        十七: 17,
        十八: 18,
        十九: 19,
        二十: 20,
        廿一: 21,
        廿二: 22,
        廿三: 23,
        廿四: 24,
        廿五: 25,
        廿六: 26,
        廿七: 27,
        廿八: 28,
        廿九: 29,
        三十: 30,
    };

    const month = monthMap[m[2]];
    const day = dayMap[d[1]];
    if (!month || !day) return null;
    return { month, day };
}

function parseShichen(text) {
    const map = {
        子: 23,
        丑: 1,
        寅: 3,
        卯: 5,
        辰: 7,
        巳: 9,
        午: 11,
        未: 13,
        申: 15,
        酉: 17,
        戌: 19,
        亥: 21,
    };
    const m = text.match(/([子丑寅卯辰巳午未申酉戌亥])时(一刻|二刻|三刻|四刻)?/);
    if (!m) return { hour: 8, minute: 0 };
    const hour = map[m[1]] ?? 8;
    const keMap = { 一刻: 0, 二刻: 15, 三刻: 30, 四刻: 45 };
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
    const numMap = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
    const unitMap = { 十: 10, 百: 100, 千: 1000 };
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

function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function detectLocationFreeForm(content) {
    const lines = content
        .split('\n')
        .map((x) => x.trim())
        .filter(Boolean);
    const re =
        /^[A-Za-z\u4e00-\u9fff][A-Za-z\u4e00-\u9fff\s]*(?:\s*[·\-–—,，\/]\s*[A-Za-z\u4e00-\u9fff\s]+){1,4}$/;
    for (const line of lines) {
        if (line.length < 3 || line.length > 80) continue;
        if (re.test(line)) return line;
    }
    return null;
}
