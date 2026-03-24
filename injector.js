import { getSettings, getChatState } from './state.js';
import { getHolidayInfo, getNextHoliday, checkEvents, loadChineseDays } from './calendar.js';
import { getWeatherPrompt } from './weather.js';
import { getCycleStatus, advanceCycle } from './cycle.js';
import { t, getLocale } from './i18n.js';

export async function buildInjectionPrompt() {
    const settings = getSettings();
    const cs = getChatState();

    if (!settings.enabled || !cs.currentTime) return '';

    await loadChineseDays();

    const parsed = new Date(cs.currentTime);
    if (isNaN(parsed.getTime())) return '';

    const dateStr = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    const hour = parsed.getHours();
    const minute = parsed.getMinutes();
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    const sections = [];
    sections.push(t('prompt.title'));

    const timePeriod = getTimePeriod(hour);

    if (settings.worldEra === 'ancient') {
        const lunarInfo = getLunarInfo(dateStr);
        const lunarDate = lunarInfo.lunarDate || '农历未知';
        const eraYearText = buildEraYearText(cs, parsed.getFullYear());
        const ancientTime = formatAncientTime(hour, minute);
        sections.push(t('prompt.timeAncient', { era: eraYearText, lunar: lunarDate, ancientTime, period: timePeriod }));
    } else {
        sections.push(t('prompt.timeModern', { y: parsed.getFullYear(), m: parsed.getMonth() + 1, d: parsed.getDate(), time: timeStr, period: timePeriod }));
    }

    if (settings.calendarEnabled) {
        if (settings.worldEra === 'ancient') {
            const lunarInfo = getLunarInfo(dateStr);
            const solarTerm = getSolarTermName(dateStr);
            if (solarTerm) {
                sections.push(t('prompt.solarTerm', { name: solarTerm }));
            }
            const festival = getTraditionalFestival(dateStr, lunarInfo.lunarRaw);
            if (festival) {
                sections.push(t('prompt.festival', { name: festival }));
            }
        } else {
            try {
                const holidayInfo = await getHolidayInfo(dateStr, settings.countryCode);
                sections.push(t('prompt.weekDay', { week: holidayInfo.weekDayName, type: holidayInfo.dayType }));
                if (holidayInfo.isHoliday && holidayInfo.holidayLocalName) {
                    sections.push(t('prompt.todayHoliday', { name: holidayInfo.holidayLocalName }));
                }
                if (holidayInfo.lunarDate) {
                    sections.push(t('prompt.lunar', { lunar: holidayInfo.lunarDate }));
                }
                const nextH = await getNextHoliday(dateStr, settings.countryCode);
                if (nextH) {
                    sections.push(t('prompt.nextHoliday', { name: nextH.localName || nextH.name, date: nextH.dateStr, days: nextH.daysUntil }));
                }
            } catch (e) {
                console.warn('[WorldEngine] 日历注入出错', e);
            }
        }
    }

    if (settings.eventsEnabled && settings.events.length > 0) {
        const matched = checkEvents(dateStr, settings.events);
        const currentCharId = getCurrentCharacterId();
        for (const ev of matched) {
            if (!isEventForCurrentChat(ev, currentCharId)) continue;
            let extra = '';
            if (ev.year) {
                const currentYear = parsed.getFullYear();
                const y = parseInt(ev.year);
                if (!isNaN(y) && y > 0) {
                    const diff = currentYear - y;
                    if (ev.type === 'birthday') {
                        extra = `（${diff}岁）`;
                    } else {
                        extra = `（第${diff}年）`;
                    }
                }
            }
            const owner = getEventOwnerName(ev);
            if (ev.type === 'birthday') {
                sections.push(t('prompt.eventBirthday', { owner, name: ev.name, extra }));
            } else {
                sections.push(t('prompt.eventAnniversary', { owner, name: ev.name, extra }));
            }
        }
    }

    if (settings.weatherEnabled && cs.weatherState) {
        const wp = getWeatherPrompt(cs.weatherState, settings.worldEra, cs.currentTime, cs.currentLocation);
        if (wp) sections.push(wp);
    }

    if (settings.cycleEnabled && Object.keys(cs.cycleStates).length > 0) {
        const cycleLines = [];
        for (const [name, data] of Object.entries(cs.cycleStates)) {
            const updated = advanceCycle({ ...data }, dateStr);
            cs.cycleStates[name] = updated;
            const status = getCycleStatus(updated, dateStr);
            const desc = formatCycleDescription(status, settings.worldEra);
            if (desc) {
                cycleLines.push(`- ${name}：${desc}`);
            }
        }
        if (cycleLines.length > 0) {
            sections.push(t('prompt.cycleTitle'));
            sections.push(...cycleLines);
            sections.push(t('prompt.cycleHint'));
        }
    }

    if (settings.worldTagMode && settings.worldTagPromptEnabled) {
        sections.push(t('prompt.worldTagGuide'));
    }
    sections.push(t('prompt.end'));
    return sections.join('\n');
}

