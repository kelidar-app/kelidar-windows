import { spawnSync } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { utils } from 'ssh2'
import { describe, expect, it, vi } from 'vitest'
import { installKeyCommand, shellQuote } from '../../src/main/hosts/key-upgrade'
import { Agents } from '../../src/main/keychain/agents'
import { pagentExePath } from '../../src/main/platform/agent'
import { createAuthHandler, type AuthCallbacks } from '../../src/main/ssh/auth'
import { generateKey } from '../../src/main/ssh/keys'
import {
  authRequestSchema,
  identitySaveRequestSchema,
  keyGenerateRequestSchema,
  keyUpgradePrepareSchema,
} from '../../src/shared/keychain'

const bash = spawnSync('bash', ['-c', 'echo ok'], { encoding: 'utf8' })
const hasBash = bash.status === 0 && bash.stdout.trim() === 'ok'

const PUBLIC = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOMqqnkVzrm0SdG6UOoqKLsabgH5C9okWi0dh2l9GKJl'

describe('installKeyCommand', () => {
  it('quotes anything for a POSIX shell', () => {
    expect(shellQuote("it's")).toBe(`'it'\\''s'`)
    expect(shellQuote('$(rm -rf /)')).toBe(`'$(rm -rf /)'`)
  })

  it('adds the key with a comment and sets the permissions sshd wants', () => {
    const command = installKeyCommand(PUBLIC)
    expect(command).toContain(`'${PUBLIC} kelidar'`)
    expect(command).toContain('chmod 700 ~/.ssh')
    expect(command).toContain('chmod 600 ~/.ssh/authorized_keys')
  })

  it.runIf(hasBash)('works in a real shell: once, on its own line', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'kelidar-home-'))
    try {
      const run = () =>
        spawnSync('bash', ['-c', installKeyCommand(PUBLIC)], {
          env: { ...process.env, HOME: home },
          encoding: 'utf8',
        })
      // An existing file whose last line has no newline.
      await mkdirAndWrite(path.join(home, '.ssh', 'authorized_keys'), 'ssh-rsa AAAAold old')
      expect(run().status).toBe(0)
      expect(run().status).toBe(0)
      const lines = (await readFile(path.join(home, '.ssh', 'authorized_keys'), 'utf8'))
        .split('\n')
        .filter((line) => line !== '')
      expect(lines).toEqual(['ssh-rsa AAAAold old', `${PUBLIC} kelidar`])
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it.runIf(hasBash)('creates ~/.ssh when it is missing', async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), 'kelidar-home-'))
    try {
      const result = spawnSync('bash', ['-c', installKeyCommand(PUBLIC)], {
        env: { ...process.env, HOME: home },
        encoding: 'utf8',
      })
      expect(result.status).toBe(0)
      expect(await readFile(path.join(home, '.ssh', 'authorized_keys'), 'utf8')).toBe(
        `${PUBLIC} kelidar\n`,
      )
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})

async function mkdirAndWrite(file: string, text: string): Promise<void> {
  const { mkdir } = await import('node:fs/promises')
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, text)
}

describe('generateKey', () => {
  it('makes ed25519 keys that read back and sign', async () => {
    for (let i = 0; i < 20; i++) {
      const { privateKey, parsed } = await generateKey('ed25519')
      expect(utils.parseKey(privateKey)).not.toBeInstanceOf(Error)
      expect(parsed.type).toBe('ssh-ed25519')
    }
  })

  it('protects a key with a passphrase', async () => {
    const { privateKey } = await generateKey('ed25519', 'phrase-Wren-2290')
    expect(utils.parseKey(privateKey)).toBeInstanceOf(Error)
    expect(utils.parseKey(privateKey, 'phrase-Wren-2290')).not.toBeInstanceOf(Error)
  })
})

describe('Keychain schemas', () => {
  it('accepts the sign-in kinds and refuses anything else', () => {
    for (const ok of [
      { type: 'password', password: 'x' },
      { type: 'key' },
      { type: 'savedKey', keyId: crypto.randomUUID() },
      { type: 'agent' },
    ]) {
      expect(authRequestSchema.safeParse(ok).success, JSON.stringify(ok)).toBe(true)
    }
    for (const bad of [
      { type: 'agent', pipe: '\\\\.\\pipe\\evil' },
      { type: 'savedKey' },
      { type: 'key', keyFileToken: '../id_rsa' },
      { type: 'password', secretId: crypto.randomUUID() },
    ]) {
      expect(authRequestSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false)
    }
  })

  it('checks identities, key generation and upgrade requests', () => {
    expect(
      identitySaveRequestSchema.safeParse({
        name: 'd',
        username: 'two words',
        auth: { type: 'agent' },
      }).success,
    ).toBe(false)
    expect(keyGenerateRequestSchema.safeParse({ name: 'k', type: 'dsa' }).success).toBe(false)
    expect(keyGenerateRequestSchema.safeParse({ name: ' ', type: 'rsa' }).success).toBe(false)
    expect(
      keyUpgradePrepareSchema.safeParse({
        hostId: crypto.randomUUID(),
        key: { generate: 'ed25519', keyId: crypto.randomUUID() },
      }).success,
    ).toBe(false)
  })
})

