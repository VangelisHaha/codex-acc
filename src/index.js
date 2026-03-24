import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';
import {spawn} from 'child_process';
import chalk from 'chalk';
import Table from 'cli-table3';
import {
    extractAccountInfo,
    extractAuthState,
    fetchRealtimeUsage,
    normalizeUsageText,
    pickRealtimeLimits
} from './account.js';
import {createLogger} from '../utils/Logger.js';
import {safePrompt} from '../utils/PromptUtil.js';

const logger = createLogger('CODEX-CC');
const CODEX_DIR = path.join(os.homedir(), '.codex');
const AUTH_FILE = path.join(CODEX_DIR, 'auth.json');
const STORE_FILE = path.join(CODEX_DIR, 'codex-cc.json');
const RESERVED_COMMANDS = new Set(['login', 'list', 'clear', 'rename', 'help']);

export async function execute(args = []) {
    ensureCodexDir();
    const [command, ...restArgs] = args;
    const store = loadStore();
    migrateStore(store);
    await ensureCurrentAuthProfile(store, command);

    if (!command) {
        await handleInteractiveLaunch(store);
        return;
    }
    if (command === 'login') {
        await handleLogin(store);
        return;
    }
    if (command === 'list') {
        await handleList(store);
        return;
    }
    if (command === 'clear') {
        handleClear();
        return;
    }
    if (command === 'rename') {
        await handleRename(store, restArgs);
        return;
    }
    if (command === 'help' || command === '-h' || command === '--help') {
        printHelp();
        return;
    }
    await launchProfile(store, command, restArgs);
}

function printHelp() {
    console.log(chalk.cyan('codex-cc 命令使用方式:'));
    console.log('  codex-cc login                       登录 Codex 并保存为别名账号');
    console.log('  codex-cc list                        查看已保存账号和额度');
    console.log('  codex-cc clear                       删除当前 ~/.codex/auth.json');
    console.log('  codex-cc rename <旧别名> <新别名>    重命名已保存账号别名');
    console.log('  codex-cc <别名> [Codex 参数]         切换指定账号并启动 codex');
}

async function ensureCurrentAuthProfile(store, command) {
    if (!shouldAutoAddCurrentProfile(command)) {
        return;
    }
    const currentAuth = readAuthFile();
    if (!currentAuth) {
        return;
    }
    const matchedAlias = findMatchingAlias(store, currentAuth);
    if (matchedAlias) {
        if (store.current !== matchedAlias) {
            store.current = matchedAlias;
            saveStore(store);
        }
        return;
    }
    const alias = resolveAutoAddedAlias(store);
    const profile = await buildProfileSnapshot(currentAuth, alias);
    profile.alias = alias;
    store.profiles[alias] = profile;
    store.current = alias;
    saveStore(store);
    logger.info(`检测到当前登录态未加入账号列表，已自动保存为别名 ${alias}`);
}

function shouldAutoAddCurrentProfile(command) {
    return !command || !['login', 'clear', 'rename', 'help', '-h', '--help'].includes(command);
}

async function handleInteractiveLaunch(store) {
    const aliases = listProfileAliases(store).sort((left, right) => compareProfiles(store.profiles[right], store.profiles[left]));
    if (aliases.length === 0) {
        logger.warn('暂无已保存账号，请先执行 codex-cc login。');
        process.exitCode = 1;
        return;
    }
    const answer = await safePrompt([
        {
            type: 'list',
            name: 'alias',
            message: '选择要启动的 Codex 账号:',
            choices: aliases.map(alias => {
                const profile = store.profiles[alias];
                return {
                    name: buildAliasChoiceLabel(alias, profile, alias === store.current),
                    value: alias
                };
            }),
            pageSize: Math.min(10, aliases.length)
        }
    ], {logger});
    if (!answer?.alias) {
        process.exitCode = 1;
        return;
    }
    await launchProfile(store, answer.alias, []);
}

