import type { BaseAgent } from 'ssh2'
import type { AgentSource, AgentStatus } from '@shared/keychain'
import { AppError } from '../ipc/app-error'

export interface AgentFactories {
  openssh: () => BaseAgent
  pageant: () => BaseAgent
  /** Keys the agent offers, or null when it is not running. */
  count: (agent: BaseAgent) => Promise<number | null>
}

/**
 * Picks the agent for "Agent" sign-in and agent forwarding: the one chosen in
 * Settings, or with `auto` the OpenSSH agent when it runs, else Pageant.
 */
export class Agents {
  constructor(
    private readonly factories: AgentFactories,
    private readonly source: () => AgentSource,
  ) {}

  async status(): Promise<AgentStatus> {
    const [opensshKeys, pageantKeys] = await Promise.all([
      this.factories.count(this.factories.openssh()),
      this.factories.count(this.factories.pageant()),
    ])
    const source = this.source()
    const opensshRunning = opensshKeys !== null
    const pageantRunning = pageantKeys !== null
    let active: AgentStatus['active']
    if (source === 'openssh') active = opensshRunning ? 'openssh' : null
    else if (source === 'pageant') active = pageantRunning ? 'pageant' : null
    else active = opensshRunning ? 'openssh' : pageantRunning ? 'pageant' : null
    return {
      openssh: { running: opensshRunning, keys: opensshKeys },
      pageant: { running: pageantRunning, keys: pageantKeys },
      active,
    }
  }

  /**
   * The agent to sign in with. Fails with AGENT_UNAVAILABLE when none runs
   * and AGENT_NO_KEYS when it holds no key, so the error says what to fix.
   */
  async forSignIn(): Promise<BaseAgent> {
    const found = await this.find()
    if (found === null) throw new AppError('AGENT_UNAVAILABLE')
    if (found.keys === 0) throw new AppError('AGENT_NO_KEYS')
    return found.agent
  }

  /** The agent to forward, or undefined when none runs (forwarding is then skipped). */
  async forForwarding(): Promise<BaseAgent | undefined> {
    return (await this.find())?.agent
  }

  private async find(): Promise<{ agent: BaseAgent; keys: number } | null> {
    const source = this.source()
    const order: ('openssh' | 'pageant')[] = source === 'auto' ? ['openssh', 'pageant'] : [source]
    for (const kind of order) {
      const agent = this.factories[kind]()
      const keys = await this.factories.count(agent)
      if (keys !== null) return { agent, keys }
    }
    return null
  }
}
