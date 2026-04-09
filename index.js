import {
    EXTENSION_NAME,
    getSettings,
    getChatState,
    saveState,
    saveSnapshot,
    restoreSnapshot,
    findPreviousSnapshotId,
    clearSnapshotsAfter,
} from './state.js';
import { autoDetectFormat, extractFromMessage, parseTimeValue } from './parser.js';
import { loadChineseDays, getHolidayInfo } from './calendar.js';
import {
    rollWeather,
    shouldRerollWeather,
    getWeatherForDate,
    getHourlyTemperature,
    buildWeatherOverrideKey,
} from './weather.js';
import { detectGenderInfo, initCycleForCharacter, getCycleStatus } from './cycle.js';
import { updateInjection, buildInjectionPrompt } from './injector.js';
import { t } from './i18n.js';

const SLUG = 'world-engine';
let panelMounted = false;

const WEATHER_TYPE_OPTIONS = [
    { type: 'sunny', cn: '晴朗', en: 'Sunny' },
    { type: 'partly_cloudy', cn: '晴间多云', en: 'Partly Cloudy' },
    { type: 'cloudy', cn: '多云', en: 'Cloudy' },
    { type: 'overcast', cn: '阴天', en: 'Overcast' },
    { type: 'light_rain', cn: '小雨', en: 'Light Rain' },
    { type: 'moderate_rain', cn: '中雨', en: 'Moderate Rain' },
    { type: 'heavy_rain', cn: '大雨', en: 'Heavy Rain' },
    { type: 'shower', cn: '阵雨', en: 'Shower' },
    { type: 'thunderstorm', cn: '雷暴', en: 'Thunderstorm' },
    { type: 'foggy', cn: '雾', en: 'Foggy' },
    { type: 'windy', cn: '大风', en: 'Windy' },
    { type: 'humid', cn: '闷热潮湿', en: 'Humid' },
    { type: 'sunny_hot', cn: '晴热', en: 'Sunny & Hot' },
    { type: 'heatwave', cn: '高温热浪', en: 'Heatwave' },
    { type: 'light_snow', cn: '小雪', en: 'Light Snow' },
    { type: 'moderate_snow', cn: '中雪', en: 'Moderate Snow' },
    { type: 'heavy_snow', cn: '大雪', en: 'Heavy Snow' },
    { type: 'sleet', cn: '雨夹雪', en: 'Sleet' },
    { type: 'frost', cn: '霜', en: 'Frost' },
    { type: 'hail', cn: '冰雹', en: 'Hail' },
    { type: 'typhoon', cn: '台风', en: 'Typhoon' },
    { type: 'blizzard', cn: '暴风雪', en: 'Blizzard' },
    { type: 'ice_storm', cn: '冰暴', en: 'Ice Storm' },
    { type: 'sunny_cold', cn: '晴冷', en: 'Sunny & Cold' },
    { type: 'windy_cold', cn: '寒风刺骨', en: 'Biting Wind' },
];

jQuery(() => {
    const context = SillyTavern.getContext();

    const mountPanel = async () => {
        if (panelMounted) return;
        if (!document.getElementById('extensions_settings')) return;

        await loadChineseDays();

        if (!document.getElementById('we-settings-panel')) {
            const panelHtml = buildSettingsHtml();
            $('#extensions_settings').append(panelHtml);
        }

        enhanceSettingsUI();
        bindSettingsEvents();
        loadSettingsToUI();
        ensureFloatingStatusWindow();
        refreshStatusDisplay();
        applyFloatingStatusVisibility();

        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        context.eventSource.on(context.eventTypes.MESSAGE_EDITED, onMessageEdited);
        context.eventSource.on(context.eventTypes.MESSAGE_DELETED, onMessageDeleted);
        context.eventSource.on(context.eventTypes.MESSAGE_SWIPED, onMessageSwiped);
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, onChatChanged);

        context.SlashCommandParser.addCommandObject(
            context.SlashCommand.fromProps({
                name: 'wetime',
                callback: async (_args, value) => {
                    if (!value) return t('common.usageTimeCmd');
                    return await handleTimeCommand(value.trim());
                },
                helpString: t('common.timeCmdHelp'),
            })
        );

        await tryInitFromLatest();
        await updateInjection();
        panelMounted = true;
    };

    context.eventSource.on(context.eventTypes.APP_READY, async () => {
        if (document.getElementById('extensions_settings')) {
            await mountPanel();
        } else {
            const timer = setInterval(async () => {
                if (document.getElementById('extensions_settings')) {
                    clearInterval(timer);
                    await mountPanel();
                }
            }, 200);
        }
    });
});

async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = SillyTavern.getContext();
    const msg = context.chat[messageId];
    if (!msg || msg.is_user) return;

    const extracted = extractFromMessage(msg.mes, settings);

    if (!extracted.time) {
        return;
    }

    const cs = getChatState();
    const oldDateStr = cs.currentTime ? cs.currentTime.split('T')[0] : null;
    const newDateStr = extracted.time.dateStr;

    cs.currentTime = extracted.time.iso;
    if (extracted.location) cs.currentLocation = extracted.location;
    cs.lastParsedMessageId = messageId;

    if (extracted.eraYear) {
        cs.eraYearLabel = extracted.eraYear.label;
        cs.eraYearBase = extracted.eraYear.yearNum;
        cs.eraYearBaseGregorian = extracted.time.year;
    }

    if (settings.weatherEnabled) {
        if (shouldRerollWeather(oldDateStr, newDateStr, cs.weatherState, cs.currentLocation)) {
            cs.weatherState = await getWeatherForDate(
                newDateStr,
                cs.currentLocation,
                settings,
                cs.weatherState
            );
        }
    }

    if (settings.cycleEnabled) {
        updateCycleStates(newDateStr);
    }

    saveSnapshot(messageId);
    saveState();
    refreshStatusDisplay();
    await updateInjection();
}

async function onMessageEdited(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = SillyTavern.getContext();
    const msg = context.chat[messageId];
    if (!msg || msg.is_user) return;

    clearSnapshotsAfter(messageId - 1);

    const extracted = extractFromMessage(msg.mes, settings);
    const cs = getChatState();

    if (extracted.time) {
        const oldDateStr = cs.currentTime ? cs.currentTime.split('T')[0] : null;
        cs.currentTime = extracted.time.iso;
        if (extracted.location) cs.currentLocation = extracted.location;
        cs.lastParsedMessageId = messageId;

        if (extracted.eraYear) {
            cs.eraYearLabel = extracted.eraYear.label;
            cs.eraYearBase = extracted.eraYear.yearNum;
            cs.eraYearBaseGregorian = extracted.time.year;
        }

        if (
            settings.weatherEnabled &&
            shouldRerollWeather(
                oldDateStr,
                extracted.time.dateStr,
                cs.weatherState,
                cs.currentLocation
            )
        ) {
            cs.weatherState = await getWeatherForDate(
                extracted.time.dateStr,
                cs.currentLocation,
                settings,
                cs.weatherState
            );
        }

        saveSnapshot(messageId);
    } else {
        const prevId = findPreviousSnapshotId(messageId);
        if (prevId !== null) restoreSnapshot(prevId);
    }

    saveState();
    refreshStatusDisplay();
    await updateInjection();
}

async function onMessageDeleted(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    clearSnapshotsAfter(messageId - 1);

    if (clearWorldStateIfNoUserMessages()) {
        refreshStatusDisplay();
        await updateInjection();
        return;
    }

    const prevId = findPreviousSnapshotId(messageId);
    if (prevId !== null) {
        restoreSnapshot(prevId);
    }
    saveState();
    refreshStatusDisplay();
    await updateInjection();
}

async function onMessageSwiped(messageId) {
    await onMessageEdited(messageId);
}

async function onChatChanged() {
    loadSettingsToUI();

    if (clearWorldStateIfNoUserMessages()) {
        refreshStatusDisplay();
        await updateInjection();
        return;
    }

    await tryInitFromLatest();
    refreshStatusDisplay();
    await updateInjection();
}

function resetWorldState() {
    const cs = getChatState();
    cs.currentTime = null;
    cs.currentScene = '';
    cs.currentLocation = '';
    cs.snapshots = {};
    cs.weatherState = null;
    cs.cycleStates = {};
    cs.lastParsedMessageId = -1;
    cs.eraYearLabel = '';
    cs.eraYearBase = null;
    cs.eraYearBaseGregorian = null;
    cs.randomBaseYear = null;

    const context = SillyTavern.getContext();
    context.setExtensionPrompt('worldEngine', '', 1, 0);
    saveState();
}

function clearWorldStateIfNoUserMessages() {
    const context = SillyTavern.getContext();
    const hasUser = Array.isArray(context.chat) && context.chat.some((m) => m.is_user);
    if (!hasUser) {
        resetWorldState();
        return true;
    }
    return false;
}

async function tryInitFromLatest() {
    const settings = getSettings();
    const cs = getChatState();

    if (cs.currentTime) return;
    if (!settings.initFromLatest) return;

    const context = SillyTavern.getContext();
    if (!context.chat || context.chat.length === 0) return;

    for (let i = context.chat.length - 1; i >= 0; i--) {
        const msg = context.chat[i];
        if (msg.is_user) continue;

        const extracted = extractFromMessage(msg.mes, settings);
        if (extracted.time) {
            cs.currentTime = extracted.time.iso;
            if (extracted.location) cs.currentLocation = extracted.location;
            cs.lastParsedMessageId = i;

            if (extracted.eraYear) {
                cs.eraYearLabel = extracted.eraYear.label;
                cs.eraYearBase = extracted.eraYear.yearNum;
                cs.eraYearBaseGregorian = extracted.time.year;
            }

            if (settings.weatherEnabled) {
                cs.weatherState = await getWeatherForDate(
                    extracted.time.dateStr,
                    cs.currentLocation,
                    settings,
                    cs.weatherState
                );
            }
            if (settings.cycleEnabled) {
                updateCycleStates(extracted.time.dateStr);
            }

            saveSnapshot(i);
            saveState();
            return;
        }
    }
}

