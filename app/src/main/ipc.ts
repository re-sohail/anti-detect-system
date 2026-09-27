import { BrowserWindow, dialog, ipcMain, type IpcMainInvokeEvent } from 'electron';
import os from 'node:os';
import path from 'node:path';
import { writeFileSync } from 'node:fs';
import { z } from 'zod';
import { Consent, Environment, GuestArch, GuestOs, NetworkExit, PresetInput, Treatment } from '@lvd/shared';
import { CHANNELS, type Channel, type In, type Out, type Result } from '@common/ipc';
import { AppError, toErrorShape } from './errors';
import type { Ctx } from './services/context';
import type { GuestService } from './services/guests';
import { registerImage, verifyImage } from './services/images';
import { checkPreset, previewPreset, savePreset } from './services/presets';
import type { RunService } from './services/runs';
import type { SettingsService } from './settings';
import { saveConsent, withdrawConsent } from './services/consents';
import { approveExit, listExits, saveExit, testExit } from './services/exits';
import { perfReport } from './services/perf';
import { exportGroundTruth, hostInventory } from './services/studyExport';

/**
 * Allow-listed, validated IPC (brief §5, Electron security guidance [17]).
 * Every mutating call writes an audit event with its outcome.
 */

const id = z.object({ id: z.string().min(1).max(80) });
const nothing = z.undefined().or(z.null()).transform(() => undefined);

const INPUTS: { [C in Channel]: z.ZodType<In<C>> } = {
  'host.probe': nothing,
  'settings.get': nothing,
  'settings.set': z.object({
    collectorUrl: z.url({ protocol: /^https?$/ }).optional(),
    operator: z.string().max(80).optional(),
    adminKey: z.string().max(200).optional(),
    provisionPort: z.number().int().min(1024).max(65535).optional(),
  }),
  'images.list': nothing,
  'images.pickAndRegister': z.object({
    name: z.string().min(1).max(120), version: z.string().min(1).max(60), origin: z.string().min(1).max(500),
    guestOs: GuestOs, guestArch: GuestArch, licenseNotes: z.string().max(2000),
    expectedSha256: z.string().regex(/^([a-fA-F0-9]{64}|[a-fA-F0-9]{128})$/).optional().or(z.literal('').transform(() => undefined)),
  }),
  'images.verify': id,
  'presets.list': nothing,
  'presets.preview': z.object({ input: z.unknown(), baseId: z.string().optional() }),
  'presets.save': z.object({ input: PresetInput, baseId: z.string().optional() }),
  'presets.check': id,
  'guests.list': nothing,
  'guests.create': z.object({ presetId: z.string().min(1), name: z.string().min(1).max(60) }),
  'guests.start': id.extend({ display: z.enum(['window', 'headless']) }),
  'guests.stop': id.extend({ force: z.boolean() }),
  'guests.pause': id,
  'guests.resume': id,
  'guests.snapshot': id.extend({ name: z.string().min(1).max(40) }),
  'guests.reset': id.extend({ name: z.string().min(1).max(40) }),
  'guests.delete': id.extend({ confirmName: z.string() }),
  'runs.list': nothing,
  'runs.start': z.object({
    guestId: z.string().nullable(), treatment: Treatment, notes: z.string().max(2000), routeId: z.string().max(64).optional(),
    placeStudyToken: z.boolean().optional(),
    environment: z.object({
      kind: Environment.shape.kind, label: z.string().min(1).max(80),
      consentId: z.string().nullable().optional(), product: Environment.shape.product.optional(),
    }),
  }),
  'runs.finish': id,
  'runs.detail': id,
  'runs.export': id,
  'audit.list': z.object({ limit: z.number().int().min(1).max(5000) }),
  'exits.list': nothing,
  'exits.save': NetworkExit.omit({ approvedAt: true, lastTest: true }),
  'exits.approve': id.extend({ approvedBy: z.string().min(1).max(120) }),
  'exits.test': id,
  'consents.list': nothing,
  'consents.save': Consent.omit({ id: true, withdrawnAt: true }).extend({ id: z.string().optional() }),
  'consents.withdraw': id,
  'perf.report': nothing,
  'perf.export': nothing,
  'study.hostInventory': nothing,
  'study.saveHostInventory': nothing,
  'study.exportGroundTruth': nothing,
} as never;

