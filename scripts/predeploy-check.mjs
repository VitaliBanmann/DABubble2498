import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const root = process.cwd();

function runCommand(command) {
  return execSync(command, { cwd: root, encoding: 'utf8' }).trim();
}

function isCamelCase(value) {
  return /^[a-z][a-zA-Z0-9]*$/.test(value);
}

function getAllFiles(directory, extensions, list = []) {
  const entries = readdirSync(directory);
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (['node_modules', 'dist', '.git'].includes(entry)) {
        return;
      }
      getAllFiles(fullPath, extensions, list);
      return;
    }
    const extension = path.extname(fullPath).toLowerCase();
    if (extensions.includes(extension)) {
      list.push(fullPath);
    }
  });
  return list;
}

function getChangedFiles() {
  const baseRef = process.env.PREDEPLOY_BASE || 'origin/main';
  const hasBaseRef = (() => {
    try {
      runCommand(`git rev-parse --verify ${baseRef}`);
      return true;
    } catch {
      return false;
    }
  })();

  const diffAgainstBase = hasBaseRef
    ? runCommand(`git diff --name-only ${baseRef}...HEAD`)
    : '';

  const staged = runCommand('git diff --name-only --cached');
  const unstaged = runCommand('git diff --name-only');

  const all = [diffAgainstBase, staged, unstaged]
    .join('\n')
    .split('\n')
    .map((value) => value.trim())
    .filter(Boolean);

  return [...new Set(all)]
    .map((value) => path.resolve(root, value))
    .filter((filePath) => filePath.startsWith(path.join(root, 'src')));
}

function getChangedLineMap(changedFiles) {
  const map = new Map();
  if (!changedFiles.length) {
    return map;
  }

  const baseRef = process.env.PREDEPLOY_BASE || 'origin/main';
  const hasBaseRef = (() => {
    try {
      runCommand(`git rev-parse --verify ${baseRef}`);
      return true;
    } catch {
      return false;
    }
  })();

  const changedAbsoluteSet = new Set(changedFiles);
  const diffCommand = hasBaseRef
    ? `git diff --unified=0 ${baseRef}...HEAD`
    : 'git diff --unified=0 --cached';

  let output = '';
  try {
    output = runCommand(diffCommand);
  } catch {
    return map;
  }

  let currentFile = '';
  output.split('\n').forEach((line) => {
    if (line.startsWith('+++ b/')) {
      const relative = line.slice('+++ b/'.length).trim();
      currentFile = path.resolve(root, relative);
      if (!changedAbsoluteSet.has(currentFile)) {
        currentFile = '';
      }
      return;
    }

    if (!currentFile || !line.startsWith('@@')) {
      return;
    }

    const match = /@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@/.exec(line);
    if (!match) {
      return;
    }

    const start = Number(match[1]);
    const count = Number(match[2] || 1);
    if (count <= 0) {
      return;
    }

    const target = map.get(currentFile) || new Set();
    for (let index = 0; index < count; index += 1) {
      target.add(start + index);
    }
    map.set(currentFile, target);
  });

  return map;
}

function getBodyLineCount(sourceFile, body) {
  const start = sourceFile.getLineAndCharacterOfPosition(body.getStart()).line;
  const end = sourceFile.getLineAndCharacterOfPosition(body.getEnd()).line;
  return end - start + 1;
}

function getLineRange(sourceFile, node) {
  const start = sourceFile.getLineAndCharacterOfPosition(node.getStart()).line + 1;
  const end = sourceFile.getLineAndCharacterOfPosition(node.getEnd()).line + 1;
  return { start, end };
}

function hasChangedLineInRange(changedLines, start, end) {
  if (!changedLines || changedLines.size === 0) {
    return false;
  }

  for (let line = start; line <= end; line += 1) {
    if (changedLines.has(line)) {
      return true;
    }
  }

  return false;
}

function getNodeName(node) {
  if (ts.isFunctionDeclaration(node) && node.name) {
    return node.name.text;
  }
  if (ts.isMethodDeclaration(node) && node.name && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
    return node.name.text;
  }
  return null;
}

