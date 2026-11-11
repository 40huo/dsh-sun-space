/**
 * DSH 宿主服务的最小类型垫片。
 * 运行时由宿主组合真实提供（packages/core/tools 等）；npm 版 @deepseek-ai/cordis
 * 不含这些模块增补，故此处声明运行期已验证的 API 形状。
 * P1-1 验证记录：tools.register/guard、timer、logger 均已在实例上运行验证过。
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
      /** 停掉一个子代理；authority 用 { kind:'ancestor', agent: 父agent } 形状（宿主做血缘校验） */
      interrupt(childId: string, authority?: Record<string, unknown>): unknown
    }
    /** 事件监听（cordis 冒泡：后代 scope 发出的事件可被祖先 scope 收到）。tools/post-execute 是瀑布，须 return next() */
    on(event: string, handler: (...args: unknown[]) => unknown): void
    /** 调用期取宿主服务（可能取不到——调用方决定退路） */
    get<T = unknown>(service: string): T | undefined
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
