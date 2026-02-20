import { registerOpenClawPredicateTools } from "../../dist/src/index.js";

export default function register(api: {
  registerTool: (
    tool: {
      name: string;
      description?: string;
      execute: (id: string, params: Record<string, unknown>) => Promise<unknown>;
    },
    options?: { optional?: boolean },
  ) => void;
}) {
  registerOpenClawPredicateTools(api, {
    async executeCmdRun(args) {
      return {
        content: [{ type: "text", text: `smoke cmd: ${String(args.command ?? "")}` }],
      };
    },
    async executeFsReadFile(args) {
      return {
        content: [{ type: "text", text: `smoke fs: ${String(args.path ?? "")}` }],
      };
    },
    async executeHttpRequest(args) {
      return {
        content: [{ type: "text", text: `smoke http: ${String(args.url ?? "")}` }],
      };
    },
  });
}
