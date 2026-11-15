// Keeps package-lock.json pointing at the public npm registry.
//
// A local npm that installs through a mirror writes the mirror's URLs into the
// lockfile, and CI, Dependabot and contributors outside that network cannot
// reach them. npm swaps registry.npmjs.org for your configured registry when
// it reads the lockfile, so a mirror keeps working locally after this fix.
//
//   node scripts/lockfile-registry.mjs          check, exit 1 on foreign URLs
//   node scripts/lockfile-registry.mjs --fix    rewrite them in place

import { readFileSync, writeFileSync } from 'node:fs'

const REGISTRY = 'https://registry.npmjs.org/'
const FILE = 'package-lock.json'
// ".../<name or @scope/name>/-/<file>.tgz" at the end of any registry URL.
const TARBALL = /\/((?:@[^/]+\/)?[^/@]+)\/-\/([^/]+\.tgz)$/

const fix = process.argv.includes('--fix')
const lock = JSON.parse(readFileSync(FILE, 'utf8'))
const foreign = []
const unknown = []

for (const [key, entry] of Object.entries(lock.packages ?? {})) {
  const url = entry.resolved
  if (typeof url !== 'string' || !/^https?:\/\//.test(url) || url.startsWith(REGISTRY)) continue
  const match = TARBALL.exec(url)
  if (!match) {
    unknown.push(`${key}: ${url}`)
    continue
  }
  foreign.push(key)
  if (fix) entry.resolved = `${REGISTRY}${match[1]}/-/${match[2]}`
}

if (unknown.length > 0) {
  console.error(`${FILE} has URLs that are not npm tarballs; fix them by hand:`)
  for (const line of unknown) console.error(`  ${line}`)
  process.exit(1)
}

if (foreign.length === 0) {
  console.log(`${FILE}: every package comes from ${REGISTRY}`)
} else if (fix) {
  writeFileSync(FILE, `${JSON.stringify(lock, null, 2)}\n`)
  console.log(`${FILE}: pointed ${String(foreign.length)} packages at ${REGISTRY}`)
} else {
  console.error(
    `${FILE}: ${String(foreign.length)} packages come from another registry (first: ${foreign[0]}).\n` +
      'CI and Dependabot cannot download them. Run "npm run lockfile:fix" and commit package-lock.json.',
  )
  process.exit(1)
}
