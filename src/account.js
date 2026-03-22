import fetch from 'node-fetch';
import {getProxyAgent, getVpnAwareAgent, resolveProxyUrl} from '../utils/ProxyAgentUtil.js';

function normalize(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim();
}

export function stripAnsi(text) {
    return String(text || '')
        .replace(/\u001B\][^\u0007]*(?:\u0007|\u001B\\)/g, '')
        .replace(/\u001B\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/[\u0000-\u0008\u000B-\u001F\u007F]/g, '');
}

function compactLine(line) {
    return stripAnsi(line)
        .replace(/[│╭╮╰╯]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function pickLine(lines, prefix) {
    const lowerPrefix = normalize(prefix).toLowerCase();
    return lines.find(item => compactLine(item).toLowerCase().startsWith(lowerPrefix)) || '';
}

function extractValue(line) {
    const text = compactLine(line);
    if (!text) {
        return '';
    }
    const index = text.indexOf(':');
    return index >= 0 ? text.slice(index + 1).trim() : text;
}

export function parseStatusText(rawText) {
    const lines = String(rawText || '').split(/\r?\n/).map(compactLine).filter(Boolean);
    return {
        account: extractValue(pickLine(lines, 'Account:')),
        fiveHourLimit: normalizeUsageText(extractValue(pickLine(lines, '5h limit:'))),
        weeklyLimit: normalizeUsageText(extractValue(pickLine(lines, 'Weekly limit:'))),
        rawOutput: lines.slice(-50).join('\n')
    };
}

export function decodeJwtPayload(token) {
    const parts = String(token || '').split('.');
    if (parts.length < 2) {
        return {};
    }
    try {
        const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
        const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=');
        return JSON.parse(Buffer.from(padded, 'base64').toString('utf-8'));
    } catch (error) {
        return {};
    }
}

export function safeJsonParse(text) {
    try {
        return JSON.parse(text);
    } catch (error) {
        return null;
    }
}

function formatResetAt(resetAt) {
    const seconds = Number(resetAt || 0);
    if (!Number.isFinite(seconds) || seconds <= 0) {
        return '';
    }
    const date = new Date(seconds * 1000);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    const formatter = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai'
    });
    const parts = formatter.formatToParts(date).reduce((accumulator, item) => {
        accumulator[item.type] = item.value;
        return accumulator;
    }, {});
    const hhmm = `${parts.hour || '00'}:${parts.minute || '00'}`;
    const today = new Date();
    const sameYear = today.getFullYear() === date.getFullYear();
    const sameMonth = today.getMonth() === date.getMonth();
    const sameDate = today.getDate() === date.getDate();
    if (sameYear && sameMonth && sameDate) {
        return `今日 ${hhmm} 恢复`;
    }
    return `${parts.month || '00'}-${parts.day || '00'} ${hhmm} 恢复`;
}

function buildLimitText(window) {
    const usedPercent = Number(window?.used_percent ?? window?.usedPercent);
    if (!Number.isFinite(usedPercent)) {
        return '';
    }
    const leftPercent = Math.max(0, 100 - Math.max(0, Math.min(100, Math.round(usedPercent))));
    const resetText = formatResetAt(window?.reset_at ?? window?.resetAt);
    return `${leftPercent}% 剩余${resetText ? `（${resetText}）` : ''}`;
}

function normalizeMonth(monthText) {
    const monthMap = {
        jan: '01',
        feb: '02',
        mar: '03',
        apr: '04',
        may: '05',
        jun: '06',
        jul: '07',
        aug: '08',
        sep: '09',
        oct: '10',
        nov: '11',
        dec: '12'
    };
    return monthMap[String(monthText || '').trim().toLowerCase()] || '';
}

function normalizeResetText(raw) {
    const text = normalize(raw);
    if (!text) {
        return '';
    }
    if (text.includes('恢复')) {
        return text.replace(/^on\s+/i, '').trim();
    }
    const todayMatch = text.match(/^today\s+(\d{1,2}:\d{2})$/i);
    if (todayMatch) {
        return `今日 ${todayMatch[1]} 恢复`;
    }
    const mdHmMatch = text.match(/^(\d{2}-\d{2})\s+(\d{1,2}:\d{2})$/i);
    if (mdHmMatch) {
        return `${mdHmMatch[1]} ${mdHmMatch[2]} 恢复`;
    }
    const englishMatch = text.match(/^(\d{1,2}:\d{2})\s+on\s+(\d{1,2})\s+([A-Za-z]{3})$/i);
    if (englishMatch) {
        const month = normalizeMonth(englishMatch[3]);
        const day = String(englishMatch[2]).padStart(2, '0');
        if (month) {
            return `${month}-${day} ${englishMatch[1]} 恢复`;
        }
    }
    return text;
}

