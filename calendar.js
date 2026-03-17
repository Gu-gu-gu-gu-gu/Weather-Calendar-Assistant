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
            script.onload = () => { chineseDaysLoaded = true; resolve(); };
            script.onerror = () => { chineseDaysLoadFailed = true; reject(); };
            const timer = setTimeout(() => { chineseDaysLoadFailed = true; reject(new Error('timeout')); }, 10000);
            script.onload = () => { clearTimeout(timer); chineseDaysLoaded = true; resolve(); };
            document.head.appendChild(script);
        });
    } catch (e) {
        console.warn('[WorldEngine] chinese-days CDN 加载失败，将使用 Nager.Date 替代', e);
    }
}

async function fetchNagerHolidays(year, countryCode) {
    const key = `${year}_${countryCode}`;
    if (nagerCache[key]) return nagerCache[key];
    try {
        const resp = await fetch(`https://date.nager.at/api/v3/PublicHolidays/${year}/${countryCode}`);
        if (resp.ok) {
            const data = await resp.json();
            nagerCache[key] = data;
            return data;
        }
    } catch (e) {
        console.warn('[WorldEngine] Nager.Date API 请求失败', e);
    }
    return [];
}

function canUseChineseDays(year) {
    return chineseDaysLoaded && year >= 2004 && year <= 2026;
}

export async function getHolidayInfo(dateStr, countryCode) {
    const d = new Date(dateStr + 'T00:00:00');
    const year = d.getFullYear();
    const dayOfWeek = d.getDay();
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
    const weekDayNames = ['日', '一', '二', '三', '四', '五', '六'];

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
        dayType: isWeekend ? '周末' : '工作日',
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
                info.dayType = '节假日';
            } else if (info.isInLieu) {
                info.dayType = '调休工作日';
            } else if (info.isWorkday) {
                info.dayType = '工作日';
            } else {
                info.dayType = '周末';
            }
            if (typeof cd.getDayDetail === 'function') {
                const detail = cd.getDayDetail(dateStr);
                if (detail && detail.name) {
                    info.holidayLocalName = detail.name;
                    info.holidayName = detail.name;
                }
            }
            if (typeof cd.getLunarDate === 'function') {
                const lunar = cd.getLunarDate(dateStr);
                if (lunar) {
                    info.lunarDate = lunar.dateStr || `${lunar.monthStr || ''}${lunar.dayStr || ''}`;
                }
            }
        } catch (e) {
            console.warn('[WorldEngine] chinese-days 调用出错', e);
        }
    } else {
        const holidays = await fetchNagerHolidays(year, countryCode);
        const match = holidays.find(h => h.date === dateStr);
        if (match) {
            info.isHoliday = true;
            info.holidayName = match.name;
            info.holidayLocalName = match.localName;
            info.dayType = '节假日';
        } else {
            info.isWorkday = !isWeekend;
            info.dayType = isWeekend ? '周末' : '工作日';
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
        if (info.isHoliday && info.holidayName) {
            return { dateStr: ds, name: info.holidayName, localName: info.holidayLocalName, daysUntil: i };
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
