import { t, getLocale } from './i18n.js';

let chineseDaysLoaded = false;
let chineseDaysLoadFailed = false;
const nagerCache = {};

export async function loadChineseDays() {
    if (chineseDaysLoaded || chineseDaysLoadFailed) return;
    if (window.chineseDays) {
        chineseDaysLoaded = true;
        return;
    }
    try {
        await new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://cdn.jsdelivr.net/npm/chinese-days';
            const timer = setTimeout(() => {
                chineseDaysLoadFailed = true;
                reject(new Error('timeout'));
            }, 10000);
            script.onload = () => {
                clearTimeout(timer);
                chineseDaysLoaded = true;
                resolve();
            };
            script.onerror = () => {
                chineseDaysLoadFailed = true;
                reject();
            };
            document.head.appendChild(script);
        });
    } catch (e) {
        console.warn(t('calendar.warnLoadFailed'), e);
    }
}

async function fetchNagerHolidays(year, countryCode) {
    const key = `${year}_${countryCode}`;
    if (nagerCache[key]) return nagerCache[key];
    try {
        const resp = await fetch(
            `https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`
        );
        if (resp.ok) {
            const data = await resp.json();
            nagerCache[key] = data;
            return data;
        }
    } catch (e) {
        console.warn(t('calendar.warnNagerFail'), e);
    }
    return [];
}

function canUseChineseDays(year) {
    return chineseDaysLoaded && year >= 2004 && year <= 2026;
}

function buildLunarText(lunar) {
    if (!lunar) return '';
    const mon = lunar.lunarMonCN || lunar.monthStr || '';
    const day = lunar.lunarDayCN || lunar.dayStr || '';
    const leap = lunar.isLeap ? '闰' : '';
    return `${leap}${mon}${day}`;
}

export async function getHolidayInfo(dateStr, countryCode) {
    await loadChineseDays();

    const locale = getLocale();
    const weekDayNames = locale.calendar?.weekDays || ['日', '一', '二', '三', '四', '五', '六'];

    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear();
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    const info = {
        dateStr,
        dayOfWeek,
        weekDayName: weekDayNames[dayOfWeek],
        isWeekend,
        isHoliday: false,
        isWorkday: false,
        holidayName: '',
        holidayLocalName: '',
        isInLieu: false,
        lunarDate: '',
        dayType: isWeekend ? t('calendar.dayType.weekend') : t('calendar.dayType.workday'),
    };

    if (countryCode === 'CN' && canUseChineseDays(year)) {
        try {
            const cd = window.chineseDays;
            info.isHoliday = cd.isHoliday(dateStr);
            info.isWorkday = cd.isWorkday(dateStr);
            if (typeof cd.isInLieu === 'function') {
                info.isInLieu = cd.isInLieu(dateStr);
            }
            if (info.isHoliday) {
                info.dayType = t('calendar.dayType.holiday');
            } else if (info.isInLieu) {
                info.dayType = t('calendar.dayType.inLieu');
            } else if (info.isWorkday) {
                info.dayType = t('calendar.dayType.workday');
            } else {
                info.dayType = t('calendar.dayType.weekend');
            }

            if (typeof cd.getDayDetail === 'function') {
                const detail = cd.getDayDetail(dateStr);
                if (detail && detail.name && info.isHoliday) {
                    const parts = String(detail.name).split(',');
                    const n1 = parts[0] || detail.name;
                    const n2 = parts[1] || parts[0] || detail.name;
                    if (!isWeekdayName(n1) && !isWeekdayName(n2)) {
                        info.holidayName = n1;
                        info.holidayLocalName = n2;
                    }
                }
            }

            if (typeof cd.getLunarDate === 'function') {
                const lunar = cd.getLunarDate(dateStr);
                const lunarText = buildLunarText(lunar);
                if (lunarText) info.lunarDate = lunarText;
            }
        } catch (e) {
            console.warn(t('calendar.warnChineseDaysFail'), e);
        }
    } else {
        const holidays = await fetchNagerHolidays(year, countryCode);
        const match = holidays.find((h) => h.date === dateStr);
        if (match) {
            info.isHoliday = true;
            info.holidayName = match.name;
            info.holidayLocalName = match.localName;
            info.dayType = t('calendar.dayType.holiday');
        } else {
            info.isWorkday = !isWeekend;
            info.dayType = isWeekend
                ? t('calendar.dayType.weekend')
                : t('calendar.dayType.workday');
        }
    }

    return info;
}

export async function getNextHoliday(dateStr, countryCode, maxDays = 60) {
    const start = new Date(dateStr + 'T00:00:00');
    for (let i = 1; i <= maxDays; i++) {
        const next = new Date(start);
        next.setDate(next.getDate() + i);
        const ds = formatDate(next);
        const info = await getHolidayInfo(ds, countryCode);
        if (info.isHoliday && info.holidayName && !isWeekdayName(info.holidayName)) {
            return {
                dateStr: ds,
                name: info.holidayName,
                localName: info.holidayLocalName,
                daysUntil: i,
            };
        }
    }
    return null;
}

export function checkEvents(dateStr, events) {
    const monthDay = dateStr.slice(5);
    const matched = [];
    for (const ev of events) {
        if (ev.date === monthDay) {
            matched.push(ev);
        }
    }
    return matched;
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function isWeekdayName(text) {
    if (!text) return false;
    const s = String(text).toLowerCase();
    if (
        s.includes('monday') ||
        s.includes('tuesday') ||
        s.includes('wednesday') ||
        s.includes('thursday') ||
        s.includes('friday') ||
        s.includes('saturday') ||
        s.includes('sunday')
    ) {
        return true;
    }
    if (/周[一二三四五六日天]/.test(text)) return true;
    if (/星期[一二三四五六日天]/.test(text)) return true;
    return false;
}
