/** Actions of mounted terminals, by tab id, so keyboard shortcuts can reach them. */
export interface TerminalActions {
  paste: () => void
  focus: () => void
}

const terminals = new Map<string, TerminalActions>()

export function registerTerminal(tabId: string, actions: TerminalActions): () => void {
  terminals.set(tabId, actions)
  return () => {
    if (terminals.get(tabId) === actions) terminals.delete(tabId)
  }
}

export function terminalActions(tabId: string): TerminalActions | undefined {
  return terminals.get(tabId)
}