export async function updateInjection() {
    const settings = getSettings();
    const context = SillyTavern.getContext();

    if (!settings.enabled) {
        context.setExtensionPrompt('worldEngine', '', 1, 0);
        return;
    }

    const prompt = await buildInjectionPrompt();
    context.setExtensionPrompt(
        'worldEngine',
        prompt,
        settings.injectionPosition,
        settings.injectionDepth,
    );
}

function buildEraYearText(cs, currentGregorianYear) {
    if (!cs.eraYearLabel || !cs.eraYearBase || !cs.eraYearBaseGregorian) {
        return '';
    }
    const diff = currentGregorianYear - cs.eraYearBaseGregorian;
    const eraYear = Math.max(1, cs.eraYearBase + diff);
    return `${cs.eraYearLabel}${formatEraYear(eraYear)} `;
}

function formatEraYear(n) {
    if (n === 1) return '元年';
    return `${toChineseNumber(n)}年`;
}

function toChineseNumber(num) {
    const digits = ['零','一','二','三','四','五','六','七','八','九'];
    if (num < 10) return digits[num];
    if (num < 20) return num === 10 ? '十' : `十${digits[num - 10]}`;
    if (num < 100) {
        const tens = Math.floor(num / 10);
        const ones = num % 10;
        return ones === 0 ? `${digits[tens]}十` : `${digits[tens]}十${digits[ones]}`;
    }
    return String(num);
}

function formatAncientTime(hour, minute) {
    const shichen = [
        { name: '子', start: 23, end: 1 },
        { name: '丑', start: 1, end: 3 },
        { name: '寅', start: 3, end: 5 },
        { name: '卯', start: 5, end: 7 },
        { name: '辰', start: 7, end: 9 },
        { name: '巳', start: 9, end: 11 },
        { name: '午', start: 11, end: 13 },
        { name: '未', start: 13, end: 15 },
        { name: '申', start: 15, end: 17 },
        { name: '酉', start: 17, end: 19 },
        { name: '戌', start: 19, end: 21 },
        { name: '亥', start: 21, end: 23 },
    ];

    let name = '子';
    for (const s of shichen) {
        if (s.start < s.end) {
            if (hour >= s.start && hour < s.end) { name = s.name; break; }
        } else {
            if (hour >= s.start || hour < s.end) { name = s.name; break; }
        }
    }

    const ke = Math.min(4, Math.max(1, Math.floor(minute / 15) + 1));
    const keText = ['一刻', '二刻', '三刻', '四刻'][ke - 1];
    return `${name}时${keText}`;
}

function getLunarInfo(dateStr) {
    const cd = window.chineseDays;
    if (!cd || typeof cd.getLunarDate !== 'function') {
        return { lunarDate: '', lunarRaw: null, lunarYearCN: '' };
    }
    try {
        const lunar = cd.getLunarDate(dateStr);
        const mon = lunar?.lunarMonCN || lunar?.monthStr || '';
        const day = lunar?.lunarDayCN || lunar?.dayStr || '';
        const leap = lunar?.isLeap ? '闰' : '';
        const lunarDate = mon && day ? `${leap}${mon}${day}` : '';
        const lunarYearCN = lunar?.lunarYearCN || '';
        return { lunarDate, lunarRaw: lunar, lunarYearCN };
    } catch (e) {
        return { lunarDate: '', lunarRaw: null, lunarYearCN: '' };
    }
}

