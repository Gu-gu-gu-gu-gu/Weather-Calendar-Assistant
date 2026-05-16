import { t } from './i18n.js';

const DEFAULT_BASE_CHANCE = {
    low: 0.03,
    medium: 0.08,
    high: 0.15,
};

const PROTECTION_MULTIPLIER = {
    none: 1.0,
    condom: 0.2,
    pill: 0.08,
    iud: 0.05,
    withdrawal: 0.45,
    sterilized: 0.001,
    unknown: 0.6,
};

const RISK_MULTIPLIER = {
    none: 0,
    low: 0.4,
    medium: 0.8,
    high: 1.2,
};

const FERTILITY_PROFILE_MULTIPLIER = {
    low: 0.7,
    normal: 1.0,
    high: 1.25,
};

function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function dateDiffDays(aStr, bStr) {
    const a = new Date(aStr + 'T00:00:00');
    const b = new Date(bStr + 'T00:00:00');
    return Math.floor((b - a) / 86400000);
}

function addDays(dateStr, days) {
    const d = new Date(dateStr + 'T00:00:00');
    d.setDate(d.getDate() + days);
    return formatDate(d);
}

function formatDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}

export function parseWorldNsfwFields(messageText) {
    const result = {
        target: '',
        nsfw: null,
        risk: '',
        inside: null,
        protection: '',
        pregRisk: '',
        riskType: '',
        abortion: '',
        abortionType: '',
    };

    const text = String(messageText || '');
    if (!text) return result;

    let worldInner = '';
    const m1 = text.match(/\[\[\s*WORLD\s*\]\]([\s\S]*?)(\[\[\s*\/\s*WORLD\s*\]\]|\[\[\\\/WORLD\]\]|$)/i);
    const m2 = text.match(/<\s*WORLD\s*>([\s\S]*?)(<\s*\/\s*WORLD\s*>|$)/i);

    let tail = text;
    if (m1) {
        worldInner = m1[1] || '';
        const endToken = m1[2] || '';
        const endIndex = text.indexOf(endToken, m1.index);
        if (endIndex >= 0) {
            tail = text.slice(endIndex + endToken.length);
        }
    } else if (m2) {
        worldInner = m2[1] || '';
        const endToken = m2[2] || '';
        const endIndex = text.indexOf(endToken, m2.index);
        if (endIndex >= 0) {
            tail = text.slice(endIndex + endToken.length);
        }
    }

    const merged = `${worldInner}\n${tail}`;

    const readField = (key) => {
        const re = new RegExp(
            key + '\\s*[:=：]\\s*([\\s\\S]*?)(?=\\s*(?:\\||｜|;|；|\\n|\\r|$))',
            'i'
        );
        const mm = merged.match(re);
        return mm ? String(mm[1] || '').trim() : '';
    };

    const nsfwRaw = readField('nsfw');
    const riskRaw = readField('risk');
    const insideRaw = readField('inside');
    const protectionRaw = readField('protection');
    const targetRaw = readField('target');
    const pregRiskRaw = readField('preg_risk');
    const riskTypeRaw = readField('risk_type');
    const abortionRaw = readField('abortion');
    const abortionTypeRaw = readField('abortion_type');

    if (nsfwRaw) {
        const v = nsfwRaw.toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes') result.nsfw = 1;
        else if (v === '0' || v === 'false' || v === 'no') result.nsfw = 0;
    }

    if (insideRaw) {
        const v = insideRaw.toLowerCase();
        if (v === '1' || v === 'true' || v === 'yes') result.inside = 1;
        else if (v === '0' || v === 'false' || v === 'no') result.inside = 0;
    }

    result.risk = riskRaw ? riskRaw.toLowerCase() : '';
    result.protection = protectionRaw ? protectionRaw.toLowerCase() : '';
    result.target = targetRaw ? targetRaw.trim() : '';
    result.pregRisk = pregRiskRaw ? pregRiskRaw.toLowerCase() : '';
    result.riskType = riskTypeRaw ? riskTypeRaw.toLowerCase() : '';
    result.abortion = abortionRaw ? abortionRaw.toLowerCase() : '';
    result.abortionType = abortionTypeRaw ? abortionTypeRaw.toLowerCase() : '';

    return result;
}

