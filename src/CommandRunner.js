import fs from 'fs';
import path from 'path';
import process from 'process';
import {spawn} from 'child_process';

export function findExecutableInPath(commandName) {
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
        return (fs.readFileSync(filePath, 'utf-8').split(/\r?\n/, 1)[0] || '').trim();
    } catch {
        return '';
    }
}

export function resolveCommandInvocation(commandName) {
    if (process.platform === 'win32') {
        return {
            bin: commandName,
            args: [],
            shell: true
        };
    }
    const commandPath = findExecutableInPath(commandName);
    if (!commandPath) {
        return {
            bin: commandName,
            args: [],
            shell: false
        };
    }
    if (commandPath.endsWith('.js')) {
        return {
            bin: process.execPath,
            args: [commandPath],
            shell: false
        };
    }
    if (readFirstLine(commandPath).includes('node')) {
        return {
            bin: process.execPath,
            args: [commandPath],
            shell: false
        };
    }
    return {
        bin: commandPath,
        args: [],
        shell: false
    };
}

export function runInvocation(invocation, args = [], options = {}) {
    const {
        stdio = 'inherit',
        env = process.env,
        cwd = process.cwd(),
        shell = invocation.shell,
        input = '',
        timeoutMs = 0
    } = options;
    return new Promise(resolve => {
        const child = spawn(invocation.bin, invocation.args.concat(args), {
            stdio: stdio === 'pipe' ? ['pipe', 'pipe', 'pipe'] : stdio,
            env,
            cwd,
            shell
        });
        let stdout = '';
        let stderr = '';
        let timer = null;
        if (stdio === 'pipe') {
            child.stdout?.on('data', chunk => {
                stdout += String(chunk);
            });
            child.stderr?.on('data', chunk => {
                stderr += String(chunk);
            });
            if (input) {
                child.stdin?.write(input);
            }
            child.stdin?.end();
        }
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                child.kill('SIGTERM');
            }, timeoutMs);
        }
        child.on('error', error => {
            if (timer) {
                clearTimeout(timer);
            }
            resolve({
                code: 1,
                stdout,
                stderr,
                error
            });
        });
        child.on('exit', code => {
            if (timer) {
                clearTimeout(timer);
            }
            resolve({
                code: typeof code === 'number' ? code : 1,
                stdout,
                stderr,
                error: null
            });
        });
    });
}

export async function runCommand(commandName, args = [], options = {}) {
    const invocation = resolveCommandInvocation(commandName);
    return runInvocation(invocation, args, options);
}

export async function captureCommand(commandName, args = [], options = {}) {
    return runCommand(commandName, args, {
        ...options,
        stdio: 'pipe'
    });
}
