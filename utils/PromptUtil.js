import inquirer from 'inquirer';

export function isPromptInterrupted(error) {
    if (!error) {
        return false;
    }
    const message = String(error?.message || '');
    return error?.name === 'ExitPromptError'
        || message.includes('ExitPromptError')
        || message.includes('User force closed')
        || message.includes('SIGINT');
}

/**
 * 安全的交互提示封装，统一处理 Ctrl+C 优雅退出
 * @param {Array} questions - inquirer 问题列表
 * @param {Object} options - { logger, cancelMessage }
 * @returns {Object|null} 用户输入结果，Ctrl+C 时返回 null
 */
export async function safePrompt(questions, options = {}) {
    const {logger = null, cancelMessage = '已取消当前交互。'} = options;
    try {
        return await inquirer.prompt(questions);
    } catch (error) {
        if (isPromptInterrupted(error)) {
            logger?.info?.(cancelMessage);
            return null;
        }
        throw error;
    }
}