export function detectNsfwFallbackWeak(messageText) {
    const text = String(messageText || '').toLowerCase();

    const hasNsfwHint =
        /(做爱|性交|内射|射在|精液|阴道|子宫|高潮|操|插入|sex|cum|inside|breed|impregnate)/i.test(
            text
        );
    const hasInsideHint =
        /(内射|射在里|射进|中出|cum inside|came inside|breed)/i.test(text);
    const hasProtectionHint =
        /(戴套|避孕套|安全套|condom|吃药|短效|紧急避孕|iud|上环|结扎|体外)/i.test(text);

    return {
        nsfw: hasNsfwHint ? true : null,
        inside: hasInsideHint ? true : null,
        risk: hasNsfwHint ? 'low' : 'unknown',
        protection: hasProtectionHint ? 'unknown' : 'unknown',
    };
}

export function getOvulationFactor(cycleStatus, cycleData) {
    if (!cycleStatus || !cycleData) return 0.9;

    if (cycleStatus.phase === 'ovulation') return 1.7;
    if (cycleStatus.phase === 'follicular') return 1.1;
    if (cycleStatus.phase === 'luteal') return 0.6;
    if (cycleStatus.phase === 'menstruation') return 0.2;
    return 0.9;
}

export function evaluateConception({
    dateStr,
    actorName,
    cycleStatus,
    cycleData,
    pregnancyState,
    nsfwInfo,
    settings,
    fertilityProfile = 'normal',
}) {
    if (!settings.pregnancyEnabled) {
        return { changed: false, reason: 'disabled' };
    }
    if (!nsfwInfo || (nsfwInfo.nsfw !== true && nsfwInfo.nsfw !== 1)) {
        return { changed: false, reason: 'not_nsfw' };
    }
    if (pregnancyState?.isPregnant) {
        return { changed: false, reason: 'already_pregnant' };
    }

    const inside = nsfwInfo.inside === true || nsfwInfo.inside === 1;
    const risk = nsfwInfo.risk && nsfwInfo.risk !== 'unknown' ? nsfwInfo.risk : 'low';
    const protection =
        nsfwInfo.protection && nsfwInfo.protection !== 'unknown' ? nsfwInfo.protection : 'unknown';

    let baseChance = DEFAULT_BASE_CHANCE[risk] ?? 0.03;
    const baseChanceRaw = baseChance;
    const riskFactor = RISK_MULTIPLIER[risk] ?? 0.5;
    baseChance *= riskFactor;

    const insideFactor = inside ? 1.35 : 0.35;
    baseChance *= insideFactor;

    const protectionFactor = PROTECTION_MULTIPLIER[protection] ?? 0.6;
    baseChance *= protectionFactor;

    const fertilityFactor = FERTILITY_PROFILE_MULTIPLIER[fertilityProfile] ?? 1.0;
    baseChance *= fertilityFactor;

    const cycleFactor = getOvulationFactor(cycleStatus, cycleData);
    baseChance *= cycleFactor;

    let ageFactor = 1.0;
    const age = cycleData?.age;
    if (typeof age === 'number') {
        if (age < 18) ageFactor = 0.8;
        else if (age >= 35 && age < 40) ageFactor = 0.85;
        else if (age >= 40) ageFactor = 0.55;
        baseChance *= ageFactor;
    }

    const randomJitter = 0.92 + Math.random() * 0.16;
    const finalChance = clamp(baseChance * randomJitter, 0, settings.pregnancyChanceCap ?? 0.35);

    const roll = Math.random();
    const success = roll < finalChance;

    if (!success) {
        return {
            changed: false,
            reason: 'roll_fail',
            detail: {
                actorName,
                baseChanceRaw,
                baseChance,
                finalChance,
                roll,
                risk,
                protection,
                inside,
                cycleFactor,
                riskFactor,
                protectionFactor,
                ageFactor,
                randomJitter,
                insideFactor,
                fertilityFactor,
            },
        };
    }

    return {
        changed: true,
        reason: 'conceived',
        next: {
            isPregnant: true,
            conceptionDate: dateStr,
            dueDate: addDays(cycleData?.lastPeriodStart || dateStr, 280),
            trimester: 1,
            week: 0,
            statusText: t('pregnancy.state.early'),
            lastUpdateDate: dateStr,
            partnerHint: '',
        },
        detail: {
            actorName,
            baseChanceRaw,
            baseChance,
            finalChance,
            roll,
            risk,
            protection,
            inside,
            cycleFactor,
            riskFactor,
            protectionFactor,
            ageFactor,
            randomJitter,
            insideFactor,
            fertilityFactor,
        },
    };
}