const READ_ONLY = new Set<Channel>([
  'host.probe', 'settings.get', 'images.list', 'presets.list', 'presets.preview', 'presets.check',
  'guests.list', 'runs.list', 'runs.detail', 'audit.list',
  'exits.list', 'consents.list', 'perf.report', 'study.hostInventory',
]);

export interface Services {
  ctx: Ctx;
  guests: GuestService;
  runs: RunService;
  settings: SettingsService;
}

function handlers(s: Services): { [C in Channel]: (input: In<C>, win: BrowserWindow | null) => Promise<Out<C>> | Out<C> } {
  const { ctx, guests, runs, settings } = s;
  return {
    'host.probe': () => ctx.probe(),
    'settings.get': () => settings.get(),
    'settings.set': (i) => settings.set(i),
    'images.list': () => ctx.db.listImages(),
    'images.pickAndRegister': async (meta, win) => {
      const opts = {
        title: 'Select a guest base image',
        properties: ['openFile' as const],
        filters: [{ name: 'Disk images', extensions: ['qcow2', 'img', 'raw'] }],
      };
      const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (pick.canceled || !pick.filePaths[0]) return null;
      return registerImage(ctx, pick.filePaths[0], meta);
    },
    'images.verify': ({ id }) => verifyImage(ctx, id),
    'presets.list': () => ctx.db.listPresets(),
    'presets.preview': ({ input, baseId }) => previewPreset(ctx, input, baseId),
    'presets.save': ({ input, baseId }) => savePreset(ctx, input, baseId),
    'presets.check': async ({ id }) => {
      const p = ctx.db.getPreset(id);
      if (!p) throw new AppError('not-found', `Unknown preset ${id}`);
      return checkPreset(ctx, p, await ctx.probe());
    },
    'guests.list': () => guests.list(),
    'guests.create': ({ presetId, name }) => guests.create(presetId, name),
    'guests.start': ({ id, display }) => guests.start(id, display),
    'guests.stop': ({ id, force }) => guests.stop(id, force),
    'guests.pause': ({ id }) => guests.pause(id),
    'guests.resume': ({ id }) => guests.resume(id),
    'guests.snapshot': ({ id, name }) => guests.snapshot(id, name),
    'guests.reset': ({ id, name }) => guests.reset(id, name),
    'guests.delete': ({ id, confirmName }) => guests.delete(id, confirmName),
    'runs.list': () => runs.list(),
    'runs.start': (i) => runs.start(i),
    'runs.finish': ({ id }) => runs.finish(id),
    'runs.detail': ({ id }) => runs.detail(id),
    'runs.export': async ({ id }, win) => {
      const opts = { title: 'Choose export folder', properties: ['openDirectory' as const, 'createDirectory' as const] };
      const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
      if (pick.canceled || !pick.filePaths[0]) return null;
      return runs.exportRun(id, pick.filePaths[0]);
    },
    'audit.list': ({ limit }) => ctx.db.listAudit(limit),
    'exits.list': () => listExits(ctx),
    'exits.save': (e) => saveExit(ctx, { ...e, approvedAt: ctx.db.getExit(e.id)?.approvedAt ?? null, lastTest: ctx.db.getExit(e.id)?.lastTest ?? null }),
    'exits.approve': ({ id, approvedBy }) => approveExit(ctx, id, approvedBy),
    'exits.test': ({ id }) => testExit(ctx, id, settings.get().collectorUrl),
    'consents.list': () => ctx.db.listConsents(),
    'consents.save': (c) => saveConsent(ctx, c),
    'consents.withdraw': ({ id }) => withdrawConsent(ctx, id),
    'perf.report': () => perfReport(ctx),
    'perf.export': async (_i, win) => {
      const dir = await pickFolder(win, 'Choose folder for the performance report');
      if (!dir) return null;
      const r = perfReport(ctx);
      const file = path.join(dir, `lvd-perf-${ctx.hostId}-${r.generatedAt.replace(/[:.]/g, '-')}.json`);
      writeFileSync(file, JSON.stringify({ report: r, rawSamples: ctx.db.samples(), events: ctx.db.guestEvents() }, null, 2), { flag: 'wx' });
      return { file };
    },
    'study.hostInventory': async () => hostInventory(ctx, await ctx.probe()),
    'study.saveHostInventory': async (_i, win) => {
      const dir = await pickFolder(win, 'Choose folder for the host inventory');
      if (!dir) return null;
      const inv = await hostInventory(ctx, await ctx.probe());
      const base = path.join(dir, `host-inventory-${ctx.hostId}`);
      writeFileSync(base + '.md', inv.markdown, { flag: 'wx' });
      writeFileSync(base + '.json', JSON.stringify(inv.inventory, null, 2), { flag: 'wx' });
      return { files: [base + '.md', base + '.json'] };
    },
    'study.exportGroundTruth': async (_i, win) => {
      const dir = await pickFolder(win, 'Choose a supervisor-only folder for ground truth');
      if (!dir) return null;
      return exportGroundTruth(ctx, await ctx.probe(), dir);
    },
  };
}