function updateCycleStates(dateStr) {
    const settings = getSettings();
    const cs = getChatState();
    const context = SillyTavern.getContext();
    const ageCfg = getCycleAgeConfig(settings);

    const charDescription = getCharacterDescription();
    const userDescription = getUserDescription();

    const checks = [];
    if (context.name2)
        checks.push({
            name: context.name2,
            text: charDescription,
            rawAge: settings.ageOverrides?.[context.name2],
        });
    if (context.name1)
        checks.push({
            name: context.name1,
            text: userDescription,
            rawAge: settings.ageOverrides?.[context.name1],
        });

    for (const { name, text, rawAge } of checks) {
        const override = settings.genderOverrides?.[name];
        const autoInfo = detectGenderInfo(text);
        const gender = override && override !== 'auto' ? override : autoInfo.gender;

        const ageInput = normalizeAgeValue(rawAge);
        const resolved = resolveAgeForDate(name, ageInput, dateStr, settings, cs.cycleStates[name]);
        const age = resolved.age;

        if (gender === 'female') {
            if (isAgeBlockedForCycle(age, ageCfg)) {
                delete cs.cycleStates[name];
                continue;
            }
            if (!cs.cycleStates[name]) {
                const init = initCycleForCharacter(name, dateStr, age, ageCfg);
                if (init) {
                    if (resolved.auto) init.ageAuto = resolved.auto;
                    cs.cycleStates[name] = init;
                }
            } else {
                cs.cycleStates[name].age = age;
                if (resolved.auto) cs.cycleStates[name].ageAuto = resolved.auto;
                else delete cs.cycleStates[name].ageAuto;
            }
        } else if (cs.cycleStates[name]) {
            delete cs.cycleStates[name];
        }
    }

    if (Array.isArray(settings.manualCharacters)) {
        for (const item of settings.manualCharacters) {
            const name = item.name?.trim();
            const gender = item.gender;
            if (!name) continue;

            const ageInput = normalizeAgeValue(item.age);
            const resolved = resolveAgeForDate(
                name,
                ageInput,
                dateStr,
                settings,
                cs.cycleStates[name]
            );
            const age = resolved.age;

            if (gender === 'female') {
                if (isAgeBlockedForCycle(age, ageCfg)) {
                    delete cs.cycleStates[name];
                    continue;
                }
                if (!cs.cycleStates[name]) {
                    const init = initCycleForCharacter(name, dateStr, age, ageCfg);
                    if (init) {
                        if (resolved.auto) init.ageAuto = resolved.auto;
                        cs.cycleStates[name] = init;
                    }
                } else {
                    cs.cycleStates[name].age = age;
                    if (resolved.auto) cs.cycleStates[name].ageAuto = resolved.auto;
                    else delete cs.cycleStates[name].ageAuto;
                }
            } else if (cs.cycleStates[name]) {
                delete cs.cycleStates[name];
            }
        }
    }
}

function getCycleAgeConfig(settings = getSettings()) {
    const minAge = Number.isInteger(parseInt(settings.cycleMinAge))
        ? parseInt(settings.cycleMinAge)
        : 12;
    const cycleUseMaxAge = settings.cycleUseMaxAge !== false;
    let maxAge = Number.isInteger(parseInt(settings.cycleMaxAge))
        ? parseInt(settings.cycleMaxAge)
        : 55;
    if (maxAge <= minAge) maxAge = minAge + 1;
    return { minAge, useMaxAge: cycleUseMaxAge, maxAge };
}

function isAgeBlockedForCycle(age, ageCfg) {
    if (age === null) return false;
    if (age < ageCfg.minAge) return true;
    if (ageCfg.useMaxAge && age >= ageCfg.maxAge) return true;
    return false;
}

function getCycleAgeHintText() {
    const cfg = getCycleAgeConfig();
    const maxText = cfg.useMaxAge ? `≥${cfg.maxAge}` : t('common.noUpperLimit');
    return t('ui.cycle.ageRangeHint', { min: cfg.minAge, maxText });
}

function updateCycleAgeHintUI() {
    const hintEl = $('#we-cycle-age-hint');
    if (hintEl.length) hintEl.text(getCycleAgeHintText());
    const cfg = getCycleAgeConfig();
    $('#we-cycle-max-age').prop('disabled', !cfg.useMaxAge);
}

