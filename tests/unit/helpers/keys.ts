import { utils } from 'ssh2'

interface Encryption {
  passphrase: string
  cipher: string
  rounds: number
}

/**
 * ssh2's generateKeyPairSync now and then (about 1 in 200 ed25519 keys)
 * returns a private key its own parser refuses ("Malformed OpenSSH private
 * key"), which made tests fail at random. Generate until the key reads back.
 */
export function readableKeyPair(
  type: 'ed25519',
  encryption?: Encryption,
): { private: string; public: string } {
  for (let attempt = 0; attempt < 20; attempt++) {
    const pair =
      encryption === undefined
        ? utils.generateKeyPairSync(type)
        : utils.generateKeyPairSync(type, encryption)
    if (!(utils.parseKey(pair.private, encryption?.passphrase) instanceof Error)) return pair
  }
  throw new Error('ssh2 did not produce a readable key in 20 tries')
}
