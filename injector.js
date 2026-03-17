import { getSettings, getChatState } from './state.js';
import { getHolidayInfo, getNextHoliday, checkEvents } from './calendar.js';
import { getWeatherPrompt } from './weather.js';
import { getCycleStatus, advanceCycle } from './cycle.js';

export async function buildInjectionPrompt() {
    const settings = getSettings();
    const cs = getChatState();

    if (!settings.enabled || !cs.currentTime) return '';

    const parsed = new Date(cs.currentTime);
    if (isNaN(parsed.getTime())) return '';

    const dateStr = `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    const hour = parsed.getHours();
    const minute = parsed.getMinutes();
    const timeStr = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;

    const sections = [];
    sections.push('[📅 World Engine - 世界状态]');

    let timePeriod;
    if (hour >= 5 && hour < 8) timePeriod = '清晨';
    else if (hour >= 8 && hour < 12) timePeriod = '上午';
    else if (hour >= 12 && hour < 14) timePeriod = '中午';
    else if (hour >= 14 && hour < 17) timePeriod = '下午';
    else if (hour >= 17 && hour < 19) timePeriod = '傍晚';
    else if (hour >= 19 && hour < 22) timePeriod = '夜晚';
    else timePeriod = '深夜';

    sections.push(`日期：${parsed.getFullYear()}年${parsed.getMonth() + 1}月${parsed.getDate()}日 ${timeStr}（${timePeriod}）`);

    if (cs.currentScene) {
        sections.push(`场景：${cs.currentScene}`);
    }

    if (settings.calendarEnabled) {
        try {
            const holidayInfo = await getHolidayInfo(dateStr, settings.countryCode);
            sections.push(`星期：${holidayInfo.weekDayName} ｜ 日历类型：${holidayInfo.dayType}`);
            if (holidayInfo.isHoliday && holidayInfo.holidayLocalName) {
                sections.push(`🎉 今日节日：${holidayInfo.holidayLocalName}`);
            }
            if (holidayInfo.lunarDate) {
                sections.push(`农历：${holidayInfo.lunarDate}`);
            }
            const nextH = await getNextHoliday(dateStr, settings.countryCode);
            if (nextH) {
                sections.push(`下一个节日：${nextH.localName || nextH.name}（${nextH.dateStr}，还有${nextH.daysUntil}天）`);
            }
        } catch (e) {
            console.warn('[WorldEngine] 日历注入出错', e);
        }
    }

    if (settings.eventsEnabled && settings.events.length > 0) {
        const matched = checkEvents(dateStr, settings.events);
        for (const ev of matched) {
            const emoji = ev.type === 'birthday' ? '🎂' : '💝';
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
            sections.push(`${emoji} 今天是${ev.character ? ev.character + '的' : ''}${ev.name}${extra}！`);
        }
    }

    if (settings.weatherEnabled && cs.weatherState) {
        const wp = getWeatherPrompt(cs.weatherState);
        if (wp) sections.push(wp);
    }

    if (settings.cycleEnabled && Object.keys(cs.cycleStates).length > 0) {
        const cycleLines = [];
        for (const [name, data] of Object.entries(cs.cycleStates)) {
            const updated = advanceCycle({ ...data }, dateStr);
            cs.cycleStates[name] = updated;
            const status = getCycleStatus(updated, dateStr);
            if (status && status.description) {
                cycleLines.push(`- ${name}：${status.description}`);
            }
        }
        if (cycleLines.length > 0) {
            sections.push('角色生理状态：');
            sections.push(...cycleLines);
            sections.push('（生理状态应自然地影响角色的精力、情绪和行为，但不必每次都明确提及）');
        }
    }

    sections.push('[/World Engine]');
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
