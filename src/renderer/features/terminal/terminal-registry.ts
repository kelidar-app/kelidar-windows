/** Actions of mounted terminals, by pane id, so keyboard shortcuts can reach them. */
export interface TerminalActions {
  paste: () => void
  focus: () => void
  openSearch: () => void
}

const terminals = new Map<string, TerminalActions>()

export function registerTerminal(paneId: string, actions: TerminalActions): () => void {
  terminals.set(paneId, actions)
  return () => {
    if (terminals.get(paneId) === actions) terminals.delete(paneId)
  }
}

export function terminalActions(paneId: string): TerminalActions | undefined {
  return terminals.get(paneId)
}
