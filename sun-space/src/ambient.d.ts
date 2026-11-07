/**
 * DSH 宿主服务的最小类型垫片。
 * 运行时由宿主组合真实提供（packages/core/tools 等）；npm 版 @deepseek-ai/cordis
 * 不含这些模块增补，故此处声明运行期已验证的 API 形状。
 * P1-1 验证记录：tools.register/guard、timer、logger 均已在 3081 实例上运行过。
 */
declare module '@deepseek-ai/cordis' {
  interface ToolDefinitionLike {
    name: string
    description: string
    parameters: unknown
    output: { schema: unknown; render: (args: unknown, value: unknown) => Array<{ type: string; text?: string }> }
    execute: (args: unknown, exec?: unknown) => Promise<unknown>
  }
  interface Context {
    plugin(module: { inject?: string[]; apply: (ctx: Context) => void }): void
    effect(fn: () => void | (() => void) | Promise<void>, label?: string): () => void
    tools: {
      register(definition: ToolDefinitionLike, options?: { when?: unknown }): () => void
      guard(guard: (call: { name: string; arguments?: Record<string, unknown> }) => string | void): () => void
      restrict(filter: { allow?: string[]; deny?: string[] }): () => void
    }
    subagents: {
      startActivation(spec: Record<string, unknown>): Promise<{ childId?: string; name: string; result?: unknown; dispose?: () => void }>
    }
    timer: unknown
    /** TimerService 混入方法（vendor/timer 运行时提供，随 fiber 清理） */
    timeout(callback: () => void, delay: number): () => void
    interval(callback: () => void, delay: number): () => void
    logger?: {
      info?(msg: string): void
      warn?(msg: string): void
      error?(msg: string): void
    }
  }
}

export {}
