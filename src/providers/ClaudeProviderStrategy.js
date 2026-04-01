import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import fetch from 'node-fetch';
import {captureCommand, runCommand} from '../CommandRunner.js';
import {getProxyAgent, getVpnAwareAgent, resolveProxyUrl} from '../../utils/ProxyAgentUtil.js';

const CLAUDE_FILE = path.join(os.homedir(), '.claude.json');
const KEYCHAIN_SERVICE = 'Claude Code-credentials';

function normalizePlan(plan) {
    const raw = String(plan || '').trim().toLowerCase();
    if (!raw) {
        return '';
    }
    if (raw === 'pro') {
        return 'Pro';
    }
    if (raw === 'max') {
        return 'Max';
    }
    if (raw === 'team') {
        return 'Team';
    }
    return raw.toUpperCase();
}

function formatResetAt(resetAt) {
    const parsed = new Date(String(resetAt || ''));
    if (Number.isNaN(parsed.getTime())) {
        return '';
    }
    const formatter = new Intl.DateTimeFormat('zh-CN', {
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
        month: '2-digit',
        day: '2-digit',
        timeZone: 'Asia/Shanghai'
    });
    const parts = formatter.formatToParts(parsed).reduce((accumulator, item) => {
        accumulator[item.type] = item.value;
        return accumulator;
    }, {});
    const hhmm = `${parts.hour || '00'}:${parts.minute || '00'}`;
    const today = new Date();
    if (today.getFullYear() === parsed.getFullYear() && today.getMonth() === parsed.getMonth() && today.getDate() === parsed.getDate()) {
        return `今日 ${hhmm} 恢复`;
    }
    return `${parts.month || '00'}-${parts.day || '00'} ${hhmm} 恢复`;
}

function parseCredentialPayload(rawCredential) {
    try {
        const payload = JSON.parse(rawCredential || '{}');
        return payload && typeof payload === 'object' ? payload : {};
    } catch {
        return {};
    }
}

function getClaudeOauthCredential(rawCredential) {
    const payload = parseCredentialPayload(rawCredential);
    const oauth = payload?.claudeAiOauth;
    return oauth && typeof oauth === 'object' ? oauth : {};
}

function isClaudeOauthExpired(rawCredential) {
    const expiresAt = Number(getClaudeOauthCredential(rawCredential)?.expiresAt || 0);
    if (!Number.isFinite(expiresAt) || expiresAt <= 0) {
        return false;
    }
    return Date.now() + 300000 >= expiresAt;
}

function formatClaudeOauthUsageWindow(window) {
    if (!window || typeof window !== 'object') {
        return '';
    }
    const usedPercent = Number(window.utilization);
    if (!Number.isFinite(usedPercent)) {
        return '';
    }
    const leftPercent = Math.max(0, 100 - Math.max(0, Math.min(100, Math.round(usedPercent))));
    const resetText = formatResetAt(window.resets_at);
    return `${leftPercent}% 剩余${resetText ? `（${resetText}）` : ''}`;
}

async function fetchClaudeOauthUsage(auth) {
    const oauth = getClaudeOauthCredential(auth?.credential || '');
    if (!oauth?.accessToken) {
        return {ok: false, reason: 'missing_access_token'};
    }
    if (!Array.isArray(oauth?.scopes) || !oauth.scopes.includes('user:profile')) {
        return {ok: false, reason: 'missing_profile_scope'};
    }
    if (isClaudeOauthExpired(auth?.credential || '')) {
        return {ok: false, reason: 'oauth_token_expired'};
    }
    try {
        const proxyUrl = resolveProxyUrl();
        const proxyAgent = getProxyAgent(proxyUrl);
        const vpnAgent = getVpnAwareAgent();
        const response = await fetch('https://api.anthropic.com/api/oauth/usage', {
            method: 'GET',
            headers: {
                Authorization: `Bearer ${oauth.accessToken}`,
                'anthropic-beta': 'oauth-2025-04-20',
                'User-Agent': 'claude-cli'
            },
            ...(proxyAgent ? {agent: proxyAgent} : {}),
            ...(!proxyAgent && vpnAgent ? {agent: vpnAgent} : {})
        });
        const text = await response.text();
        let payload = {};
        try {
            payload = JSON.parse(text || '{}');
        } catch {
            payload = {};
        }
        if (!response.ok) {
            if (response.status === 401) {
                return {ok: false, reason: 'oauth_token_expired'};
            }
            if (response.status === 403) {
                return {ok: false, reason: 'request_forbidden'};
            }
            return {
                ok: false,
                reason: `http_${response.status}`,
                errorMessage: payload?.message || payload?.error || ''
            };
        }
        const fiveHourLimit = formatClaudeOauthUsageWindow(payload?.five_hour);
        const weeklyLimit = formatClaudeOauthUsageWindow(payload?.seven_day);
        if (!fiveHourLimit && !weeklyLimit) {
            return {ok: false, reason: 'missing_rate_limits'};
        }
        return {
            ok: true,
            usage: {
                fiveHourLimit,
                weeklyLimit,
                source: 'claude_oauth_usage_api'
            }
        };
    } catch (error) {
        return {
            ok: false,
            reason: error?.message || 'fetch_failed'
        };
    }
}