export function normalizeUsageText(rawText) {
    const text = stripAnsi(String(rawText || ''))
        .replace(/\[[^\]]*]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!text || text === '-') {
        return '';
    }
    const cnMatch = text.match(/(\d+)%\s*剩余(?:[（(]([^）)]+)[）)])?/);
    if (cnMatch) {
        const resetText = normalizeResetText(cnMatch[2] || '');
        return `${cnMatch[1]}% 剩余${resetText ? `（${resetText}）` : ''}`;
    }
    const enMatch = text.match(/(\d+)%\s*left(?:\s*\(resets?\s+([^)]+)\))?/i);
    if (enMatch) {
        const resetText = normalizeResetText(enMatch[2] || '');
        return `${enMatch[1]}% 剩余${resetText ? `（${resetText}）` : ''}`;
    }
    const percentMatch = text.match(/(\d+)%/);
    if (percentMatch) {
        return `${percentMatch[1]}% 剩余`;
    }
    return text;
}

export function pickRealtimeLimits(payload) {
    const primary = payload?.rate_limit?.primary_window || null;
    const secondary = payload?.rate_limit?.secondary_window || null;
    const additional = Array.isArray(payload?.additional_rate_limits) ? payload.additional_rate_limits : [];
    const weeklyCandidate = additional.find(item => {
        const feature = normalize(item?.metered_feature).toLowerCase();
        const name = normalize(item?.limit_name).toLowerCase();
        return feature.includes('weekly') || name.includes('weekly');
    }) || additional[0] || null;
    return {
        fiveHourLimit: normalizeUsageText(buildLimitText(primary)),
        weeklyLimit: normalizeUsageText(buildLimitText(weeklyCandidate?.rate_limit?.primary_window || secondary))
    };
}

function normalizePlan(plan) {
    const raw = normalize(plan).toLowerCase();
    if (!raw) {
        return '';
    }
    if (raw === 'team') {
        return 'Team';
    }
    if (raw === 'pro') {
        return 'Pro';
    }
    if (raw === 'plus') {
        return 'Plus';
    }
    return raw.toUpperCase();
}

export function extractAuthState(auth) {
    if (!auth || typeof auth !== 'object' || Array.isArray(auth)) {
        return {
            accessToken: '',
            idToken: '',
            accountId: '',
            authMode: ''
        };
    }
    return {
        accessToken: normalize(auth?.tokens?.access_token),
        idToken: normalize(auth?.tokens?.id_token),
        accountId: normalize(auth?.tokens?.account_id || auth?.account_id),
        authMode: normalize(auth?.auth_mode)
    };
}

export function extractAccountInfo(auth) {
    const authState = extractAuthState(auth);
    const payload = decodeJwtPayload(authState.accessToken || authState.idToken || '');
    const profileInfo = payload?.['https://api.openai.com/profile'] || {};
    const authInfo = payload?.['https://api.openai.com/auth'] || {};
    const email = normalize(profileInfo?.email || payload?.email);
    const planType = normalize(authInfo?.chatgpt_plan_type);
    const accountId = normalize(authInfo?.chatgpt_account_id || authState.accountId);
    const userId = normalize(authInfo?.chatgpt_user_id || authInfo?.user_id);
    return {
        email,
        planType,
        planLabel: normalizePlan(planType),
        accountId,
        userId,
        authMode: authState.authMode,
        displayText: email && planType ? `${email} (${normalizePlan(planType)})` : email || ''
    };
}

export async function fetchRealtimeUsage(auth, options = {}) {
    const {
        timeoutMs = 8000,
        chatgptBaseUrl = 'https://chatgpt.com/backend-api'
    } = options;
    const authState = extractAuthState(auth);
    if (!authState.accessToken) {
        return {ok: false, reason: 'missing_access_token'};
    }
    const headers = {
        Authorization: `Bearer ${authState.accessToken}`,
        'User-Agent': 'codex-cli'
    };
    if (authState.accountId) {
        headers['ChatGPT-Account-Id'] = authState.accountId;
    }
    const proxyUrl = resolveProxyUrl();
    const proxyAgent = getProxyAgent(proxyUrl);
    const vpnAgent = getVpnAwareAgent();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(`${chatgptBaseUrl}/wham/usage`, {
            method: 'GET',
            headers,
            signal: controller.signal,
            ...(proxyAgent ? {agent: proxyAgent} : {}),
            ...(!proxyAgent && vpnAgent ? {agent: vpnAgent} : {})
        });
        const text = await response.text();
        if (!response.ok) {
            return {
                ok: false,
                reason: `http_${response.status}`,
                output: stripAnsi(text).slice(0, 500),
                debug: {
                    proxyUrl,
                    chatgptBaseUrl
                }
            };
        }
        const payload = safeJsonParse(text);
        if (!payload) {
            return {
                ok: false,
                reason: 'invalid_json',
                output: stripAnsi(text).slice(0, 500),
                debug: {
                    proxyUrl,
                    chatgptBaseUrl
                }
            };
        }
        return {
            ok: true,
            payload,
            rawOutput: JSON.stringify(payload),
            debug: {
                proxyUrl,
                chatgptBaseUrl
            }
        };
    } catch (error) {
        return {
            ok: false,
            reason: error?.name === 'AbortError' ? 'timeout' : normalize(error?.message || 'fetch_failed'),
            debug: {
                proxyUrl,
                chatgptBaseUrl
            }
        };
    } finally {
        clearTimeout(timer);
    }
}
