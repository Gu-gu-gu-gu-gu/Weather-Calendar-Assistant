import { EXTENSION_NAME, getSettings, getChatState, saveState, saveSnapshot, restoreSnapshot, findPreviousSnapshotId, clearSnapshotsAfter } from './state.js';
import { autoDetectFormat, extractFromMessage, parseTimeValue } from './parser.js';
import { loadChineseDays } from './calendar.js';
import { rollWeather, shouldRerollWeather } from './weather.js';
import { detectGenderInfo, initCycleForCharacter, getCycleStatus } from './cycle.js';
import { updateInjection, buildInjectionPrompt } from './injector.js';

const SLUG = 'world-engine';

jQuery(async () => {
    const context = SillyTavern.getContext();

    await loadChineseDays();

    const panelHtml = buildSettingsHtml();
    $('#extensions_settings').append(panelHtml);

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
});

async function onMessageReceived(messageId) {
    const settings = getSettings();
    if (!settings.enabled) return;

    const context = SillyTavern.getContext();
    const msg = context.chat[messageId];
    if (!msg || msg.is_user) return;

    const extracted = extractFromMessage(msg.mes, settings);

    if (!extracted.time) {
        toastr.warning('未能从AI消息中解析出时间信息，世界时间未更新。', 'World Engine', { timeOut: 4000 });
        return;
    }

    const cs = getChatState();
    const oldDateStr = cs.currentTime ? cs.currentTime.split('T')[0] : null;
    const newDateStr = extracted.time.dateStr;

    cs.currentTime = extracted.time.iso;
    if (extracted.scene) cs.currentScene = extracted.scene;
    cs.lastParsedMessageId = messageId;

    if (settings.weatherEnabled) {
        if (shouldRerollWeather(oldDateStr, newDateStr, cs.weatherState)) {
            cs.weatherState = rollWeather(extracted.time.month);
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
        cs.lastParsedMessageId = messageId;

        if (settings.weatherEnabled && shouldRerollWeather(oldDateStr, extracted.time.dateStr, cs.weatherState)) {
            cs.weatherState = rollWeather(extracted.time.month);
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
            cs.lastParsedMessageId = i;

            if (settings.weatherEnabled) {
                cs.weatherState = rollWeather(extracted.time.month);
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

        if (settings.weatherEnabled) {
            cs.weatherState = rollWeather(d.getMonth() + 1);
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
            cs.weatherState = rollWeather(parsed.month);
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
                            <label>时间正则(高级)</label>
                            <input type="text" id="we-time-regex" placeholder="留空=使用默认解析" />
                        </div>
                        <div class="we-row">
                            <label>场景正则(高级)</label>
                            <input type="text" id="we-scene-regex" placeholder="留空=使用默认解析" />
                        </div>
                        <div class="we-row">
                            <label>去除NSFW进度</label>
                            <input type="checkbox" id="we-strip-nsfw" />
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
                            <input type="text" id="we-event-char" placeholder="关联角色（可空）" style="flex:1" />
                            <button class="we-btn" id="we-add-event">+添加</button>
                        </div>
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
                toastr.success(`起始时间已设为 ${parsed.iso}`, 'World Engine');
            } else {
                toastr.error('时间格式无法解析', 'World Engine');
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
    $('#we-time-regex').on('change', function () {
        getSettings().timeRegexCustom = this.value.trim();
        saveState();
    });
    $('#we-scene-regex').on('change', function () {
        getSettings().sceneRegexCustom = this.value.trim();
        saveState();
    });
    $('#we-strip-nsfw').on('change', function () {
        getSettings().stripNSFWProgress = this.checked;
        saveState();
    });

    $('#we-auto-detect').on('click', function () {
        const context = SillyTavern.getContext();
        if (!context.chat || context.chat.length === 0) {
            toastr.warning('当前没有聊天记录', 'World Engine');
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
                saveState();
                toastr.success(`检测到标签: ${detected.tagWrapper || '无'}, 时间Key: ${detected.timeKey || '无'}, 场景Key: ${detected.sceneKey || '无'}`, 'World Engine', { timeOut: 5000 });
                found = true;
                break;
            }
        }
        if (!found) {
            toastr.warning('未能从AI消息中自动检测到字段格式', 'World Engine');
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
        const character = $('#we-event-char').val().trim();

        if (!name || !dateRaw) {
            toastr.warning('名称和日期不能为空', 'World Engine');
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
            toastr.warning('日期格式应为 MM-DD 或 YYYY-MM-DD', 'World Engine');
            return;
        }

        const settings = getSettings();
        settings.events.push({
            id: Date.now().toString(36),
            name, date: monthDay, year, type, character,
        });
        saveState();
        renderEventList();
        $('#we-event-name').val('');
        $('#we-event-date').val('');
        $('#we-event-char').val('');
        toastr.success('纪念日已添加', 'World Engine');
        updateInjection();
    });

    $('#we-weather-enabled').on('change', function () {
        getSettings().weatherEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-reroll-weather').on('click', function () {
        const cs = getChatState();
        if (!cs.currentTime) {
            toastr.warning('尚无世界时间', 'World Engine');
            return;
        }
        const d = new Date(cs.currentTime);
        cs.weatherState = rollWeather(d.getMonth() + 1);
        saveState();
        refreshStatusDisplay();
        updateInjection();
        toastr.success(`天气已重Roll: ${cs.weatherState.cn}`, 'World Engine');
    });

    $('#we-cycle-enabled').on('change', function () {
        getSettings().cycleEnabled = this.checked;
        saveState();
        updateInjection();
    });

    $('#we-rescan-cycle').on('click', function () {
        const cs = getChatState();
        if (!cs.currentTime) {
            toastr.warning('尚无世界时间', 'World Engine');
            return;
        }
        cs.cycleStates = {};
        updateCycleStates(cs.currentTime.split('T')[0]);
        saveState();
        refreshStatusDisplay();
        updateInjection();
        toastr.success('已重新扫描角色生理状态', 'World Engine');
    });

    $('#we-reinit-latest').on('click', async function () {
        const cs = getChatState();
        cs.currentTime = null;
        cs.currentScene = '';
        cs.snapshots = {};
        cs.weatherState = null;
        cs.lastParsedMessageId = -1;
        await tryInitFromLatest();
        refreshStatusDisplay();
        await updateInjection();
        if (cs.currentTime) {
            toastr.success(`从最新AI初始化成功: ${cs.currentTime}`, 'World Engine');
        } else {
            toastr.warning('未找到可解析的AI消息', 'World Engine');
        }
    });

    $('#we-scan-all').on('click', async function () {
        const cs = getChatState();
        cs.currentTime = null;
        cs.currentScene = '';
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
                cs.lastParsedMessageId = i;
                saveSnapshot(i);
                count++;
            }
        }

        if (cs.currentTime && settings.weatherEnabled) {
            const d = new Date(cs.currentTime);
            cs.weatherState = rollWeather(d.getMonth() + 1);
        }
        if (cs.currentTime && settings.cycleEnabled) {
            updateCycleStates(cs.currentTime.split('T')[0]);
        }

        saveState();
        refreshStatusDisplay();
        await updateInjection();
        toastr.success(`扫描完毕，共解析 ${count} 条时间记录`, 'World Engine');
    });

    $('#we-reset-state').on('click', async function () {
        if (!confirm('确定要清除当前对话的所有世界状态吗？')) return;
        const context = SillyTavern.getContext();
        context.chatMetadata.worldEngine = null;
        getChatState();
        context.setExtensionPrompt('worldEngine', '', 1, 0);
        saveState();
        refreshStatusDisplay();
        toastr.info('世界状态已清除', 'World Engine');
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
}

function loadSettingsToUI() {
    const s = getSettings();
    $('#we-enabled').prop('checked', s.enabled);
    $('#we-country').val(s.countryCode);
    $('#we-start-time').val(s.customStartTime);
    $('#we-init-latest').prop('checked', s.initFromLatest);
    $('#we-tag-wrapper').val(s.tagWrapper);
    $('#we-time-key').val(s.timeKey);
    $('#we-scene-key').val(s.sceneKey);
    $('#we-time-regex').val(s.timeRegexCustom);
    $('#we-scene-regex').val(s.sceneRegexCustom);
    $('#we-strip-nsfw').prop('checked', s.stripNSFWProgress);
    $('#we-calendar-enabled').prop('checked', s.calendarEnabled);
    $('#we-events-enabled').prop('checked', s.eventsEnabled);
    $('#we-weather-enabled').prop('checked', s.weatherEnabled);
    $('#we-cycle-enabled').prop('checked', s.cycleEnabled);
    renderEventList();
    renderGenderOverrideList();
    renderCycleList();
}

function renderEventList() {
    const settings = getSettings();
    const container = $('#we-event-list');
    container.empty();

    for (const ev of settings.events) {
        const emoji = ev.type === 'birthday' ? '🎂' : ev.type === 'anniversary' ? '💝' : '📌';
        const charLabel = ev.character ? `(${ev.character})` : '';
        const yearLabel = ev.year ? `${ev.year}-` : '';
        const item = $(`<div class="we-event-item">
            <span>${emoji} ${yearLabel}${ev.date} ${ev.name} ${charLabel}</span>
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
        if (cs.weatherState) {
            lines.push(`🌤 天气: ${cs.weatherState.cn} (${cs.weatherState.en}) ${cs.weatherState.temp}°C${cs.weatherState.extreme ? ' ⚠极端' : ''}`);
        }
        lines.push(`🌐 地区: ${settings.countryCode}`);
        lines.push(`📦 快照数: ${Object.keys(cs.snapshots).length}`);

        const cycleCount = Object.keys(cs.cycleStates).length;
        if (cycleCount > 0) lines.push(`🩸 生理周期追踪: ${cycleCount}个角色`);
    }

    $('#we-status-display').text(lines.join('\n'));
    renderGenderOverrideList();
    renderCycleList();
}
