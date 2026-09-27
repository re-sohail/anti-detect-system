import type { LvdApi } from '../common/ipc';

declare global {
  interface Window {
    lvd: LvdApi;
  }
}
