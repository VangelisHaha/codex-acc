import fs from 'fs';
import os from 'os';
import path from 'path';

export const STORE_DIR = path.join(os.homedir(), '.codex');
export const STORE_FILE = path.join(STORE_DIR, 'codex-cc.json');

export function ensureStoreDir() {
    if (!fs.existsSync(STORE_DIR)) {
        fs.mkdirSync(STORE_DIR, {recursive: true});
    }
}

function normalizeCurrent(current) {
    if (!current || typeof current !== 'object' || Array.isArray(current)) {
        if (typeof current === 'string' && current) {
            return {codex: current, claude: null};
        }
        return {codex: null, claude: null};
    }
    return {
        codex: typeof current.codex === 'string' ? current.codex : null,
        claude: typeof current.claude === 'string' ? current.claude : null
    };
}

function normalizeProfile(alias, profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) {
        return null;
    }
    return {
        alias,
        provider: typeof profile.provider === 'string' ? profile.provider : 'codex',
        auth: profile.auth || profile.data || null,
        account: profile.account && typeof profile.account === 'object' ? profile.account : {},
        usage: profile.usage && typeof profile.usage === 'object' ? profile.usage : {},
        savedAt: profile.savedAt || profile.updatedAt || new Date().toISOString(),
        updatedAt: profile.updatedAt || profile.savedAt || new Date().toISOString()
    };
}

function readJsonFile(filePath) {
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch {
        return null;
    }
}

export function ensureStoreShape(store) {
    const nextStore = {
        current: normalizeCurrent(store?.current),
        profiles: {}
    };
    const profiles = store?.profiles && typeof store.profiles === 'object' && !Array.isArray(store.profiles)
        ? store.profiles
        : {};
    for (const [alias, profile] of Object.entries(profiles)) {
        const normalized = normalizeProfile(alias, profile);
        if (normalized?.auth) {
            nextStore.profiles[alias] = normalized;
        }
    }
    return nextStore;
}

export function listAliases(store) {
    return Object.keys(store?.profiles || {}).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

export function resolveAvailableAlias(store, preferredAlias = 'default') {
    const baseAlias = String(preferredAlias || 'default').trim() || 'default';
    if (!store?.profiles?.[baseAlias]) {
        return baseAlias;
    }
    let index = 2;
    while (store.profiles[`${baseAlias}-${index}`]) {
        index += 1;
    }
    return `${baseAlias}-${index}`;
}

function buildProfileIdentity(profile) {
    const provider = profile?.provider || 'codex';
    const accountId = profile?.account?.accountId || profile?.account?.userId || '';
    const email = profile?.account?.email || '';
    const orgId = profile?.account?.orgId || '';
    return `${provider}::${accountId || email || orgId}`;
}

function hasNumericSuffix(alias) {
    return /-\d+$/.test(String(alias || ''));
}

function pickPreferredAlias(store, leftAlias, rightAlias) {
    const currentAliases = new Set(Object.values(store.current || {}).filter(Boolean));
    if (currentAliases.has(leftAlias) && !currentAliases.has(rightAlias)) {
        return leftAlias;
    }
    if (currentAliases.has(rightAlias) && !currentAliases.has(leftAlias)) {
        return rightAlias;
    }
    if (hasNumericSuffix(leftAlias) && !hasNumericSuffix(rightAlias)) {
        return rightAlias;
    }
    if (hasNumericSuffix(rightAlias) && !hasNumericSuffix(leftAlias)) {
        return leftAlias;
    }
    if (String(leftAlias).length !== String(rightAlias).length) {
        return String(leftAlias).length < String(rightAlias).length ? leftAlias : rightAlias;
    }
    return String(leftAlias).localeCompare(String(rightAlias), 'zh-Hans-CN') <= 0 ? leftAlias : rightAlias;
}

function deduplicateProfiles(store) {
    const identityMap = new Map();
    let changed = false;
    for (const alias of listAliases(store)) {
        const identity = buildProfileIdentity(store.profiles[alias]);
        if (!identity || identity.endsWith('::')) {
            continue;
        }
        const existingAlias = identityMap.get(identity);
        if (!existingAlias) {
            identityMap.set(identity, alias);
            continue;
        }
        const preferredAlias = pickPreferredAlias(store, existingAlias, alias);
        const removedAlias = preferredAlias === existingAlias ? alias : existingAlias;
        if (preferredAlias !== existingAlias) {
            identityMap.set(identity, preferredAlias);
        }
        delete store.profiles[removedAlias];
        for (const providerId of Object.keys(store.current || {})) {
            if (store.current[providerId] === removedAlias) {
                store.current[providerId] = preferredAlias;
            }
        }
        changed = true;
    }
    return changed;
}

export function saveStore(store, logger = null) {
    ensureStoreDir();
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    } catch (error) {
        logger?.error?.(`保存 ${STORE_FILE} 失败: ${error.message}`);
        throw error;
    }
}

export function loadStore(logger = null) {
    ensureStoreDir();
    const rawStore = fs.existsSync(STORE_FILE) ? readJsonFile(STORE_FILE) : null;
    const store = ensureStoreShape(rawStore);
    const deduplicated = deduplicateProfiles(store);
    if (deduplicated) {
        logger?.info?.('检测到 codex-cc 存储中存在重复账号，已自动去重');
    }
    if (deduplicated) {
        saveStore(store, logger);
    }
    return store;
}