function checkTypescriptFile(filePath, errors, changedLines) {
  const content = readFileSync(filePath, 'utf8');
  const sourceFile = ts.createSourceFile(filePath, content, ts.ScriptTarget.Latest, true);

  if (/\balert\s*\(/.test(content)) {
    errors.push(`${path.relative(root, filePath)}: alert() ist nicht erlaubt.`);
  }

  function visit(node) {
    const isFunctionLike =
      ts.isFunctionDeclaration(node) ||
      ts.isMethodDeclaration(node) ||
      ts.isFunctionExpression(node) ||
      ts.isArrowFunction(node);

    if (isFunctionLike && node.body) {
      const bodyRange = getLineRange(sourceFile, node.body);
      if (!hasChangedLineInRange(changedLines, bodyRange.start, bodyRange.end)) {
        ts.forEachChild(node, visit);
        return;
      }

      const name = getNodeName(node.parent) || getNodeName(node);
      if (name && !isCamelCase(name)) {
        errors.push(`${path.relative(root, filePath)}: Funktion '${name}' ist nicht camelCase.`);
      }

      const lineCount = getBodyLineCount(sourceFile, node.body);
      if (lineCount > 14) {
        errors.push(`${path.relative(root, filePath)}: Funktion '${name || '<anonymous>'}' hat ${lineCount} Zeilen (max. 14).`);
      }

      if (ts.isBlock(node.body)) {
        const statements = node.body.statements.length;
        if (statements > 10) {
          errors.push(`${path.relative(root, filePath)}: Funktion '${name || '<anonymous>'}' hat ${statements} Statements (SRP-Verstoß möglich).`);
        }
      }
    }

    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
}

function checkHtmlFile(filePath, errors, warnings) {
  const content = readFileSync(filePath, 'utf8');

  if (/\balert\s*\(/.test(content)) {
    errors.push(`${path.relative(root, filePath)}: alert() ist nicht erlaubt.`);
  }

  const forms = content.match(/<form\b[^>]*>/gi) || [];
  forms.forEach((formTag) => {
    if (!/\bnovalidate\b/i.test(formTag)) {
      errors.push(`${path.relative(root, filePath)}: <form> braucht 'novalidate' (keine reine HTML5-Validation).`);
    }
  });

  if (forms.length > 0) {
    const hasSpecificErrorHint = /(error|fehler|invalid|required|minlength|maxlength)/i.test(content);
    if (!hasSpecificErrorHint) {
      warnings.push(`${path.relative(root, filePath)}: Formular ohne erkennbare spezifische Fehlermeldung gefunden.`);
    }
  }
}

function checkButtonStyles(errors) {
  const scssFiles = getAllFiles(path.join(root, 'src'), ['.scss']);
  const styles = scssFiles.map((filePath) => readFileSync(filePath, 'utf8')).join('\n');

  if (!/cursor\s*:\s*pointer\s*;?/i.test(styles)) {
    errors.push('Keine globale/button-bezogene CSS-Regel mit cursor: pointer gefunden.');
  }

  if (!/:hover\b/i.test(styles)) {
    errors.push('Kein :hover-State für Buttons/CSS gefunden.');
  }

  if (!/:disabled\b|\[disabled\]/i.test(styles)) {
    errors.push('Kein disabled-State für Buttons/CSS gefunden.');
  }
}

function printManualChecklistReminder() {
  const checklistPath = 'docs/predeploy-manual-checklist.md';
  console.log(`\nManuelle UI-Prüfung zusätzlich ausführen: ${checklistPath}`);
  console.log('- Funktionieren alle Links/Buttons in den betroffenen Views?');
}

function run() {
  const errors = [];
  const warnings = [];
  const changedFiles = getChangedFiles();
  const changedLineMap = getChangedLineMap(changedFiles);

  const tsFiles = changedFiles.filter((filePath) => filePath.endsWith('.ts') && !filePath.endsWith('.spec.ts'));
  const htmlFiles = changedFiles.filter((filePath) => filePath.endsWith('.html'));

  tsFiles.forEach((filePath) =>
    checkTypescriptFile(filePath, errors, changedLineMap.get(filePath) || new Set()),
  );
  htmlFiles.forEach((filePath) => checkHtmlFile(filePath, errors, warnings));
  checkButtonStyles(errors);

  if (warnings.length > 0) {
    console.log('\nWarnungen:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (errors.length > 0) {
    console.error('\nPredeploy-Check fehlgeschlagen:');
    errors.forEach((error) => console.error(`- ${error}`));
    printManualChecklistReminder();
    process.exit(1);
  }

  console.log('Predeploy-Check erfolgreich.');
  printManualChecklistReminder();
}

run();