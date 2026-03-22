import chalk from 'chalk';
import fs from 'fs';
import os from 'os';
import path from 'path';
import process from 'process';

/**
 * 获取日志文件路径，统一写到 ~/.codex-acc/logs/ 下
 */
function getLogFilePath() {
    const today = new Date();
    const yyyy = today.getFullYear();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const filename = `codex-cc-${yyyy}-${mm}-${dd}.log`;
    const logDir = path.join(os.homedir(), '.codex-acc', 'logs');

    try {
        if (!fs.existsSync(logDir)) {
            fs.mkdirSync(logDir, {recursive: true});
        }
        fs.accessSync(logDir, fs.constants.W_OK);
    } catch {
        // 日志目录不可写时静默忽略
        return null;
    }

    return path.join(logDir, filename);
}

async function appendLogFile(message) {
    const filePath = getLogFilePath();
    if (!filePath) {
        return;
    }
    fs.promises.appendFile(filePath, message + '\n').catch(() => {});
}

/**
 * 统一的日志工具
 */
export class Logger {
    constructor(moduleName = 'APP') {
        this.moduleName = moduleName;
        this.verbose = process.env.VERBOSE === 'true' || process.argv.includes('--verbose');
    }

    formatConsoleTime() {
        const now = new Date();
        const yyyy = now.getFullYear();
        const mm = String(now.getMonth() + 1).padStart(2, '0');
        const dd = String(now.getDate()).padStart(2, '0');
        const hh = String(now.getHours()).padStart(2, '0');
        const mi = String(now.getMinutes()).padStart(2, '0');
        const ss = String(now.getSeconds()).padStart(2, '0');
        return `${yyyy}-${mm}-${dd} ${hh}:${mi}:${ss}`;
    }

    formatConsolePrefix(icon) {
        return `${icon} [${this.moduleName}] [${this.formatConsoleTime()}]`;
    }

    async logToFile(level, message) {
        const time = new Date().toLocaleString('zh-CN', {timeZone: 'Asia/Shanghai'});
        const logLine = `[${time}] [${level}] [${this.moduleName}] ${message}`;
        await appendLogFile(logLine);
    }

    info(message, ...args) {
        console.log(chalk.blue(this.formatConsolePrefix('🦶')), message, ...args);
        this.logToFile('INFO', [message, ...args].join(' '));
    }

    log(message, ...args) {
        this.logToFile('INFO', [message, ...args].join(' '));
    }

    success(message, ...args) {
        console.log(chalk.green(this.formatConsolePrefix('✅')), message, ...args);
        this.logToFile('SUCCESS', [message, ...args].join(' '));
    }

    warn(message, ...args) {
        console.warn(chalk.yellow(this.formatConsolePrefix('⚠️ ')), message, ...args);
        this.logToFile('WARN', [message, ...args].join(' '));
    }

    error(message, ...args) {
        console.error(chalk.red(this.formatConsolePrefix('🛑')), message, ...args);
        this.logToFile('ERROR', [message, ...args].join(' '));
    }

    debug(message, ...args) {
        if (this.verbose) {
            console.log(chalk.gray(this.formatConsolePrefix('🐛')), message, ...args);
            this.logToFile('DEBUG', [message, ...args].join(' '));
        }
    }
}

/**
 * 创建模块专用的 Logger 实例
 */
export function createLogger(moduleName) {
    return new Logger(moduleName);
}
