export const EXTENSION_NAME = 'WorldEngine';

export const DEFAULT_SETTINGS = {
    enabled: true,
    tagWrapper: '',
    timeKey: 'time',
    sceneKey: 'scene',
    timeRegexCustom: '',
    sceneRegexCustom: '',
    countryCode: 'CN',
    customStartTime: '',
    initFromLatest: true,
    calendarEnabled: true,
    eventsEnabled: true,
    events: [],
    weatherEnabled: true,
    cycleEnabled: true,
    genderOverrides: {},
    stripNSFWProgress: true,
    injectionPosition: 1,
    injectionDepth: 4,
};

export function getSettings() {
    const context = SillyTavern.getContext();
    if (!context.extensionSettings[EXTENSION_NAME]) {
        context.extensionSettings[EXTENSION_NAME] = {};
    }
    const s = context.extensionSettings[EXTENSION_NAME];
    for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
        if (s[k] === undefined) {
            s[k] = JSON.parse(JSON.stringify(v));
        }
    }
    return s;
}

export function getChatState() {
    const context = SillyTavern.getContext();
    if (!context.chatMetadata.worldEngine) {
        context.chatMetadata.worldEngine = {
            currentTime: null,
            currentScene: '',
            snapshots: {},
            weatherState: null,
            cycleStates: {},
            lastParsedMessageId: -1,
        };
    }
    return context.chatMetadata.worldEngine;
}

export function saveState() {
    const context = SillyTavern.getContext();
    context.saveSettingsDebounced();
    context.saveMetadataDebounced();
}

export function saveSnapshot(messageId) {
    const cs = getChatState();
    cs.snapshots[String(messageId)] = {
        currentTime: cs.currentTime,
        currentScene: cs.currentScene,
        weatherState: cs.weatherState ? JSON.parse(JSON.stringify(cs.weatherState)) : null,
        cycleStates: JSON.parse(JSON.stringify(cs.cycleStates)),
    };
    saveState();
}

export function restoreSnapshot(messageId) {
    const cs = getChatState();
    const snap = cs.snapshots[String(messageId)];
    if (!snap) return false;
    cs.currentTime = snap.currentTime;
    cs.currentScene = snap.currentScene;
    cs.weatherState = snap.weatherState;
    cs.cycleStates = JSON.parse(JSON.stringify(snap.cycleStates));
    saveState();
    return true;
}

export function findPreviousSnapshotId(messageId) {
    const cs = getChatState();
    const ids = Object.keys(cs.snapshots).map(Number).filter(i => i < messageId).sort((a, b) => b - a);
    return ids.length > 0 ? ids[0] : null;
}

export function clearSnapshotsAfter(messageId) {
    const cs = getChatState();
    for (const key of Object.keys(cs.snapshots)) {
        if (Number(key) > messageId) {
            delete cs.snapshots[key];
        }
    }
}
