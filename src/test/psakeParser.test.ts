import * as assert from 'assert';
import { parsePsakeFile, parseIncludes } from '../psakeParser.js';

suite('psakeParser', () => {
    suite('parsePsakeFile', () => {
        test('parses a simple positional task', () => {
            const content = `Task Build {\n\t"build"\n}`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Build');
            assert.strictEqual(tasks[0].line, 0);
            assert.deepStrictEqual(tasks[0].dependencies, []);
            assert.strictEqual(tasks[0].description, '');
        });

        test('parses a task with -Name parameter', () => {
            const content = `Task -Name Compile -Action { "compile" }`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Compile');
        });

        test('parses a task with -Depends', () => {
            const content = `Task Test -Depends Compile, Clean { }`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.deepStrictEqual(tasks[0].dependencies, ['Compile', 'Clean']);
        });

        test('parses a task with -Description', () => {
            const content = `Task Build -Description "Compiles the project" { }`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].description, 'Compiles the project');
        });

        test('parses a default task with no action block', () => {
            const content = `Task default -Depends Test`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'default');
            assert.deepStrictEqual(tasks[0].dependencies, ['Test']);
        });

        test('parses multiple tasks', () => {
            const content = [
                'Task default -Depends Test',
                '',
                'Task Test -Depends Compile, Clean {',
                '\t"test"',
                '}',
                '',
                'Task Compile -Depends Clean {',
                '\t"compile"',
                '}',
                '',
                'Task Clean {',
                '\t"clean"',
                '}',
            ].join('\n');

            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 4);
            assert.strictEqual(tasks[0].name, 'default');
            assert.strictEqual(tasks[1].name, 'Test');
            assert.strictEqual(tasks[2].name, 'Compile');
            assert.strictEqual(tasks[3].name, 'Clean');
        });

        test('records correct line numbers', () => {
            const content = ['', 'Task Build { }', '', 'Task Test { }'].join('\n');
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 2);
            assert.strictEqual(tasks[0].line, 1);
            assert.strictEqual(tasks[1].line, 3);
        });

        test('ignores comment lines', () => {
            const content = [
                '# This is a comment',
                'Task Build { }',
                '# Another comment',
            ].join('\n');
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Build');
        });

        test('ignores empty lines', () => {
            const content = '\n\n\nTask Build { }\n\n';
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
        });

        test('handles continuation lines with backtick', () => {
            const content = [
                'Task Build `',
                '    -Depends Clean `',
                '    -Description "Build task" { }',
            ].join('\n');
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Build');
            assert.deepStrictEqual(tasks[0].dependencies, ['Clean']);
            assert.strictEqual(tasks[0].description, 'Build task');
        });

        test('handles full -Name -Depends -Description syntax', () => {
            const content = `Task -Name Release -Depends Build, Test -Description "Creates a release package" { }`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Release');
            assert.deepStrictEqual(tasks[0].dependencies, ['Build', 'Test']);
            assert.strictEqual(tasks[0].description, 'Creates a release package');
        });

        test('returns empty array for empty file', () => {
            assert.deepStrictEqual(parsePsakeFile(''), []);
        });

        test('returns empty array for file with no tasks', () => {
            const content = [
                '# A build properties file',
                'Properties {',
                '    $Version = "1.0.0"',
                '}',
            ].join('\n');
            const tasks = parsePsakeFile(content);
            assert.deepStrictEqual(tasks, []);
        });

        test('does not match "Task" inside a string literal in another statement', () => {
            const content = `$msg = "Run Task here"\nTask Real { }`;
            const tasks = parsePsakeFile(content);
            // Only "Real" should match; the string line starts with "$" not "Task"
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Real');
        });
    });

    suite('FromModule tasks', () => {
        test('parses -FromModule parameter', () => {
            const content = `Task Test -FromModule PowerShellBuild`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Test');
            assert.strictEqual(tasks[0].fromModule, 'PowerShellBuild');
            assert.strictEqual(tasks[0].minimumVersion, undefined);
            assert.strictEqual(tasks[0].requiredVersion, undefined);
        });

        test('parses -FromModule with -minimumVersion', () => {
            const content = `Task Test -FromModule PowerShellBuild -minimumVersion '0.6.1'`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].fromModule, 'PowerShellBuild');
            assert.strictEqual(tasks[0].minimumVersion, '0.6.1');
        });

        test('parses -FromModule with -requiredVersion', () => {
            const content = `Task Test -FromModule PowerShellBuild -requiredVersion '1.0.0'`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].requiredVersion, '1.0.0');
            assert.strictEqual(tasks[0].minimumVersion, undefined);
        });

        test('parses -Version as alias for -requiredVersion', () => {
            const content = `Task Test -FromModule PowerShellBuild -Version '1.0.0'`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].requiredVersion, '1.0.0');
        });

        test('parses -maximumVersion', () => {
            const content = `Task Test -FromModule PowerShellBuild -minimumVersion '0.5.0' -maximumVersion '1.0.0'`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].minimumVersion, '0.5.0');
            assert.strictEqual(tasks[0].maximumVersion, '1.0.0');
        });

        test('parses -lessThanVersion', () => {
            const content = `Task Test -FromModule PowerShellBuild -lessThanVersion '2.0.0'`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].lessThanVersion, '2.0.0');
        });

        test('parses -FromModule with double-quoted module name', () => {
            const content = `Task Test -FromModule "PowerShellBuild" -minimumVersion "0.6.1"`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].fromModule, 'PowerShellBuild');
            assert.strictEqual(tasks[0].minimumVersion, '0.6.1');
        });

        test('parses -FromModule on continuation lines', () => {
            const content = [
                'Task Test `',
                '    -FromModule PowerShellBuild `',
                "    -minimumVersion '0.6.1'",
            ].join('\n');
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks.length, 1);
            assert.strictEqual(tasks[0].name, 'Test');
            assert.strictEqual(tasks[0].fromModule, 'PowerShellBuild');
            assert.strictEqual(tasks[0].minimumVersion, '0.6.1');
        });

        test('parses -FromModule task with local -Depends', () => {
            // psake allows a reference task to declare additional local dependencies
            const content = `Task Test -FromModule PowerShellBuild -Depends LocalSetup -minimumVersion '0.6.1'`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].fromModule, 'PowerShellBuild');
            assert.deepStrictEqual(tasks[0].dependencies, ['LocalSetup']);
            assert.strictEqual(tasks[0].minimumVersion, '0.6.1');
        });

        test('fromModule is undefined on normal tasks', () => {
            const content = `Task Build -Depends Clean { }`;
            const tasks = parsePsakeFile(content);
            assert.strictEqual(tasks[0].fromModule, undefined);
            assert.strictEqual(tasks[0].minimumVersion, undefined);
        });
    });

    suite('parseIncludes', () => {
        test('parses positional Include', () => {
            const content = `Include './helpers.ps1'`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes.length, 1);
            assert.strictEqual(includes[0].path, './helpers.ps1');
            assert.strictEqual(includes[0].isLiteral, false);
            assert.strictEqual(includes[0].line, 0);
        });

        test('parses positional Include with double quotes', () => {
            const content = `Include "./helpers.ps1"`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes[0].path, './helpers.ps1');
        });

        test('parses -Path parameter', () => {
            const content = `Include -Path './helpers.ps1'`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes[0].path, './helpers.ps1');
            assert.strictEqual(includes[0].isLiteral, false);
        });

        test('parses -fileNamePathToInclude alias', () => {
            const content = `Include -fileNamePathToInclude './helpers.ps1'`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes[0].path, './helpers.ps1');
            assert.strictEqual(includes[0].isLiteral, false);
        });

        test('parses -LiteralPath parameter and sets isLiteral = true', () => {
            const content = `Include -LiteralPath 'C:\\build\\helpers.ps1'`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes[0].path, 'C:\\build\\helpers.ps1');
            assert.strictEqual(includes[0].isLiteral, true);
        });

        test('parses multiple Include statements', () => {
            const content = [
                `Include './helpers.ps1'`,
                `Task Build { }`,
                `Include -Path './tools.ps1'`,
            ].join('\n');
            const includes = parseIncludes(content);
            assert.strictEqual(includes.length, 2);
            assert.strictEqual(includes[0].path, './helpers.ps1');
            assert.strictEqual(includes[0].line, 0);
            assert.strictEqual(includes[1].path, './tools.ps1');
            assert.strictEqual(includes[1].line, 2);
        });

        test('parses Include on continuation lines', () => {
            const content = [
                'Include `',
                "    './helpers.ps1'",
            ].join('\n');
            const includes = parseIncludes(content);
            assert.strictEqual(includes.length, 1);
            assert.strictEqual(includes[0].path, './helpers.ps1');
        });

        test('ignores comment lines', () => {
            const content = `# Include './ignored.ps1'\nInclude './real.ps1'`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes.length, 1);
            assert.strictEqual(includes[0].path, './real.ps1');
        });

        test('returns empty array when no Include statements', () => {
            const content = `Task Build { }\nTask Clean { }`;
            assert.deepStrictEqual(parseIncludes(content), []);
        });

        test('is case-insensitive for the Include keyword', () => {
            const content = `include './helpers.ps1'`;
            const includes = parseIncludes(content);
            assert.strictEqual(includes.length, 1);
            assert.strictEqual(includes[0].path, './helpers.ps1');
        });
    });
});
