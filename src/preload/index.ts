import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type {
  IpcEventPayload,
  IpcInvokeArgs,
  IpcResponse,
  IpcResult,
  RendererApi,
} from '@shared/ipc'
import { isIpcChannel, type IpcChannel } from '@shared/ipc-channels'
import { isIpcEvent, type IpcEvent } from '@shared/ipc-events'

/**
 * The preload exposes exactly one object, `window.api`, with two methods.
 * It only forwards known channels and events; main validates the sender and
 * the payload. Never expose ipcRenderer or any Node API to the renderer.
 */
async function invoke<C extends IpcChannel>(
  channel: C,
  ...args: IpcInvokeArgs<C>
): Promise<IpcResult<IpcResponse<C>>> {
  if (!isIpcChannel(channel)) {
    return { ok: false, error: { code: 'IPC_FORBIDDEN' } }
  }
  return (await ipcRenderer.invoke(channel, ...args)) as IpcResult<IpcResponse<C>>
}

/** The listener never sees the IpcRendererEvent (it carries `sender`). */
function on<E extends IpcEvent>(
  event: E,
  listener: (payload: IpcEventPayload<E>) => void,
): () => void {
  if (!isIpcEvent(event)) return () => undefined
  const wrapped = (_event: IpcRendererEvent, payload: IpcEventPayload<E>): void => {
    listener(payload)
  }
  ipcRenderer.on(event, wrapped)
  return () => {
    ipcRenderer.removeListener(event, wrapped)
  }
}

const api: RendererApi = { invoke, on }

contextBridge.exposeInMainWorld('api', api)
