import { existsSync } from 'node:fs';
import { defineConfig, devices } from '@playwright/test';
const baseURL = 'http://localhost:4173';
// Cloud sandbox only: its pre-installed Chromium (/opt/pw-browsers) is an older build than this Playwright expects.
// Elsewhere the path doesn't exist and Playwright uses its own downloaded browser.
const sandboxChromium = '/opt/pw-browsers/chromium';
const launchOptions = existsSync(sandboxChromium) ? { executablePath: sandboxChromium } : {};
// http-server 14.1.1 trips Node's DEP0066 warning on every run; silence just that one.
const serverEnv = { NODE_OPTIONS: [process.env.NODE_OPTIONS, '--disable-warning=DEP0066'].filter(Boolean).join(' ') };
export default defineConfig({
  testDir: 'e2e',
  reporter: 'list',
  webServer: { command: 'npm run serve', url: baseURL, reuseExistingServer: true, env: serverEnv },
  use: { baseURL, locale: 'ar-EG' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], launchOptions } }],
});
