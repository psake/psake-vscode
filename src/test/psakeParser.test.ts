import * as assert from 'assert';
import { parsePsakeFile } from '../psakeParser.js';

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
});
