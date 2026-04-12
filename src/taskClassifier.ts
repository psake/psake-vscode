export type TaskClass = 'build' | 'test' | 'none';

const TEST_NAME_PATTERN = /(^|[^a-z0-9])(test|tests|pester|spec|specs)([^a-z0-9]|$)/i;
const BUILD_NAME_PATTERN = /(^|[^a-z0-9])(build|compile|publish|package|pack|release|dist)([^a-z0-9]|$)/i;

export function classifyByName(name: string): TaskClass {
    if (TEST_NAME_PATTERN.test(name)) { return 'test'; }
    if (BUILD_NAME_PATTERN.test(name)) { return 'build'; }
    return 'none';
}
