import { chmodSync, constants, copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { ImageRecord } from '@lvd/shared';
import type { ImageMeta } from '@common/ipc';
import { AppError } from '../errors';
import type { Ctx } from './context';
import { hashFile, newId, sha256File } from './hash';

/**
 * Image manager (brief §5): records origin, version, hash, install date and licence notes.
 * Bases are copied into the app's store (a clone on APFS), made read-only, and never modified.
 */
export async function registerImage(ctx: Ctx, sourcePath: string, meta: ImageMeta): Promise<ImageRecord> {
  if (!existsSync(sourcePath)) throw new AppError('missing-image', `Image file not found: ${sourcePath}`);
  const ext = path.extname(sourcePath).toLowerCase();
  const format = ext === '.qcow2' ? 'qcow2' : ext === '.img' || ext === '.raw' ? 'raw' : null;
  if (!format) throw new AppError('invalid-input', 'Image must be .qcow2, .img or .raw');

  const id = newId('img');
  const dir = path.join(ctx.dataDir, 'images');
  mkdirSync(dir, { recursive: true });
  const dest = path.join(dir, `${id}.${format}`);
  copyFileSync(sourcePath, dest, constants.COPYFILE_FICLONE);
  const sha = await sha256File(dest);
  // Publishers use SHA-256 or SHA-512 (e.g. Debian's SHA512SUMS); verify whichever was given.
  const expected = meta.expectedSha256?.toLowerCase();
  if (expected) {
    const actual = expected.length === 128 ? await hashFile(dest, 'sha512') : sha;
    if (actual !== expected) {
      rmSync(dest, { force: true });
      throw new AppError('checksum-mismatch', 'Image checksum does not match the published value', { expected, actual });
    }
  }
  chmodSync(dest, 0o444);
  const record = ImageRecord.parse({
    id,
    name: meta.name,
    version: meta.version,
    origin: meta.origin,
    sha256: sha,
    sizeBytes: statSync(dest).size,
    guestOs: meta.guestOs,
    guestArch: meta.guestArch,
    format,
    licenseNotes: meta.licenseNotes,
    path: dest,
    addedAt: new Date().toISOString(),
    status: 'active',
    provisioning: meta.provisioning ?? 'manual',
  });
  ctx.db.putImage(record);
  return record;
}

export async function verifyImage(ctx: Ctx, id: string): Promise<{ id: string; match: boolean; actual: string }> {
  const img = ctx.db.getImage(id);
  if (!img) throw new AppError('not-found', `Unknown image ${id}`);
  if (!existsSync(img.path)) throw new AppError('missing-image', `Image file missing: ${img.path}`);
  const actual = await sha256File(img.path);
  return { id, match: actual === img.sha256, actual };
}

/** Throws unless the stored base still matches its registered checksum. */
export async function requireVerifiedImage(ctx: Ctx, id: string): Promise<ImageRecord> {
  const img = ctx.db.getImage(id);
  if (!img) throw new AppError('missing-image', `Preset refers to unknown image ${id}`);
  const v = await verifyImage(ctx, id);
  if (!v.match) throw new AppError('checksum-mismatch', `Base image ${img.name} ${img.version} has changed on disk`, { expected: img.sha256, actual: v.actual });
  return img;
}
