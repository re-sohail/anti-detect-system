import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

export function sha256File(p: string): Promise<string> {
  return hashFile(p, 'sha256');
}

export function hashFile(p: string, algo: 'sha256' | 'sha512'): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash(algo);
    createReadStream(p)
      .on('data', (c) => h.update(c))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

export function sha256(s: string | Buffer): string {
  return createHash('sha256').update(s).digest('hex');
}

export function newId(prefix: string): string {
  const t = Date.now().toString(36);
  const r = Array.from(crypto.getRandomValues(new Uint8Array(5)), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${prefix}_${t}${r}`;
}
