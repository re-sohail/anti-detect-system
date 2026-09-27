import { app, BrowserWindow, safeStorage, session, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import type { HostCapabilities } from '@common/ipc';
import { registerIpc } from './ipc';
import { SettingsService } from './settings';
import { probeHost } from './services/capabilities';
import type { Ctx } from './services/context';
import { openDb } from './services/db';
import { GuestService } from './services/guests';
import { RunService } from './services/runs';
import { PerfSampler } from './services/perf';
import { cloudInitUserData, guestBaseUrl, readAgentSource, startProvisioningServer } from './services/provisioning';
import { getExit } from './services/exits';
import { existsSync } from 'node:fs';

const RENDERER_DEV_URL = process.env.ELECTRON_RENDERER_URL;

function createServices() {
  const dataDir = process.env.LVD_DATA_DIR ?? path.join(app.getPath('userData'), 'data');
  const db = openDb(dataDir);
  let hostId = db.getSetting('hostId');
  if (!hostId) {
    // A random study identifier, not a hardware serial.
    hostId = 'host_' + randomUUID();
    db.setSetting('hostId', hostId);
  }
  const box = safeStorage.isEncryptionAvailable()
    ? {
        encrypt: (s: string) => safeStorage.encryptString(s).toString('base64'),
        decrypt: (s: string) => safeStorage.decryptString(Buffer.from(s, 'base64')),
      }
    : { encrypt: (s: string) => 'plain:' + s, decrypt: (s: string) => s.replace(/^plain:/, '') };
  const settings = new SettingsService(db, box);

  let cached: { at: number; caps: HostCapabilities } | null = null;
  const ctx: Ctx = {
    db,
    dataDir,
    hostId,
    appVersion: app.getVersion(),
    electronVersion: process.versions.electron,
    runtimeDir: process.platform === 'win32' ? path.join(os.tmpdir(), 'lvd') : `/tmp/lvd-${process.getuid?.() ?? 0}`,
    adminKey: () => settings.adminKey() ?? (app.isPackaged ? null : 'dev-admin-key'),
    probe: async () => {
      // Short cache so a burst of checks does not re-spawn probes; free memory/disk stay fresh enough.
      if (cached && Date.now() - cached.at < 3000) return cached.caps;
      const caps = await probeHost(dataDir, hostId!);
      cached = { at: Date.now(), caps };
      return caps;
    },
  };
  const guests = new GuestService(ctx, () => settings.get().provisionPort);
  const runs = new RunService(ctx, guests, () => settings.get().collectorUrl);

  // First-boot provisioning + in-guest runner endpoint (loopback only).
  const agentPath = [
    process.env.LVD_AGENT_PATH,
    path.join(process.resourcesPath ?? '', 'guest-agent', 'lvd-agent.py'),
    path.join(app.getAppPath(), '..', 'guest-agent', 'lvd-agent.py'),
  ].find((p): p is string => !!p && existsSync(p));
  const provisionPort = settings.get().provisionPort;
  startProvisioningServer(ctx, provisionPort, {
    userData: (guest) => {
      const preset = db.getPreset(guest.presetId, guest.presetVersion);
      if (!preset || !guest.provisioning.secret || !agentPath) return null;
      return cloudInitUserData({
        guest, preset, exit: getExit(ctx, preset.network.routeId), collectorUrl: settings.get().collectorUrl,
        runnerBaseUrl: guestBaseUrl(provisionPort, guest.id, guest.provisioning.secret), agentSource: readAgentSource(agentPath),
        packagesPreinstalled: !!db.getImage(guest.imageId)?.derivedFrom,
      });
    },
    currentRun: (guest) => runs.openRunFor(guest.id),
  });
  new PerfSampler(ctx).start();

  // R4: a guest that dies mid-run interrupts its runs; nothing is fabricated.
  guests.onUnexpectedExit((guestId, reason) => runs.interruptRunsFor(guestId, `guest exited: ${reason}`));
  // Crash recovery on startup.
  const lost = guests.reconcile();
  for (const g of lost) runs.interruptRunsFor(g, 'guest not running after app restart');
  runs.interruptPlanned('app restarted before run registration completed');
  db.audit({ actor: 'system', action: 'app.start', target: null, outcome: 'ok', detail: { recoveredGuests: lost } });
  return { ctx, guests, runs, settings };
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'LVD Research Control',
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
    },
  });
  win.once('ready-to-show', () => win.show());
  // No navigation away from the app and no new windows; external links open in the OS browser.
  win.webContents.on('will-navigate', (e, url) => {
    if (!isAppUrl(url)) e.preventDefault();
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  if (RENDERER_DEV_URL) void win.loadURL(RENDERER_DEV_URL);
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'));
  return win;
}

function isAppUrl(url: string): boolean {
  if (RENDERER_DEV_URL) return url.startsWith(RENDERER_DEV_URL);
  return url.startsWith('file://') && url.includes('/renderer/index.html');
}

app.whenReady().then(() => {
  session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  const services = createServices();
  registerIpc(services, (e) => !!e.senderFrame && isAppUrl(e.senderFrame.url));
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  // Guests keep running detached; they are reconciled on next launch.
  if (process.platform !== 'darwin') app.quit();
});
