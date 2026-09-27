import { contextBridge, ipcRenderer } from 'electron';
import { CHANNELS, type LvdApi } from '@common/ipc';

const allowed = new Set<string>(CHANNELS);

const api: LvdApi = {
  invoke(channel, input) {
    if (!allowed.has(channel)) return Promise.resolve({ ok: false, error: { code: 'invalid-input', message: 'Unknown channel' } });
    return ipcRenderer.invoke(channel, input);
  },
};

contextBridge.exposeInMainWorld('lvd', api);
