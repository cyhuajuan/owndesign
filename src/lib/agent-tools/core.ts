import { jsonSchema, tool } from "ai";
import type { ToolSet } from "ai";

import type { ProjectWorkspaceToolContext } from "./types";

export type WorkspaceToolResult<Output> =
  | {
      ok: true;
      output: Output;
      wallTimeMs: number;
    }
  | {
      error: string;
      ok: false;
      wallTimeMs: number;
    };

export type WorkspaceToolDefinition<Input, Output> = {
  description: string;
  execute: (
    input: Input,
    context: ProjectWorkspaceToolContext,
  ) => Promise<Output> | Output;
  inputSchema: Record<string, unknown>;
  name: string;
  parallelSafe: boolean;
  validate?: (input: Input) => void;
};

export type AnyWorkspaceToolDefinition = WorkspaceToolDefinition<never, unknown>;

export function createWorkspaceToolRegistry(
  definitions: AnyWorkspaceToolDefinition[],
  context: ProjectWorkspaceToolContext,
) {
  const tools: ToolSet = {};
  const metadata: Record<string, { parallelSafe: boolean }> = {};

  for (const definition of definitions) {
    if (tools[definition.name]) {
      throw new Error(`Project Workspace tool already registered: ${definition.name}`);
    }

    metadata[definition.name] = {
      parallelSafe: definition.parallelSafe,
    };
    tools[definition.name] = tool({
      description: definition.description,
      inputSchema: jsonSchema(definition.inputSchema),
      execute: async (input: unknown) => {
        const startedAt = performance.now();

        try {
          definition.validate?.(input as never);
          const output = await definition.execute(input as never, context);

          return {
            ok: true,
            output,
            wallTimeMs: elapsedWallTime(startedAt),
          } satisfies WorkspaceToolResult<unknown>;
        } catch (error) {
          return {
            error: error instanceof Error ? error.message : String(error),
            ok: false,
            wallTimeMs: elapsedWallTime(startedAt),
          } satisfies WorkspaceToolResult<unknown>;
        }
      },
    });
  }

  Object.defineProperty(tools, "__metadata", {
    enumerable: false,
    value: metadata,
  });

  return tools as ToolSet & {
    __metadata: Record<string, { parallelSafe: boolean }>;
  };
}

function elapsedWallTime(startedAt: number) {
  return Math.max(0, Math.round((performance.now() - startedAt) * 100) / 100);
}
