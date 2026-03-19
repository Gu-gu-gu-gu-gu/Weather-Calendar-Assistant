import { EXTENSION_NAME, getSettings, getChatState, saveState, saveSnapshot, restoreSnapshot, findPreviousSnapshotId, clearSnapshotsAfter } from './state.js';
import { autoDetectFormat, extractFromMessage, parseTimeValue } from './parser.js';
import { loadChineseDays } from './calendar.js';
import { rollWeather, shouldRerollWeather, getWeatherForDate } from './weather.js';
import { detectGenderInfo, initCycleForCharacter, getCycleStatus } from './cycle.js';
import { updateInjection, buildInjectionPrompt } from './injector.js';

const SLUG = 'world-engine';
let panelMounted = false;

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

        bindSettingsEvents();
        loadSettingsToUI();
        refreshStatusDisplay();

        context.eventSource.on(context.eventTypes.MESSAGE_RECEIVED, onMessageReceived);
        context.eventSource.on(context.eventTypes.MESSAGE_EDITED, onMessageEdited);
        context.eventSource.on(context.eventTypes.MESSAGE_DELETED, onMessageDeleted);
        context.eventSource.on(context.eventTypes.MESSAGE_SWIPED, onMessageSwiped);
        context.eventSource.on(context.eventTypes.CHAT_CHANGED, onChatChanged);

        context.SlashCommandParser.addCommandObject(context.SlashCommand.fromProps({
            name: 'wetime',
            callback: async (_args, value) => {
                if (!value) return 'Usage: /wetime 2025-06-18 08:00 or /wetime +3d';
                return await handleTimeCommand(value.trim());
            },
            helpString: '手动设置/跳转世界时间。例：/wetime 2025-06-18 08:00 或 /wetime +3d',
        }));

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
        toastr.warning('未能从AI消息中解析出时间信息，世界时间未更新。', '天气与日历小助手', { timeOut: 4000 });
        return;
    }

    const cs = getChatState();
    const oldDateStr = cs.currentTime ? cs.currentTime.split('T')[0] : null;
    const newDateStr = extracted.time.dateStr;

    cs.currentTime = extracted.time.iso;
    if (extracted.scene) cs.currentScene = extracted.scene;
    if (extracted.location) cs.currentLocation = extracted.location;
    cs.lastParsedMessageId = messageId;

    if (extracted.eraYear) {
        cs.eraYearLabel = extracted.eraYear.label;
        cs.eraYearBase = extracted.eraYear.yearNum;
        cs.eraYearBaseGregorian = extracted.time.year;
    }

    if (settings.weatherEnabled) {
        if (shouldRerollWeather(oldDateStr, newDateStr, cs.weatherState, cs.currentLocation)) {
            cs.weatherState = await getWeatherForDate(newDateStr, cs.currentLocation, settings, cs.weatherState);
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
        if (extracted.scene) cs.currentScene = extracted.scene;
        if (extracted.location) cs.currentLocation = extracted.location;
        cs.lastParsedMessageId = messageId;

        if (extracted.eraYear) {
            cs.eraYearLabel = extracted.eraYear.label;
            cs.eraYearBase = extracted.eraYear.yearNum;
            cs.eraYearBaseGregorian = extracted.time.year;
        }

        if (settings.weatherEnabled && shouldRerollWeather(oldDateStr, extracted.time.dateStr, cs.weatherState, cs.currentLocation)) {
            cs.weatherState = await getWeatherForDate(extracted.time.dateStr, cs.currentLocation, settings, cs.weatherState);
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
    await tryInitFromLatest();
    refreshStatusDisplay();
    await updateInjection();
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
            if (extracted.scene) cs.currentScene = extracted.scene;
            if (extracted.location) cs.currentLocation = extracted.location;
            cs.lastParsedMessageId = i;

            if (extracted.eraYear) {
                cs.eraYearLabel = extracted.eraYear.label;
                cs.eraYearBase = extracted.eraYear.yearNum;
                cs.eraYearBaseGregorian = extracted.time.year;
            }

            if (settings.weatherEnabled) {
                cs.weatherState = await getWeatherForDate(extracted.time.dateStr, cs.currentLocation, settings, cs.weatherState);
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

    const charDescription = getCharacterDescription();
    const userDescription = getUserDescription();

    const checks = [];
    if (context.name2) checks.push({ name: context.name2, text: charDescription });
    if (context.name1) checks.push({ name: context.name1, text: userDescription });

    for (const { name, text } of checks) {
        const override = settings.genderOverrides?.[name];
        const autoInfo = detectGenderInfo(text);
        const gender = override && override !== 'auto' ? override : autoInfo.gender;

        if (gender === 'female' && !cs.cycleStates[name]) {
            cs.cycleStates[name] = initCycleForCharacter(name, dateStr);
        } else if (gender !== 'female' && cs.cycleStates[name]) {
            delete cs.cycleStates[name];
        }
    }

    if (Array.isArray(settings.manualCharacters)) {
        for (const item of settings.manualCharacters) {
            const name = item.name?.trim();
            const gender = item.gender;
            if (!name) continue;
            if (gender === 'female' && !cs.cycleStates[name]) {
                cs.cycleStates[name] = initCycleForCharacter(name, dateStr);
            } else if (gender !== 'female' && cs.cycleStates[name]) {
                delete cs.cycleStates[name];
            }
        }
    }
}

function getCharacterDescription() {
    const context = SillyTavern.getContext();
    try {
        if (context.characterId !== undefined && context.characters[context.characterId]) {
            const char = context.characters[context.characterId];
            return [char.description, char.personality, char.scenario, char.mes_example, char.first_mes].filter(Boolean).join('\n');
        }
    } catch (_) { }
    return '';
}

function getUserDescription() {
    const context = SillyTavern.getContext();
    try {
        if (context.name1) {
            const persona = context.extensionSettings?.persona?.description || '';
            return persona;
        }
    } catch (_) { }
    return '';
}

async function handleTimeCommand(input) {
    const cs = getChatState();
    const settings = getSettings();

    const jumpMatch = input.match(/^\+(\d+)([dhm])$/i);
    if (jumpMatch) {
        if (!cs.currentTime) return '当前无世界时间，请先解析一条AI消息。';
        const val = parseInt(jumpMatch[1]);
        const unit = jumpMatch[2].toLowerCase();
        const d = new Date(cs.currentTime);
        if (unit === 'd') d.setDate(d.getDate() + val);
        else if (unit === 'h') d.setHours(d.getHours() + val);
        else if (unit === 'm') d.setMinutes(d.getMinutes() + val);
        cs.currentTime = d.toISOString().slice(0, 19);

        const dateStr = cs.currentTime.split('T')[0];
        if (settings.weatherEnabled) {
            cs.weatherState = await getWeatherForDate(dateStr, cs.currentLocation, settings, cs.weatherState);
        }
        saveState();
        refreshStatusDisplay();
        await updateInjection();
        return `世界时间已跳转至 ${cs.currentTime}`;
    }

    const parsed = parseTimeValue(input);
    if (parsed) {
        cs.currentTime = parsed.iso;
        if (settings.weatherEnabled) {
            cs.weatherState = await getWeatherForDate(parsed.dateStr, cs.currentLocation, settings, cs.weatherState);
        }
        saveState();
        refreshStatusDisplay();
        await updateInjection();
        return `世界时间已设置为 ${cs.currentTime}`;
    }

    return '无法解析时间。格式示例：2025-06-18 08:00 或 +3d +6h +30m';
}

function buildSettingsHtml() {
    return `
    <div id="we-settings-panel" class="extension_settings">
        <div class="inline-drawer">
            <div class="inline-drawer-toggle inline-drawer-header">
                <b>天气与日历小助手</b>
                <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
            </div>
            <div class="inline-drawer-content">

                <div class="we-section">
                    <div class="we-section-header" data-section="general">
                        <span>⚙ 总控</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="general">
                        <div class="we-row">
                            <label>启用插件</label>
                            <input type="checkbox" id="we-enabled" />
                        </div>
                        <div class="we-row">
                            <label>国家/地区</label>
                            <select id="we-country">
                                <option value="CN">中国 (CN)</option>
                                <option value="US">美国 (US)</option>
                                <option value="JP">日本 (JP)</option>
                                <option value="KR">韩国 (KR)</option>
                                <option value="GB">英国 (GB)</option>
                                <option value="DE">德国 (DE)</option>
                                <option value="FR">法国 (FR)</option>
                                <option value="CA">加拿大 (CA)</option>
                                <option value="AU">澳大利亚 (AU)</option>
                                <option value="RU">俄罗斯 (RU)</option>
                            </select>
                        </div>
                        <div class="we-row">
                            <label>时代模式</label>
                            <select id="we-world-era">
                                <option value="modern">现代</option>
                                <option value="ancient">古代</option>
                            </select>
                        </div>
                        <div class="we-row">
                            <label>自定义起始时间</label>
                            <input type="text" id="we-start-time" placeholder="留空=从AI消息解析 | 格式：2025-06-18 08:00" />
                        </div>
                        <div class="we-row">
                            <label>从最新AI初始化</label>
                            <input type="checkbox" id="we-init-latest" />
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="parser">
                        <span>🔍 解析设置</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="parser">
                        <div class="we-row">
                            <label>XML标签名</label>
                            <input type="text" id="we-tag-wrapper" placeholder="如：horae（留空=自动检测）" />
                        </div>
                        <div class="we-row">
                            <label>时间字段Key</label>
                            <input type="text" id="we-time-key" placeholder="如：time" />
                        </div>
                        <div class="we-row">
                            <label>场景字段Key</label>
                            <input type="text" id="we-scene-key" placeholder="如：scene" />
                        </div>
                        <div class="we-row">
                            <label>地点字段Key</label>
                            <input type="text" id="we-location-key" placeholder="如：location" />
                        </div>
                        <div class="we-row">
                            <label>正则预设</label>
                            <select id="we-regex-preset" style="width:160px;"></select>
                            <input type="text" id="we-regex-preset-name" placeholder="预设名（可空）" style="flex:1" />
                            <button class="we-btn" id="we-regex-preset-save">保存当前</button>
                            <button class="we-btn we-btn-danger" id="we-regex-preset-delete">删除当前</button>
                        </div>
                        <div class="we-row">
                            <label>时间正则(高级)</label>
                            <input type="text" id="we-time-regex" placeholder="留空=使用默认解析" />
                        </div>
                        <div class="we-row">
                            <label>场景正则(高级)</label>
                            <input type="text" id="we-scene-regex" placeholder="留空=使用默认解析" />
                        </div>
                        <div class="we-row">
                            <label>地点正则(高级)</label>
                            <input type="text" id="we-location-regex" placeholder="留空=使用默认解析" />
                        </div>
                        <div class="we-row">
                            <button class="we-btn" id="we-auto-detect">🔎 从最新AI消息自动检测</button>
                        </div>
                        <div class="we-hint">自动检测会扫描最新一条AI消息，提取标签名和字段Key并填入上方。</div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="calendar">
                        <span>📅 日历与纪念日</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="calendar">
                        <div class="we-row">
                            <label>启用日历注入</label>
                            <input type="checkbox" id="we-calendar-enabled" />
                        </div>
                        <div class="we-row">
                            <label>启用纪念日</label>
                            <input type="checkbox" id="we-events-enabled" />
                        </div>
                        <div class="we-event-list" id="we-event-list"></div>
                        <div class="we-row">
                            <input type="text" id="we-event-name" placeholder="名称（如：生日）" style="flex:1" />
                            <input type="text" id="we-event-date" placeholder="MM-DD 或 YYYY-MM-DD" style="width:150px" />
                            <select id="we-event-type" style="width:80px">
                                <option value="birthday">生日</option>
                                <option value="anniversary">纪念日</option>
                                <option value="custom">自定义</option>
                            </select>
                            <button class="we-btn" id="we-add-event">+添加</button>
                        </div>
                        <div class="we-row">
                            <input type="text" id="we-event-char-filter" placeholder="搜索角色..." style="flex:1" />
                            <button class="we-btn" id="we-event-char-select-all">全选</button>
                            <button class="we-btn" id="we-event-char-clear">清空</button>
                        </div>
                        <div class="we-row">
                            <select id="we-event-char" multiple class="we-event-char-select"></select>
                        </div>
                        <div class="we-hint">可多选角色卡，留空表示所有聊天都注入。</div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="weather">
                        <span>🌤 天气系统</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="weather">
                        <div class="we-row">
                            <label>启用天气</label>
                            <input type="checkbox" id="we-weather-enabled" />
                        </div>
                        <div class="we-row">
                            <label>默认城市</label>
                            <input type="text" id="we-default-city" placeholder="未解析到地点时使用" />
                        </div>
                        <div class="we-row">
                            <label>古地名映射</label>
                            <input type="text" id="we-ancient-from" placeholder="古地名 如 长安" style="flex:1" />
                            <input type="text" id="we-ancient-to" placeholder="现代地名 如 西安" style="flex:1" />
                            <button class="we-btn" id="we-add-ancient-map">+添加</button>
                        </div>
                        <div class="we-event-list" id="we-ancient-map-list"></div>
                        <div class="we-row">
                            <label>连续性概率</label>
                            <input type="text" id="we-weather-continuity" placeholder="0-100" />
                        </div>
                        <div class="we-row">
                            <label>温度抖动(℃)</label>
                            <input type="text" id="we-weather-jitter" placeholder="如 2" />
                        </div>
                        <div class="we-row">
                            <label>雨天偏向(%)</label>
                            <input type="text" id="we-weather-rain-bias" placeholder="如 20" />
                        </div>
                        <div class="we-row">
                            <button class="we-btn" id="we-reroll-weather">🎲 重新Roll天气</button>
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="cycle">
                        <span>🩸 生理周期</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="cycle">
                        <div class="we-row">
                            <label>启用生理周期</label>
                            <input type="checkbox" id="we-cycle-enabled" />
                        </div>
                        <div class="we-hint">自动扫描角色/User设定中的性别关键词，为女性角色生成经期周期。</div>
                        <div id="we-gender-list"></div>
                        <div class="we-hint" style="margin-top:6px;">手动添加角色（适用于世界观/多角色卡）</div>
                        <div class="we-row">
                            <input type="text" id="we-manual-name" placeholder="角色名" style="flex:1" />
                            <select id="we-manual-gender" style="width:90px;">
                                <option value="female">女</option>
                                <option value="male">男</option>
                                <option value="unknown">未知</option>
                            </select>
                            <button class="we-btn" id="we-add-manual">+添加</button>
                        </div>
                        <div id="we-manual-list"></div>
                        <div id="we-cycle-list"></div>
                        <div class="we-row">
                            <button class="we-btn" id="we-rescan-cycle">🔄 重新扫描角色</button>
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="actions">
                        <span>🛠 操作</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="actions">
                        <div class="we-row">
                            <button class="we-btn" id="we-reinit-latest">📡 从最新AI重新初始化</button>
                            <button class="we-btn" id="we-scan-all">📜 从头扫描所有历史</button>
                        </div>
                        <div class="we-row">
                            <button class="we-btn we-btn-danger" id="we-reset-state">🗑 清除当前对话的世界状态</button>
                        </div>
                    </div>
                </div>

                <div class="we-section">
                    <div class="we-section-header" data-section="status">
                        <span>📊 当前状态</span>
                        <span class="we-toggle-icon">▼</span>
                    </div>
                    <div class="we-section-body" data-section="status">
                        <div class="we-status-box" id="we-status-display">等待初始化...</div>
                        <div class="we-row" style="margin-top:6px;">
                            <button class="we-btn" id="we-preview-prompt">👁 预览注入提示词</button>
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
                toastr.success(`起始时间已设为 ${parsed.iso}`, '天气与日历小助手');
            } else {
                toastr.error('时间格式无法解析', '天气与日历小助手');
            }
        }
        saveState();
    });

    $('#we-init-latest').on('change', function () {
        getSettings().initFromLatest = this.checked;
        saveState();
    });

    $('#we-tag-wrapper').on('change', function () {
        getSettings().tagWrapper = this.value.trim();
        saveState();
    });
    $('#we-time-key').on('change', function () {
        getSettings().timeKey = this.value.trim();
        saveState();
    });
    $('#we-scene-key').on('change', function () {
        getSettings().sceneKey = this.value.trim();
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
    $('#we-scene-regex').on('change', function () {
        getSettings().sceneRegexCustom = this.value.trim();
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
        const sceneRegex = $('#we-scene-regex').val().trim();
        const locationRegex = $('#we-location-regex').val().trim();

        let preset = null;
        if (nameInput) {
            preset = presets.find(p => p.name === nameInput);
        }
        if (!preset) {
            const currentId = $('#we-regex-preset').val();
            preset = presets.find(p => p.id === currentId) || null;
        }

        if (!preset) {
            preset = { id: Date.now().toString(36), name: nameInput || `预设${presets.length + 1}` };
            presets.push(preset);
        }

        preset.name = nameInput || preset.name || `预设${presets.length}`;
        preset.timeRegex = timeRegex;
        preset.sceneRegex = sceneRegex;
        preset.locationRegex = locationRegex;

        settings.regexPresets = presets;
        settings.regexPresetLastId = preset.id;
        saveState();
        renderRegexPresetOptions();
        $('#we-regex-preset').val(preset.id);
        $('#we-regex-preset-name').val('');
        toastr.success('正则预设已保存', '天气与日历小助手');
    });
    $('#we-regex-preset-delete').on('click', function () {
        const settings = getSettings();
        const id = $('#we-regex-preset').val();
        if (!id) {
            toastr.warning('没有可删除的预设', '天气与日历小助手');
            return;
        }

        settings.regexPresets = (settings.regexPresets || []).filter(p => String(p.id) !== String(id));
        if (settings.regexPresetLastId === id) settings.regexPresetLastId = '';
        saveState();
        renderRegexPresetOptions();
        $('#we-regex-preset-name').val('');
        toastr.success('已删除预设', '天气与日历小助手');
    });

    $('#we-auto-detect').on('click', function () {
        const context = SillyTavern.getContext();
        if (!context.chat || context.chat.length === 0) {
            toastr.warning('当前没有聊天记录', '天气与日历小助手');
            return;
        }
        let found = false;
        for (let i = context.chat.length - 1; i >= 0; i--) {
            const msg = context.chat[i];
            if (msg.is_user) continue;
            const detected = autoDetectFormat(msg.mes);
            if (detected.fields.length > 0) {
                const settings = getSettings();
                if (detected.tagWrapper) {
                    settings.tagWrapper = detected.tagWrapper;
                    $('#we-tag-wrapper').val(detected.tagWrapper);
                }
                if (detected.timeKey) {
                    settings.timeKey = detected.timeKey;
                    $('#we-time-key').val(detected.timeKey);
                }
                if (detected.sceneKey) {
                    settings.sceneKey = detected.sceneKey;
                    $('#we-scene-key').val(detected.sceneKey);
                }
                if (detected.locationKey) {
                    settings.locationKey = detected.locationKey;
                    $('#we-location-key').val(detected.locationKey);
                }
                saveState();
                toastr.success(`检测到标签: ${detected.tagWrapper || '无'}, 时间Key: ${detected.timeKey || '无'}, 场景Key: ${detected.sceneKey || '无'}, 地点Key: ${detected.locationKey || '无'}`, '天气与日历小助手', { timeOut: 5000 });
                found = true;
                break;
            }
        }
        if (!found) {
            toastr.warning('未能从AI消息中自动检测到字段格式', '天气与日历小助手');
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
            toastr.warning('名称和日期不能为空', '天气与日历小助手');
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
            toastr.warning('日期格式应为 MM-DD 或 YYYY-MM-DD', '天气与日历小助手');
            return;
        }

        const settings = getSettings();
        settings.events.push({
            id: Date.now().toString(36),
            name,
            date: monthDay,
            year,
            type,
            characterIds: characterIds.map(String)
        });
        saveState();
        renderEventList();
        $('#we-event-name').val('');
        $('#we-event-date').val('');
        $('#we-event-char').val([]);
        toastr.success('纪念日已添加', '天气与日历小助手');
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
            toastr.warning('古地名和现代地名不能为空', '天气与日历小助手');
            return;
        }
        const settings = getSettings();
        if (!Array.isArray(settings.ancientLocationMap)) settings.ancientLocationMap = [];
        const existing = settings.ancientLocationMap.find(x => x.from === from);
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
        settings.ancientLocationMap = (settings.ancientLocationMap || []).filter(x => x.from !== from);
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

    $('#we-weather-rain-bias').on('change', function () {
        const v = parseInt(this.value);
        getSettings().weatherRainBias = isNaN(v) ? 20 : Math.max(0, Math.min(100, v));
        saveState();
    });

    $('#we-reroll-weather').on('click', async function () {
        const cs = getChatState();
        if (!cs.currentTime) {
            toastr.warning('尚无世界时间', '天气与日历小助手');
            return;
        }
        cs.weatherState = await getWeatherForDate(cs.currentTime.split('T')[0], cs.currentLocation, getSettings(), cs.weatherState);
        saveState();
        refreshStatusDisplay();
        updateInjection();
        toastr.success(`天气已更新: ${cs.weatherState.cn}`, '天气与日历小助手');
    });

    $('#we-cycle-enabled').on('change', function () {
        getSettings().cycleEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-add-manual').on('click', function () {
        const name = $('#we-manual-name').val().trim();
        const gender = $('#we-manual-gender').val();
        if (!name) {
            toastr.warning('角色名不能为空', '天气与日历小助手');
            return;
        }
        const settings = getSettings();
        if (!Array.isArray(settings.manualCharacters)) settings.manualCharacters = [];
        const existing = settings.manualCharacters.find(x => x.name === name);
        if (existing) {
            existing.gender = gender;
        } else {
            settings.manualCharacters.push({ name, gender });
        }
        saveState();
        renderManualList();
        $('#we-manual-name').val('');
        toastr.success('已添加/更新角色', '天气与日历小助手');
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });

    $('#we-rescan-cycle').on('click', function () {
        const cs = getChatState();
        if (!cs.currentTime) {
            toastr.warning('尚无世界时间', '天气与日历小助手');
            return;
        }
        cs.cycleStates = {};
        updateCycleStates(cs.currentTime.split('T')[0]);
        saveState();
        refreshStatusDisplay();
        updateInjection();
        toastr.success('已重新扫描角色生理状态', '天气与日历小助手');
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
            toastr.success(`从最新AI初始化成功: ${cs.currentTime}`, '天气与日历小助手');
        } else {
            toastr.warning('未找到可解析的AI消息', '天气与日历小助手');
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
                if (extracted.scene) cs.currentScene = extracted.scene;
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
            cs.weatherState = await getWeatherForDate(cs.currentTime.split('T')[0], cs.currentLocation, settings, cs.weatherState);
        }
        if (cs.currentTime && settings.cycleEnabled) {
            updateCycleStates(cs.currentTime.split('T')[0]);
        }

        saveState();
        refreshStatusDisplay();
        await updateInjection();
        toastr.success(`扫描完毕，共解析 ${count} 条时间记录`, '天气与日历小助手');
    });

    $('#we-reset-state').on('click', async function () {
        if (!confirm('确定要清除当前对话的所有世界状态吗？')) return;
        const context = SillyTavern.getContext();
        context.chatMetadata.worldEngine = null;
        getChatState();
        context.setExtensionPrompt('worldEngine', '', 1, 0);
        saveState();
        refreshStatusDisplay();
        toastr.info('世界状态已清除', '天气与日历小助手');
    });

    $('#we-preview-prompt').on('click', async function () {
        const prompt = await buildInjectionPrompt();
        const box = $('#we-prompt-preview');
        box.text(prompt || '（无注入内容）');
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

    $('#we-settings-panel').on('click', '.we-del-manual', function () {
        const name = $(this).data('name');
        const settings = getSettings();
        settings.manualCharacters = (settings.manualCharacters || []).filter(x => x.name !== name);
        saveState();
        renderManualList();
        if (getChatState().currentTime) {
            updateCycleStates(getChatState().currentTime.split('T')[0]);
            refreshStatusDisplay();
            updateInjection();
        }
    });
}

function loadSettingsToUI() {
    const s = getSettings();
    $('#we-enabled').prop('checked', s.enabled);
    $('#we-country').val(s.countryCode);
    $('#we-world-era').val(s.worldEra || 'modern');
    $('#we-start-time').val(s.customStartTime);
    $('#we-init-latest').prop('checked', s.initFromLatest);
    $('#we-tag-wrapper').val(s.tagWrapper);
    $('#we-time-key').val(s.timeKey);
    $('#we-scene-key').val(s.sceneKey);
    $('#we-location-key').val(s.locationKey);
    $('#we-time-regex').val(s.timeRegexCustom);
    $('#we-scene-regex').val(s.sceneRegexCustom);
    $('#we-location-regex').val(s.locationRegexCustom);
    renderRegexPresetOptions();
    $('#we-calendar-enabled').prop('checked', s.calendarEnabled);
    $('#we-events-enabled').prop('checked', s.eventsEnabled);
    $('#we-weather-enabled').prop('checked', s.weatherEnabled);
    $('#we-default-city').val(s.defaultCity);
    $('#we-weather-continuity').val(s.weatherContinuity);
    $('#we-weather-jitter').val(s.weatherTempJitter);
    $('#we-weather-rain-bias').val(s.weatherRainBias);
    $('#we-cycle-enabled').prop('checked', s.cycleEnabled);
    renderEventCharacterOptions();
    renderEventList();
    renderAncientMapList();
    renderGenderOverrideList();
    renderManualList();
    renderCycleList();
}

function renderEventList() {
    const settings = getSettings();
    const container = $('#we-event-list');
    container.empty();

    for (const ev of settings.events) {
        const emoji = ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💝' : '📌';
        const yearLabel = ev.year ? `${ev.year}-` : '';
        let bindLabel = '';

        if (Array.isArray(ev.characterIds) && ev.characterIds.length > 0) {
            const names = ev.characterIds.map(id => getCharacterNameById(id)).filter(Boolean);
            if (names.length > 0) bindLabel = `（${names.join('、')}）`;
        } else if (ev.character) {
            bindLabel = `（${ev.character}）`;
        }

        const item = $(`<div class="we-event-item">
            <span>${emoji} ${yearLabel}${ev.date} ${ev.name}${bindLabel}</span>
            <button class="we-btn we-btn-danger we-del-event" data-id="${ev.id}" style="margin-left:auto;">✕</button>
        </div>`);
        container.append(item);
    }

    container.find('.we-del-event').on('click', function () {
        const id = $(this).data('id');
        settings.events = settings.events.filter(e => e.id !== String(id));
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
        select.append('<option value="">（无预设）</option>');
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
    return presets.find(p => String(p.id) === String(id)) || null;
}

function applyRegexPreset(preset) {
    const settings = getSettings();
    const t = preset.timeRegex || '';
    const s = preset.sceneRegex || '';
    const l = preset.locationRegex || '';
    settings.timeRegexCustom = t;
    settings.sceneRegexCustom = s;
    settings.locationRegexCustom = l;
    $('#we-time-regex').val(t);
    $('#we-scene-regex').val(s);
    $('#we-location-regex').val(l);
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
        select.append('<option value="">（无角色卡）</option>');
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
    $('#we-event-char').find('option').each(function () {
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
        container.append('<div class="we-hint">尚未添加古地名映射。</div>');
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
        container.append('<div class="we-hint">未检测到角色/用户信息。</div>');
        return;
    }

    for (const { name, text } of checks) {
        const info = detectGenderInfo(text);
        const override = settings.genderOverrides?.[name] || 'auto';
        const line = $(`
            <div class="we-row" style="margin-bottom:4px;">
                <label>${name}</label>
                <span style="font-size:12px;">自动识别：${info.gender} (女${info.femaleCount}/男${info.maleCount})</span>
                <select class="we-gender-select" data-name="${name}" style="width:100px;">
                    <option value="auto">自动</option>
                    <option value="female">女</option>
                    <option value="male">男</option>
                    <option value="unknown">未知</option>
                </select>
            </div>
        `);
        line.find('select').val(override);
        container.append(line);
    }
}

function renderManualList() {
    const settings = getSettings();
    const container = $('#we-manual-list');
    container.empty();

    if (!settings.manualCharacters || settings.manualCharacters.length === 0) {
        container.append('<div class="we-hint">尚未手动添加角色。</div>');
        return;
    }

    for (const item of settings.manualCharacters) {
        const line = $(`<div class="we-row" style="margin-bottom:4px;">
            <span style="font-size:12px;">${item.name}（${item.gender}）</span>
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
        container.append('<div class="we-hint">尚无世界时间，无法显示生理周期。</div>');
        return;
    }

    const dateStr = cs.currentTime.split('T')[0];

    for (const [name, data] of Object.entries(cs.cycleStates)) {
        const status = getCycleStatus(data, dateStr);
        const text = status ? `${name}: ${status.description} (周期${data.cycleLength}天, 经期${data.periodDuration}天)` : `${name}: 数据异常`;
        container.append(`<div class="we-hint" style="margin:3px 0;">🩸 ${text}</div>`);
    }

    if (Object.keys(cs.cycleStates).length === 0) {
        container.append('<div class="we-hint">未检测到女性角色或周期系统未初始化。</div>');
    }
}

function refreshStatusDisplay() {
    const cs = getChatState();
    const settings = getSettings();
    let lines = [];

    if (!settings.enabled) {
        lines.push('❌ 插件已禁用');
    } else if (!cs.currentTime) {
        lines.push('⏳ 尚未初始化世界时间');
        lines.push('发送消息后将自动从AI回复中解析。');
    } else {
        lines.push(`🕐 世界时间: ${cs.currentTime}`);
        if (cs.currentScene) lines.push(`📍 场景: ${cs.currentScene}`);
        if (cs.currentLocation) lines.push(`🏙 地点: ${cs.currentLocation}`);
        if (cs.weatherState) {
            const src = cs.weatherState.source ? `(${cs.weatherState.source})` : '';
            lines.push(`🌤 天气: ${cs.weatherState.cn} ${cs.weatherState.temp}°C ${src}${cs.weatherState.extreme ? ' ⚠极端' : ''}`);
        }
        lines.push(`🌐 地区: ${settings.countryCode}`);
        lines.push(`🧭 时代: ${settings.worldEra === 'ancient' ? '古代' : '现代'}`);
        lines.push(`📦 快照数: ${Object.keys(cs.snapshots).length}`);

        const cycleCount = Object.keys(cs.cycleStates).length;
        if (cycleCount > 0) lines.push(`🩸 生理周期追踪: ${cycleCount}个角色`);
    }

    $('#we-status-display').text(lines.join('\n'));
    renderGenderOverrideList();
    renderManualList();
    renderCycleList();
}
