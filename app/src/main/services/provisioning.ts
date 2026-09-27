import http from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import type { NetworkExit, Preset } from '@lvd/shared';
import type { GuestRecord } from '@common/ipc';
import type { Ctx } from './context';

/**
 * First-boot provisioning and the guest runner endpoint (plan Phase 3).
 *
 * Guests created from a cloud-init image receive their configuration from this app over a
 * loopback-only HTTP server that QEMU user networking exposes to the guest at 10.0.2.2.
 * The preset's time zone, locale and display are applied inside the guest OS, and the
 * guest browser is pinned by managed policy to the university collector (research boundary)
 * and, for proxy exits, to the approved proxy. No credentials are placed in any image.
 */

export const QEMU_HOST_ALIAS = '10.0.2.2';

export function toGuestUrl(url: string): string {
  const u = new URL(url);
  if (['localhost', '127.0.0.1', '[::1]'].includes(u.hostname)) u.hostname = QEMU_HOST_ALIAS;
  return u.toString();
}

export function guestBaseUrl(port: number, guestId: string, secret: string): string {
  return `http://${QEMU_HOST_ALIAS}:${port}/g/${guestId}/${secret}/`;
}

/** SMBIOS serial telling cloud-init's NoCloud datasource where to fetch its seed. */
export function smbiosSeedArg(port: number, guestId: string, secret: string): string {
  return `type=1,serial=ds=nocloud;s=${guestBaseUrl(port, guestId, secret)}`;
}

function posixLocale(bcp47: string): string {
  const [lang, region] = bcp47.split('-');
  return region && /^[A-Za-z]{2}$/.test(region) ? `${lang.toLowerCase()}_${region.toUpperCase()}.UTF-8` : 'C.UTF-8';
}

export function chromiumPolicy(collectorUrl: string, exit: NetworkExit | null): Record<string, unknown> {
  const c = new URL(toGuestUrl(collectorUrl));
  const policy: Record<string, unknown> = {
    // Research boundary: the study browser may reach only the university collector (brief §2).
    URLBlocklist: ['*'],
    URLAllowlist: [`${c.protocol}//${c.host}`],
    BrowserSignin: 0,
    SyncDisabled: true,
    PasswordManagerEnabled: false,
    MetricsReportingEnabled: false,
    DefaultBrowserSettingEnabled: false,
    PromotionalTabsEnabled: false,
    TranslateEnabled: false,
  };
  if (exit?.kind === 'university-proxy' && exit.proxyUrl) {
    policy.ProxyMode = 'fixed_servers';
    policy.ProxyServer = exit.proxyUrl;
    policy.ProxyBypassList = ''; // the collector must see the proxy's exit
  } else {
    policy.ProxyMode = 'direct';
  }
  return policy;
}

const LOCALE_SH = (loc: string) => `#!/bin/sh
# Enable and generate the preset locale, then make it the system default for new sessions.
set -e
if [ "${loc}" != "C.UTF-8" ]; then
  sed -i 's/^# *\\(${loc.replace('.', '\\.')} \\)/\\1/' /etc/locale.gen
  grep -q '^${loc.replace('.', '\\.')} ' /etc/locale.gen || echo '${loc} UTF-8' >> /etc/locale.gen
  locale-gen
fi
update-locale LANG=${loc}
`;

const DISPLAY_SH = (w: number, h: number) => `#!/bin/sh
# Apply the preset display size (virtio-gpu offers a fixed mode list, so add the mode if missing).
OUT=$(xrandr | awk '/ connected/{print $1; exit}')
[ -z "$OUT" ] && exit 0
if ! xrandr --output "$OUT" --mode ${w}x${h} 2>/dev/null; then
  ML=$(cvt ${w} ${h} | sed -n 's/^Modeline //p')
  NAME=$(echo "$ML" | awk '{print $1}')
  eval xrandr --newmode $ML
  eval xrandr --addmode "$OUT" $NAME
  eval xrandr --output "$OUT" --mode $NAME
fi
`;

