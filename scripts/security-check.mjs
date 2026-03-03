import { execSync } from 'node:child_process';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = process.cwd();
const errors = [];
const warnings = [];

function runCommand(command) {
  try {
    return { ok: true, output: execSync(command, { cwd: root, encoding: 'utf8' }).trim() };
  } catch (error) {
    return {
      ok: false,
      output: String(error.stdout || error.message || '').trim(),
    };
  }
}

function listFiles(directory, extensions, collected = []) {
  const entries = readdirSync(directory);
  entries.forEach((entry) => {
    const fullPath = path.join(directory, entry);
    const stats = statSync(fullPath);
    if (stats.isDirectory()) {
      if (['node_modules', '.git', 'dist', '.angular'].includes(entry)) {
        return;
      }
      listFiles(fullPath, extensions, collected);
      return;
    }
    if (extensions.includes(path.extname(fullPath).toLowerCase())) {
      collected.push(fullPath);
    }
  });
  return collected;
}

function checkNpmAudit() {
  const result = runCommand('npm audit --json --omit=dev');
  if (!result.output) {
    warnings.push('npm audit lieferte keine auswertbaren Daten.');
    return;
  }

  try {
    const parsed = JSON.parse(result.output);
    const metadata = parsed.metadata && parsed.metadata.vulnerabilities
      ? parsed.metadata.vulnerabilities
      : {};
    const critical = Number(metadata.critical || 0);
    const high = Number(metadata.high || 0);

    if (critical > 0) {
      errors.push(`npm audit: ${critical} kritische Schwachstelle(n) gefunden.`);
    }
    if (high > 0) {
      warnings.push(`npm audit: ${high} hohe Schwachstelle(n) gefunden. Bitte Abhängigkeiten zeitnah aktualisieren.`);
    }
  } catch {
    warnings.push('npm audit JSON konnte nicht geparst werden.');
  }
}

function checkDangerousPatterns() {
  const patterns = [
    { regex: /\beval\s*\(/, label: 'eval()' },
    { regex: /new\s+Function\s*\(/, label: 'new Function()' },
    { regex: /bypassSecurityTrust(Html|Style|Script|Url|ResourceUrl)\s*\(/, label: 'Angular bypassSecurityTrust*' },
    { regex: /\[innerHTML\]\s*=/, label: '[innerHTML] binding' },
  ];

  const files = listFiles(path.join(root, 'src'), ['.ts', '.html']);
  files.forEach((filePath) => {
    const content = readFileSync(filePath, 'utf8');
    patterns.forEach(({ regex, label }) => {
      if (regex.test(content)) {
        errors.push(`${path.relative(root, filePath)}: Kritisches Muster gefunden: ${label}`);
      }
    });
  });
}

function checkSecrets() {
  const secretPatterns = [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
    /ghp_[A-Za-z0-9]{30,}/,
    /github_pat_[A-Za-z0-9_]{20,}/,
    /AKIA[0-9A-Z]{16}/,
    /xox[baprs]-[A-Za-z0-9-]{10,}/,
  ];

  const files = listFiles(root, ['.ts', '.js', '.mjs', '.json', '.html', '.scss', '.env']);
  files.forEach((filePath) => {
    const relative = path.relative(root, filePath);
    const isEnvironmentConfig = relative.includes('src/environments/environment');
    if (isEnvironmentConfig) {
      return;
    }

    const content = readFileSync(filePath, 'utf8');
    secretPatterns.forEach((pattern) => {
      if (pattern.test(content)) {
        errors.push(`${relative}: Mögliches Secret/Key im Repository gefunden.`);
      }
    });
  });
}

function checkFirebaseRules() {
  const firestorePath = path.join(root, 'firestore.rules');
  const storagePath = path.join(root, 'storage.rules');

  const firestoreContent = readFileSync(firestorePath, 'utf8');
  const storageContent = readFileSync(storagePath, 'utf8');

  if (/allow\s+read\s*,\s*write\s*:\s*if\s+true\s*;/i.test(firestoreContent)) {
    errors.push('firestore.rules: Globaler allow read,write: if true ist unsicher.');
  }
  if (/allow\s+write\s*:\s*if\s+true\s*;/i.test(storageContent)) {
    errors.push('storage.rules: Globales allow write: if true ist unsicher.');
  }
}

function printResult() {
  if (warnings.length > 0) {
    console.log('\nSecurity-Hinweise:');
    warnings.forEach((warning) => console.log(`- ${warning}`));
  }

  if (errors.length > 0) {
    console.error('\nSecurity-Check fehlgeschlagen:');
    errors.forEach((error) => console.error(`- ${error}`));
    process.exit(1);
  }

  console.log('Security-Check erfolgreich.');
}

function run() {
  checkNpmAudit();
  checkDangerousPatterns();
  checkSecrets();
  checkFirebaseRules();
  printResult();
}

run();