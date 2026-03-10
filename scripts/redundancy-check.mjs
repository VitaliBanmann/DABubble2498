import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const sourceDir = path.join(root, 'src');
const targetExtensions = new Set(['.ts', '.html', '.scss']);
const minBlockSize = 8;
const maxReports = 25;

function collectFiles(directory, list = []) {
    const entries = readdirSync(directory);
    entries.forEach((entry) => {
        const fullPath = path.join(directory, entry);
        const stats = statSync(fullPath);
        if (stats.isDirectory()) {
            if (['node_modules', '.git', 'dist', '.angular'].includes(entry)) {
                return;
            }
            collectFiles(fullPath, list);
            return;
        }

        const extension = path.extname(fullPath).toLowerCase();
        if (targetExtensions.has(extension)) {
            list.push(fullPath);
        }
    });

    return list;
}

function normalizeLine(line) {
    return line
        .replace(/\/\/.*$/, '')
        .replace(/\/\*.*\*\//g, '')
        .replace(/<!--.*-->/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function readNormalizedLines(filePath) {
    return readFileSync(filePath, 'utf8')
        .split('\n')
        .map((line) => normalizeLine(line))
        .filter((line) => line.length > 0);
}

function toRelative(filePath) {
    return path.relative(root, filePath);
}

function buildBlockKey(lines, index) {
    return lines.slice(index, index + minBlockSize).join('\n');
}

function findDuplicateBlocks(files) {
    const blocks = new Map();

    files.forEach((filePath) => {
        const lines = readNormalizedLines(filePath);
        for (let index = 0; index <= lines.length - minBlockSize; index += 1) {
            const key = buildBlockKey(lines, index);
            const existing = blocks.get(key) || [];
            existing.push({
                filePath,
                line: index + 1,
            });
            blocks.set(key, existing);
        }
    });

    return Array.from(blocks.entries())
        .map(([_, matches]) => matches)
        .filter((matches) => {
            if (matches.length < 2) {
                return false;
            }

            const fileSet = new Set(matches.map((item) => item.filePath));
            return fileSet.size > 1;
        });
}

function printResult(duplicates) {
    if (!duplicates.length) {
        console.log('Redundanz-Check erfolgreich: Keine signifikanten Block-Duplikate gefunden.');
        return;
    }

    console.log('Redundanz-Check Hinweis: Mögliche Code-Duplikate gefunden.');

    duplicates.slice(0, maxReports).forEach((group, index) => {
        const locations = group
            .map((item) => `${toRelative(item.filePath)}:${item.line}`)
            .join(', ');
        console.log(`- Duplikat ${index + 1}: ${locations}`);
    });

    if (duplicates.length > maxReports) {
        console.log(`- ... und ${duplicates.length - maxReports} weitere mögliche Duplikate.`);
    }

    if (process.env.REDUNDANCY_FAIL === 'true') {
        process.exit(1);
    }
}

function run() {
    const files = collectFiles(sourceDir);
    const duplicates = findDuplicateBlocks(files);
    printResult(duplicates);
}

run();
