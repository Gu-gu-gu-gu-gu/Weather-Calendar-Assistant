import { t } from './i18n.js';

const FEMALE_KEYWORDS = [
    '女',
    '少女',
    '女性',
    '女孩',
    '女人',
    '姐',
    '妹',
    '母',
    '妻',
    '嫁',
    '公主',
    '女王',
    '皇后',
    '女仆',
    '侍女',
    '她的',
    '闺',
    '娘',
    '淑女',
    '小姐',
    'female',
    'girl',
    'woman',
    'she',
    'her',
    'lady',
    'maiden',
    'wife',
    'princess',
    'queen',
];

const MALE_KEYWORDS = [
    '男',
    '少年',
    '男性',
    '男孩',
    '男人',
    '兄',
    '弟',
    '父',
    '夫',
    '他的',
    '公',
    '王子',
    '勇者',
    '骑士',
    '先生',
    '少爷',
    'male',
    'boy',
    'man',
    'he',
    'him',
    'his',
    'prince',
    'king',
    'lord',
    'sir',
];

function getAgeGateOptions(options = {}) {
    const minAge = Number.isInteger(parseInt(options.minAge)) ? parseInt(options.minAge) : 12;
    const useMaxAge = options.useMaxAge !== false;
    let maxAge = Number.isInteger(parseInt(options.maxAge)) ? parseInt(options.maxAge) : 55;
    if (maxAge <= minAge) maxAge = minAge + 1;
    return { minAge, useMaxAge, maxAge };
}

function isAgeAllowed(age, options = {}) {
    if (typeof age !== 'number') return true;
    const gate = getAgeGateOptions(options);
    if (age < gate.minAge) return false;
    if (gate.useMaxAge && age >= gate.maxAge) return false;
    return true;
}

export function detectGenderInfo(descriptionText) {
    if (!descriptionText) return { gender: 'unknown', femaleCount: 0, maleCount: 0 };
    const lower = descriptionText.toLowerCase();
    let f = 0,
        m = 0;
    for (const kw of FEMALE_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) f++;
    }
    for (const kw of MALE_KEYWORDS) {
        if (lower.includes(kw.toLowerCase())) m++;
    }
    if (f > m) return { gender: 'female', femaleCount: f, maleCount: m };
    if (m > f) return { gender: 'male', femaleCount: f, maleCount: m };
    return { gender: 'unknown', femaleCount: f, maleCount: m };
}

export function detectGender(descriptionText) {
    return detectGenderInfo(descriptionText).gender;
}

export function initCycleForCharacter(characterName, worldDateStr, age = null, options = {}) {
    const baseDate = new Date(worldDateStr + 'T00:00:00');

    let cycleLength = 28 + Math.floor(Math.random() * 7) - 3;
    let periodDuration = 3 + Math.floor(Math.random() * 5);

    if (typeof age === 'number') {
        if (!isAgeAllowed(age, options)) return null;
        if (age <= 17) {
            cycleLength = 30 + Math.floor(Math.random() * 7);
            periodDuration = 3 + Math.floor(Math.random() * 4);
        } else if (age >= 40) {
            cycleLength = 24 + Math.floor(Math.random() * 11);
            periodDuration = 4 + Math.floor(Math.random() * 4);
        } else {
            cycleLength = 26 + Math.floor(Math.random() * 7);
            periodDuration = 3 + Math.floor(Math.random() * 4);
        }
    }

    const offset = Math.floor(Math.random() * cycleLength);
    const lastStart = new Date(baseDate);
    lastStart.setDate(lastStart.getDate() - offset);
    const lastStartStr = fmtDate(lastStart);

    return {
        characterName,
        cycleLength,
        periodDuration,
        lastPeriodStart: lastStartStr,
        skipNext: false,
        delayDays: 0,
        age: typeof age === 'number' ? age : null,
    };
}

export function getCycleStatus(cycleData, currentDateStr) {
    if (!cycleData || !cycleData.lastPeriodStart) return null;

    const current = new Date(currentDateStr + 'T00:00:00');
    const lastStart = new Date(cycleData.lastPeriodStart + 'T00:00:00');
    const diffDays = Math.floor((current - lastStart) / 86400000);

    if (diffDays < 0) {
        return { phase: 'unknown', dayInCycle: 0, onPeriod: false, description: '' };
    }

    let cycleLen = cycleData.cycleLength || 28;
    let periodLen = cycleData.periodDuration || 5;
    let delay = cycleData.delayDays || 0;

    const effectiveCycleLen = cycleLen + delay;
    const dayInCycle = diffDays % effectiveCycleLen;

    if (cycleData.skipNext && diffDays >= effectiveCycleLen && diffDays < effectiveCycleLen * 2) {
        return {
            phase: 'skipped',
            dayInCycle,
            onPeriod: false,
            description: t('cycle.skipped'),
        };
    }

    let phase, onPeriod, description;

    if (dayInCycle < periodLen) {
        phase = 'menstruation';
        onPeriod = true;
        const dayNum = dayInCycle + 1;
        description = t('cycle.menstruationDay', { day: dayNum });
        if (dayNum <= 2) description += t('cycle.menstruationDetail1');
        else if (dayNum <= 4) description += t('cycle.menstruationDetail2');
        else description += t('cycle.menstruationDetail3');
    } else if (dayInCycle < periodLen + 7) {
        phase = 'follicular';
        onPeriod = false;
        description = t('cycle.follicular');
    } else if (dayInCycle < periodLen + 10) {
        phase = 'ovulation';
        onPeriod = false;
        description = t('cycle.ovulation');
    } else {
        phase = 'luteal';
        onPeriod = false;
        const daysToNext = effectiveCycleLen - dayInCycle;
        if (daysToNext <= 5) {
            description = t('cycle.lutealPms');
        } else {
            description = t('cycle.luteal');
        }
    }

    return { phase, dayInCycle, onPeriod, description, periodLen, cycleLen: effectiveCycleLen };
}

export function advanceCycle(cycleData, currentDateStr) {
    const current = new Date(currentDateStr + 'T00:00:00');
    const lastStart = new Date(cycleData.lastPeriodStart + 'T00:00:00');
    const effectiveLen = (cycleData.cycleLength || 28) + (cycleData.delayDays || 0);
    const diffDays = Math.floor((current - lastStart) / 86400000);

    if (diffDays >= effectiveLen) {
        const newStart = new Date(lastStart);
        newStart.setDate(newStart.getDate() + effectiveLen);
        cycleData.lastPeriodStart = fmtDate(newStart);

        cycleData.delayDays = 0;
        cycleData.skipNext = false;

        let skipChance = 0.03;
        let delayChance = 0.18;
        const age = cycleData.age;

        if (typeof age === 'number') {
            if (age >= 45) {
                skipChance = 0.12;
                delayChance = 0.35;
            } else if (age >= 40) {
                skipChance = 0.06;
                delayChance = 0.25;
            } else if (age <= 17) {
                skipChance = 0.04;
                delayChance = 0.25;
            }
        }

        const rand = Math.random();
        if (rand < skipChance) {
            cycleData.skipNext = true;
        } else if (rand < skipChance + delayChance) {
            cycleData.delayDays = Math.floor(Math.random() * 7) - 3;
        }
    }

    return cycleData;
}

function fmtDate(d) {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${dd}`;
}