function readClaudeJson() {
    if (!fs.existsSync(CLAUDE_FILE)) {
        return {};
    }
    try {
        return JSON.parse(fs.readFileSync(CLAUDE_FILE, 'utf-8'));
    } catch {
        return {};
    }
}

async function readClaudeAuthStatus() {
    const result = await captureCommand('claude', ['auth', 'status'], {timeoutMs: 12000});
    if (result.code !== 0) {
        return null;
    }
    try {
        return JSON.parse(result.stdout || '{}');
    } catch {
        return null;
    }
}

async function readKeychainCredential() {
    if (process.platform !== 'darwin') {
        return {ok: false, reason: 'unsupported_platform', value: ''};
    }
    const userName = process.env.USER || os.userInfo().username;
    const result = await captureCommand('security', [
        'find-generic-password',
        '-a',
        userName,
        '-w',
        '-s',
        KEYCHAIN_SERVICE
    ], {timeoutMs: 10000});
    if (result.code !== 0) {
        return {ok: false, reason: 'missing_keychain_credential', value: ''};
    }
    return {ok: true, reason: '', value: String(result.stdout || '').trim()};
}

async function writeKeychainCredential(value) {
    if (process.platform !== 'darwin') {
        throw new Error('当前平台暂不支持写入 Claude Keychain 凭证');
    }
    const userName = process.env.USER || os.userInfo().username;
    const result = await captureCommand('security', [
        'add-generic-password',
        '-a',
        userName,
        '-U',
        '-s',
        KEYCHAIN_SERVICE,
        '-w',
        value
    ], {timeoutMs: 10000});
    if (result.code !== 0) {
        throw new Error(result.stderr.trim() || result.stdout.trim() || '写入 Keychain 失败');
    }
}

function buildAccountInfo(auth) {
    const status = auth?.status || {};
    const oauthAccount = auth?.oauthAccount || {};
    const credential = parseCredentialPayload(auth?.credential || '');
    const oauthCredential = getClaudeOauthCredential(auth?.credential || '');
    const email = status.email || oauthAccount.emailAddress || '';
    const planType = status.subscriptionType || oauthCredential.subscriptionType || credential.subscriptionType || '';
    return {
        email,
        planType,
        planLabel: normalizePlan(planType),
        accountId: oauthAccount.accountUuid || '',
        userId: oauthAccount.accountUuid || '',
        orgId: status.orgId || oauthAccount.organizationUuid || '',
        orgName: status.orgName || oauthAccount.organizationName || '',
        displayText: email && planType ? `${email} (${normalizePlan(planType)})` : email || ''
    };
}

export class ClaudeProviderStrategy {
    constructor() {
        this.id = 'claude';
        this.displayName = 'Claude';
        this.commandName = 'claude';
    }

    async getCurrentAuth() {
        const claudeJson = readClaudeJson();
        const status = await readClaudeAuthStatus();
        const credentialResult = await readKeychainCredential();
        const oauthAccount = claudeJson?.oauthAccount || null;
        const credential = credentialResult.ok ? credentialResult.value : '';
        if (!oauthAccount && !status?.loggedIn && !credential) {
            return null;
        }
        return {
            claudeJson,
            oauthAccount,
            status,
            credential
        };
    }

