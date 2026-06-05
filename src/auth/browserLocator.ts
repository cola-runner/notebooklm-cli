/**
 * Locate an installed Chromium-family browser to drive the auto-capture login.
 *
 * We launch the user's real Chrome/Edge/Brave (not Playwright's bundled
 * Chromium) so Google's "this browser may not be secure" automation block does
 * not fire — the human signs in normally and we read the session cookies over
 * the DevTools protocol afterwards.
 */

import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface BrowserChoice {
  name: string;
  path: string;
}

/** First installed Chromium-family browser, or null if none is found. */
export function findChromiumBrowser(): BrowserChoice | null {
  for (const candidate of browserCandidates()) {
    if (existsSync(candidate.path)) return candidate;
  }
  return null;
}

function browserCandidates(): BrowserChoice[] {
  if (process.platform === 'darwin') {
    return [
      {
        name: 'Google Chrome',
        path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      },
      {
        name: 'Microsoft Edge',
        path: '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
      },
      {
        name: 'Brave',
        path: '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
      },
      { name: 'Chromium', path: '/Applications/Chromium.app/Contents/MacOS/Chromium' },
      {
        name: 'Google Chrome Canary',
        path: '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
      },
    ];
  }
  if (process.platform === 'win32') {
    const pf = process.env['PROGRAMFILES'] ?? 'C:\\Program Files';
    const pf86 = process.env['PROGRAMFILES(X86)'] ?? 'C:\\Program Files (x86)';
    const local = process.env['LOCALAPPDATA'] ?? join(homedir(), 'AppData', 'Local');
    return [
      { name: 'Google Chrome', path: join(pf, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Google Chrome', path: join(pf86, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Google Chrome', path: join(local, 'Google\\Chrome\\Application\\chrome.exe') },
      { name: 'Microsoft Edge', path: join(pf86, 'Microsoft\\Edge\\Application\\msedge.exe') },
      { name: 'Microsoft Edge', path: join(pf, 'Microsoft\\Edge\\Application\\msedge.exe') },
      {
        name: 'Brave',
        path: join(pf, 'BraveSoftware\\Brave-Browser\\Application\\brave.exe'),
      },
    ];
  }
  // Linux and other Unixes.
  return [
    { name: 'Google Chrome', path: '/usr/bin/google-chrome' },
    { name: 'Google Chrome', path: '/usr/bin/google-chrome-stable' },
    { name: 'Chromium', path: '/usr/bin/chromium' },
    { name: 'Chromium', path: '/usr/bin/chromium-browser' },
    { name: 'Microsoft Edge', path: '/usr/bin/microsoft-edge' },
    { name: 'Brave', path: '/usr/bin/brave-browser' },
  ];
}
