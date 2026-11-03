export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Reading = { limits: Limit[]; at: number }

declare module 'claude-code' {
  interface PluginState {
    'usage-meter': { reading: Shaped<Reading | null> }
  }
}