async function pickFolder(win: BrowserWindow | null, title: string): Promise<string | null> {
  const opts = { title, properties: ['openDirectory' as const, 'createDirectory' as const] };
  const pick = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
  return pick.canceled || !pick.filePaths[0] ? null : pick.filePaths[0];
}

/** Audit target: the entity id an action is about, so per-run/guest history can be exported. */
function targetOf(input: unknown, out: unknown): string | null {
  const o = out as { id?: unknown } | null;
  const i = input as { id?: unknown; guestId?: unknown; presetId?: unknown } | null;
  return [i?.id, o?.id, i?.guestId, i?.presetId].find((v): v is string => typeof v === 'string') ?? null;
}

function redact(channel: Channel, input: unknown): unknown {
  if (channel === 'settings.set' && input && typeof input === 'object' && 'adminKey' in input) {
    return { ...input, adminKey: '[redacted]' };
  }
  return input;
}

export function registerIpc(s: Services, isTrustedSender: (e: IpcMainInvokeEvent) => boolean) {
  const table = handlers(s);
  const actor = () => s.settings.get().operator || os.userInfo().username;

  for (const channel of CHANNELS) {
    ipcMain.handle(channel, async (event, raw): Promise<Result<unknown>> => {
      if (!isTrustedSender(event)) {
        return { ok: false, error: { code: 'invalid-input', message: 'Untrusted IPC sender' } };
      }
      const parsed = (INPUTS[channel] as z.ZodType<unknown>).safeParse(raw);
      if (!parsed.success) {
        const error = { code: 'invalid-input' as const, message: 'Invalid input', details: z.treeifyError(parsed.error) };
        if (!READ_ONLY.has(channel)) s.ctx.db.audit({ actor: actor(), action: channel, target: null, outcome: 'error', detail: { error } });
        return { ok: false, error };
      }
      const win = BrowserWindow.fromWebContents(event.sender);
      try {
        const data = await (table[channel] as (i: unknown, w: BrowserWindow | null) => unknown)(parsed.data, win);
        if (!READ_ONLY.has(channel)) {
          s.ctx.db.audit({ actor: actor(), action: channel, target: targetOf(parsed.data, data), outcome: 'ok', detail: { input: redact(channel, parsed.data) } });
        }
        return { ok: true, data };
      } catch (e) {
        const error = toErrorShape(e);
        if (!READ_ONLY.has(channel)) {
          s.ctx.db.audit({ actor: actor(), action: channel, target: targetOf(parsed.data, null), outcome: 'error', detail: { input: redact(channel, parsed.data), error } });
        }
        if (error.code === 'internal') console.error(`[ipc] ${channel}`, e);
        return { ok: false, error };
      }
    });
  }
}
