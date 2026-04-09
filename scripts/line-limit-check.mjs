import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';

const rootDir = process.cwd();
const maxLines = 400;
const includedExtensions = new Set(['.ts', '.mjs']);
const excludedDirs = new Set([
    '.angular',
    '.firebase',
    '.git',
    'dist',
    'node_modules',
]);

async function collectFiles(dirPath) {
    const entries = await readdir(dirPath, { withFileTypes: true });
    const files = [];

    for (const entry of entries) {
        if (excludedDirs.has(entry.name)) continue;

        const fullPath = join(dirPath, entry.name);
        if (entry.isDirectory()) {
            files.push(...(await collectFiles(fullPath)));
            continue;
        }

        if (!includedExtensions.has(getExtension(entry.name))) continue;
        files.push(fullPath);
    }

    return files;
}

function getExtension(fileName) {
    const dotIndex = fileName.lastIndexOf('.');
    return dotIndex >= 0 ? fileName.slice(dotIndex) : '';
}

async function countLines(filePath) {
    const content = await readFile(filePath, 'utf8');
    return countNonJSDocLines(content);
}

function countNonJSDocLines(content) {
    const lines = content.split(/\r?\n/);
    let count = 0;
    let inJSDoc = false;

    for (const line of lines) {
        const trimmed = line.trim();

        if (!inJSDoc && trimmed.startsWith('/**')) {
            inJSDoc = !trimmed.includes('*/');
            continue;
        }

        if (inJSDoc) {
            if (trimmed.includes('*/')) {
                inJSDoc = false;
            }
            continue;
        }

        count += 1;
    }

    return count;
}

function printViolations(violations) {
    console.error('Line-Limit-Check fehlgeschlagen. Dateien ueber 400 Zeilen:');
    violations.forEach((item) => {
        console.error(`- ${item.path}: ${item.lines}`);
    });
}

async function main() {
    const files = await collectFiles(rootDir);
    const violations = [];

    for (const filePath of files) {
        const lines = await countLines(filePath);
        if (lines <= maxLines) continue;
        violations.push({
            path: relative(rootDir, filePath).replaceAll('\\', '/'),
            lines,
        });
    }

    violations.sort((left, right) => right.lines - left.lines);

    if (!violations.length) {
        console.log('Line-Limit-Check erfolgreich.');
        return;
    }

    printViolations(violations);
    process.exitCode = 1;
}

main().catch((error) => {
    console.error('Line-Limit-Check konnte nicht ausgefuehrt werden.', error);
    process.exitCode = 1;
});
