import type { Settings } from '@common/ipc';
import type { Db } from './services/db';

export interface SecretBox {
  encrypt(plain: string): string;
  decrypt(cipher: string): string;
}

/** The admin key is stored encrypted with the OS keychain (Electron safeStorage) and never sent to the renderer. */
export class SettingsService {
  constructor(private db: Db, private box: SecretBox) {}

  get(): Settings {
    return {
      collectorUrl: this.db.getSetting('collectorUrl') ?? 'http://localhost:4100',
      operator: this.db.getSetting('operator') ?? '',
      hasAdminKey: !!this.db.getSetting('adminKey'),
      provisionPort: Number(this.db.getSetting('provisionPort') ?? 4180),
    };
  }

  set(patch: { collectorUrl?: string; operator?: string; adminKey?: string; provisionPort?: number }): Settings {
    if (patch.provisionPort !== undefined) this.db.setSetting('provisionPort', String(patch.provisionPort));
    if (patch.collectorUrl !== undefined) this.db.setSetting('collectorUrl', patch.collectorUrl.replace(/\/+$/, ''));
    if (patch.operator !== undefined) this.db.setSetting('operator', patch.operator.trim());
    if (patch.adminKey !== undefined && patch.adminKey !== '') this.db.setSetting('adminKey', this.box.encrypt(patch.adminKey));
    return this.get();
  }

  adminKey(): string | null {
    const c = this.db.getSetting('adminKey');
    return c ? this.box.decrypt(c) : null;
  }
}