async function handleLogin(store) {
    const previousAuth = readAuthFile();
    removeAuthIfExists();
    logger.info('准备启动 codex login，请按终端提示完成登录。');
    const exitCode = await runCodex(['login']);
    if (exitCode !== 0) {
        restoreAuthIfNeeded(previousAuth);
        logger.error(`codex login 退出码: ${exitCode}`);
        process.exitCode = exitCode || 1;
        return;
    }
    const auth = readAuthFile();
    if (!auth) {
        restoreAuthIfNeeded(previousAuth);
        logger.error('登录完成后未检测到 ~/.codex/auth.json。');
        process.exitCode = 1;
        return;
    }
    const profile = await buildProfileSnapshot(auth, null);
    printAccountSummary('当前登录账号', profile);
    const alias = await promptAlias(store, suggestAlias(profile.account));
    if (!alias) {
        process.exitCode = 1;
        return;
    }
    profile.alias = alias;
    store.profiles[alias] = profile;
    store.current = alias;
    saveStore(store);
    logger.success(`账号已保存为别名 ${alias}`);
}

async function handleList(store) {
    const aliases = listProfileAliases(store).sort((left, right) => compareProfiles(store.profiles[right], store.profiles[left]));
    if (aliases.length === 0) {
        logger.warn('暂无已保存账号，请先执行 codex-cc login。');
        return;
    }
    const concurrency = resolveListConcurrency(aliases.length);
    logger.info(`开始并发查询 ${aliases.length} 个账号额度（并发 ${concurrency}）...`);
    let changed = false;
    const rows = await mapWithConcurrency(aliases, concurrency, async alias => {
        logger.info(`[${alias}] 开始查询实时额度...`);
        const refreshed = await refreshProfileUsage(store.profiles[alias]);
        store.profiles[alias] = refreshed.profile;
        changed = changed || refreshed.changed;
        const fetchedAt = refreshed.fetchedAt || new Date().toISOString();
        if (refreshed.ok) {
            logger.success(`[${alias}] 实时额度查询成功：5h=${refreshed.profile.usage?.fiveHourLimit || '-'}，周=${refreshed.profile.usage?.weeklyLimit || '-'}`);
        } else {
            logger.warn(`[${alias}] 实时额度查询失败：${formatFetchReason(refreshed.reason)}`);
        }
        return {
            当前: alias === store.current ? '是' : '',
            别名: alias,
            账号: refreshed.profile.account?.email || refreshed.profile.account?.displayText || '-',
            套餐: refreshed.profile.account?.planLabel || '-',
            '5h额度': refreshed.ok ? formatUsageForDisplay(refreshed.profile.usage?.fiveHourLimit) : '查询失败',
            周额度: refreshed.ok ? formatUsageForDisplay(refreshed.profile.usage?.weeklyLimit) : '查询失败',
            更新时间: refreshed.ok ? formatTime(fetchedAt) : '-',
            _weeklyPercent: refreshed.ok ? extractRemainingPercent(refreshed.profile.usage?.weeklyLimit) : -1,
            _fiveHourPercent: refreshed.ok ? extractRemainingPercent(refreshed.profile.usage?.fiveHourLimit) : -1
        };
    });
    if (changed) {
        try {
            saveStore(store);
        } catch (error) {
        }
    }
    rows.sort((left, right) => compareDisplayRows(right, left));
    renderProfileTable(rows);
}

function handleClear() {
    if (!fs.existsSync(AUTH_FILE)) {
        logger.info('未检测到 ~/.codex/auth.json，无需清理。');
        return;
    }
    try {
        fs.unlinkSync(AUTH_FILE);
        logger.success('已删除 ~/.codex/auth.json');
    } catch (error) {
        logger.error(`删除 ~/.codex/auth.json 失败: ${error.message}`);
        process.exitCode = 1;
    }
}