export function advancePregnancyState(state, dateStr, settings) {
    if (!state || !state.isPregnant || !state.conceptionDate) return state;
    if (state.lastUpdateDate === dateStr) return state;

    const days = dateDiffDays(state.conceptionDate, dateStr);
    const week = Math.max(0, Math.floor(days / 7));

    const next = { ...state };
    next.week = week;
    next.lastUpdateDate = dateStr;

    if (week < 13) {
        next.trimester = 1;
        next.statusText = t('pregnancy.state.early');
    } else if (week < 28) {
        next.trimester = 2;
        next.statusText = t('pregnancy.state.middle');
    } else if (week < 40) {
        next.trimester = 3;
        next.statusText = t('pregnancy.state.late');
    } else {
        next.trimester = 3;
        next.statusText = t('pregnancy.state.delivery');
    }

    if (settings.pregnancyEnableMiscarriage && week <= 12) {
        const risk = settings.pregnancyMiscarriageRisk ?? 0.02;
        if (Math.random() < clamp(risk, 0, 0.3)) {
            return {
                isPregnant: false,
                conceptionDate: '',
                dueDate: '',
                trimester: 0,
                week: 0,
                statusText: t('pregnancy.state.miscarriage'),
                lastUpdateDate: dateStr,
                ended: 'miscarriage',
            };
        }
    }

    if (week >= 40) {
        return {
            isPregnant: false,
            conceptionDate: '',
            dueDate: '',
            trimester: 0,
            week: 0,
            statusText: t('pregnancy.state.postpartum'),
            lastUpdateDate: dateStr,
            ended: 'delivery',
        };
    }

    return next;
}

export function evaluatePregnancyRiskEvent(pregnancyState, nsfwInfo, settings) {
    if (!pregnancyState || !pregnancyState.isPregnant) {
        return { changed: false, reason: 'not_pregnant' };
    }

    const pregRisk = nsfwInfo?.pregRisk || 'none';
    const riskType = nsfwInfo?.riskType || 'other';

    if (!pregRisk || pregRisk === 'none') {
        return { changed: false, reason: 'no_risk_event' };
    }

    const baseMap = { low: 0.01, medium: 0.03, high: 0.08 };
    let chance = baseMap[pregRisk] ?? 0;

    const typeFactorMap = {
        impact: 1.2,
        bdsm: 1.3,
        fall: 1.4,
        violence: 1.6,
        accident: 1.3,
        other: 1.0,
    };
    const typeFactor = typeFactorMap[riskType] ?? 1.0;
    chance *= typeFactor;

    const week = Number.isInteger(pregnancyState.week) ? pregnancyState.week : 0;
    let weekFactor = 1.0;
    if (week <= 12) weekFactor = 1.25;
    else if (week >= 28) weekFactor = 1.15;
    chance *= weekFactor;

    const cap = settings?.pregnancyRiskEventCap ?? 0.2;
    chance = clamp(chance, 0, cap);

    const roll = Math.random();
    const success = roll < chance;

    if (!success) {
        return {
            changed: false,
            reason: 'risk_roll_fail',
            detail: { pregRisk, riskType, chance, roll, typeFactor, weekFactor },
        };
    }

    return {
        changed: true,
        reason: 'risk_event_hit',
        next: {
            ...pregnancyState,
            isPregnant: false,
            conceptionDate: '',
            dueDate: '',
            trimester: 0,
            week: 0,
            statusText: t('pregnancy.state.miscarriage'),
            ended: 'risk_event',
        },
        detail: { pregRisk, riskType, chance, roll, typeFactor, weekFactor },
    };
}

export function evaluateAbortionEvent(pregnancyState, nsfwInfo) {
    if (!pregnancyState || !pregnancyState.isPregnant) {
        return { changed: false, reason: 'not_pregnant' };
    }

    const abortion = nsfwInfo?.abortion || '';
    const abortionType = nsfwInfo?.abortionType || '';

    const yesSet = new Set(['1', 'true', 'yes', 'y']);
    if (!yesSet.has(String(abortion).toLowerCase())) {
        return { changed: false, reason: 'no_abortion_event' };
    }

    const type = abortionType || 'unknown';
    let statusText = t('pregnancy.state.miscarriage');

    if (type === 'medical' || type === 'drug') {
        statusText = '已进行药流，进入恢复期';
    } else if (type === 'surgical') {
        statusText = '已进行人流，进入恢复期';
    } else if (type === 'spontaneous') {
        statusText = t('pregnancy.state.miscarriage');
    }

    return {
        changed: true,
        reason: 'abortion_event',
        next: {
            ...pregnancyState,
            isPregnant: false,
            conceptionDate: '',
            dueDate: '',
            trimester: 0,
            week: 0,
            statusText,
            ended: `abortion_${type}`,
        },
    };
}