function parseBirthDateInput(raw) {
    const s = String(raw || '').trim();
    if (!s) return null;
    const m = s.match(/^(\d{4})[-/.年](\d{1,2})[-/.月](\d{1,2})日?$/);
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const mon = parseInt(m[2], 10);
    const d = parseInt(m[3], 10);
    const dt = new Date(y, mon - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== mon - 1 || dt.getDate() !== d) return null;
    return `${y}-${String(mon).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function parseAgeInput(raw) {
    const s = String(raw ?? '').trim();
    if (!s) return { ok: true, value: null };
    if (/^\d+$/.test(s)) {
        const n = parseInt(s, 10);
        if (n > 0) return { ok: true, value: n };
        return { ok: false, value: null };
    }
    const dob = parseBirthDateInput(s);
    if (dob) return { ok: true, value: dob };
    return { ok: false, value: null };
}

function parseMonthDay(mmdd) {
    const m = String(mmdd || '')
        .trim()
        .match(/^(\d{2})-(\d{2})$/);
    if (!m) return null;
    const month = parseInt(m[1], 10);
    const day = parseInt(m[2], 10);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    return { month, day };
}

function compareDateStr(a, b) {
    if (a === b) return 0;
    return a > b ? 1 : -1; // YYYY-MM-DD 可直接字典序比较
}

function safeBirthdayDate(year, month, day) {
    // 处理 2/29 等非法日期，回退到当月最后一天
    const lastDay = new Date(year, month, 0).getDate();
    const dd = Math.min(day, lastDay);
    return new Date(year, month - 1, dd);
}

function countBirthdayCrossings(startDateStr, endDateStr, month, day) {
    const cmp = compareDateStr(startDateStr, endDateStr);
    if (cmp === 0) return 0;
    if (cmp > 0) return -countBirthdayCrossings(endDateStr, startDateStr, month, day);

    const s = new Date(startDateStr + 'T00:00:00');
    const e = new Date(endDateStr + 'T00:00:00');
    let count = 0;

    for (let y = s.getFullYear(); y <= e.getFullYear(); y++) {
        const bd = safeBirthdayDate(y, month, day);
        if (bd > s && bd <= e) count++;
    }
    return count;
}

function calcAgeFromDob(dobStr, dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    const b = new Date(dobStr + 'T00:00:00');
    if (isNaN(d.getTime()) || isNaN(b.getTime())) return null;
    let age = d.getFullYear() - b.getFullYear();
    const dm = d.getMonth() + 1;
    const dd = d.getDate();
    const bm = b.getMonth() + 1;
    const bd = b.getDate();
    if (dm < bm || (dm === bm && dd < bd)) age -= 1;
    return Math.max(0, age);
}

function getBoundBirthdayForName(name, settings) {
    const events = Array.isArray(settings.events) ? settings.events : [];
    for (const ev of events) {
        if (ev.type !== 'birthday') continue;
        const md = parseMonthDay(ev.date);
        if (!md) continue;

        let matched = false;

        if (Array.isArray(ev.characterIds) && ev.characterIds.length > 0) {
            const names = ev.characterIds.map((id) => getCharacterNameById(id)).filter(Boolean);
            matched = names.includes(name);
        } else if (ev.character) {
            matched = String(ev.character) === String(name);
        }

        if (matched) return md;
    }
    return null;
}

function resolveAgeForDate(name, ageInput, dateStr, settings, existingCycleData) {
    if (ageInput === null || ageInput === undefined || ageInput === '') {
        return { age: null, auto: null };
    }

    // 1) 生日字符串优先
    if (typeof ageInput === 'string') {
        const age = calcAgeFromDob(ageInput, dateStr);
        return {
            age: age === null ? null : age,
            auto: { mode: 'dob', dob: ageInput, input: ageInput },
        };
    }

    // 2/3) 数字年龄：先绑定生日，否则自然年
    if (typeof ageInput === 'number') {
        const birthday = getBoundBirthdayForName(name, settings);
        const mode = birthday ? 'birthday' : 'natural';

        const prev = existingCycleData?.ageAuto;
        const samePrev =
            prev &&
            prev.mode === mode &&
            prev.input === String(ageInput) &&
            (mode !== 'birthday' ||
                (prev.birthdayMonth === birthday.month && prev.birthdayDay === birthday.day));

        const anchorDate = samePrev ? prev.anchorDate : dateStr;
        const baseAge = samePrev ? prev.baseAge : ageInput;

        let delta = 0;
        if (mode === 'birthday') {
            delta = countBirthdayCrossings(anchorDate, dateStr, birthday.month, birthday.day);
        } else {
            delta = parseInt(dateStr.slice(0, 4), 10) - parseInt(anchorDate.slice(0, 4), 10);
        }

        const age = Math.max(0, baseAge + delta);

        return {
            age,
            auto: {
                mode,
                input: String(ageInput),
                baseAge,
                anchorDate,
                birthdayMonth: birthday?.month ?? null,
                birthdayDay: birthday?.day ?? null,
            },
        };
    }

    return { age: null, auto: null };
}

function normalizeAgeValue(v) {
    const parsed = parseAgeInput(v);
    return parsed.ok ? parsed.value : null;
}

function getCharacterDescription() {
    const context = SillyTavern.getContext();
    try {
        if (context.characterId !== undefined && context.characters[context.characterId]) {
            const char = context.characters[context.characterId];
            return [
                char.description,
                char.personality,
                char.scenario,
                char.mes_example,
                char.first_mes,
            ]
                .filter(Boolean)
                .join('\n');
        }
    } catch (_) {}
    return '';
}

function getUserDescription() {
    const context = SillyTavern.getContext();
    try {
        if (context.name1) {
            const persona = context.extensionSettings?.persona?.description || '';
            return persona;
        }
    } catch (_) {}
    return '';
}

async function handleTimeCommand(input) {
    const cs = getChatState();
    const settings = getSettings();

    const jumpMatch = input.match(/^\+(\d+)([dhm])$/i);
    if (jumpMatch) {
        if (!cs.currentTime) return t('common.noWorldTime');
        const val = parseInt(jumpMatch[1]);
        const unit = jumpMatch[2].toLowerCase();
        const d = new Date(cs.currentTime);
        if (unit === 'd') d.setDate(d.getDate() + val);
        else if (unit === 'h') d.setHours(d.getHours() + val);
        else if (unit === 'm') d.setMinutes(d.getMinutes() + val);
        cs.currentTime = d.toISOString().slice(0, 19);

        const dateStr = cs.currentTime.split('T')[0];
        if (settings.weatherEnabled) {
            cs.weatherState = await getWeatherForDate(
                dateStr,
                cs.currentLocation,
                settings,
                cs.weatherState
            );
        }
        saveState();
        refreshStatusDisplay();
        await updateInjection();
        return t('common.timeJumped', { time: cs.currentTime });
    }

    const parsed = parseTimeValue(input);
    if (parsed) {
        cs.currentTime = parsed.iso;
        if (settings.weatherEnabled) {
            cs.weatherState = await getWeatherForDate(
                parsed.dateStr,
                cs.currentLocation,
                settings,
                cs.weatherState
            );
        }
        saveState();
        refreshStatusDisplay();
        await updateInjection();
        return t('common.timeSetCmd', { time: cs.currentTime });
    }

    return t('common.timeParseFail');
}

function buildSettingsHtml() {
    return `
    <div id="we-settings-panel" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>${t('app.name')}</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <div class="we-section">
                    <div class="we-section-header collapsed" data-section="general">
                        <span>${t('ui.sections.general')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body hidden" data-section="general">
                        <div class="we-row">
                            <label>${t('ui.language')}</label>
                            <select id="we-ui-lang">
                                <option value="auto">${t('ui.langAuto')}</option>
                                <option value="zh">${t('ui.langZh')}</option>
                                <option value="en">${t('ui.langEn')}</option>
                            </select>
                        </div>
                        <div class="we-row">
                            <label>${t('ui.general.enabled')}</label>
                            <input type="checkbox" id="we-enabled" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.general.country')}</label>
                            <select id="we-country">
                                <option value="CN">${t('ui.countryOptions.CN')}</option>
                                <option value="US">${t('ui.countryOptions.US')}</option>
                                <option value="JP">${t('ui.countryOptions.JP')}</option>
                                <option value="KR">${t('ui.countryOptions.KR')}</option>
                                <option value="GB">${t('ui.countryOptions.GB')}</option>
                                <option value="DE">${t('ui.countryOptions.DE')}</option>
                                <option value="FR">${t('ui.countryOptions.FR')}</option>
                                <option value="CA">${t('ui.countryOptions.CA')}</option>
                                <option value="AU">${t('ui.countryOptions.AU')}</option>
                                <option value="RU">${t('ui.countryOptions.RU')}</option>
                            </select>
                        </div>
                        <div class="we-row">
                            <label>${t('ui.general.worldEra')}</label>
                            <select id="we-world-era">
                                <option value="modern">${t('ui.general.modern')}</option>
                                <option value="ancient">${t('ui.general.ancient')}</option>
                            </select>
                        </div>
                        <div class="we-row">
                            <label>${t('ui.general.startTime')}</label>
                            <input type="text" id="we-start-time" placeholder="${t('ui.general.startTimePh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.general.initLatest')}</label>
                            <input type="checkbox" id="we-init-latest" />
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header collapsed" data-section="parser">
                        <span>${t('ui.sections.parser')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body hidden" data-section="parser">
                        <div class="we-row">
                            <label>${t('ui.parser.worldTagMode')}</label>
                            <input type="checkbox" id="we-worldtag-mode" />
                        </div>
                        <div class="we-hint">${t('ui.parser.worldTagModeHint')}</div>
                        <div class="we-row">
                            <label>${t('ui.parser.worldTagPrompt')}</label>
                            <input type="checkbox" id="we-worldtag-prompt" />
                        </div>
                        <div class="we-hint">${t('ui.parser.worldTagPromptHint')}</div>
                        <div class="we-row">
                            <label>${t('ui.parser.injectionMode')}</label>
                            <select id="we-injection-mode">
                                <option value="extension">${t('ui.parser.injectionModeExtension')}</option>
                                <option value="macro">${t('ui.parser.injectionModeMacro')}</option>
                            </select>
                        </div>
                        <div class="we-row">
                            <label>${t('ui.parser.macroPlaceholder')}</label>
                            <input type="text" id="we-macro-placeholder" placeholder="${t('ui.parser.macroPlaceholderPh')}" />
                        </div>
                        <div class="we-hint" id="we-macro-preview"></div>
                        <div class="we-row">
                            <label>${t('ui.parser.macroFallback')}</label>
                            <input type="checkbox" id="we-macro-fallback" />
                        </div>
                        <div class="we-hint">${t('ui.parser.macroHint')}</div>
                        <div class="we-row">
                            <label>${t('ui.parser.tagWrapper')}</label>
                            <input type="text" id="we-tag-wrapper" placeholder="${t('ui.parser.tagWrapperPh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.parser.timeKey')}</label>
                            <input type="text" id="we-time-key" placeholder="${t('ui.parser.timeKeyPh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.parser.locationKey')}</label>
                            <input type="text" id="we-location-key" placeholder="${t('ui.parser.locationKeyPh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.parser.regexPreset')}</label>
                            <select id="we-regex-preset" style="width:160px;"></select>
                            <input type="text" id="we-regex-preset-name" placeholder="${t('ui.parser.presetNamePh')}" style="flex:1" />
                            <button class="we-btn" id="we-regex-preset-save">${t('ui.parser.presetSave')}</button>
                            <button class="we-btn we-btn-danger" id="we-regex-preset-delete">${t('ui.parser.presetDelete')}</button>
                        </div>
                        <div class="we-row">
                            <label>${t('ui.parser.timeRegex')}</label>
                            <input type="text" id="we-time-regex" placeholder="${t('ui.parser.timeRegexPh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.parser.locationRegex')}</label>
                            <input type="text" id="we-location-regex" placeholder="${t('ui.parser.locationRegexPh')}" />
                        </div>
                        <div class="we-row">
                            <button class="we-btn" id="we-auto-detect">${t('ui.parser.autoDetect')}</button>
                        </div>
                        <div class="we-hint">${t('ui.parser.autoDetectHint')}</div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header collapsed" data-section="calendar">
                        <span>${t('ui.sections.calendar')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body hidden" data-section="calendar">
                        <div class="we-row">
                            <label>${t('ui.calendar.enable')}</label>
                            <input type="checkbox" id="we-calendar-enabled" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.calendar.eventsEnable')}</label>
                            <input type="checkbox" id="we-events-enabled" />
                        </div>
                        <div class="we-event-list" id="we-event-list"></div>
                        <div class="we-row">
                            <input type="text" id="we-event-name" placeholder="${t('ui.calendar.eventNamePh')}" style="flex:1" />
                            <input type="text" id="we-event-date" placeholder="${t('ui.calendar.eventDatePh')}" style="width:150px" />
                            <select id="we-event-type" style="width:80px">
                                <option value="birthday">${t('ui.calendar.eventTypeBirthday')}</option>
                                <option value="anniversary">${t('ui.calendar.eventTypeAnniversary')}</option>
                                <option value="custom">${t('ui.calendar.eventTypeCustom')}</option>
                            </select>
                            <button class="we-btn" id="we-add-event">${t('ui.calendar.addEvent')}</button>
                        </div>
                        <div class="we-row">
                            <input type="text" id="we-event-char-filter" placeholder="${t('ui.calendar.charFilterPh')}" style="flex:1" />
                            <button class="we-btn" id="we-event-char-select-all">${t('ui.calendar.selectAll')}</button>
                            <button class="we-btn" id="we-event-char-clear">${t('ui.calendar.clear')}</button>
                        </div>
                        <div class="we-row">
                            <select id="we-event-char" multiple class="we-event-char-select"></select>
                        </div>
                        <div class="we-hint">${t('ui.calendar.charHint')}</div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header collapsed" data-section="weather">
                        <span>${t('ui.sections.weather')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body hidden" data-section="weather">
                        <div class="we-row">
                            <label>${t('ui.weather.enable')}</label>
                            <input type="checkbox" id="we-weather-enabled" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.weather.defaultCity')}</label>
                            <input type="text" id="we-default-city" placeholder="${t('ui.weather.defaultCityPh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.weather.ancientMapLabel')}</label>
                            <input type="text" id="we-ancient-from" placeholder="${t('ui.weather.ancientFromPh')}" style="flex:1" />
                            <input type="text" id="we-ancient-to" placeholder="${t('ui.weather.ancientToPh')}" style="flex:1" />
                            <button class="we-btn" id="we-add-ancient-map">${t('ui.weather.addMap')}</button>
                        </div>
                        <div class="we-event-list" id="we-ancient-map-list"></div>
                        <div class="we-row">
                            <label>${t('ui.weather.continuity')}</label>
                            <input type="text" id="we-weather-continuity" placeholder="${t('ui.weather.continuityPh')}" />
                        </div>
                        <div class="we-row">
                            <label>${t('ui.weather.jitter')}</label>
                            <input type="text" id="we-weather-jitter" placeholder="${t('ui.weather.jitterPh')}" />
                        </div>
                        <div class="we-row">
                            <button class="we-btn" id="we-reroll-weather">${t('ui.weather.reroll')}</button>
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header collapsed" data-section="cycle">
                        <span>${t('ui.sections.cycle')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body hidden" data-section="cycle">
                        <div class="we-row">
                            <label>${t('ui.cycle.enable')}</label>
                            <input type="checkbox" id="we-cycle-enabled" />
                        </div>
                        <div class="we-hint">${t('ui.cycle.hint')}</div>
                        <div id="we-gender-list"></div>
                        <div class="we-hint" style="margin-top:6px;">${t('ui.cycle.manualHint')}</div>
                        <div class="we-row">
                            <input type="text" id="we-manual-name" placeholder="${t('ui.cycle.manualNamePh')}" style="flex:1" />
                            <select id="we-manual-gender" style="width:90px;">
                                <option value="female">${t('common.genderFemale')}</option>
                                <option value="male">${t('common.genderMale')}</option>
                                <option value="unknown">${t('common.genderUnknown')}</option>
                            </select>
                            <input type="text" id="we-manual-age" placeholder="${t('ui.cycle.manualAgePh')}" style="width:70px;" />
                            <button class="we-btn" id="we-add-manual">${t('ui.cycle.manualAdd')}</button>
                        </div>
                        <div class="we-hint">${t('ui.cycle.manualAgeHint')}</div>
                        <div id="we-manual-list"></div>
                        <div id="we-cycle-list"></div>
                        <div class="we-row">
                            <button class="we-btn" id="we-rescan-cycle">${t('ui.cycle.rescan')}</button>
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header collapsed" data-section="actions">
                        <span>${t('ui.sections.actions')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body hidden" data-section="actions">
                        <div class="we-row">
                            <button class="we-btn" id="we-reinit-latest">${t('ui.actions.reinit')}</button>
                            <button class="we-btn" id="we-scan-all">${t('ui.actions.scanAll')}</button>
                        </div>
                        <div class="we-row">
                            <button class="we-btn" id="we-test-weather">${t('ui.actions.testWeather')}</button>
                            <button class="we-btn" id="we-test-calendar">${t('ui.actions.testCalendar')}</button>
                        </div>
                        <div class="we-row">
                            <button class="we-btn" id="we-diagnose">${t('ui.actions.diagnose')}</button>
                        </div>
                        <div class="we-row">
                            <button class="we-btn we-btn-danger" id="we-reset-state">${t('ui.actions.reset')}</button>
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="status">
                        <span>${t('ui.sections.status')}</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="status">
                        <div class="we-status-box" id="we-status-display">${t('ui.status.waiting')}</div>
                        <div class="we-row" style="margin-top:6px;">
                            <button class="we-btn" id="we-preview-prompt">${t('ui.status.preview')}</button>
                        </div>
                        <div class="we-status-box hidden" id="we-prompt-preview"></div>
                    </div>
                </div>

            </div>
        </div>
    </div>`;
}

function bindSettingsEvents() {
    $('#we-settings-panel').on('click', '.we-section-header', function () {
        const section = $(this).data('section');
        const body = $(`.we-section-body[data-section="${section}"]`);
        body.toggleClass('hidden');
        $(this).toggleClass('collapsed');
    });

    $('#we-ui-lang').on('change', function () {
        getSettings().uiLanguage = this.value;
        saveState();
        $('#we-settings-panel').remove();
        panelMounted = false;
        location.reload();
    });

    $('#we-enabled').on('change', function () {
        getSettings().enabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-country').on('change', function () {
        getSettings().countryCode = this.value;
        saveState();
        updateInjection();
    });

    $('#we-world-era').on('change', function () {
        getSettings().worldEra = this.value;
        saveState();
        refreshStatusDisplay();
        updateInjection();
    });

    $('#we-start-time').on('change', function () {
        const val = this.value.trim();
        getSettings().customStartTime = val;
        if (val) {
            const parsed = parseTimeValue(val);
            if (parsed) {
                const cs = getChatState();
                cs.currentTime = parsed.iso;
                saveState();
                refreshStatusDisplay();
                updateInjection();
                toastr.success(t('toast.timeSet', { time: parsed.iso }), t('app.name'));
            } else {
                toastr.error(t('toast.timeInvalid'), t('app.name'));
            }
        }
        saveState();
    });

    $('#we-init-latest').on('change', function () {
        getSettings().initFromLatest = this.checked;
        saveState();
    });

    $('#we-worldtag-mode').on('change', function () {
        getSettings().worldTagMode = this.checked;
        saveState();
        updateWorldTagUI();
        updateInjection();
    });

    $('#we-worldtag-prompt').on('change', function () {
        getSettings().worldTagPromptEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-injection-mode').on('change', function () {
        const s = getSettings();
        s.injectionMode = this.value === 'macro' ? 'macro' : 'extension';
        saveState();
        updateInjectionModeUI();
        updateInjection();
    });

    $('#we-macro-placeholder').on('change', function () {
        const s = getSettings();
        const normalized = normalizeMacroPlaceholder(this.value);
        s.macroPlaceholder = normalized;
        $(this).val(normalized);
        saveState();
        updateInjectionModeUI();
        updateInjection();
    });

    $('#we-macro-fallback').on('change', function () {
        const s = getSettings();
        s.macroFallbackToExtension = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-tag-wrapper').on('change', function () {
        getSettings().tagWrapper = this.value.trim();
        saveState();
    });
    $('#we-time-key').on('change', function () {
        getSettings().timeKey = this.value.trim();
        saveState();
    });
    $('#we-location-key').on('change', function () {
        getSettings().locationKey = this.value.trim();
        saveState();
    });
    $('#we-time-regex').on('change', function () {
        getSettings().timeRegexCustom = this.value.trim();
        saveState();
    });
    $('#we-location-regex').on('change', function () {
        getSettings().locationRegexCustom = this.value.trim();
        saveState();
    });
    $('#we-regex-preset').on('change', function () {
        const id = this.value;
        const preset = getRegexPresetById(id);
        if (!preset) return;
        applyRegexPreset(preset);
        const settings = getSettings();
        settings.regexPresetLastId = id;
        saveState();
        updateInjection();
    });

    $('#we-regex-preset-save').on('click', function () {
        const settings = getSettings();
        const presets = Array.isArray(settings.regexPresets) ? settings.regexPresets : [];
        const nameInput = $('#we-regex-preset-name').val().trim();
        const timeRegex = $('#we-time-regex').val().trim();
        const locationRegex = $('#we-location-regex').val().trim();

        let preset = null;
        if (nameInput) {
            preset = presets.find((p) => p.name === nameInput);
        }
        if (!preset) {
            const currentId = $('#we-regex-preset').val();
            preset = presets.find((p) => p.id === currentId) || null;
        }

        if (!preset) {
            preset = {
                id: Date.now().toString(36),
                name: nameInput || `Preset${presets.length + 1}`,
            };
            presets.push(preset);
        }

        preset.name = nameInput || preset.name || `Preset${presets.length}`;
        preset.timeRegex = timeRegex;
        preset.locationRegex = locationRegex;

        settings.regexPresets = presets;
        settings.regexPresetLastId = preset.id;
        saveState();
        renderRegexPresetOptions();
        $('#we-regex-preset').val(preset.id);
        $('#we-regex-preset-name').val('');
        toastr.success(t('toast.presetSaved'), t('app.name'));
    });
    $('#we-regex-preset-delete').on('click', function () {
        const settings = getSettings();
        const id = $('#we-regex-preset').val();
        if (!id) {
            toastr.warning(t('toast.presetNoDelete'), t('app.name'));
            return;
        }

        settings.regexPresets = (settings.regexPresets || []).filter(
            (p) => String(p.id) !== String(id)
        );
        if (settings.regexPresetLastId === id) settings.regexPresetLastId = '';
        saveState();
        renderRegexPresetOptions();
        $('#we-regex-preset-name').val('');
        toastr.success(t('toast.presetDeleted'), t('app.name'));
    });

    $('#we-auto-detect').on('click', function () {
        const context = SillyTavern.getContext();
        if (!context.chat || context.chat.length === 0) {
            toastr.warning(t('toast.noChat'), t('app.name'));
            return;
        }
        let found = false;
        for (let i = context.chat.length - 1; i >= 0; i--) {
            const msg = context.chat[i];
            if (msg.is_user) continue;
            const detected = autoDetectFormat(msg.mes);
            if (detected && detected.fields && detected.fields.length > 0) {
                const settings = getSettings();
                if (detected.tagWrapper) {
                    settings.tagWrapper = detected.tagWrapper;
                    $('#we-tag-wrapper').val(detected.tagWrapper);
                }
                if (detected.timeKey) {
                    settings.timeKey = detected.timeKey;
                    $('#we-time-key').val(detected.timeKey);
                }
                if (detected.locationKey) {
                    settings.locationKey = detected.locationKey;
                    $('#we-location-key').val(detected.locationKey);
                }
                saveState();
                toastr.success(
                    t('toast.detectSuccess', {
                        tag: detected.tagWrapper || t('common.none'),
                        timeKey: detected.timeKey || t('common.none'),
                        locationKey: detected.locationKey || t('common.none'),
                    }),
                    t('app.name'),
                    { timeOut: 5000 }
                );
                found = true;
                break;
            }
        }
        if (!found) {
            toastr.warning(t('toast.detectFail'), t('app.name'));
        }
    });

    $('#we-calendar-enabled').on('change', function () {
        getSettings().calendarEnabled = this.checked;
        saveState();
        updateInjection();
    });
    $('#we-events-enabled').on('change', function () {
        getSettings().eventsEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-add-event').on('click', function () {
        const name = $('#we-event-name').val().trim();
        const dateRaw = $('#we-event-date').val().trim();
        const type = $('#we-event-type').val();
        const characterIds = $('#we-event-char').val() || [];

        if (!name || !dateRaw) {
            toastr.warning(t('toast.eventNeedNameDate'), t('app.name'));
            return;
        }

        let monthDay = '';
        let year = '';
        if (/^\d{2}-\d{2}$/.test(dateRaw)) {
            monthDay = dateRaw;
        } else if (/^\d{4}-\d{2}-\d{2}$/.test(dateRaw)) {
            year = dateRaw.slice(0, 4);
            monthDay = dateRaw.slice(5);
        } else {
            toastr.warning(t('toast.eventDateFormat'), t('app.name'));
            return;
        }

        const settings = getSettings();
        settings.events.push({
            id: Date.now().toString(36),
            name,
            date: monthDay,
            year,
            type,
            characterIds: characterIds.map(String),
        });
        saveState();
        renderEventList();
        $('#we-event-name').val('');
        $('#we-event-date').val('');
        $('#we-event-char').val([]);
        toastr.success(t('toast.eventAdded'), t('app.name'));
        updateInjection();
    });

    $('#we-event-char-filter').on('input', function () {
        filterEventCharacterOptions(this.value);
    });

    $('#we-event-char-select-all').on('click', function () {
        const select = $('#we-event-char');
        select.find('option').each(function () {
            if (!this.hidden) this.selected = true;
        });
        select.trigger('change');
    });

    $('#we-event-char-clear').on('click', function () {
        $('#we-event-char').val([]).trigger('change');
    });

    $('#we-weather-enabled').on('change', function () {
        getSettings().weatherEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-default-city').on('change', function () {
        getSettings().defaultCity = this.value.trim();
        saveState();
    });

    $('#we-add-ancient-map').on('click', function () {
        const from = $('#we-ancient-from').val().trim();
        const to = $('#we-ancient-to').val().trim();
        if (!from || !to) {
            toastr.warning(t('toast.mapNeedBoth'), t('app.name'));
            return;
        }
        const settings = getSettings();
        if (!Array.isArray(settings.ancientLocationMap)) settings.ancientLocationMap = [];
        const existing = settings.ancientLocationMap.find((x) => x.from === from);
        if (existing) {
            existing.to = to;
        } else {
            settings.ancientLocationMap.push({ from, to });
        }
        saveState();
        renderAncientMapList();
        $('#we-ancient-from').val('');
        $('#we-ancient-to').val('');
        updateInjection();
    });

    $('#we-settings-panel').on('click', '.we-del-ancient-map', function () {
        const from = $(this).data('from');
        const settings = getSettings();
        settings.ancientLocationMap = (settings.ancientLocationMap || []).filter(
            (x) => x.from !== from
        );
        saveState();
        renderAncientMapList();
        updateInjection();
    });

    $('#we-weather-continuity').on('change', function () {
        const v = parseInt(this.value);
        getSettings().weatherContinuity = isNaN(v) ? 70 : Math.max(0, Math.min(100, v));
        saveState();
    });

    $('#we-weather-jitter').on('change', function () {
        const v = parseInt(this.value);
        getSettings().weatherTempJitter = isNaN(v) ? 2 : Math.max(0, v);
        saveState();
    });

    $('#we-reroll-weather').on('click', async function () {
        const cs = getChatState();
        if (!cs.currentTime) {
            toastr.warning(t('toast.noWorldTime'), t('app.name'));
            return;
        }
        cs.weatherState = await getWeatherForDate(
            cs.currentTime.split('T')[0],
            cs.currentLocation,
            getSettings(),
            cs.weatherState
        );
        saveState();
        refreshStatusDisplay();
        updateInjection();
        toastr.success(t('toast.weatherUpdated', { weather: cs.weatherState.cn }), t('app.name'));
    });

    $('#we-cycle-enabled').on('change', function () {
        getSettings().cycleEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-add-manual').on('click', function () {
        const name = $('#we-manual-name').val().trim();
        const gender = $('#we-manual-gender').val();
        const ageRaw = $('#we-manual-age').val().trim();
        let age = null;

        if (!name) {
            toastr.warning(t('toast.manualNeedName'), t('app.name'));
            return;
        }

        const parsedAge = parseAgeInput(ageRaw);
        if (!parsedAge.ok) {
            toastr.warning(t('toast.ageInvalid'), t('app.name'));
            return;
        }
        age = parsedAge.value; // 可能是 number、'YYYY-MM-DD' 或 null

        const settings = getSettings();
        if (!Array.isArray(settings.manualCharacters)) settings.manualCharacters = [];
        const existing = settings.manualCharacters.find((x) => x.name === name);
        if (existing) {
            existing.gender = gender;
            existing.age = age;
        } else {
            settings.manualCharacters.push({ name, gender, age });
        }
        saveState();
        renderManualList();
        $('#we-manual-name').val('');
        $('#we-manual-age').val('');
        toastr.success(t('toast.manualAdded'), t('app.name'));
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-rescan-cycle').on('click', function () {
        const cs = getChatState();
        if (!cs.currentTime) {
            toastr.warning(t('toast.noWorldTime'), t('app.name'));
            return;
        }
        cs.cycleStates = {};
        updateCycleStates(cs.currentTime.split('T')[0]);
        saveState();
        refreshStatusDisplay();
        updateInjection();
        toastr.success(t('toast.rescanDone'), t('app.name'));
    });

    $('#we-reinit-latest').on('click', async function () {
        const cs = getChatState();
        cs.currentTime = null;
        cs.currentScene = '';
        cs.currentLocation = '';
        cs.snapshots = {};
        cs.weatherState = null;
        cs.lastParsedMessageId = -1;
        await tryInitFromLatest();
        refreshStatusDisplay();
        await updateInjection();
        if (cs.currentTime) {
            toastr.success(t('toast.initSuccess', { time: cs.currentTime }), t('app.name'));
        } else {
            toastr.warning(t('toast.initFail'), t('app.name'));
        }
    });

    $('#we-scan-all').on('click', async function () {
        const cs = getChatState();
        cs.currentTime = null;
        cs.currentScene = '';
        cs.currentLocation = '';
        cs.snapshots = {};
        cs.weatherState = null;
        cs.lastParsedMessageId = -1;

        const context = SillyTavern.getContext();
        const settings = getSettings();
        let count = 0;

        for (let i = 0; i < context.chat.length; i++) {
            const msg = context.chat[i];
            if (msg.is_user) continue;
            const extracted = extractFromMessage(msg.mes, settings);
            if (extracted.time) {
                cs.currentTime = extracted.time.iso;
                if (extracted.location) cs.currentLocation = extracted.location;
                cs.lastParsedMessageId = i;
                if (extracted.eraYear) {
                    cs.eraYearLabel = extracted.eraYear.label;
                    cs.eraYearBase = extracted.eraYear.yearNum;
                    cs.eraYearBaseGregorian = extracted.time.year;
                }
                saveSnapshot(i);
                count++;
            }
        }

        if (cs.currentTime && settings.weatherEnabled) {
            cs.weatherState = await getWeatherForDate(
                cs.currentTime.split('T')[0],
                cs.currentLocation,
                settings,
                cs.weatherState
            );
        }
        if (cs.currentTime && settings.cycleEnabled) {
            updateCycleStates(cs.currentTime.split('T')[0]);
        }

        saveState();
        refreshStatusDisplay();
        await updateInjection();
        toastr.success(t('toast.scanDone', { count }), t('app.name'));
    });

    $('#we-test-weather').on('click', async function () {
        const settings = getSettings();
        const cs = getChatState();
        const location = (cs.currentLocation || settings.defaultCity || '').trim();
        if (!location) {
            toastr.warning(t('toast.needCity'), t('app.name'));
            return;
        }
        const dateStr = cs.currentTime ? cs.currentTime.split('T')[0] : formatDate(new Date());
        try {
            const w = await getWeatherForDate(dateStr, location, settings, null);
            if (w && w.cn) {
                toastr.success(
                    t('toast.weatherOk', { weather: w.cn, temp: w.temp }),
                    t('app.name')
                );
            } else {
                toastr.error(t('toast.weatherBad'), t('app.name'));
            }
        } catch (e) {
            toastr.error(t('toast.weatherFail'), t('app.name'));
        }
    });

    $('#we-test-calendar').on('click', async function () {
        const settings = getSettings();
        const dateStr = formatDate(new Date());
        try {
            const info = await getHolidayInfo(dateStr, settings.countryCode);
            const name = info.holidayLocalName || info.holidayName || t('common.none');
            toastr.success(
                t('toast.calendarOk', { date: dateStr, type: info.dayType, name }),
                t('app.name')
            );
        } catch (e) {
            toastr.error(t('toast.calendarFail'), t('app.name'));
        }
    });

    $('#we-diagnose').on('click', async function () {
        const modal = openDiagnosticModal();
        try {
            const text = await runDiagnostics((percent, msg) => {
                updateDiagnosticModal(modal, percent, msg);
            });
            await copyToClipboard(text);
            updateDiagnosticModal(modal, 100, t('common.doneCopied'));
            modal.find('.we-diagnose-result').text(text);
        } catch (e) {
            updateDiagnosticModal(modal, 100, t('common.diagFailed', { err: e?.message || e }));
            modal.find('.we-diagnose-result').text(String(e));
        }
    });

    $('#we-reset-state').on('click', async function () {
        if (!confirm(t('toast.resetConfirm'))) return;
        const context = SillyTavern.getContext();
        context.chatMetadata.worldEngine = null;
        getChatState();
        context.setExtensionPrompt('worldEngine', '', 1, 0);
        saveState();
        refreshStatusDisplay();
        toastr.info(t('toast.resetDone'), t('app.name'));
    });

    $('#we-preview-prompt').on('click', async function () {
        const prompt = await buildInjectionPrompt();
        const box = $('#we-prompt-preview');
        box.text(prompt || t('ui.status.noPrompt'));
        box.toggleClass('hidden');
    });

    $('#we-settings-panel').on('change', '.we-gender-select', function () {
        const name = $(this).data('name');
        const value = $(this).val();
        const settings = getSettings();
        if (!settings.genderOverrides) settings.genderOverrides = {};
        settings.genderOverrides[name] = value;
        saveState();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-settings-panel').on('change', '.we-age-input', function () {
        const name = $(this).data('name');
        const val = $(this).val().trim();
        const settings = getSettings();
        if (!settings.ageOverrides) settings.ageOverrides = {};

        if (!val) {
            delete settings.ageOverrides[name];
        } else {
            const parsedAge = parseAgeInput(val);
            if (!parsedAge.ok) {
                toastr.warning(t('toast.ageInvalid'), t('app.name'));
                const oldVal = settings.ageOverrides?.[name];
                $(this).val(oldVal === undefined || oldVal === null ? '' : String(oldVal));
                return;
            }
            settings.ageOverrides[name] = parsedAge.value; // number 或 'YYYY-MM-DD'
        }

        saveState();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-settings-panel').on('click', '.we-del-manual', function () {
        const name = $(this).data('name');
        const settings = getSettings();
        settings.manualCharacters = (settings.manualCharacters || []).filter(
            (x) => x.name !== name
        );
        saveState();
        renderManualList();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-floating-enabled').on('change', function () {
        getSettings().floatingStatusEnabled = this.checked;
        saveState();
        applyFloatingStatusVisibility();
    });

    $('#we-apply-manual-weather').on('click', async function () {
        await applyManualWeatherOverrideForCurrent();
    });

    $('#we-clear-manual-weather').on('click', async function () {
        await clearManualWeatherOverrideForCurrent();
    });

    $('#we-cycle-min-age').on('change', function () {
        const v = parseInt(this.value);
        if (isNaN(v) || v < 0) {
            toastr.warning(t('toast.cycleMinAgeInvalid'), t('app.name'));
            $(this).val(getSettings().cycleMinAge ?? 12);
            return;
        }
        getSettings().cycleMinAge = v;
        saveState();
        updateCycleAgeHintUI();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-cycle-use-max-age').on('change', function () {
        getSettings().cycleUseMaxAge = this.checked;
        saveState();
        updateCycleAgeHintUI();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-cycle-max-age').on('change', function () {
        const s = getSettings();
        const minAge = Number.isInteger(parseInt(s.cycleMinAge)) ? parseInt(s.cycleMinAge) : 12;
        const v = parseInt(this.value);
        if (isNaN(v) || v <= minAge) {
            toastr.warning(t('toast.cycleMaxAgeInvalid'), t('app.name'));
            $(this).val(s.cycleMaxAge ?? 55);
            return;
        }
        s.cycleMaxAge = v;
        saveState();
        updateCycleAgeHintUI();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });
}

function updateWorldTagUI() {
    const enabled = getSettings().worldTagMode;
    const disabled = enabled;
    $('#we-tag-wrapper').prop('disabled', disabled);
    $('#we-time-key').prop('disabled', disabled);
    $('#we-location-key').prop('disabled', disabled);
    $('#we-time-regex').prop('disabled', disabled);
    $('#we-location-regex').prop('disabled', disabled);
    $('#we-regex-preset').prop('disabled', disabled);
    $('#we-regex-preset-name').prop('disabled', disabled);
    $('#we-regex-preset-save').prop('disabled', disabled);
    $('#we-regex-preset-delete').prop('disabled', disabled);
    $('#we-auto-detect').prop('disabled', disabled);
    $('#we-worldtag-prompt').prop('disabled', false);
}

function normalizeMacroPlaceholder(input) {
    const cleaned = String(input || '')
        .trim()
        .replace(/[{}]/g, '')
        .replace(/\s+/g, '_')
        .replace(/[^a-zA-Z0-9_]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_+|_+$/g, '');
    return cleaned || 'world_engine';
}

function updateInjectionModeUI() {
    const s = getSettings();
    const mode = s.injectionMode === 'macro' ? 'macro' : 'extension';
    const macroName = normalizeMacroPlaceholder(s.macroPlaceholder || 'world_engine');
    const placeholder = `{{${macroName}}}`;

    if ($('#we-injection-mode').length) $('#we-injection-mode').val(mode);
    if ($('#we-macro-placeholder').length) $('#we-macro-placeholder').val(macroName);
    if ($('#we-macro-fallback').length)
        $('#we-macro-fallback').prop('checked', !!s.macroFallbackToExtension);

    const isMacro = mode === 'macro';
    $('#we-macro-placeholder').prop('disabled', !isMacro);
    $('#we-macro-fallback').prop('disabled', !isMacro);

    if ($('#we-macro-preview').length) {
        $('#we-macro-preview').text(t('ui.parser.macroPreview', { placeholder }));
    }
}

function loadSettingsToUI() {
    const s = getSettings();
    $('#we-ui-lang').val(s.uiLanguage || 'auto');
    $('#we-enabled').prop('checked', s.enabled);
    $('#we-country').val(s.countryCode);
    $('#we-world-era').val(s.worldEra || 'modern');
    $('#we-start-time').val(s.customStartTime);
    $('#we-init-latest').prop('checked', s.initFromLatest);
    $('#we-worldtag-mode').prop('checked', s.worldTagMode);
    $('#we-worldtag-prompt').prop('checked', s.worldTagPromptEnabled);
    $('#we-injection-mode').val(s.injectionMode || 'extension');
    $('#we-macro-placeholder').val(s.macroPlaceholder || 'world_engine');
    $('#we-macro-fallback').prop('checked', !!s.macroFallbackToExtension);
    $('#we-tag-wrapper').val(s.tagWrapper);
    $('#we-time-key').val(s.timeKey);
    $('#we-location-key').val(s.locationKey);
    $('#we-time-regex').val(s.timeRegexCustom);
    $('#we-location-regex').val(s.locationRegexCustom);
    renderRegexPresetOptions();
    $('#we-calendar-enabled').prop('checked', s.calendarEnabled);
    $('#we-events-enabled').prop('checked', s.eventsEnabled);
    $('#we-weather-enabled').prop('checked', s.weatherEnabled);
    $('#we-default-city').val(s.defaultCity);
    $('#we-weather-continuity').val(s.weatherContinuity);
    $('#we-weather-jitter').val(s.weatherTempJitter);
    $('#we-cycle-enabled').prop('checked', s.cycleEnabled);

    if ($('#we-cycle-min-age').length) $('#we-cycle-min-age').val(s.cycleMinAge ?? 12);
    if ($('#we-cycle-use-max-age').length)
        $('#we-cycle-use-max-age').prop('checked', s.cycleUseMaxAge !== false);
    if ($('#we-cycle-max-age').length) $('#we-cycle-max-age').val(s.cycleMaxAge ?? 55);
    if ($('#we-floating-enabled').length)
        $('#we-floating-enabled').prop('checked', !!s.floatingStatusEnabled);

    updateCycleAgeHintUI();
    renderEventCharacterOptions();
    renderEventList();
    renderAncientMapList();
    renderGenderOverrideList();
    renderManualList();
    renderCycleList();
    updateWorldTagUI();
    updateInjectionModeUI();
    applyFloatingStatusVisibility();
    applyFloatingStatusPosition();
    syncWeatherManualEditorFromState();
}

function renderEventList() {
    const settings = getSettings();
    const container = $('#we-event-list');
    container.empty();

    if (!settings.events || settings.events.length === 0) {
        container.append(`<div class="we-hint">${t('calendar.noEvent')}</div>`);
        return;
    }

    for (const ev of settings.events) {
        const emoji = ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💝' : '📌';
        const yearLabel = ev.year ? `${ev.year}-` : '';
        let bindLabel = '';

        if (Array.isArray(ev.characterIds) && ev.characterIds.length > 0) {
            const names = ev.characterIds.map((id) => getCharacterNameById(id)).filter(Boolean);
            if (names.length > 0)
                bindLabel = `${t('common.bracketL')}${joinList(names)}${t('common.bracketR')}`;
        } else if (ev.character) {
            bindLabel = `${t('common.bracketL')}${ev.character}${t('common.bracketR')}`;
        }

        const item = $(`<div class="we-event-item">
            <span>${emoji} ${yearLabel}${ev.date} ${ev.name}${bindLabel}</span>
            <button class="we-btn we-btn-danger we-del-event" data-id="${ev.id}" style="margin-left:auto;">✕</button>
        </div>`);
        container.append(item);
    }

    container.find('.we-del-event').on('click', function () {
        const id = $(this).data('id');
        settings.events = settings.events.filter((e) => e.id !== String(id));
        saveState();
        renderEventList();
        updateInjection();
    });
}

function renderRegexPresetOptions() {
    const settings = getSettings();
    const select = $('#we-regex-preset');
    const delBtn = $('#we-regex-preset-delete');
    select.empty();

    const presets = Array.isArray(settings.regexPresets) ? settings.regexPresets : [];
    if (presets.length === 0) {
        select.append(`<option value="">${t('common.noPreset')}</option>`);
        select.prop('disabled', true);
        delBtn.prop('disabled', true);
        settings.regexPresetLastId = '';
        saveState();
        return;
    }

    select.prop('disabled', false);
    delBtn.prop('disabled', false);

    for (const p of presets) {
        select.append(`<option value="${p.id}">${p.name || p.id}</option>`);
    }

    if (settings.regexPresetLastId) {
        select.val(settings.regexPresetLastId);
    }
}

function getRegexPresetById(id) {
    const settings = getSettings();
    const presets = Array.isArray(settings.regexPresets) ? settings.regexPresets : [];
    return presets.find((p) => String(p.id) === String(id)) || null;
}

function applyRegexPreset(preset) {
    const settings = getSettings();
    const tval = preset.timeRegex || '';
    const lval = preset.locationRegex || '';
    settings.timeRegexCustom = tval;
    settings.locationRegexCustom = lval;
    $('#we-time-regex').val(tval);
    $('#we-location-regex').val(lval);
    saveState();
}

function renderEventCharacterOptions() {
    const select = $('#we-event-char');
    const filter = $('#we-event-char-filter');
    const btnAll = $('#we-event-char-select-all');
    const btnClear = $('#we-event-char-clear');

    select.empty();

    const context = SillyTavern.getContext();
    const chars = context.characters || [];
    if (chars.length === 0) {
        select.append(`<option value="">${t('calendar.noCard')}</option>`);
        select.prop('disabled', true);
        filter.prop('disabled', true);
        btnAll.prop('disabled', true);
        btnClear.prop('disabled', true);
        return;
    }

    select.prop('disabled', false);
    filter.prop('disabled', false);
    btnAll.prop('disabled', false);
    btnClear.prop('disabled', false);

    for (let i = 0; i < chars.length; i++) {
        const c = chars[i];
        if (!c) continue;
        const name = c.name || c?.data?.name || c?.char_name || `角色${i}`;
        select.append(`<option value="${i}">${name}</option>`);
    }

    filterEventCharacterOptions(filter.val() || '');
}

function filterEventCharacterOptions(keyword) {
    const kw = (keyword || '').trim().toLowerCase();
    $('#we-event-char')
        .find('option')
        .each(function () {
            const text = $(this).text().toLowerCase();
            const show = !kw || text.includes(kw);
            $(this).prop('hidden', !show);
        });
}

function getCharacterNameById(id) {
    const context = SillyTavern.getContext();
    const c = context.characters?.[Number(id)];
    return c?.name || c?.data?.name || c?.char_name || '';
}

function renderAncientMapList() {
    const settings = getSettings();
    const container = $('#we-ancient-map-list');
    container.empty();

    const list = Array.isArray(settings.ancientLocationMap) ? settings.ancientLocationMap : [];
    if (list.length === 0) {
        container.append(`<div class="we-hint">${t('calendar.noMap')}</div>`);
        return;
    }

    for (const item of list) {
        const line = $(`<div class="we-event-item">
            <span>🏮 ${item.from} → ${item.to}</span>
            <button class="we-btn we-btn-danger we-del-ancient-map" data-from="${item.from}" style="margin-left:auto;">✕</button>
        </div>`);
        container.append(line);
    }
}

function renderGenderOverrideList() {
    const container = $('#we-gender-list');
    container.empty();

    const context = SillyTavern.getContext();
    const settings = getSettings();
    const charDescription = getCharacterDescription();
    const userDescription = getUserDescription();

    const checks = [];
    if (context.name2) checks.push({ name: context.name2, text: charDescription });
    if (context.name1) checks.push({ name: context.name1, text: userDescription });

    if (checks.length === 0) {
        container.append(`<div class="we-hint">${t('calendar.noChar')}</div>`);
        return;
    }

    for (const { name, text } of checks) {
        const info = detectGenderInfo(text);
        const override = settings.genderOverrides?.[name] || 'auto';
        const ageVal = settings.ageOverrides?.[name] ?? '';
        const genderLabel = getGenderLabel(info.gender);
        const detectText = t('ui.cycle.autoDetectInfo', {
            gender: genderLabel,
            female: info.femaleCount,
            male: info.maleCount,
        });
        const line = $(`
            <div class="we-row" style="margin-bottom:4px;">
                <label>${name}</label>
                <span style="font-size:12px;">${detectText}</span>
                <select class="we-gender-select" data-name="${name}" style="width:100px;">
                    <option value="auto">${t('common.genderAuto')}</option>
                    <option value="female">${t('common.genderFemale')}</option>
                    <option value="male">${t('common.genderMale')}</option>
                    <option value="unknown">${t('common.genderUnknown')}</option>
                </select>
                <input type="text" class="we-age-input" data-name="${name}" placeholder="${t('common.ageLabel')}" style="width:70px;" />
            </div>
        `);
        line.find('select').val(override);
        line.find('.we-age-input').val(ageVal);
        container.append(line);
    }
}

function renderManualList() {
    const settings = getSettings();
    const container = $('#we-manual-list');
    container.empty();

    if (!settings.manualCharacters || settings.manualCharacters.length === 0) {
        container.append(`<div class="we-hint">${t('calendar.noManual')}</div>`);
        return;
    }

    for (const item of settings.manualCharacters) {
        const ageText = item.age ? t('common.ageText', { age: item.age }) : '';
        const line = $(`<div class="we-row" style="margin-bottom:4px;">
            <span style="font-size:12px;">${item.name}${t('common.bracketL')}${getGenderLabel(item.gender)}${ageText}${t('common.bracketR')}</span>
            <button class="we-btn we-btn-danger we-del-manual" data-name="${item.name}" style="margin-left:auto;">✕</button>
        </div>`);
        container.append(line);
    }
}

function renderCycleList() {
    const cs = getChatState();
    const container = $('#we-cycle-list');
    container.empty();

    if (!cs.currentTime) {
        container.append(`<div class="we-hint">${t('calendar.noCycleTime')}</div>`);
        return;
    }

    const dateStr = cs.currentTime.split('T')[0];

    for (const [name, data] of Object.entries(cs.cycleStates)) {
        const status = getCycleStatus(data, dateStr);
        const agePart = data.age ? t('common.cycleAge', { age: data.age }) : '';
        const text = status
            ? t('common.cycleLine', {
                  name,
                  desc: status.description,
                  cycle: data.cycleLength,
                  period: data.periodDuration,
                  age: agePart,
              })
            : `${name}: ${t('common.cycleError')}`;
        container.append(`<div class="we-hint" style="margin:3px 0;">🩸 ${text}</div>`);
    }

    if (Object.keys(cs.cycleStates).length === 0) {
        container.append(`<div class="we-hint">${t('calendar.noCycle')}</div>`);
    }
}

function refreshStatusDisplay() {
    const cs = getChatState();
    const settings = getSettings();
    let lines = [];

    if (!settings.enabled) {
        lines.push(t('status.disabled'));
    } else if (!cs.currentTime) {
        lines.push(t('status.noTime'));
        lines.push(t('status.noTimeHint'));
    } else {
        lines.push(t('status.time', { time: cs.currentTime }));
        if (cs.currentLocation) lines.push(t('status.location', { location: cs.currentLocation }));
        if (cs.weatherState) {
            const src = cs.weatherState.source ? `(${cs.weatherState.source})` : '';
            const extreme = cs.weatherState.extreme ? t('common.extreme') : '';
            const displayTemp = getHourlyTemperature(
                cs.weatherState,
                cs.currentTime,
                cs.currentLocation
            );
            lines.push(
                t('status.weather', {
                    weather: cs.weatherState.cn,
                    temp: displayTemp,
                    src,
                    extreme,
                })
            );
        }
        lines.push(t('status.region', { region: settings.countryCode }));
        lines.push(
            t('status.era', {
                era:
                    settings.worldEra === 'ancient'
                        ? t('ui.general.ancient')
                        : t('ui.general.modern'),
            })
        );
        lines.push(t('status.snapshots', { count: Object.keys(cs.snapshots).length }));

        const cycleEntries = Object.entries(cs.cycleStates || {});
        if (cycleEntries.length > 0) {
            lines.push(t('status.cycleTitle', { count: cycleEntries.length }));
            const dateStr = cs.currentTime.split('T')[0];
            for (const [name, data] of cycleEntries) {
                lines.push(buildStatusCycleLine(name, data, dateStr));
            }
        }
    }

    const statusText = lines.join('\n');
    $('#we-status-display').text(statusText);
    $('#we-floating-status-display').text(statusText);
    renderGenderOverrideList();
    renderManualList();
    renderCycleList();
    syncWeatherManualEditorFromState();
}

function enhanceSettingsUI() {
    if (!$('#we-settings-panel').length) return;

    if (!$('#we-weather-manual-type').length) {
        const weatherBody = $('.we-section-body[data-section="weather"]');
        const typeOptions = WEATHER_TYPE_OPTIONS.map(
            (x) => `<option value="${x.type}">${x.cn} / ${x.en}</option>`
        ).join('');
        weatherBody.append(`
            <div class="we-hint" id="we-weather-manual-hint">${t('ui.weather.manualHint')}</div>
            <div class="we-row">
                <label>${t('ui.weather.manualType')}</label>
                <select id="we-weather-manual-type">${typeOptions}</select>
            </div>
            <div class="we-row">
                <label>${t('ui.weather.manualTemp')}</label>
                <input type="text" id="we-weather-manual-temp" placeholder="${t('ui.weather.manualTempPh')}" style="width:90px;" />
                <label style="min-width:auto;">${t('ui.weather.manualExtreme')}</label>
                <input type="checkbox" id="we-weather-manual-extreme" />
            </div>
            <div class="we-row">
                <button class="we-btn" id="we-apply-manual-weather">${t('ui.weather.manualApply')}</button>
                <button class="we-btn we-btn-danger" id="we-clear-manual-weather">${t('ui.weather.manualClear')}</button>
            </div>
        `);
    }

    if (!$('#we-cycle-min-age').length) {
        const cycleBody = $('.we-section-body[data-section="cycle"]');
        const firstHint = cycleBody.find('.we-hint').first();
        firstHint.after(`
            <div class="we-row">
                <label>${t('ui.cycle.minAge')}</label>
                <input type="text" id="we-cycle-min-age" style="width:70px;" />
                <label style="min-width:auto;">${t('ui.cycle.useMaxAge')}</label>
                <input type="checkbox" id="we-cycle-use-max-age" />
                <label style="min-width:auto;">${t('ui.cycle.maxAge')}</label>
                <input type="text" id="we-cycle-max-age" style="width:70px;" />
            </div>
            <div class="we-hint" id="we-cycle-age-hint"></div>
        `);
    }

    if (!$('#we-floating-enabled').length) {
        const statusBody = $('.we-section-body[data-section="status"]');
        statusBody.prepend(`
            <div class="we-row">
                <label>${t('ui.status.floatingEnable')}</label>
                <input type="checkbox" id="we-floating-enabled" />
            </div>
        `);
    }
}

function getWeatherTypeMeta(type) {
    return WEATHER_TYPE_OPTIONS.find((x) => x.type === type) || WEATHER_TYPE_OPTIONS[0];
}

async function applyManualWeatherOverrideForCurrent() {
    const cs = getChatState();
    const settings = getSettings();
    if (!cs.currentTime) {
        toastr.warning(t('toast.noWorldTime'), t('app.name'));
        return;
    }

    const dateStr = cs.currentTime.split('T')[0];
    const type = $('#we-weather-manual-type').val() || 'sunny';
    const meta = getWeatherTypeMeta(type);
    const rawTemp = $('#we-weather-manual-temp').val().trim();
    let temp = parseInt(rawTemp);
    if (isNaN(temp)) {
        temp = typeof cs.weatherState?.temp === 'number' ? cs.weatherState.temp : 20;
    }
    const extreme = $('#we-weather-manual-extreme').prop('checked') === true;

    if (!settings.weatherOverrides) settings.weatherOverrides = {};
    const key = buildWeatherOverrideKey(dateStr, cs.currentLocation, settings);
    settings.weatherOverrides[key] = {
        type,
        cn: meta.cn,
        en: meta.en,
        temp,
        extreme,
    };

    cs.weatherState = await getWeatherForDate(dateStr, cs.currentLocation, settings, null);
    saveState();
    refreshStatusDisplay();
    await updateInjection();
    toastr.success(t('toast.weatherManualApplied', { weather: cs.weatherState.cn }), t('app.name'));
}

async function clearManualWeatherOverrideForCurrent() {
    const cs = getChatState();
    const settings = getSettings();
    if (!cs.currentTime) {
        toastr.warning(t('toast.noWorldTime'), t('app.name'));
        return;
    }

    const dateStr = cs.currentTime.split('T')[0];
    const key = buildWeatherOverrideKey(dateStr, cs.currentLocation, settings);
    if (settings.weatherOverrides && settings.weatherOverrides[key]) {
        delete settings.weatherOverrides[key];
    }

    cs.weatherState = await getWeatherForDate(dateStr, cs.currentLocation, settings, null);
    saveState();
    refreshStatusDisplay();
    await updateInjection();
    toastr.success(t('toast.weatherManualCleared'), t('app.name'));
}

function syncWeatherManualEditorFromState() {
    const cs = getChatState();
    if (!$('#we-weather-manual-type').length) return;
    if (!cs.weatherState) return;
    $('#we-weather-manual-type').val(cs.weatherState.type || 'sunny');
    $('#we-weather-manual-temp').val(
        typeof cs.weatherState.temp === 'number' ? String(cs.weatherState.temp) : ''
    );
    $('#we-weather-manual-extreme').prop('checked', !!cs.weatherState.extreme);
}

function ensureFloatingStatusWindow() {
    if ($('#we-floating-status').length) return;
    $('body').append(`
        <div id="we-floating-status" class="we-floating-status hidden">
            <div id="we-floating-status-header" class="we-floating-status-header">
                <span>${t('ui.sections.status')}</span>
                <div class="we-floating-status-actions">
                    <button id="we-floating-status-drag-handle" class="we-floating-status-drag-handle">⠿</button>
                    <button id="we-floating-status-close" class="we-floating-status-close">×</button>
                </div>
            </div>
            <pre id="we-floating-status-display" class="we-floating-status-display"></pre>
        </div>
    `);

    $('#we-floating-status-close').on('click', function () {
        const s = getSettings();
        s.floatingStatusEnabled = false;
        $('#we-floating-enabled').prop('checked', false);
        saveState();
        applyFloatingStatusVisibility();
    });

    const box = $('#we-floating-status');
    const dragHandle = $('#we-floating-status-drag-handle');

    let dragging = false;
    let pointerId = null;
    let startX = 0;
    let startY = 0;
    let baseLeft = 0;
    let baseTop = 0;

    dragHandle.on('pointerdown', function (e) {
        if (e.button !== undefined && e.button !== 0) return;

        dragging = true;
        pointerId = e.pointerId;
        startX = e.clientX;
        startY = e.clientY;
        baseLeft = parseFloat(box.css('left')) || 0;
        baseTop = parseFloat(box.css('top')) || 0;

        const el = dragHandle.get(0);
        if (el && el.setPointerCapture) {
            el.setPointerCapture(pointerId);
        }

        e.preventDefault();
    });

    dragHandle.on('pointermove', function (e) {
        if (!dragging || e.pointerId !== pointerId) return;

        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        let left = baseLeft + dx;
        let top = baseTop + dy;

        const maxX = Math.max(0, window.innerWidth - box.outerWidth() - 8);
        const maxY = Math.max(0, window.innerHeight - box.outerHeight() - 8);

        left = Math.max(0, Math.min(maxX, left));
        top = Math.max(0, Math.min(maxY, top));

        box.css({ left: `${Math.round(left)}px`, top: `${Math.round(top)}px` });
        e.preventDefault();
    });

    function stopDrag(e) {
        if (!dragging) return;
        if (e && e.pointerId !== undefined && e.pointerId !== pointerId) return;

        dragging = false;
        const s = getSettings();
        const left = parseFloat(box.css('left')) || 0;
        const top = parseFloat(box.css('top')) || 0;
        s.floatingStatusPos = { x: Math.round(left), y: Math.round(top) };
        saveState();

        if (pointerId !== null) {
            const el = dragHandle.get(0);
            if (el && el.releasePointerCapture) {
                try {
                    el.releasePointerCapture(pointerId);
                } catch (_) {}
            }
        }
        pointerId = null;
    }

    dragHandle.on('pointerup', stopDrag);
    dragHandle.on('pointercancel', stopDrag);
    dragHandle.on('lostpointercapture', stopDrag);

    $(window).on('resize.weFloating', function () {
        applyFloatingStatusPosition();
    });
}

function applyFloatingStatusPosition() {
    const s = getSettings();
    const box = $('#we-floating-status');
    if (!box.length) return;

    let x = Number.isInteger(parseInt(s.floatingStatusPos?.x))
        ? parseInt(s.floatingStatusPos.x)
        : 20;
    let y = Number.isInteger(parseInt(s.floatingStatusPos?.y))
        ? parseInt(s.floatingStatusPos.y)
        : 120;

    const maxX = Math.max(0, window.innerWidth - box.outerWidth() - 8);
    const maxY = Math.max(0, window.innerHeight - box.outerHeight() - 8);

    x = Math.max(0, Math.min(maxX, x));
    y = Math.max(0, Math.min(maxY, y));

    box.css({ left: `${x}px`, top: `${y}px` });
}

function applyFloatingStatusVisibility() {
    const s = getSettings();
    const box = $('#we-floating-status');
    if (!box.length) return;
    if (s.floatingStatusEnabled) box.removeClass('hidden');
    else box.addClass('hidden');
    applyFloatingStatusPosition();
}

function getLatestAiMessage() {
    const context = SillyTavern.getContext();
    if (!Array.isArray(context.chat) || context.chat.length === 0) return null;
    for (let i = context.chat.length - 1; i >= 0; i--) {
        const msg = context.chat[i];
        if (msg && !msg.is_user) {
            return { id: i, mes: msg.mes || '' };
        }
    }
    return null;
}

function truncateForDiag(text, maxLen = 240) {
    const s = String(text || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (s.length <= maxLen) return s;
    return s.slice(-maxLen);
}

function escapeRegexDiag(str) {
    return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function cleanDiagFieldValue(raw) {
    let s = String(raw || '').trim();
    s = s.replace(/^\s*[|｜;；]+\s*/, '');
    s = s.replace(/\s*(\[\[\s*\/\s*WORLD\s*\]\]|\[\[\\\/WORLD\]\]|<\s*\/\s*WORLD\s*>)+\s*$/gi, '');
    s = s.replace(/\s*[|｜;；]+\s*$/g, '');
    return s.trim();
}

function pickCaptureGroupDiag(m) {
    if (!m || m.length <= 1) return m && m[1] ? m[1] : null;
    for (let i = m.length - 1; i >= 1; i--) {
        if (m[i] !== undefined && m[i] !== null && String(m[i]).trim() !== '') {
            return m[i];
        }
    }
    return m[1] || null;
}

function tryMatchRegex(text, regexStr) {
    if (!regexStr) return { hit: false, value: '', error: '' };
    try {
        const re = new RegExp(regexStr);
        const m = text.match(re);
        if (m) {
            const g = pickCaptureGroupDiag(m);
            return { hit: true, value: (g || m[0]).trim(), error: '' };
        }
        return { hit: false, value: '', error: '' };
    } catch (e) {
        return { hit: false, value: '', error: e?.message || String(e) };
    }
}

function tryMatchKey(text, key) {
    if (!key) return { hit: false, value: '' };
    try {
        const re = new RegExp(
            escapeRegexDiag(key) +
                '\\s*[:=：]\\s*([\\s\\S]*?)(?=\\s*(?:\\||｜|;|；|\\n|\\r|\\[\\[\\s*\\/\\s*WORLD\\s*\\]\\]|<\\s*\\/\\s*WORLD\\s*>|$))',
            'im'
        );
        const m = text.match(re);
        if (m) {
            return { hit: true, value: cleanDiagFieldValue(String(m[1] || '')) };
        }
    } catch (_) {}
    return { hit: false, value: '' };
}

function buildParseDiagnostics(settings) {
    const lines = [];
    const latest = getLatestAiMessage();
    if (!latest) {
        lines.push(t('diag.parseNoAi'));
        return lines;
    }

    const text = String(latest.mes || '');
    const snippet = truncateForDiag(text, 240);

    const worldTagMatch =
        text.match(/\[\[WORLD\]\][\s\S]*?\[\[\/WORLD\]\]/i) ||
        text.match(/<WORLD>[\s\S]*?<\/WORLD>/i);

    let wrapperVal = t('common.notSet');
    const wrapperLabel = settings.tagWrapper ? settings.tagWrapper : t('common.notSet');
    if (settings.tagWrapper) {
        const wr = new RegExp(
            `<${escapeRegexDiag(settings.tagWrapper)}>[\\s\\S]*?<\\/${escapeRegexDiag(settings.tagWrapper)}>`,
            'i'
        );
        wrapperVal = wr.test(text) ? t('diag.ok') : t('diag.fail');
    }

    const timeRegex = tryMatchRegex(text, settings.timeRegexCustom);
    const locRegex = tryMatchRegex(text, settings.locationRegexCustom);

    let timeRegexVal = t('common.notSet');
    if (settings.timeRegexCustom) {
        timeRegexVal = timeRegex.error
            ? t('diag.parseRegexError', { err: timeRegex.error })
            : timeRegex.hit
              ? timeRegex.value
              : t('common.none');
    }

    let locRegexVal = t('common.notSet');
    if (settings.locationRegexCustom) {
        locRegexVal = locRegex.error
            ? t('diag.parseRegexError', { err: locRegex.error })
            : locRegex.hit
              ? locRegex.value
              : t('common.none');
    }

    const timeKey = tryMatchKey(text, settings.timeKey);
    const locKey = tryMatchKey(text, settings.locationKey);

    const extracted = extractFromMessage(text, settings);
    const timeVal = extracted.time ? extracted.time.iso : t('common.none');
    const locVal = extracted.location || t('common.none');

    let reason = '';
    if (extracted.time) {
        reason = t('diag.parseReasonOk');
    } else if (settings.worldTagMode && !worldTagMatch) {
        reason = t('diag.parseReasonWorld');
    } else if (extracted.rawTime && !extracted.time) {
        reason = t('diag.parseReasonTimeFail');
    } else {
        reason = t('diag.parseReasonNoTime');
    }

    lines.push(t('diag.parseLatest', { id: latest.id }));
    lines.push(t('diag.parseSnippet', { text: snippet || t('common.none') }));
    lines.push(t('diag.parseWorldTag', { val: worldTagMatch ? t('diag.ok') : t('diag.fail') }));
    lines.push(t('diag.parseTagWrapper', { name: wrapperLabel, val: wrapperVal }));
    lines.push(t('diag.parseTimeRegex', { val: timeRegexVal }));
    lines.push(t('diag.parseLocationRegex', { val: locRegexVal }));
    lines.push(t('diag.parseTimeKey', { val: timeKey.hit ? timeKey.value : t('common.none') }));
    lines.push(t('diag.parseLocationKey', { val: locKey.hit ? locKey.value : t('common.none') }));
    lines.push(t('diag.parseResultTime', { val: timeVal }));
    lines.push(t('diag.parseResultLoc', { val: locVal }));
    lines.push(t('diag.parseReason', { val: reason }));

    return lines;
}

async function runDiagnostics(onProgress) {
    const settings = getSettings();
    const cs = getChatState();
    const now = new Date();
    const dateStr = formatDate(now);

    const lines = [];
    const update = (percent, msg) => {
        if (onProgress) onProgress(percent, msg);
        return new Promise((resolve) => setTimeout(resolve, 80));
    };

    await update(5, t('diag.progressBase'));
    lines.push(t('diag.title'));
    lines.push(t('diag.time', { time: now.toISOString() }));
    lines.push(t('diag.version', { version: '1.8.0' }));

    await update(15, t('diag.progressSettings'));
    lines.push('\n' + t('diag.settings'));
    lines.push(t('diag.enabled', { val: settings.enabled ? t('diag.ok') : t('diag.fail') }));
    lines.push(
        t('diag.parseMode', {
            val: settings.worldTagMode ? t('common.parseModeWorldTag') : t('common.parseModeField'),
        })
    );
    lines.push(t('diag.country', { val: settings.countryCode }));
    lines.push(
        t('diag.era', {
            val: settings.worldEra === 'ancient' ? t('ui.general.ancient') : t('ui.general.modern'),
        })
    );
    lines.push(t('diag.weather', { val: settings.weatherEnabled ? t('diag.ok') : t('diag.fail') }));
    lines.push(
        t('diag.calendar', { val: settings.calendarEnabled ? t('diag.ok') : t('diag.fail') })
    );
    lines.push(t('diag.cycle', { val: settings.cycleEnabled ? t('diag.ok') : t('diag.fail') }));
    lines.push(t('diag.defaultCity', { val: settings.defaultCity || t('common.notSet') }));
    lines.push(t('diag.network', { val: navigator.onLine ? t('diag.online') : t('diag.offline') }));

    await update(30, t('diag.progressState'));
    lines.push('\n' + t('diag.state'));
    lines.push(t('diag.stateTime', { val: cs.currentTime || t('common.notInit') }));
    lines.push(t('diag.stateLoc', { val: cs.currentLocation || t('common.unknown') }));
    if (cs.weatherState) {
        lines.push(
            t('diag.stateWeather', { val: `${cs.weatherState.cn} ${cs.weatherState.temp}°C` })
        );
    } else {
        lines.push(t('diag.stateWeather', { val: t('common.none') }));
    }
    lines.push(t('diag.stateCycle', { val: Object.keys(cs.cycleStates || {}).length }));
    lines.push(t('diag.stateSnap', { val: Object.keys(cs.snapshots || {}).length }));

    await update(40, t('diag.progressParse'));
    lines.push('\n' + t('diag.parse'));
    lines.push(...buildParseDiagnostics(settings));

    await update(55, t('diag.progressCalendar'));
    lines.push('\n' + t('diag.api'));
    await loadChineseDays();
    lines.push(t('diag.chineseDays', { val: window.chineseDays ? t('diag.ok') : t('diag.fail') }));

    let calendarResult = t('common.notTested');
    try {
        const info = await getHolidayInfo(dateStr, settings.countryCode);
        calendarResult = `${t('diag.ok')} (${info.dayType}, ${info.holidayLocalName || t('common.none')})`;
    } catch (e) {
        calendarResult = `${t('diag.fail')} (${e?.message || e})`;
    }
    lines.push(t('diag.calendarApi', { val: calendarResult }));

    await update(80, t('diag.progressWeather'));
    let weatherResult = t('common.notTested');
    if (!settings.weatherEnabled) {
        weatherResult = t('common.disabled');
    } else {
        const loc = cs.currentLocation || settings.defaultCity;
        if (!loc) {
            weatherResult = t('common.skipNoLocation');
        } else {
            try {
                const w = await getWeatherForDate(dateStr, loc, settings, null);
                weatherResult = w
                    ? `${t('diag.ok')} (${w.cn} ${w.temp}°C)`
                    : `${t('diag.fail')} (${t('common.none')})`;
            } catch (e) {
                weatherResult = `${t('diag.fail')} (${e?.message || e})`;
            }
        }
    }
    lines.push(t('diag.weatherApi', { val: weatherResult }));

    await update(100, t('diag.progressDone'));
    lines.push('\n' + t('diag.end'));
    return lines.join('\n');
}

async function copyToClipboard(text) {
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }
    } catch (_) {}
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    try {
        document.execCommand('copy');
    } catch (_) {}
    document.body.removeChild(textarea);
}

function openDiagnosticModal() {
    let modal = $('#we-diagnose-modal');
    if (!modal.length) {
        const html = `
        <div id="we-diagnose-modal" class="we-modal">
            <div class="we-modal-content">
                <div class="we-modal-header">
                    <span>${t('app.diagnoseTitle')}</span>
                    <button class="we-modal-close">×</button>
                </div>
                <div class="we-modal-body">
                    <div class="we-diagnose-progress-area">
                        <div class="we-progress-text">${t('common.preparing')}</div>
                        <div class="we-progress"><div class="we-progress-bar"></div></div>
                    </div>
                    <div class="we-diagnose-result-area">
                        <pre class="we-diagnose-result"></pre>
                        <button class="we-diagnose-copy-btn">${t('common.copy')}</button>
                    </div>
                </div>
            </div>
        </div>`;
        $('body').append(html);
        modal = $('#we-diagnose-modal');
        modal.on('click', '.we-modal-close', closeDiagnosticModal);
        modal.on('click', (e) => {
            if (e.target.id === 'we-diagnose-modal') closeDiagnosticModal();
        });
        modal.on('click', '.we-diagnose-copy-btn', async function () {
            const text = modal.find('.we-diagnose-result').text();
            const btn = $(this);
            if (text) {
                await copyToClipboard(text);
                btn.text(t('common.copied'));
                setTimeout(() => btn.text(t('common.copy')), 1500);
            }
        });
    }

    modal.find('.we-diagnose-result').text('');
    updateDiagnosticModal(modal, 0, t('common.preparing'));
    modal.removeClass('hidden').addClass('visible');
    return modal;
}

function closeDiagnosticModal() {
    const modal = $('#we-diagnose-modal');
    modal.removeClass('visible').addClass('hidden');
    const oldInterval = modal.data('progress-interval');
    if (oldInterval) clearInterval(oldInterval);
}

function updateDiagnosticModal(modal, percent, msg) {
    modal.find('.we-progress-bar').css('width', `${percent}%`);
    modal.find('.we-progress-text').text(msg || '');
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

function buildStatusCycleLine(name, cycleData, dateStr) {
    const status = getCycleStatus(cycleData, dateStr);
    const phaseText = status?.description || t('common.unknown');
    const day = Number.isInteger(status?.dayInCycle) ? status.dayInCycle + 1 : 0;
    const next = getNextCycleDate(cycleData);
    return t('status.cycleItem', {
        name,
        phase: phaseText,
        day,
        next: next || t('common.none'),
    });
}

function getNextCycleDate(cycleData) {
    if (!cycleData?.lastPeriodStart) return '';
    const base = new Date(cycleData.lastPeriodStart + 'T00:00:00');
    if (isNaN(base.getTime())) return '';
    const cycleLen = Number.isInteger(parseInt(cycleData.cycleLength))
        ? parseInt(cycleData.cycleLength)
        : 28;
    const delay = Number.isInteger(parseInt(cycleData.delayDays))
        ? parseInt(cycleData.delayDays)
        : 0;
    base.setDate(base.getDate() + cycleLen + delay);
    return formatDate(base);
}

function getGenderLabel(gender) {
    if (gender === 'female') return t('common.genderFemale');
    if (gender === 'male') return t('common.genderMale');
    if (gender === 'unknown') return t('common.genderUnknown');
    return t('common.genderUnknown');
}

function joinList(arr) {
    return arr.join(t('common.listSep'));
}