async function handleRename(store, args = []) {
    const [sourceAlias, targetAliasInput] = args;
    if (!sourceAlias || !targetAliasInput) {
        logger.error('用法: codex-cc rename <旧别名> <新别名>');
        process.exitCode = 1;
        return;
    }
    if (!store.profiles[sourceAlias]) {
        logger.error(`账号别名 ${sourceAlias} 不存在。`);
        process.exitCode = 1;
        return;
    }
    const targetValidation = validateAlias(targetAliasInput);
    if (targetValidation !== true) {
        logger.error(String(targetValidation));
        process.exitCode = 1;
        return;
    }
    const targetAlias = targetAliasInput.trim();
    if (sourceAlias === targetAlias) {
        logger.info(`别名未变化，仍为 ${sourceAlias}`);
        return;
    }
    if (store.profiles[targetAlias]) {
        logger.error(`目标别名 ${targetAlias} 已存在。`);
        process.exitCode = 1;
        return;
    }
    const profile = {
        ...store.profiles[sourceAlias],
        alias: targetAlias
    };
    delete store.profiles[sourceAlias];
    store.profiles[targetAlias] = profile;
    if (store.current === sourceAlias) {
        store.current = targetAlias;
    }
    saveStore(store);
    logger.success(`已将账号别名 ${sourceAlias} 重命名为 ${targetAlias}`);
}

async function launchProfile(store, alias, codexArgs = []) {
    const profile = store.profiles[alias];
    if (!profile) {
        logger.error(`账号别名 ${alias} 不存在，请先执行 codex-cc login。`);
        process.exitCode = 1;
        return;
    }
    await writeAuthFile(profile.auth);
    const refreshed = await refreshProfileUsage(profile);
    store.profiles[alias] = refreshed.profile;
    store.current = alias;
    saveStore(store);
    printAccountSummary(`当前账号 ${alias}`, refreshed.profile);
    const exitCode = await runCodex(codexArgs);
    if (exitCode !== 0) {
        logger.error(`codex 退出码: ${exitCode}`);
        process.exitCode = exitCode || 1;
    }
}

function ensureCodexDir() {
    if (!fs.existsSync(CODEX_DIR)) {
        fs.mkdirSync(CODEX_DIR, {recursive: true});
    }
}

function loadStore() {
    if (!fs.existsSync(STORE_FILE)) {
        return {current: null, profiles: {}};
    }
    try {
        return ensureStoreShape(JSON.parse(fs.readFileSync(STORE_FILE, 'utf-8')));
    } catch (error) {
        logger.warn(`读取 ${STORE_FILE} 失败，将使用空配置: ${error.message}`);
        return {current: null, profiles: {}};
    }
}

function ensureStoreShape(store) {
    if (!store || typeof store !== 'object' || Array.isArray(store)) {
        return {current: null, profiles: {}};
    }
    if (!store.profiles || typeof store.profiles !== 'object' || Array.isArray(store.profiles)) {
        store.profiles = {};
    }
    store.current = typeof store.current === 'string' ? store.current : null;
    return store;
}

function migrateStore(store) {
    let changed = false;
    for (const alias of Object.keys(store.profiles || {})) {
        const current = store.profiles[alias];
        if (!current || typeof current !== 'object') {
            delete store.profiles[alias];
            changed = true;
            continue;
        }
        if (current.data && !current.auth) {
            store.profiles[alias] = buildProfileFromAuth(alias, current.data, current);
            changed = true;
            continue;
        }
        if (!current.auth && current.tokens) {
            store.profiles[alias] = buildProfileFromAuth(alias, current, current);
            changed = true;
        }
    }
    if (changed) {
        saveStore(store);
    }
}

function buildProfileFromAuth(alias, auth, overrides = {}) {
    const now = new Date().toISOString();
    return {
        alias,
        auth,
        account: {
            ...extractAccountInfo(auth),
            ...(overrides.account || {})
        },
        usage: normalizeUsageSnapshot(overrides.usage),
        savedAt: overrides.savedAt || now,
        updatedAt: overrides.updatedAt || overrides.savedAt || now
    };
}

async function buildProfileSnapshot(auth, alias) {
    return (await refreshProfileUsage(buildProfileFromAuth(alias || '', auth))).profile;
}

