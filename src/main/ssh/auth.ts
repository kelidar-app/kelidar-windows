import type {
  AuthenticationType,
  AuthHandlerMiddleware,
  KeyboardInteractiveCallback,
  NextAuthHandler,
  Prompt,
} from 'ssh2'

/** How a session signs in. Lives only in main. */
export type Credential =
  | { type: 'password'; password: string }
  | { type: 'ask' }
  | { type: 'key'; privateKey: string; passphrase?: string; keyName: string }

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
): AuthHandlerMiddleware {
  let keyTried = false
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
    if (prompts.length === 1 && only !== undefined && !only.echo && password !== undefined) {
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

  return (methodsLeft: AuthenticationType[] | null, _partial: boolean, next: NextAuthHandler) => {
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
        callbacks.onTry(credential)
        next({
          type: 'publickey',
          username,
          key: credential.privateKey,
          ...(credential.passphrase === undefined ? {} : { passphrase: credential.passphrase }),
        })
        return
      }
      if (credential.type === 'password' && passwordTries === 0 && allowed('password')) {
        passwordTries++
        callbacks.onTry(credential)
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