export function cloudInitUserData(opts: {
  guest: Pick<GuestRecord, 'id' | 'name'>;
  preset: Preset;
  exit: NetworkExit | null;
  collectorUrl: string;
  runnerBaseUrl: string;
  agentSource: string;
  /** Base built from a provisioned guest: packages are already installed, skip the network-heavy step. */
  packagesPreinstalled?: boolean;
}): string {
  const { preset } = opts;
  const b64 = (s: string) => Buffer.from(s).toString('base64');
  const runner = `sh -c '/opt/lvd/display.sh; exec python3 /opt/lvd/lvd-agent.py --watch ${opts.runnerBaseUrl}'`;
  const files: Array<{ path: string; content: string; permissions: string }> = [
    { path: '/opt/lvd/lvd-agent.py', content: opts.agentSource, permissions: '0755' },
    { path: '/opt/lvd/display.sh', content: DISPLAY_SH(preset.display.width, preset.display.height), permissions: '0755' },
    { path: '/opt/lvd/set-locale.sh', content: LOCALE_SH(posixLocale(preset.regional.locale)), permissions: '0755' },
    {
      // Debian's chromium wrapper sources /etc/chromium.d/*: apply the preset language to the browser layer too.
      path: '/etc/chromium.d/lvd-study-locale',
      content: `export LANGUAGE=${posixLocale(preset.regional.locale).split('.')[0]}\nCHROMIUM_FLAGS="$CHROMIUM_FLAGS --lang=${preset.regional.locale} --accept-lang=${preset.regional.locale},${preset.regional.locale.split('-')[0]}"\n`,
      permissions: '0644',
    },
    { path: '/etc/chromium/policies/managed/lvd-study.json', content: JSON.stringify(chromiumPolicy(opts.collectorUrl, opts.exit), null, 2), permissions: '0644' },
    { path: '/etc/lightdm/lightdm.conf.d/50-lvd-autologin.conf', content: '[Seat:*]\nautologin-user=study\nautologin-user-timeout=0\nautologin-session=xfce\n', permissions: '0644' },
    {
      path: '/etc/xdg/autostart/lvd-runner.desktop',
      content: `[Desktop Entry]\nType=Application\nName=LVD study runner\nExec=${runner}\nX-GNOME-Autostart-enabled=true\n`,
      permissions: '0644',
    },
  ];
  const lines = [
    '#cloud-config',
    `# Generated by LVD Research Control for guest ${opts.guest.id} (preset ${preset.id} v${preset.version}).`,
    `hostname: lvd-${opts.guest.id.slice(-8)}`,
    `timezone: ${preset.regional.timeZone}`,
    // No `locale:` key: cloud-init's locale module runs before `locales` is installed and fails the
    // whole Config stage (pilot 3 serial log). /opt/lvd/set-locale.sh applies it after packages.
    'users:',
    '  - name: study',
    '    gecos: Study session',
    '    shell: /bin/bash',
    '    lock_passwd: true',
    '    groups: [audio, video]',
    ...(opts.packagesPreinstalled
      ? ['# Packages preinstalled in the derived base image.']
      : ['package_update: true', 'packages: [xfce4, lightdm, chromium, python3, x11-xserver-utils, dbus-x11, locales, fonts-dejavu]']),
    'write_files:',
    ...files.flatMap((f) => [
      `  - path: ${f.path}`,
      `    permissions: '${f.permissions}'`,
      '    encoding: b64',
      `    content: ${b64(f.content)}`,
    ]),
    'runcmd:',
    // cloud-init's locale step runs before packages are installed, so generate the locale again here.
    '  - [sh, /opt/lvd/set-locale.sh]',
    '  - [systemctl, set-default, graphical.target]',
    `  - [python3, /opt/lvd/lvd-agent.py, --event, provisioned, --watch, ${opts.runnerBaseUrl}]`,
    'power_state:',
    '  mode: reboot',
    '  message: LVD provisioning complete',
    '  condition: true',
    '',
  ];
  return lines.join('\n');
}

export interface ProvisioningHooks {
  userData(guest: GuestRecord): string | null;
  currentRun(guest: GuestRecord): { runToken: string; collectorUrl: string; studyUrl: string } | null;
}

const EVENTS = new Set(['provisioned', 'runner-started', 'agent-report-sent', 'agent-report-failed', 'browser-launched', 'browser-launch-failed']);

/** Loopback-only server; each guest authenticates with its own random secret. */
export function startProvisioningServer(ctx: Ctx, port: number, hooks: ProvisioningHooks): http.Server {
  const server = http.createServer((req, res) => {
    const send = (status: number, body: string, type = 'text/plain') => {
      res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
      res.end(body);
    };
    const m = /^\/g\/([A-Za-z0-9_]+)\/([a-f0-9]{32})\/([a-z-]*)$/.exec(req.url ?? '');
    if (!m) return send(404, 'not found');
    const [, guestId, secret, resource] = m;
    const guest = ctx.db.getGuest(guestId);
    const expected = guest?.provisioning.secret;
    if (!guest || !expected || expected.length !== secret.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(secret))) {
      return send(403, 'forbidden');
    }

    if (req.method === 'GET' && resource === 'meta-data') {
      return send(200, `instance-id: ${guest.id}\nlocal-hostname: lvd-${guest.id.slice(-8)}\n`);
    }
    if (req.method === 'GET' && resource === 'vendor-data') return send(200, '');
    if (req.method === 'GET' && resource === 'user-data') {
      const ud = hooks.userData(guest);
      return ud ? send(200, ud) : send(404, 'no provisioning for this guest');
    }
    if (req.method === 'GET' && resource === 'current-run') {
      const run = hooks.currentRun(guest);
      return run ? send(200, JSON.stringify(run), 'application/json') : send(204, '');
    }
    if (req.method === 'POST' && resource === 'events') {
      let body = '';
      req.on('data', (c) => {
        body += c;
        if (body.length > 16_384) req.destroy();
      });
      req.on('end', () => {
        try {
          const e = JSON.parse(body) as { event?: string; runToken?: string; detail?: unknown };
          if (!e.event || !EVENTS.has(e.event)) return send(400, 'unknown event');
          ctx.db.addGuestEvent(guest.id, e.event, typeof e.runToken === 'string' ? e.runToken.slice(0, 64) : null, e.detail);
          if (e.event === 'provisioned') {
            ctx.db.putGuest({ ...guest, provisioning: { ...guest.provisioning, provisionedAt: new Date().toISOString() } });
          }
          send(204, '');
        } catch {
          send(400, 'bad json');
        }
      });
      return;
    }
    send(404, 'not found');
  });
  server.on('error', (e) => console.error('[provisioning] server error', e));
  server.listen(port, '127.0.0.1');
  return server;
}

export function readAgentSource(path: string): string {
  return readFileSync(path, 'utf8');
}