function findMatchingAlias(store, auth) {
    const targetAccount = extractAccountInfo(auth);
    const targetState = extractAuthState(auth);
    for (const alias of listProfileAliases(store)) {
        const profile = store.profiles[alias];
        if (isSameAccount(profile, targetAccount, targetState)) {
            return alias;
        }
    }
    return '';
}

function isSameAccount(profile, targetAccount, targetState) {
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

function resolveAutoAddedAlias(store) {
    if (!store.profiles.default) {
        return 'default';
    }
    let index = 2;
    while (store.profiles[`default-${index}`]) {
        index += 1;
    }
    return `default-${index}`;
}

async function refreshProfileUsage(profile) {
    const nextProfile = {
        ...profile,
        account: {
            ...extractAccountInfo(profile.auth),
            ...(profile.account || {})
        },
        usage: normalizeUsageSnapshot(profile.usage)
    };
    const fetchedAt = new Date().toISOString();
    const realtime = await fetchRealtimeUsage(nextProfile.auth, {timeoutMs: 15000});
    if (!realtime.ok) {
        return {
            profile: nextProfile,
            changed: false,
            ok: false,
            reason: realtime.reason || 'fetch_failed',
            fetchedAt
        };
    }
    const limits = pickRealtimeLimits(realtime.payload || {});
    const nextUsage = {
        fiveHourLimit: limits.fiveHourLimit || nextProfile.usage.fiveHourLimit || '',
        weeklyLimit: limits.weeklyLimit || nextProfile.usage.weeklyLimit || '',
        source: 'realtime_usage_api',
        updatedAt: fetchedAt
    };
    const changed = nextUsage.fiveHourLimit !== nextProfile.usage.fiveHourLimit
        || nextUsage.weeklyLimit !== nextProfile.usage.weeklyLimit;
    nextProfile.usage = nextUsage;
    nextProfile.updatedAt = fetchedAt;
    return {profile: nextProfile, changed, ok: true, reason: '', fetchedAt};
}

function normalizeUsageSnapshot(usage) {
    return {
        fiveHourLimit: normalizeUsageText(usage?.fiveHourLimit || ''),
        weeklyLimit: normalizeUsageText(usage?.weeklyLimit || ''),
        source: usage?.source || '',
        updatedAt: usage?.updatedAt || ''
    };
}

function listProfileAliases(store) {
    return Object.keys(store.profiles || {}).sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'));
}

function buildAliasChoiceLabel(alias, profile, isCurrent) {
    const currentText = isCurrent ? ' [当前]' : '';
    const email = profile?.account?.email || profile?.account?.displayText || '未知账号';
    const plan = profile?.account?.planLabel ? ` / ${profile.account.planLabel}` : '';
    const fiveHour = profile?.usage?.fiveHourLimit ? ` / 5h:${formatUsageForDisplay(profile.usage.fiveHourLimit)}` : '';
    const weekly = profile?.usage?.weeklyLimit ? ` / 周:${formatUsageForDisplay(profile.usage.weeklyLimit)}` : '';
    return `${alias}${currentText} - ${email}${plan}${fiveHour}${weekly}`;
}

async function promptAlias(store, defaultAlias) {
    while (true) {
        const answer = await safePrompt([
            {
                type: 'input',
                name: 'alias',
                message: '请输入账号别名:',
                default: defaultAlias || undefined,
                validate: input => validateAlias(input)
            }
        ], {logger});
        const alias = answer?.alias?.trim();
        if (!alias) {
            return null;
        }
        if (!store.profiles[alias]) {
            return alias;
        }
        const confirmed = await safePrompt([
            {
                type: 'confirm',
                name: 'overwrite',
                message: `别名 ${alias} 已存在，是否覆盖？`,
                default: false
            }
        ], {logger});
        if (!confirmed) {
            return null;
        }
        if (confirmed.overwrite) {
            return alias;
        }
    }
}

function validateAlias(input) {
    const alias = String(input || '').trim();
    if (!alias) {
        return '别名不能为空';
    }
    if (RESERVED_COMMANDS.has(alias)) {
        return `别名不能与内置命令 ${alias} 冲突`;
    }
    if (/\s/.test(alias)) {
        return '别名不能包含空白字符';
    }
    if (/[\\/]/.test(alias)) {
        return '别名不能包含路径分隔符';
    }
    return true;
}

function suggestAlias(account) {
    const email = account?.email || '';
    return email.includes('@') ? email.split('@')[0] : 'default';
}

async function writeAuthFile(auth) {
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf-8');
    } catch (error) {
        logger.error(`写入 ~/.codex/auth.json 失败: ${error.message}`);
        process.exitCode = 1;
        throw error;
    }
}

