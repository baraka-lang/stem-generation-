#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

console.log('🔍 Validating Electron Setup for DAW Integration\n');

const checks = [];

function check(name, condition, fix) {
  const result = { name, passed: false, fix };
  try {
    result.passed = condition();
  } catch (err) {
    result.error = err.message;
  }
  checks.push(result);
  return result.passed;
}

check(
  'electron-main.cjs exists',
  () => fs.existsSync('./electron-main.cjs'),
  'File should have been created during setup'
);

check(
  'electron-preload.cjs exists',
  () => fs.existsSync('./electron-preload.cjs'),
  'File should have been created during setup'
);

check(
  'package.json has correct main entry',
  () => {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    return pkg.main === 'electron-main.cjs';
  },
  'Update package.json: "main": "electron-main.cjs"'
);

check(
  'Electron dependency installed',
  () => {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    return pkg.devDependencies && pkg.devDependencies.electron;
  },
  'Run: npm install --save-dev electron'
);

check(
  'Electron Builder dependency installed',
  () => {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    return pkg.devDependencies && pkg.devDependencies['electron-builder'];
  },
  'Run: npm install --save-dev electron-builder'
);

check(
  'dist/ directory exists (web app built)',
  () => fs.existsSync('./dist') && fs.existsSync('./dist/index.html'),
  'Run: npm run build'
);

check(
  'Electron scripts in package.json',
  () => {
    const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf-8'));
    return pkg.scripts && pkg.scripts.electron && pkg.scripts['electron:dev'];
  },
  'Add scripts: "electron": "electron .", "electron:dev": "NODE_ENV=development electron ."'
);

check(
  'app.js has Electron detection',
  () => {
    const appJs = fs.readFileSync('./src/app.js', 'utf-8');
    return appJs.includes('window.electronAPI') && appJs.includes('startNativeDrag');
  },
  'Update src/app.js with Electron API integration'
);

check(
  '.env file exists',
  () => fs.existsSync('./.env'),
  'Create .env file with required API keys'
);

console.log('Results:\n');

let allPassed = true;
checks.forEach(({ name, passed, fix, error }) => {
  const icon = passed ? '✅' : '❌';
  console.log(`${icon} ${name}`);
  if (!passed) {
    allPassed = false;
    if (error) console.log(`   Error: ${error}`);
    if (fix) console.log(`   Fix: ${fix}`);
  }
});

console.log('\n' + '='.repeat(60));

if (allPassed) {
  console.log('✅ All checks passed! You can now run:\n');
  console.log('   npm run electron        # Launch Electron app');
  console.log('   npm run electron:dev    # Launch in dev mode\n');
  console.log('Then test drag and drop with Ableton Live!');
} else {
  console.log('❌ Some checks failed. Please fix the issues above.\n');
  console.log('Quick fix commands:\n');
  console.log('   npm install');
  console.log('   npm run build');
  console.log('   npm run electron\n');
}

console.log('='.repeat(60));
console.log('\n📚 Documentation:');
console.log('   - QUICK_START.md - Quick setup guide');
console.log('   - README_ELECTRON.md - Complete documentation');
console.log('   - ELECTRON_DAW_INTEGRATION.md - Technical details\n');
