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

export function parseTimeValue(raw) {
    if (!raw) return null;
    const s = raw.trim();
    const dateMatch = s.match(/(\d{4})[.\-\/年](\d{1,2})[.\-\/月](\d{1,2})[日]?/);
    if (!dateMatch) return null;

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

export function extractFromMessage(messageText, settings) {
    const result = { time: null, scene: null, location: null, rawTime: null };
    let content = messageText;

    if (settings.tagWrapper) {
        const re = new RegExp(`<${escapeRegex(settings.tagWrapper)}>([\\s\\S]*?)<\\/${escapeRegex(settings.tagWrapper)}>`);
        const m = content.match(re);
        if (m) content = m[1];
    }

    if (settings.timeRegexCustom) {
        try {
            const m = content.match(new RegExp(settings.timeRegexCustom));
            if (m) {
                const g = pickCaptureGroup(m);
                result.rawTime = (g || m[0]).trim();
                result.time = parseTimeValue(result.rawTime);
            }
        } catch (_) { }
    }

    if (!result.time && settings.timeKey) {
        const re = new RegExp(escapeRegex(settings.timeKey) + '\\s*[:：]\\s*(.+)', 'im');
        const m = content.match(re);
        if (m) {
            result.rawTime = m[1].trim();
            result.time = parseTimeValue(result.rawTime);
        }
    }

    if (!result.time) {
        for (const k of TIME_KEYS_DEFAULT) {
            const re = new RegExp(escapeRegex(k) + '\\s*[:：]\\s*(.+)', 'im');
            const m = content.match(re);
            if (m) {
                result.rawTime = m[1].trim();
                result.time = parseTimeValue(result.rawTime);
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

    return result;
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