function readAuthFile() {
    if (!fs.existsSync(AUTH_FILE)) {
        return null;
    }
    try {
        return JSON.parse(fs.readFileSync(AUTH_FILE, 'utf-8'));
    } catch (error) {
        logger.error(`读取 ~/.codex/auth.json 失败: ${error.message}`);
        return null;
    }
}

function removeAuthIfExists() {
    if (!fs.existsSync(AUTH_FILE)) {
        return;
    }
    try {
        fs.unlinkSync(AUTH_FILE);
    } catch (error) {
        logger.error(`删除 ~/.codex/auth.json 失败: ${error.message}`);
        process.exitCode = 1;
        throw error;
    }
}

function restoreAuthIfNeeded(auth) {
    if (!auth) {
        return;
    }
    try {
        fs.writeFileSync(AUTH_FILE, JSON.stringify(auth, null, 2), 'utf-8');
    } catch (error) {
        logger.warn(`恢复旧 auth.json 失败: ${error.message}`);
    }
}

function saveStore(store) {
    try {
        fs.writeFileSync(STORE_FILE, JSON.stringify(store, null, 2), 'utf-8');
    } catch (error) {
        logger.error(`保存 ${STORE_FILE} 失败: ${error.message}`);
        process.exitCode = 1;
    }
}

function printAccountSummary(title, profile) {
    console.log(chalk.green(title));
    console.log(`  账号: ${profile?.account?.email || profile?.account?.displayText || '-'}`);
    console.log(`  套餐: ${profile?.account?.planLabel || '-'}`);
    console.log(`  5h额度: ${formatUsageForDisplay(profile?.usage?.fiveHourLimit)}`);
    console.log(`  周额度: ${formatUsageForDisplay(profile?.usage?.weeklyLimit)}`);
}

function runCodex(args = []) {
    const command = resolveCodexCommand();
    return new Promise(resolve => {
        const child = spawn(command.bin, command.args.concat(args), {
            stdio: 'inherit',
            shell: command.shell
        });
        child.on('error', error => {
            logger.error(`启动 codex 失败: ${error.message}`);
            resolve(1);
        });
        child.on('exit', code => {
            resolve(typeof code === 'number' ? code : 0);
        });
    });
}

function resolveCodexCommand() {
    if (process.platform === 'win32') {
        return {
            bin: 'codex',
            args: [],
            shell: true
        };
    }
    const codexPath = findExecutableInPath('codex');
    if (!codexPath) {
        return {
            bin: 'codex',
            args: [],
            shell: false
        };
    }
    if (codexPath.endsWith('.js')) {
        return {
            bin: process.execPath,
            args: [codexPath],
            shell: false
        };
    }
    const firstLine = readFirstLine(codexPath);
    if (firstLine.includes('node')) {
        return {
            bin: process.execPath,
            args: [codexPath],
            shell: false
        };
    }
    return {
        bin: codexPath,
        args: [],
        shell: false
    };
}

function findExecutableInPath(commandName) {
    const pathValue = process.env.PATH || '';
    const pathList = pathValue.split(path.delimiter).filter(Boolean);
    for (const dirPath of pathList) {
        const candidate = path.join(dirPath, commandName);
        if (fs.existsSync(candidate)) {
            return candidate;
        }
    }
    return '';
}

function readFirstLine(filePath) {
    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        return content.split(/\r?\n/, 1)[0] || '';
    } catch (error) {
        return '';
    }
}

