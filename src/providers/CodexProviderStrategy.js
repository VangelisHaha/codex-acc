import fs from 'fs';
import os from 'os';
import path from 'path';
import {
    extractAccountInfo,
    extractAuthState,
    fetchRealtimeUsage,
    isAuthUnauthorizedFailure,
    normalizeUsageText,
    pickRealtimeLimits,
    refreshAuthTokenIfNeeded
} from '../account.js';
import {runCommand} from '../CommandRunner.js';

const CODEX_DIR = path.join(os.homedir(), '.codex');
const AUTH_FILE = path.join(CODEX_DIR, 'auth.json');

function ensureCodexDir() {
    if (!fs.existsSync(CODEX_DIR)) {
        fs.mkdirSync(CODEX_DIR, {recursive: true});
    }
}

function readAuthFile() {
    if (!fs.existsSync(AUTH_FILE)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    } catch {
        return null;
    }
}

function writeAuthFile(auth) {
    ensureCodexDir();
    fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf-8');
}

function removeAuthIfExists() {
    if (fs.existsSync(AUTH_FILE)) {
        fs.unlinkSync(AUTH_FILE);
    }
}

function normalizeUsageSnapshot(usage) {
    return {
        fiveHourLimit: normalizeUsageText(usage?.fiveHourLimit || ''),
        weeklyLimit: normalizeUsageText(usage?.weeklyLimit || ''),
        source: usage?.source || '',
        updatedAt: usage?.updatedAt || ''
    };
}

function isSameAccount(profile, targetAuth) {
    const targetAccount = extractAccountInfo(targetAuth);
    const targetState = extractAuthState(targetAuth);
    const profileAccount = profile?.account || {};
    const profileState = extractAuthState(profile?.auth);
    if (profileAccount.accountId && targetAccount.accountId && profileAccount.accountId === targetAccount.accountId) {
        return true;
    }
    if (profileState.accessToken && targetState.accessToken && profileState.accessToken === targetState.accessToken) {
        return true;
    }
    if (profileState.idToken && targetState.idToken && profileState.idToken === targetState.idToken) {
        return true;
    }
    const hasStrongIdentity = Boolean(
        profileAccount.accountId
        || targetAccount.accountId
        || profileState.accessToken
        || targetState.accessToken
        || profileState.idToken
        || targetState.idToken
    );
    if (hasStrongIdentity) {
        return false;
    }
    if (profileAccount.userId && targetAccount.userId && profileAccount.userId === targetAccount.userId) {
        return true;
    }
    if (profileAccount.email && targetAccount.email && profileAccount.email === targetAccount.email) {
        return true;
    }
    return false;
}

function suggestAlias(account) {
    const email = account?.email || '';
    return email.includes('@') ? email.split('@')[0] : 'default';
}

export class CodexProviderStrategy {
    constructor() {
        this.id = 'codex';
        this.displayName = 'Codex';
        this.commandName = 'codex';
    }

    async getCurrentAuth() {
        ensureCodexDir();
        return readAuthFile();
    }

    matchProfile(profile, auth) {
        return isSameAccount(profile, auth);
    }

    async buildProfile(auth, existingProfile = {}) {
        const profile = {
            alias: existingProfile.alias || '',
            provider: this.id,
            auth,
            account: {
                ...extractAccountInfo(auth),
                ...(existingProfile.account || {})
            },
            usage: normalizeUsageSnapshot(existingProfile.usage),
            savedAt: existingProfile.savedAt || new Date().toISOString(),
            updatedAt: existingProfile.updatedAt || existingProfile.savedAt || new Date().toISOString()
        };
        return (await this.refreshProfile(profile)).profile;
    }

