#!/usr/bin/env node

import {execute} from '../src/index.js';

const args = process.argv.slice(2);

try {
    await execute(args);
} catch (error) {
    if (error?.name === 'ExitPromptError' || String(error?.message || '').includes('SIGINT')) {
        process.exit(0);
    }
    console.error('codex-cc 异常:', error?.message || error);
    process.exit(1);
}
