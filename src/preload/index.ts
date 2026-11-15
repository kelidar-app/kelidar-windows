import { contextBridge, ipcRenderer } from 'electron'
import type { IpcInvokeArgs, IpcResponse, IpcResult, RendererApi } from '@shared/ipc'
import { isIpcChannel, type IpcChannel } from '@shared/ipc-channels'

/**
 * The preload exposes exactly one object, `window.api`, with one method.
 * It only forwards known channels; main validates the sender and the payload.
 * Never expose ipcRenderer or any Node API to the renderer.
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

const api: RendererApi = { invoke }

contextBridge.exposeInMainWorld('api', api)
