import type {
  AuthenticationType,
  AuthHandlerMiddleware,
  BaseAgent,
  KeyboardInteractiveCallback,
  NextAuthHandler,
  Prompt,
} from 'ssh2'

/** How a session signs in. Lives only in main. */
export type Credential =
  | { type: 'password'; password: string }
  | { type: 'ask' }
  /** The keys in the Windows OpenSSH agent or Pageant. */
  | { type: 'agent' }
  | {
      type: 'key'
      privateKey: string
      passphrase?: string
      keyName: string
      /** Encrypted and no passphrase known yet: ask before connecting. */
      needsPassphrase?: boolean
    }

/** The sign-in that worked, kept for "Save host" after Quick Connect. */
export type UsedCredential =
  | { type: 'password'; password: string }
  | { type: 'key'; privateKey: string; passphrase?: string; keyName: string }

export interface AuthCallbacks {
  /** Ask the user for a password. null = cancelled. */
  askPassword: (attempt: number) => Promise<string | null>
  /** Ask the user the server's keyboard-interactive questions. null = cancelled. */
  askKeyboard: (
    name: string,
    instructions: string,
    prompts: { text: string; echo: boolean }[],
  ) => Promise<string[] | null>
  onCancelled: () => void
  onTry: (used: UsedCredential | null) => void
}

export interface AuthOptions {
  /** Required for agent sign-in. */
  agent?: BaseAgent | undefined
  /**
   * Try only the given credential: no password questions and no
   * keyboard-interactive. Used to test a new key before switching to it.
   */
  strict?: boolean
}

/** Server questions that ask for a one-time code: never answered with the saved password. */
const ONE_TIME_CODE =
  /verification|one[- ]?time|otp|token|authenticat|2fa|two[- ]?factor|\bcode\b|کد|رمز یک‌بار/i

export const MAX_PASSWORD_ATTEMPTS = 3

/**
 * ssh2 documents next(false) as "no more methods to try"; @types/ssh2 leaves
 * false out of NextAuthHandler.
 */
function noMoreMethods(next: NextAuthHandler): void {
  ;(next as unknown as (method: false) => void)(false)
}

/**
 * Builds ssh2's authHandler. Order: the saved key or password first; if the
 * server only offers keyboard-interactive, a single hidden question is
 * answered with the password; anything else is shown to the user. For
 * "ask every time" the user gets three tries.
 */
export function createAuthHandler(
  username: string,
  credential: Credential,
  callbacks: AuthCallbacks,
  options: AuthOptions = {},
): AuthHandlerMiddleware {
  let keyTried = false
  let agentTried = false
  let lastMethod: AuthenticationType | null = null
  let passwordTries = 0
  let keyboardTries = 0
  let password: string | undefined =
    credential.type === 'password' ? credential.password : undefined
  let cancelled = false
  const maxKeyboard = credential.type === 'ask' ? MAX_PASSWORD_ATTEMPTS : 1

  const keyboardPrompt = (
    name: string,
    instructions: string,
    _lang: string,
    prompts: Prompt[],
    finish: KeyboardInteractiveCallback,
  ): void => {
    if (prompts.length === 0) {
      finish([])
      return
    }
    const only = prompts[0]
    if (
      prompts.length === 1 &&
      only !== undefined &&
      !only.echo &&
      password !== undefined &&
      !ONE_TIME_CODE.test(`${name} ${instructions} ${only.prompt}`)
    ) {
      const answer = password
      // Use a remembered password once; a second question means it was wrong.
      password = undefined
      finish([answer])
      return
    }
    void callbacks
      .askKeyboard(
        name,
        instructions,
        prompts.map((prompt) => ({ text: prompt.prompt, echo: prompt.echo ?? false })),
      )
      .then((values) => {
        if (values === null) {
          cancelled = true
          callbacks.onCancelled()
          finish(prompts.map(() => ''))
          return
        }
        if (prompts.length === 1 && values[0] !== undefined && only?.echo === false) {
          callbacks.onTry({ type: 'password', password: values[0] })
        }
        finish(values)
      })
  }

  return (methodsLeft: AuthenticationType[] | null, partial: boolean, next: NextAuthHandler) => {
    // The password was accepted but the server wants more: the next
    // keyboard-interactive question is a second factor, so it goes to the user.
    if (partial && lastMethod === 'password') password = undefined
    // ssh2 passes null on the first call, before the server has listed methods.
    const allowed = (method: AuthenticationType): boolean =>
      methodsLeft === null || methodsLeft.includes(method)

    void (async () => {
      if (cancelled) {
        noMoreMethods(next)
        return
      }
      if (credential.type === 'key' && !keyTried && allowed('publickey')) {
        keyTried = true
        callbacks.onTry({
          type: 'key',
          privateKey: credential.privateKey,
          keyName: credential.keyName,
          ...(credential.passphrase === undefined ? {} : { passphrase: credential.passphrase }),
        })
        next({
          type: 'publickey',
          username,
          key: credential.privateKey,
          ...(credential.passphrase === undefined ? {} : { passphrase: credential.passphrase }),
        })
        return
      }
      if (credential.type === 'agent' && !agentTried && options.agent !== undefined) {
        agentTried = true
        callbacks.onTry(null)
        next({ type: 'agent', username, agent: options.agent })
        return
      }
      if (options.strict === true) {
        noMoreMethods(next)
        return
      }
      if (credential.type === 'password' && passwordTries === 0 && allowed('password')) {
        passwordTries++
        callbacks.onTry(credential)
        lastMethod = 'password'
        next({ type: 'password', username, password: credential.password })
        return
      }
      if (
        credential.type === 'ask' &&
        passwordTries < MAX_PASSWORD_ATTEMPTS &&
        allowed('password')
      ) {
        const typed = await callbacks.askPassword(passwordTries)
        if (typed === null) {
          cancelled = true
          callbacks.onCancelled()
          noMoreMethods(next)
          return
        }
        passwordTries++
        password = typed
        callbacks.onTry({ type: 'password', password: typed })
        next({ type: 'password', username, password: typed })
        return
      }
      if (keyboardTries < maxKeyboard && allowed('keyboard-interactive')) {
        keyboardTries++
        next({ type: 'keyboard-interactive', username, prompt: keyboardPrompt })
        return
      }
      noMoreMethods(next)
    })()
  }
}