describe('agents', () => {
  const fakeAgent = (name: string) => ({ name }) as never

  it('picks the OpenSSH agent first, then Pageant, and reports both', async () => {
    const counts: Record<string, number | null> = { openssh: null, pageant: 2 }
    let source: 'auto' | 'openssh' | 'pageant' = 'auto'
    const agents = new Agents(
      {
        openssh: () => fakeAgent('openssh'),
        pageant: () => fakeAgent('pageant'),
        count: (agent) =>
          Promise.resolve(counts[(agent as unknown as { name: string }).name] ?? null),
      },
      () => source,
    )
    expect(await agents.status()).toEqual({
      openssh: { running: false, keys: null },
      pageant: { running: true, keys: 2 },
      active: 'pageant',
    })
    expect(await agents.forSignIn()).toEqual({ name: 'pageant' })
    source = 'openssh'
    await expect(agents.forSignIn()).rejects.toMatchObject({ code: 'AGENT_UNAVAILABLE' })
    expect(await agents.forForwarding()).toBeUndefined()
    counts['openssh'] = 0
    await expect(agents.forSignIn()).rejects.toMatchObject({ code: 'AGENT_NO_KEYS' })
  })

  it("runs Pageant's helper from outside app.asar", () => {
    expect(pagentExePath('C:\\Apps\\Kelidar\\resources\\app.asar')).toBe(
      'C:\\Apps\\Kelidar\\resources\\app.asar.unpacked\\node_modules\\ssh2\\util\\pagent.exe',
    )
    expect(pagentExePath('P:\\ssh manager')).toBe(
      'P:\\ssh manager\\node_modules\\ssh2\\util\\pagent.exe',
    )
  })
})

describe('sign-in questions', () => {
  const callbacks = (): AuthCallbacks & { askKeyboard: ReturnType<typeof vi.fn> } => ({
    askPassword: vi.fn(() => Promise.resolve(null)),
    askKeyboard: vi.fn(() => Promise.resolve(['123456'])),
    onCancelled: vi.fn(),
    onTry: vi.fn(),
  })

  /** Drives the handler like ssh2 does and returns what it sends. */
  function step(
    handler: ReturnType<typeof createAuthHandler>,
    methods: string[] | null,
    partial: boolean,
  ): Promise<unknown> {
    return new Promise((resolve) => {
      ;(handler as unknown as (m: unknown, p: boolean, next: (x: unknown) => void) => void)(
        methods,
        partial,
        resolve,
      )
    })
  }

  async function answerKeyboard(sent: unknown, question: string): Promise<string[]> {
    const prompt = (sent as { prompt: (...args: unknown[]) => void }).prompt
    return new Promise((resolve) => {
      prompt('', '', '', [{ prompt: question, echo: false }], resolve)
    })
  }

  it('sends the saved password to a lone password question', async () => {
    const cb = callbacks()
    const handler = createAuthHandler('u', { type: 'password', password: 'pw' }, cb)
    const sent = await step(handler, ['keyboard-interactive'], false)
    expect(await answerKeyboard(sent, 'Password: ')).toEqual(['pw'])
    expect(cb.askKeyboard).not.toHaveBeenCalled()
  })

  it('asks the user for the second factor after the password was accepted', async () => {
    const cb = callbacks()
    const handler = createAuthHandler('u', { type: 'password', password: 'pw' }, cb)
    expect(await step(handler, null, false)).toMatchObject({ type: 'password' })
    const sent = await step(handler, ['keyboard-interactive'], true)
    expect(await answerKeyboard(sent, 'Password: ')).toEqual(['123456'])
    expect(cb.askKeyboard).toHaveBeenCalledOnce()
  })

  it('never answers a one-time code question with the password', async () => {
    const cb = callbacks()
    const handler = createAuthHandler('u', { type: 'password', password: 'pw' }, cb)
    const sent = await step(handler, ['keyboard-interactive'], false)
    expect(await answerKeyboard(sent, 'Verification code: ')).toEqual(['123456'])
  })

  it('tries only the given key in strict mode', async () => {
    const cb = callbacks()
    const handler = createAuthHandler('u', { type: 'key', privateKey: 'k', keyName: 'k' }, cb, {
      strict: true,
    })
    expect(await step(handler, null, false)).toMatchObject({ type: 'publickey' })
    expect(await step(handler, ['password', 'keyboard-interactive'], false)).toBe(false)
  })
})
