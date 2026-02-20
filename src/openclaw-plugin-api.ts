interface RegisteredTool {
  name: string;
  description?: string;
  parameters?: unknown;
  execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
}

interface OpenClawPluginApi {
  registerTool(tool: RegisteredTool, options?: { optional?: boolean }): void;
}

interface PredicateToolHandlers {
  executeCmdRun(args: Record<string, unknown>): Promise<unknown>;
  executeFsReadFile(args: Record<string, unknown>): Promise<unknown>;
  executeHttpRequest(args: Record<string, unknown>): Promise<unknown>;
}

export function registerOpenClawPredicateTools(
  api: OpenClawPluginApi,
  handlers: PredicateToolHandlers,
): void {
  api.registerTool(
    {
      name: "predicate_cmd_run",
      description: "Guarded shell execution routed through Predicate Authority.",
      execute: async (_id: string, params: Record<string, unknown>) =>
        handlers.executeCmdRun(params),
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "predicate_fs_read_file",
      description: "Guarded file read routed through Predicate Authority.",
      execute: async (_id: string, params: Record<string, unknown>) =>
        handlers.executeFsReadFile(params),
    },
    { optional: true },
  );

  api.registerTool(
    {
      name: "predicate_http_request",
      description: "Guarded HTTP request routed through Predicate Authority.",
      execute: async (_id: string, params: Record<string, unknown>) =>
        handlers.executeHttpRequest(params),
    },
    { optional: true },
  );
}
