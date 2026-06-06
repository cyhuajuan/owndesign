import { tool } from 'ai';
import type { ToolSet } from 'ai';
import type { z } from 'zod';

import type { ProjectWorkspaceToolContext } from './types';

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

export type WorkspaceToolDefinition<Input, Output, Context = ProjectWorkspaceToolContext> = {
  description: string;
  execute: (input: Input, context: Context) => Promise<Output> | Output;
  inputSchema: z.ZodType<Input>;
  name: string;
  parallelSafe: boolean;
  validate?: (input: Input) => void;
};

export type AnyWorkspaceToolDefinition<Context = ProjectWorkspaceToolContext> = Omit<
  WorkspaceToolDefinition<never, unknown, Context>,
  'inputSchema'
> & {
  inputSchema: z.ZodType;
};

export function createWorkspaceToolRegistry<Context = ProjectWorkspaceToolContext>(
  definitions: AnyWorkspaceToolDefinition<Context>[],
  context: Context,
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
      inputSchema: definition.inputSchema,
      execute: async (input: unknown) => {
        const startedAt = performance.now();

        try {
          const parsedInput = definition.inputSchema.parse(input);
          definition.validate?.(parsedInput as never);
          const output = await definition.execute(parsedInput as never, context);

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

  Object.defineProperty(tools, '__metadata', {
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
