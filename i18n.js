import { getSettings } from './state.js';
import { ZH } from './locales/zh.js';
import { EN } from './locales/en.js';

function getNested(obj, path) {
    return path.split('.').reduce((o, k) => (o ? o[k] : undefined), obj);
}

function normalizeLang(input) {
    const s = String(input || '')
        .trim()
        .toLowerCase();
    if (!s) return '';
    if (s.startsWith('zh')) return 'zh';
    if (
        s.includes('chinese') ||
        s.includes('中文') ||
        s.includes('简体') ||
        s.includes('繁体') ||
        s.includes('漢') ||
        s.includes('汉')
    )
        return 'zh';
    if (s.startsWith('en')) return 'en';
    if (s.includes('english')) return 'en';
    return '';
}

function detectAutoLang() {
    const info = { candidates: [], picked: 'en' };
    const push = (source, value) => info.candidates.push({ source, value });

    try {
        const lsLanguage = localStorage.getItem('language');
        const lsUi = localStorage.getItem('ui_language');
        const lsInterface = localStorage.getItem('interface_language');
        const lsLang = localStorage.getItem('lang');
        const lsLocale = localStorage.getItem('locale');

        const lsCandidates = [
            { source: 'localStorage.language', value: lsLanguage },
            { source: 'localStorage.ui_language', value: lsUi },
            { source: 'localStorage.interface_language', value: lsInterface },
            { source: 'localStorage.lang', value: lsLang },
            { source: 'localStorage.locale', value: lsLocale },
        ];

        for (const c of lsCandidates) {
            push(c.source, c.value);
            const v = normalizeLang(c.value);
            if (v) {
                info.picked = v;
                window.__WE_LANG_INFO__ = info;
                return v;
            }
        }

        const ctx =
            typeof SillyTavern !== 'undefined' && typeof SillyTavern.getContext === 'function'
                ? SillyTavern.getContext()
                : null;

        const ctxCandidates = [
            { source: 'ctx.settings.language', value: ctx?.settings?.language },
            { source: 'ctx.settings.ui_language', value: ctx?.settings?.ui_language },
            { source: 'ctx.settings.interface_language', value: ctx?.settings?.interface_language },
            { source: 'window.i18n.locale', value: window?.i18n?.locale },
            { source: 'window.i18n.language', value: window?.i18n?.language },
            {
                source: 'window.SillyTavern.getContext.settings.language',
                value: window?.SillyTavern?.getContext?.()?.settings?.language,
            },
        ];

        for (const c of ctxCandidates) {
            push(c.source, c.value);
            const v = normalizeLang(c.value);
            if (v) {
                info.picked = v;
                window.__WE_LANG_INFO__ = info;
                return v;
            }
        }

        const htmlLang = document?.documentElement?.lang;
        push('document.documentElement.lang', htmlLang);
        const v1 = normalizeLang(htmlLang);
        if (v1) {
            info.picked = v1;
            window.__WE_LANG_INFO__ = info;
            return v1;
        }

        const nav = navigator?.language;
        push('navigator.language', nav);
        const v2 = normalizeLang(nav);
        if (v2) {
            info.picked = v2;
            window.__WE_LANG_INFO__ = info;
            return v2;
        }
    } catch (_) {}

    window.__WE_LANG_INFO__ = info;
    return info.picked;
}

export function getUILang() {
    const s = getSettings();
    const v = s.uiLanguage || 'auto';
    if (v === 'auto') return detectAutoLang();
    if (v !== 'zh' && v !== 'en') return detectAutoLang();
    return v;
}

export function getLocale() {
    return getUILang() === 'en' ? EN : ZH;
}

export function t(path, vars = {}) {
    const lang = getUILang();
    const dict = lang === 'en' ? EN : ZH;
    let text = getNested(dict, path);
    if (text === undefined) text = getNested(ZH, path);
    if (typeof text === 'function') return text(vars);
    if (typeof text !== 'string') return String(text ?? path);
    return text.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
}
