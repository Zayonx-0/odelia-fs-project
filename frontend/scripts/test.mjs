import { existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { executablePath } from 'puppeteer';

// Respect CI/local configuration, then Puppeteer's browser, then a system Chrome.
const candidates = [
  process.env.CHROME_BIN,
  await executablePath(),
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
  '/usr/bin/google-chrome'
];
const chrome = candidates.find(path => path && existsSync(path));
if (!chrome) {
  console.error('No Chrome found. Set CHROME_BIN or run: npx puppeteer browsers install chrome');
  process.exit(1);
}
const cli = fileURLToPath(new URL('../node_modules/@angular/cli/bin/ng.js', import.meta.url));
const child = spawn(process.execPath, [cli, 'test', ...process.argv.slice(2)], {
  stdio: 'inherit', env: { ...process.env, CHROME_BIN: chrome }
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
