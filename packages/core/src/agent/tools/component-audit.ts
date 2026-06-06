import { z } from 'zod';

import { runComponentAudit, type ComponentAuditResult } from '../component-audit-agent';
import type { WorkspaceToolDefinition } from './core';
import type { ComponentAuditInput, DesignWorkspaceToolContext } from './types';

export function createComponentAuditToolDefinition(): WorkspaceToolDefinition<
  ComponentAuditInput,
  ComponentAuditResult,
  DesignWorkspaceToolContext
> {
  return {
    description:
      'Run the read-only component audit sub-agent after completing an HTML task. Use it before the final reply and rerun it after fixing high severity findings.',
    inputSchema: z
      .object({
        completedWorkSummary: z
          .string()
          .describe('Brief summary of the workspace changes completed before this audit.')
          .optional(),
        taskSummary: z.string().describe('Brief summary of the current user task.').optional(),
      })
      .strict(),
    name: 'componentAudit',
    parallelSafe: false,
    execute: async (
      { completedWorkSummary, taskSummary },
      { model, projectId, providerOptions, resources, workspaceStore },
    ) => {
      return runComponentAudit(
        {
          model,
          projectId,
          providerOptions,
          resources,
          workspaceStore,
        },
        {
          assistantResponse: completedWorkSummary ?? 'The main agent completed the task.',
          userPrompt: taskSummary ?? 'Audit the completed HTML task.',
        },
      );
    },
  };
}
