import process from 'process';
import chalk from 'chalk';
import {createLogger} from '../utils/Logger.js';
import {safePrompt} from '../utils/PromptUtil.js';
import {loadStore, resolveAvailableAlias, saveStore, listAliases} from './store.js';
import {
    compareDisplayRows,
    compareProfiles,
    compactUsageText,
    extractRemainingPercent,
    formatFailedUsageCell,
    formatFetchReason,
    formatUsageForDisplay,
    renderProfileTable
} from './formatter.js';
import {ProviderRegistry} from './ProviderRegistry.js';
import {CodexProviderStrategy} from './providers/CodexProviderStrategy.js';
import {ClaudeProviderStrategy} from './providers/ClaudeProviderStrategy.js';

const logger = createLogger('CODEX-CC');
const providers = new ProviderRegistry([
    new CodexProviderStrategy(),
    new ClaudeProviderStrategy()
]);
const RESERVED_COMMANDS = new Set(['login', 'relogin', 'list', 'clear', 'rename', 'help']);

export async function execute(args = []) {
    const [command, ...restArgs] = args;
    const store = loadStore(logger);
    await ensureCurrentAuthProfiles(store, command);

    if (!command) {
        await handleInteractiveLaunch(store);
        return;
    }
    if (command === 'login') {
        await handleLogin(store, restArgs);
        return;
    }
    if (command === 'relogin') {
        await handleRelogin(store, restArgs);
        return;
    }
    if (command === 'list') {
        await handleList(store);
        return;
    }
    if (command === 'rename') {
        await handleRename(store, restArgs);
        return;
    }
    if (command === 'clear') {
        await handleClear(store, restArgs);
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
    console.log('  codex-cc login [codex|claude]          登录指定工具并保存为别名账号');
    console.log('  codex-cc relogin <别名>                重新登录并覆盖指定别名账号');
    console.log('  codex-cc list                          查看已保存账号列表与额度');
    console.log('  codex-cc rename <旧别名> <新别名>      重命名已保存账号别名');
    console.log('  codex-cc clear [codex|claude|<别名>]   清理当前工具登录态');
    console.log('  codex-cc <别名> [原生命令参数]          切换指定账号并启动原生命令');
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

function isCurrentAlias(store, alias, providerId) {
    return store.current?.[providerId] === alias;
}

async function ensureCurrentAuthProfiles(store, command) {
    if (['login', 'relogin', 'rename', 'clear', 'help', '-h', '--help'].includes(command || '')) {
        return;
    }
    let changed = false;
    for (const provider of providers.list()) {
        const currentAuth = await provider.getCurrentAuth();
        if (!currentAuth) {
            continue;
        }
        const matchedAlias = listAliases(store).find(alias => {
            const profile = store.profiles[alias];
            return profile.provider === provider.id && provider.matchProfile(profile, currentAuth);
        });
        if (matchedAlias) {
            if (store.current[provider.id] !== matchedAlias) {
                store.current[provider.id] = matchedAlias;
                changed = true;
            }
            continue;
        }
        const alias = resolveAvailableAlias(store, 'default');
        const profile = await provider.buildProfile(currentAuth, {alias, provider: provider.id});
        store.profiles[alias] = profile;
        store.current[provider.id] = alias;
        changed = true;
        logger.info(`检测到当前 ${provider.displayName} 登录态未加入列表，已自动保存为别名 ${alias}`);
    }
    if (changed) {
        saveStore(store, logger);
    }
}

function buildAliasChoiceLabel(alias, profile, isCurrent) {
    const currentText = isCurrent ? ' [当前]' : '';
    const toolText = profile.provider === 'claude' ? 'Claude' : 'Codex';
    const email = profile?.account?.email || profile?.account?.displayText || '未知账号';
    const plan = profile?.account?.planLabel ? ` / ${profile.account.planLabel}` : '';
    const fiveHour = profile?.usage?.fiveHourLimit ? ` / 5h:${profile.usage.fiveHourLimit}` : '';
    const weekly = profile?.usage?.weeklyLimit ? ` / 周:${profile.usage.weeklyLimit}` : '';
    return `${alias}${currentText} - ${toolText} - ${email}${plan}${fiveHour}${weekly}`;
}

async function handleInteractiveLaunch(store) {
    const aliases = listAliases(store).sort((left, right) => compareProfiles(store.profiles[right], store.profiles[left]));
    if (aliases.length === 0) {
        logger.warn('暂无已保存账号，请先执行 codex-cc login。');
        process.exitCode = 1;
        return;
    }
    const answer = await safePrompt([
        {
            type: 'list',
            name: 'alias',
            message: '选择要启动的账号:',
            choices: aliases.map(alias => ({
                name: buildAliasChoiceLabel(alias, store.profiles[alias], isCurrentAlias(store, alias, store.profiles[alias].provider)),
                value: alias
            })),
            pageSize: Math.min(10, aliases.length)
        }
    ], {logger});
    if (!answer?.alias) {
        process.exitCode = 1;
        return;
    }
    await launchProfile(store, answer.alias, []);
}

async function promptLoginProvider(restArgs) {
    const providerId = restArgs[0];
    if (providerId) {
        return providers.get(providerId);
    }
    const answer = await safePrompt([
        {
            type: 'list',
            name: 'provider',
            message: '选择要登录的工具:',
            choices: providers.list().map(provider => ({
                name: provider.displayName,
                value: provider.id
            }))
        }
    ], {logger});
    return providers.get(answer?.provider || '');
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
        if (!confirmed?.overwrite) {
            return null;
        }
        return alias;
    }
}

function printAccountSummary(title, provider, profile) {
    console.log(chalk.green(title));
    console.log(`  工具: ${provider.displayName}`);
    console.log(`  账号: ${provider.getAccountEmail(profile)}`);
    console.log(`  套餐: ${provider.getPlanLabel(profile)}`);
    console.log(`  5h额度: ${formatUsageForDisplay(profile?.usage?.fiveHourLimit)}`);
    console.log(`  周额度: ${formatUsageForDisplay(profile?.usage?.weeklyLimit)}`);
}

async function handleLogin(store, restArgs) {
    const provider = await promptLoginProvider(restArgs);
    if (!provider) {
        logger.error('用法: codex-cc login [codex|claude]');
        process.exitCode = 1;
        return;
    }
    const auth = await provider.login(logger);
    const profile = await provider.buildProfile(auth, {provider: provider.id});
    printAccountSummary('当前登录账号', provider, profile);
    const alias = await promptAlias(store, provider.suggestAlias(profile));
    if (!alias) {
        process.exitCode = 1;
        return;
    }
    store.profiles[alias] = {
        ...profile,
        alias
    };
    store.current[provider.id] = alias;
    saveStore(store, logger);
    logger.success(`${provider.displayName} 账号已保存为别名 ${alias}`);
}

async function handleRelogin(store, restArgs) {
    const alias = String(restArgs[0] || '').trim();
    if (!alias) {
        logger.error('用法: codex-cc relogin <别名>');
        process.exitCode = 1;
        return;
    }
    const existingProfile = store.profiles[alias];
    if (!existingProfile) {
        logger.error(`账号别名 ${alias} 不存在，请先执行 codex-cc login。`);
        process.exitCode = 1;
        return;
    }
    const provider = providers.get(existingProfile.provider);
    if (!provider) {
        logger.error(`别名 ${alias} 对应的 provider 不存在。`);
        process.exitCode = 1;
        return;
    }
    const previousAuth = await provider.getCurrentAuth();
    logger.info(`准备为 ${provider.displayName} 别名 ${alias} 重新登录，请按终端提示完成登录。`);
    const auth = typeof provider.relogin === 'function'
        ? await provider.relogin(logger, existingProfile)
        : await provider.login(logger);
    const profile = await provider.buildProfile(auth, {
        ...existingProfile,
        alias,
        provider: provider.id
    });
    printAccountSummary(`重新登录后的账号（将覆盖别名 ${alias}）`, provider, profile);
    const answer = await safePrompt([
        {
            type: 'confirm',
            name: 'overwrite',
            message: `确认用当前登录态覆盖别名 ${alias} 吗？`,
            default: true
        }
    ], {logger});
    if (!answer?.overwrite) {
        if (previousAuth) {
            await provider.activateProfile({auth: previousAuth});
        } else {
            await provider.clearCurrentAuth();
        }
        logger.info(`已取消覆盖别名 ${alias}。`);
        return;
    }
    store.profiles[alias] = {
        ...existingProfile,
        ...profile,
        alias
    };
    store.current[provider.id] = alias;
    saveStore(store, logger);
    logger.success(`${provider.displayName} 别名 ${alias} 已重新登录并更新。`);
}

function resolveListConcurrency(accountCount) {
    if (!Number.isFinite(accountCount) || accountCount <= 0) {
        return 1;
    }
    return Math.min(Math.max(1, Math.trunc(accountCount)), 5);
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

function buildDisplayRow(store, alias, provider, refreshed) {
    return {
        当前: isCurrentAlias(store, alias, provider.id) ? '是' : '',
        工具: provider.displayName,
        别名: alias,
        账号: provider.getAccountEmail(refreshed.profile),
        套餐: provider.getPlanLabel(refreshed.profile),
        '5h额度': refreshed.ok ? formatUsageForDisplay(refreshed.profile.usage?.fiveHourLimit) : formatFailedUsageCell(refreshed.reason),
        周额度: refreshed.ok ? formatUsageForDisplay(refreshed.profile.usage?.weeklyLimit) : formatFailedUsageCell(refreshed.reason),
        _weeklyPercent: refreshed.ok ? extractRemainingPercent(refreshed.profile.usage?.weeklyLimit) : -1,
        _fiveHourPercent: refreshed.ok ? extractRemainingPercent(refreshed.profile.usage?.fiveHourLimit) : -1
    };
}

async function refreshAliasGroup(store, aliases, changedRef) {
    if (aliases.length === 0) {
        return [];
    }
    const concurrency = resolveListConcurrency(aliases.length);
    logger.info(`开始并发查询 ${aliases.length} 个账号额度（并发 ${concurrency}）...`);
    return mapWithConcurrency(aliases, concurrency, async alias => {
        const profile = store.profiles[alias];
        const provider = providers.get(profile.provider);
        logger.info(`[${provider.displayName}/${alias}] 开始查询实时额度...`);
        const refreshed = await provider.refreshProfile(profile);
        store.profiles[alias] = refreshed.profile;
        changedRef.value = changedRef.value || refreshed.changed;
        if (refreshed.ok) {
            logger.success(
                `[${provider.displayName}/${alias}] 实时额度查询成功：5h=${compactUsageText(refreshed.profile.usage?.fiveHourLimit) || '-'}，周=${compactUsageText(refreshed.profile.usage?.weeklyLimit) || '-'}`
            );
        } else {
            const needsRelogin = typeof provider.isReloginRequired === 'function' && provider.isReloginRequired(refreshed.reason);
            const reloginHint = needsRelogin ? `，可执行 codex-cc relogin ${alias}` : '';
            logger.warn(`[${provider.displayName}/${alias}] 实时额度查询失败：${formatFetchReason(refreshed.reason)}${reloginHint}`);
            if (needsRelogin) {
                changedRef.reloginHints.push(alias);
            }
        }
        return buildDisplayRow(store, alias, provider, refreshed);
    });
}

async function handleList(store) {
    const aliases = listAliases(store).sort((left, right) => compareProfiles(store.profiles[right], store.profiles[left]));
    if (aliases.length === 0) {
        logger.warn('暂无已保存账号，请先执行 codex-cc login。');
        return;
    }
    const codexAliases = aliases.filter(alias => store.profiles[alias]?.provider === 'codex');
    const claudeAliases = aliases.filter(alias => store.profiles[alias]?.provider === 'claude');
    const changedRef = {value: false, reloginHints: []};
    const codexRows = await refreshAliasGroup(store, codexAliases, changedRef);
    codexRows.sort((left, right) => compareDisplayRows(right, left));
    if (codexRows.length > 0) {
        console.log(chalk.cyan('[Codex] 账号列表'));
        renderProfileTable(codexRows);
    }
    const claudeRows = await refreshAliasGroup(store, claudeAliases, changedRef);
    claudeRows.sort((left, right) => compareDisplayRows(right, left));
    if (claudeRows.length > 0) {
        if (codexRows.length > 0) {
            console.log('');
        }
        console.log(chalk.cyan('[Claude] 账号列表'));
        renderProfileTable(claudeRows);
    }
    if (changedRef.reloginHints.length > 0) {
        logger.info(`检测到 ${changedRef.reloginHints.length} 个账号需要重新登录：`);
        for (const alias of changedRef.reloginHints.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))) {
            console.log(`  codex-cc relogin ${alias}`);
        }
    }
    if (changedRef.value) {
        saveStore(store, logger);
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
    const validation = validateAlias(targetAliasInput);
    if (validation !== true) {
        logger.error(String(validation));
        process.exitCode = 1;
        return;
    }
    const targetAlias = targetAliasInput.trim();
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
    if (store.current[profile.provider] === sourceAlias) {
        store.current[profile.provider] = targetAlias;
    }
    saveStore(store, logger);
    logger.success(`已将账号别名 ${sourceAlias} 重命名为 ${targetAlias}`);
}

async function handleClear(store, args = []) {
    const target = args[0];
    if (!target) {
        for (const provider of providers.list()) {
            await provider.clearCurrentAuth();
        }
        logger.success('已清理 Codex / Claude 当前登录态');
        return;
    }
    const provider = providers.get(target);
    if (provider) {
        await provider.clearCurrentAuth();
        logger.success(`已清理 ${provider.displayName} 当前登录态`);
        return;
    }
    const profile = store.profiles[target];
    if (!profile) {
        logger.error(`未找到 ${target} 对应的 provider 或别名`);
        process.exitCode = 1;
        return;
    }
    await providers.get(profile.provider).clearCurrentAuth();
    logger.success(`已清理 ${target} 当前登录态`);
}

async function launchProfile(store, alias, commandArgs = []) {
    const profile = store.profiles[alias];
    if (!profile) {
        logger.error(`账号别名 ${alias} 不存在，请先执行 codex-cc login。`);
        process.exitCode = 1;
        return;
    }
    const provider = providers.get(profile.provider);
    await provider.activateProfile(profile);
    const refreshed = await provider.refreshProfile(profile);
    store.profiles[alias] = refreshed.profile;
    store.current[provider.id] = alias;
    saveStore(store, logger);
    if (!refreshed.ok && typeof provider.isReloginRequired === 'function' && provider.isReloginRequired(refreshed.reason)) {
        logger.warn(`账号 ${alias} 的登录态可能已失效，可先执行 codex-cc relogin ${alias}。`);
    }
    printAccountSummary(`当前账号 ${alias}`, provider, refreshed.profile);
    const exitCode = await provider.launchProfile(refreshed.profile, commandArgs);
    if (exitCode !== 0) {
        logger.error(`${provider.commandName} 退出码: ${exitCode}`);
        process.exitCode = exitCode || 1;
    }
}
