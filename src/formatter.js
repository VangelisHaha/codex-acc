import chalk from 'chalk';
import Table from 'cli-table3';
import stringWidth from 'string-width';

function padCell(value, width) {
    const text = String(value ?? '');
    const visualWidth = stringWidth(text);
    if (visualWidth >= width) {
        return text;
    }
    return text + ' '.repeat(width - visualWidth);
}

function getDynamicColWidths() {
    const terminalWidth = Number(process.stdout?.columns || 0);
    if (!Number.isFinite(terminalWidth) || terminalWidth <= 0) {
        return [6, 8, 16, 28, 8, 30, 30];
    }
    if (terminalWidth >= 160) {
        return [6, 8, 16, 34, 8, 34, 34];
    }
    if (terminalWidth >= 148) {
        return [6, 8, 16, 30, 8, 30, 30];
    }
    if (terminalWidth >= 138) {
        return [6, 8, 14, 26, 8, 28, 28];
    }
    return [6, 8, 14, 22, 8, 24, 24];
}

export function extractRemainingPercent(text) {
    const match = String(text || '').match(/(\d+)%/);
    if (!match) {
        return -1;
    }
    return Number.parseInt(match[1], 10);
}

export function compactUsageText(text) {
    const value = String(text || '').trim();
    if (!value) {
        return '';
    }
    return value.replace('% 剩余', '%');
}

export function formatUsageForDisplay(text) {
    const value = compactUsageText(text);
    if (!value) {
        return '-';
    }
    const percent = extractRemainingPercent(value);
    if (percent >= 0 && percent < 20) {
        return chalk.red(value);
    }
    return value;
}

export function compareProfiles(leftProfile, rightProfile) {
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

export function compareDisplayRows(leftRow, rightRow) {
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

export function renderProfileTable(rows) {
    const colWidths = getDynamicColWidths();
    const table = new Table({
        head: ['当前', '工具', '别名', '账号', '套餐', '5h额度', '周额度'],
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
        colWidths,
        wordWrap: false
    });
    for (const row of rows) {
        table.push([
            padCell(row.当前, colWidths[0] - 2),
            padCell(row.工具, colWidths[1] - 2),
            padCell(row.别名, colWidths[2] - 2),
            padCell(row.账号, colWidths[3] - 2),
            padCell(row.套餐, colWidths[4] - 2),
            padCell(row['5h额度'], colWidths[5] - 2),
            padCell(row.周额度, colWidths[6] - 2)
        ]);
    }
    console.log(table.toString());
}

export function formatFetchReason(reason) {
    if (!reason) {
        return '未知错误';
    }
    if (typeof reason === 'object') {
        if (reason.errorCode === 'refresh_token_expired') {
            return 'refresh_token 已过期，请重新登录';
        }
        if (reason.errorCode === 'refresh_token_reused') {
            return 'refresh_token 已被使用，请重新登录';
        }
        if (reason.errorCode === 'refresh_token_invalidated') {
            return 'refresh_token 已失效，请重新登录';
        }
        if (reason.errorCode === 'token_expired') {
            return 'access_token 已过期，已尝试刷新但失败，请重新登录';
        }
        if (reason.reason === 'missing_refresh_token') {
            return '缺少 refresh_token，请重新登录';
        }
        if (reason.reason === 'refresh_timeout') {
            return '刷新 access_token 超时';
        }
        if (reason.reason === 'refresh_invalid_json') {
            return '刷新 access_token 返回了非法响应';
        }
        if (reason.reason === 'refresh_failed' && reason.errorMessage) {
            return `刷新 access_token 失败：${reason.errorMessage}`;
        }
        if (reason.reason === 'refresh_unauthorized') {
            return reason.errorMessage || '刷新 access_token 被拒绝，请重新登录';
        }
        if (reason.reason && String(reason.reason).startsWith('refresh_http_')) {
            return reason.errorMessage || `刷新 access_token 接口返回 ${String(reason.reason).slice('refresh_http_'.length)}`;
        }
        if (reason.errorMessage) {
            return reason.errorCode ? `${reason.errorMessage}（${reason.errorCode}）` : reason.errorMessage;
        }
        return formatFetchReason(reason.reason);
    }
    const value = String(reason || '').trim();
    if (!value) {
        return '未知错误';
    }
    if (value === 'missing_access_token') {
        return '缺少 access_token，请重新登录';
    }
    if (value === 'oauth_token_expired') {
        return 'Claude OAuth 已过期，请重新执行 claude auth login';
    }
    if (value === 'missing_profile_scope') {
        return 'Claude 当前登录态缺少 user:profile 权限，无法查询额度';
    }
    if (value === 'authentication_failed') {
        return 'Claude 鉴权失败，请重新执行 claude auth login';
    }
    if (value === 'request_forbidden') {
        return 'Claude 服务端拒绝当前请求';
    }
    if (value === 'missing_rate_limits') {
        return '接口未返回额度字段';
    }
    if (value === 'unsupported_platform') {
        return '当前平台暂不支持';
    }
    if (value === 'not_logged_in') {
        return '当前未登录';
    }
    if (value === 'http_401') {
        return '接口返回 401，请重新登录';
    }
    if (value === 'http_402') {
        return '接口返回 402，当前登录态可能已失效，请重新登录';
    }
    if (value.startsWith('http_')) {
        return `接口返回 ${value.slice(5)}`;
    }
    return value;
}

export function formatFailedUsageCell(reason) {
    const message = formatFetchReason(reason);
    if (message.includes('重新登录')) {
        return '需重登';
    }
    return '查询失败';
}