    matchProfile(profile, auth) {
        const left = profile?.account || {};
        const right = buildAccountInfo(auth);
        if (left.accountId && right.accountId && left.accountId === right.accountId) {
            return true;
        }
        if (left.email && right.email && left.email === right.email) {
            return true;
        }
        if (left.orgId && right.orgId && left.orgId === right.orgId) {
            return true;
        }
        return false;
    }

    async buildProfile(auth, existingProfile = {}) {
        return {
            alias: existingProfile.alias || '',
            provider: this.id,
            auth,
            account: {
                ...buildAccountInfo(auth),
                ...(existingProfile.account || {})
            },
            usage: existingProfile.usage && typeof existingProfile.usage === 'object' ? existingProfile.usage : {},
            savedAt: existingProfile.savedAt || new Date().toISOString(),
            updatedAt: existingProfile.updatedAt || existingProfile.savedAt || new Date().toISOString()
        };
    }

    async refreshProfile(profile) {
        const originalAuth = await this.getCurrentAuth();
        const sameAccount = originalAuth && this.matchProfile({account: buildAccountInfo(originalAuth)}, profile.auth);
        const effectiveAuth = sameAccount ? originalAuth : profile.auth;
        const usageResult = await fetchClaudeOauthUsage(effectiveAuth);
        if (!usageResult.ok) {
            return {
                profile: {
                    ...profile,
                    auth: effectiveAuth,
                    provider: this.id,
                    account: {
                        ...buildAccountInfo(effectiveAuth),
                        ...(profile.account || {})
                    }
                },
                changed: false,
                ok: false,
                reason: usageResult.reason || 'fetch_failed',
                fetchedAt: new Date().toISOString()
            };
        }
        const fetchedAt = new Date().toISOString();
        return {
            profile: {
                ...profile,
                auth: effectiveAuth,
                provider: this.id,
                account: {
                    ...buildAccountInfo(effectiveAuth),
                    ...(profile.account || {})
                },
                usage: {
                    fiveHourLimit: usageResult.usage?.fiveHourLimit || '',
                    weeklyLimit: usageResult.usage?.weeklyLimit || '',
                    source: usageResult.usage?.source || '',
                    updatedAt: fetchedAt
                },
                updatedAt: fetchedAt
            },
            changed: true,
            ok: true,
            reason: '',
            fetchedAt
        };
    }

    async login(logger) {
        logger.info('准备启动 claude auth login，请按终端提示完成登录。');
        const result = await runCommand(this.commandName, ['auth', 'login']);
        if (result.code !== 0) {
            throw new Error(`claude auth login 退出码: ${result.code}`);
        }
        const auth = await this.getCurrentAuth();
        if (!auth) {
            throw new Error('登录完成后未检测到 Claude 登录态');
        }
        return auth;
    }

    isReloginRequired(reason) {
        const value = typeof reason === 'string'
            ? String(reason || '').trim()
            : String(reason?.reason || reason?.errorCode || '').trim();
        return ['oauth_token_expired', 'authentication_failed', 'missing_access_token', 'missing_profile_scope'].includes(value);
    }

    async activateProfile(profile) {
        const claudeJson = profile?.auth?.claudeJson || {};
        fs.writeFileSync(CLAUDE_FILE, JSON.stringify(claudeJson, null, 2), 'utf-8');
        if (profile?.auth?.credential) {
            await writeKeychainCredential(profile.auth.credential);
        }
    }

    async clearCurrentAuth() {
        await runCommand(this.commandName, ['auth', 'logout']);
    }

    async launchProfile(profile, args = []) {
        await this.activateProfile(profile);
        const result = await runCommand(this.commandName, args);
        return result.code;
    }

    getAccountEmail(profile) {
        return profile?.account?.email || profile?.account?.displayText || '-';
    }

    getPlanLabel(profile) {
        return profile?.account?.planLabel || '-';
    }

    suggestAlias(profile) {
        const email = profile?.account?.email || '';
        return email.includes('@') ? email.split('@')[0] : 'default';
    }
}
