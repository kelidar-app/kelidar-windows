import { afterEach, describe, expect, it } from 'vitest'
import type { GroupView } from '../../src/shared/groups'
import type { HostView } from '../../src/shared/hosts'
import type { SessionOpenResponse } from '../../src/shared/session'
import { createHarness, waitFor, type Harness } from './helpers/harness'
import { startTestServer } from './helpers/ssh-server'

const PASSWORD = 'pw-Group-Lynx-3307-secret'

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  while (cleanups.length > 0) await cleanups.pop()?.()
})

async function setup(): Promise<Harness> {
  const harness = await createHarness()
  cleanups.push(harness.close)
  return harness
}

describe('groups over IPC', () => {
  it('connects with the port a host inherits from its group, then lists it as recent', async () => {
    const h = await setup()
    const server = await startTestServer({ password: PASSWORD })
    cleanups.push(server.close)

    const parent = await h.call<GroupView>('groups:save', {
      name: 'Lab',
      defaults: { port: server.port, environment: 'staging' },
    })
    const child = await h.call<GroupView>('groups:save', { name: 'Rack 1', parentId: parent.id })
    const host = await h.call<HostView>('hosts:save', {
      name: 'box',
      address: '127.0.0.1',
      username: 'tester',
      groupId: child.id,
      tags: ['lab'],
      auth: { type: 'password', password: PASSWORD },
    })
    expect(host).toMatchObject({ port: server.port, environment: 'staging', groupId: child.id })
    expect(host.lastConnectedAt).toBeUndefined()

    const { sessionId, target } = await h.call<SessionOpenResponse>('session:open', {
      hostId: host.id,
      cols: 80,
      rows: 24,
    })
    expect(target.port).toBe(server.port)
    const prompt = await waitFor(() => h.sink.prompts().find((p) => p.kind === 'hostKey'), {
      label: 'host key prompt',
    })
    await h.call('prompt:answer', {
      promptId: prompt.promptId,
      answer: { kind: 'hostKey', trust: true },
    })
    await waitFor(() => h.sink.states(sessionId).find((s) => s.state === 'ready'), {
      label: 'ready',
    })

    await expect
      .poll(async () => (await h.call<HostView[]>('hosts:list'))[0]?.lastConnectedAt)
      .toEqual(expect.any(String))
  })

  it('favorites a host, refuses bad payloads, and never sends secrets with groups', async () => {
    const h = await setup()
    const group = await h.call<GroupView>('groups:save', { name: 'Web', color: 'blue' })
    const host = await h.call<HostView>('hosts:save', {
      name: 'web',
      address: 'web.example.com',
      username: 'deploy',
      groupId: group.id,
      auth: { type: 'password', password: PASSWORD },
    })
    const favorite = await h.call<HostView>('hosts:setFavorite', { id: host.id, favorite: true })
    expect(favorite.favorite).toBe(true)

    const invalid = { ok: false, error: { code: 'IPC_INVALID_PAYLOAD' } }
    await expect(h.invoke('groups:save', { name: 'x', parentId: 'not-a-uuid' })).resolves.toEqual(
      invalid,
    )
    await expect(h.invoke('groups:save', { name: 'x', secret: PASSWORD })).resolves.toEqual(invalid)
    await expect(h.invoke('hosts:setFavorite', { id: host.id })).resolves.toEqual(invalid)
    await expect(
      h.invoke('groups:save', { id: group.id, name: 'Web', parentId: group.id }),
    ).resolves.toEqual({ ok: false, error: { code: 'GROUP_PARENT_INVALID' } })

    await h.call('groups:delete', { id: group.id })
    const [after] = await h.call<HostView[]>('hosts:list')
    expect(after?.groupId).toBeUndefined()
    expect(after?.favorite).toBe(true)

    expect(JSON.stringify(h.responses)).not.toContain(PASSWORD)
    expect(h.logs.join('\n')).not.toContain(PASSWORD)
  })
})