function getSolarTermName(dateStr) {
    const cd = window.chineseDays;
    if (!cd) return '';
    try {
        if (typeof cd.getSolarTermsInRange === 'function') {
            const list = cd.getSolarTermsInRange(dateStr);
            if (Array.isArray(list) && list.length > 0 && list[0].name) return list[0].name;
        }
        if (typeof cd.getSolarTerms === 'function') {
            const list = cd.getSolarTerms(dateStr);
            if (Array.isArray(list) && list.length > 0 && list[0].name) return list[0].name;
        }
        if (typeof cd.getSolarTerm === 'function') {
            const term = cd.getSolarTerm(dateStr);
            if (term && term.name) return term.name;
            if (typeof term === 'string') return term;
        }
        if (typeof cd.getSolarTermName === 'function') {
            const name = cd.getSolarTermName(dateStr);
            if (name) return name;
        }
        if (typeof cd.getDayDetail === 'function') {
            const detail = cd.getDayDetail(dateStr);
            if (detail && detail.solarTerm) return detail.solarTerm;
            if (detail && detail.solarTermName) return detail.solarTermName;
        }
    } catch (e) { }
    return '';
}

function getTraditionalFestival(dateStr, lunar) {
    const cd = window.chineseDays;
    if (cd && typeof cd.getLunarFestivals === 'function') {
        try {
            const list = cd.getLunarFestivals(dateStr);
            if (Array.isArray(list) && list.length > 0) {
                const names = list.map(x => typeof x === 'string' ? x : (x.name || x.localName || x.festival || '')).filter(Boolean);
                if (names.length > 0) return names.join('、');
            }
        } catch (e) { }
    }

    if (!lunar) return '';
    const key = `${lunar.lunarMonCN || lunar.monthStr || ''}${lunar.lunarDayCN || lunar.dayStr || ''}`;
    const map = getLocale().calendar?.traditionalFestivals || {};
    return map[key] || '';
}

function getCurrentCharacterId() {
    const context = SillyTavern.getContext();
    return context.characterId ?? null;
}

function getCurrentCharacterName() {
    const context = SillyTavern.getContext();
    const c = context.characters?.[context.characterId];
    return c?.name || c?.data?.name || c?.char_name || '';
}

function isEventForCurrentChat(ev, currentCharId) {
    if (Array.isArray(ev.characterIds) && ev.characterIds.length > 0) {
        return currentCharId !== null && ev.characterIds.map(String).includes(String(currentCharId));
    }
    if (ev.character) {
        const name = getCurrentCharacterName();
        return name && name === ev.character;
    }
    return true;
}

function getEventOwnerName(ev) {
    if (Array.isArray(ev.characterIds) && ev.characterIds.length > 0) {
        const names = ev.characterIds.map(id => getCharacterNameById(id)).filter(Boolean);
        if (names.length > 0) return `${names.join('、')}的`;
    }
    if (ev.character) return `${ev.character}的`;
    return '';
}

function getCharacterNameById(id) {
    const context = SillyTavern.getContext();
    const c = context.characters?.[Number(id)];
    return c?.name || c?.data?.name || c?.char_name || '';
}

function formatCycleDescription(status, worldEra) {
    if (!status) return '';
    if (worldEra !== 'ancient') return status.description || '';
    if (status.phase === 'skipped') return t('cycle.ancientSkipped');
    if (status.phase === 'menstruation') {
        const day = (status.dayInCycle ?? 0) + 1;
        return t('cycle.ancientMenstruation', { day });
    }
    if (status.phase === 'follicular') return t('cycle.ancientFollicular');
    if (status.phase === 'ovulation') return t('cycle.ancientOvulation');
    if (status.phase === 'luteal') {
        if ((status.description || '').includes('经前期')) {
            return t('cycle.ancientPms');
        }
        return t('cycle.ancientLuteal');
    }
    return status.description || '';
}

function getTimePeriod(hour) {
    if (hour >= 5 && hour < 8) return t('prompt.periods.dawn');
    if (hour >= 8 && hour < 12) return t('prompt.periods.morning');
    if (hour >= 12 && hour < 14) return t('prompt.periods.noon');
    if (hour >= 14 && hour < 17) return t('prompt.periods.afternoon');
    if (hour >= 17 && hour < 19) return t('prompt.periods.evening');
    if (hour >= 19 && hour < 22) return t('prompt.periods.night');
    return t('prompt.periods.midnight');
}