function formatTime(timeValue) {
    if (!timeValue) {
        return '-';
    }
    const date = new Date(timeValue);
    if (Number.isNaN(date.getTime())) {
        return String(timeValue);
    }
    return date.toLocaleString('zh-CN', {hour12: false});
}

function extractRemainingPercent(text) {
    const match = String(text || '').match(/(\d+)%/);
    if (!match) {
        return -1;
    }
    return Number.parseInt(match[1], 10);
}

function compareProfiles(leftProfile, rightProfile) {
    const weeklyDiff = extractRemainingPercent(leftProfile?.usage?.weeklyLimit) - extractRemainingPercent(rightProfile?.usage?.weeklyLimit);
    if (weeklyDiff !== 0) {
        return weeklyDiff;
    }
    const fiveHourDiff = extractRemainingPercent(leftProfile?.usage?.fiveHourLimit) - extractRemainingPercent(rightProfile?.usage?.fiveHourLimit);
    if (fiveHourDiff !== 0) {
        return fiveHourDiff;
    }
    return String(leftProfile?.alias || '').localeCompare(String(rightProfile?.alias || ''), 'zh-Hans-CN');
}

function formatUsageForDisplay(text) {
    const raw = normalizeUsageText(text);
    if (!raw) {
        return '-';
    }
    const percent = extractRemainingPercent(raw);
    if (percent >= 0 && percent < 20) {
        return chalk.red(raw);
    }
    return raw;
}

function compareDisplayRows(leftRow, rightRow) {
    const weeklyDiff = Number(leftRow?._weeklyPercent ?? -1) - Number(rightRow?._weeklyPercent ?? -1);
    if (weeklyDiff !== 0) {
        return weeklyDiff;
    }
    const fiveHourDiff = Number(leftRow?._fiveHourPercent ?? -1) - Number(rightRow?._fiveHourPercent ?? -1);
    if (fiveHourDiff !== 0) {
        return fiveHourDiff;
    }
    return String(leftRow?.别名 || '').localeCompare(String(rightRow?.别名 || ''), 'zh-Hans-CN');
}

function resolveListConcurrency(accountCount) {
    if (!Number.isFinite(accountCount) || accountCount <= 0) {
        return 1;
    }
    return Math.min(Math.max(1, Math.trunc(accountCount)), 5);
}

function renderProfileTable(rows) {
    const table = new Table({
        head: ['当前', '别名', '账号', '套餐', '5h额度', '周额度', '更新时间'],
        style: {
            head: [],
            border: []
        },
        chars: {
            top: '─',
            'top-mid': '┬',
            'top-left': '┌',
            'top-right': '┐',
            bottom: '─',
            'bottom-mid': '┴',
            'bottom-left': '└',
            'bottom-right': '┘',
            left: '│',
            'left-mid': '├',
            mid: '─',
            'mid-mid': '┼',
            right: '│',
            'right-mid': '┤',
            middle: '│'
        },
        colWidths: [6, 15, 26, 6, 30, 30, 20],
        wordWrap: false
    });
    for (const row of rows) {
        table.push([
            row.当前,
            row.别名,
            row.账号,
            row.套餐,
            row['5h额度'],
            row.周额度,
            row.更新时间
        ]);
    }
    console.log(table.toString());
}

function formatFetchReason(reason) {
    const value = String(reason || '').trim();
    if (!value) {
        return '未知错误';
    }
    if (value === 'missing_access_token') {
        return '缺少 access_token';
    }
    if (value === 'timeout') {
        return '请求超时';
    }
    if (value.startsWith('http_')) {
        return `接口返回 ${value.slice(5)}`;
    }
    return value;
}

async function mapWithConcurrency(items, limit, iterator) {
    const normalizedLimit = Math.max(1, Number(limit) || 1);
    const results = new Array(items.length);
    let currentIndex = 0;
    const workers = Array.from({length: Math.min(normalizedLimit, items.length)}, async () => {
        while (true) {
            const index = currentIndex;
            currentIndex += 1;
            if (index >= items.length) {
                return;
            }
            results[index] = await iterator(items[index], index);
        }
    });
    await Promise.all(workers);
    return results;
}
