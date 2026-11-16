import type { ErrorCode } from '@shared/errors'
import type { KeyFileInfo } from '@shared/hosts'
import type { AuthRequest, SignInView } from '@shared/keychain'

export type OwnMethod = 'password' | 'key' | 'agent'

/** What the user picked for a sign-in of its own (host or identity). Lives in form state only. */
export interface SignInDraft {
  method: OwnMethod
  password: string
  forgetPassword: boolean
  /** A Keychain key, or '' for the key file below / none. */
  keyId: string
  keyFile: KeyFileInfo | null
  passphrase: string
}

export function initialDraft(saved: SignInView | undefined): SignInDraft {
  return {
    method: saved?.method === 'key' ? 'key' : saved?.method === 'agent' ? 'agent' : 'password',
    password: '',
    forgetPassword: false,
    keyId: saved?.method === 'key' ? saved.keyId : '',
    keyFile: null,
    passphrase: '',
  }
}

export interface SignInErrors {
  key?: string | undefined
  passphrase?: string | undefined
}

/** Errors that belong next to a sign-in field rather than at the top of the form. */
export const SIGN_IN_FIELD_ERRORS: Partial<Record<ErrorCode, keyof SignInErrors>> = {
  KEY_FILE_UNREADABLE: 'key',
  KEY_FILE_EXPIRED: 'key',
  KEY_INVALID: 'key',
  KEY_REQUIRED: 'key',
  KEY_NOT_FOUND: 'key',
  KEY_PASSPHRASE_REQUIRED: 'passphrase',
  KEY_PASSPHRASE_WRONG: 'passphrase',
}

/**
 * Turns the draft into an auth request, or the field error to show.
 * `saved` is what the record signs in with today (to keep a saved password or key).
 */
export function draftToAuth(
  draft: SignInDraft,
  saved: SignInView | undefined,
):
  | { ok: true; auth: AuthRequest }
  | { ok: false; errors: { key?: ErrorCode; passphrase?: ErrorCode } } {
  if (draft.method === 'agent') return { ok: true, auth: { type: 'agent' } }
  if (draft.method === 'password') {
    if (draft.password !== '')
      return { ok: true, auth: { type: 'password', password: draft.password } }
    const keep = saved?.method === 'password' && !draft.forgetPassword
    return { ok: true, auth: keep ? { type: 'password' } : { type: 'password', password: '' } }
  }
  if (draft.keyFile !== null) {
    if (draft.keyFile.encrypted && draft.passphrase === '') {
      return { ok: false, errors: { passphrase: 'KEY_PASSPHRASE_REQUIRED' } }
    }
    return {
      ok: true,
      auth: {
        type: 'key',
        keyFileToken: draft.keyFile.token,
        ...(draft.keyFile.encrypted ? { passphrase: draft.passphrase } : {}),
      },
    }
  }
  if (draft.keyId === '') return { ok: false, errors: { key: 'KEY_REQUIRED' } }
  return { ok: true, auth: { type: 'savedKey', keyId: draft.keyId } }
}