    async refreshProfile(profile) {
        const nextProfile = {
            ...profile,
            provider: this.id,
            account: {
                ...extractAccountInfo(profile.auth),
                ...(profile.account || {})
            },
            usage: normalizeUsageSnapshot(profile.usage)
        };
        let changed = false;
        const proactiveRefresh = await refreshAuthTokenIfNeeded(nextProfile.auth, {timeoutMs: 15000});
        if (proactiveRefresh.ok && proactiveRefresh.changed) {
            nextProfile.auth = proactiveRefresh.auth;
            nextProfile.account = {
                ...extractAccountInfo(nextProfile.auth),
                ...(nextProfile.account || {})
            };
            changed = true;
        }
        const fetchedAt = new Date().toISOString();
        let realtime = await fetchRealtimeUsage(nextProfile.auth, {timeoutMs: 15000});
        if (!realtime.ok && isAuthUnauthorizedFailure(realtime)) {
            const recoveryRefresh = await refreshAuthTokenIfNeeded(nextProfile.auth, {
                timeoutMs: 15000,
                force: true
            });
            if (recoveryRefresh.ok && recoveryRefresh.changed) {
                nextProfile.auth = recoveryRefresh.auth;
                nextProfile.account = {
                    ...extractAccountInfo(nextProfile.auth),
                    ...(nextProfile.account || {})
                };
                changed = true;
            }
            if (recoveryRefresh.ok) {
                realtime = await fetchRealtimeUsage(nextProfile.auth, {timeoutMs: 15000});
            } else {
                return {
                    profile: nextProfile,
                    changed,
                    ok: false,
                    reason: recoveryRefresh,
                    fetchedAt
                };
            }
        }
        if (!realtime.ok) {
            return {
                profile: nextProfile,
                changed,
                ok: false,
                reason: realtime,
                fetchedAt
            };
        }
        const limits = pickRealtimeLimits(realtime.payload || {});
        const nextUsage = {
            fiveHourLimit: limits.fiveHourLimit || '',
            weeklyLimit: limits.weeklyLimit || '',
            source: 'realtime_usage_api',
            updatedAt: fetchedAt
        };
        changed = changed
            || nextUsage.fiveHourLimit !== nextProfile.usage.fiveHourLimit
            || nextUsage.weeklyLimit !== nextProfile.usage.weeklyLimit;
        nextProfile.usage = nextUsage;
        nextProfile.updatedAt = fetchedAt;
        return {
            profile: nextProfile,
            changed,
            ok: true,
            reason: '',
            fetchedAt
        };
    }

    async login(logger) {
        const previousAuth = readAuthFile();
        removeAuthIfExists();
        logger.info('准备启动 codex login，请按终端提示完成登录。');
        const result = await runCommand(this.commandName, ['login']);
        if (result.code !== 0) {
            if (previousAuth) {
                writeAuthFile(previousAuth);
            }
            throw new Error(`codex login 退出码: ${result.code}`);
        }
        const auth = readAuthFile();
        if (!auth) {
            if (previousAuth) {
                writeAuthFile(previousAuth);
            }
            throw new Error('登录完成后未检测到 ~/.codex/auth.json');
        }
        return auth;
    }

    async relogin(logger) {
        return this.login(logger);
    }

    isReloginRequired(reason) {
        if (!reason) {
            return false;
        }
        if (typeof reason === 'object') {
            const errorCode = String(reason.errorCode || '').trim();
            if (['refresh_token_expired', 'refresh_token_reused', 'refresh_token_invalidated', 'token_expired'].includes(errorCode)) {
                return true;
            }
            const nestedReason = String(reason.reason || '').trim();
            if (['missing_refresh_token', 'missing_access_token', 'refresh_unauthorized', 'http_401', 'http_402'].includes(nestedReason)) {
                return true;
            }
            if (nestedReason.startsWith('refresh_http_')) {
                const status = nestedReason.slice('refresh_http_'.length);
                return ['400', '401', '403'].includes(status);
            }
            return false;
        }
        return ['missing_refresh_token', 'missing_access_token', 'http_401', 'http_402'].includes(String(reason).trim());
    }

    async activateProfile(profile) {
        writeAuthFile(profile.auth);
    }

    async clearCurrentAuth() {
        removeAuthIfExists();
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
        return suggestAlias(profile?.account);
    }
}
