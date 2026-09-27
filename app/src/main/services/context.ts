import type { HostCapabilities } from '@common/ipc';
import type { Db } from './db';

export interface Ctx {
  db: Db;
  dataDir: string;
  hostId: string;
  appVersion: string;
  electronVersion: string;
  probe: () => Promise<HostCapabilities>;
  adminKey: () => string | null;
  /** Directory for control sockets; kept short because unix socket paths are length-limited. */
  runtimeDir: string;
}
