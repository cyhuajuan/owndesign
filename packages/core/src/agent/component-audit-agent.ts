import { stepCountIs, ToolLoopAgent, type ToolSet } from 'ai';

import { createWorkspaceToolRegistry } from './tools/core';
import { createGlobToolDefinition } from './tools/glob';
import { createGrepToolDefinition } from './tools/grep';
import { createReadToolDefinition } from './tools/read';
import type { DesignWorkspaceToolContext } from './tools/types';
import { loadPrompt } from '@owndesign/core/prompts';

export type ComponentAuditAgentContext = Pick<
  DesignWorkspaceToolContext,
  'model' | 'projectId' | 'providerOptions' | 'resources' | 'workspaceStore'
>;

export type ComponentAuditSeverity = 'high' | 'medium' | 'low';

export type ComponentAuditFinding = {
  type: string;
  severity: ComponentAuditSeverity;
  message: string;
  path?: string;
  recommendedAction?: string;
};

export type ComponentAuditResult = {
  passed: boolean;
  findings: ComponentAuditFinding[];
  summary: string;
};

type RunComponentAuditInput = {
  assistantResponse: string;
  userPrompt: string;
};

export async function runComponentAudit(
  context: ComponentAuditAgentContext,
  input: RunComponentAuditInput,
) {
  const agent = createComponentAuditAgent(context);
  const result = await agent.generate({
    prompt: buildComponentAuditPrompt(input),
  });

  return parseComponentAuditResult(result.text);
}

export function createComponentAuditAgent(context: ComponentAuditAgentContext) {
  const { model, providerOptions } = context;

  return new ToolLoopAgent({
    allowSystemInMessages: true,
    model,
    instructions: buildComponentAuditInstructions(),
    providerOptions,
    stopWhen: stepCountIs(30),
    tools: createComponentAuditTools(context),
  });
}

export function createComponentAuditTools({
  projectId,
  resources,
  workspaceStore,
}: ComponentAuditAgentContext) {
  return createWorkspaceToolRegistry(
    [createReadToolDefinition(), createGlobToolDefinition(), createGrepToolDefinition()],
    {
      projectId,
      resources,
      workspaceStore,
    },
  ) as ToolSet & {
    __metadata: Record<string, { parallelSafe: boolean }>;
  };
}

export function buildComponentAuditInstructions() {
  return loadPrompt('agents/component-audit');
}

export function buildComponentAuditPrompt({
  assistantResponse,
  userPrompt,
}: RunComponentAuditInput) {
  return [
    'Audit the completed OwnDesign HTML task.',
    '',
    'Original user task:',
    userPrompt,
    '',
    'Main agent final response:',
    assistantResponse,
    '',
    'Inspect the workspace now. Return JSON only.',
  ].join('\n');
}

export function parseComponentAuditResult(text: string | undefined): ComponentAuditResult {
  if (!text?.trim()) {
    return invalidAuditResult('Component audit returned no JSON.');
  }

  try {
    const parsed = JSON.parse(extractJsonObject(text));
    const findings: ComponentAuditFinding[] = Array.isArray(parsed.findings)
      ? parsed.findings.map(parseFinding).filter(isComponentAuditFinding)
      : [];

    return {
      findings,
      passed: Boolean(parsed.passed) && findings.every((finding) => finding.severity !== 'high'),
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    };
  } catch {
    return invalidAuditResult('Component audit returned invalid JSON.');
  }
}

function isComponentAuditFinding(
  finding: ComponentAuditFinding | null,
): finding is ComponentAuditFinding {
  return finding !== null;
}

function parseFinding(input: unknown): ComponentAuditFinding | null {
  if (!input || typeof input !== 'object') {
    return null;
  }

  const finding = input as Record<string, unknown>;
  const severity = finding.severity;
  if (severity !== 'high' && severity !== 'medium' && severity !== 'low') {
    return null;
  }

  return {
    message: typeof finding.message === 'string' ? finding.message : '',
    path: typeof finding.path === 'string' ? finding.path : undefined,
    recommendedAction:
      typeof finding.recommendedAction === 'string' ? finding.recommendedAction : undefined,
    severity,
    type: typeof finding.type === 'string' ? finding.type : 'component_audit_finding',
  };
}

function invalidAuditResult(message: string): ComponentAuditResult {
  return {
    findings: [
      {
        message,
        recommendedAction: 'Review component audit output format.',
        severity: 'medium',
        type: 'component_audit_invalid_output',
      },
    ],
    passed: false,
    summary: message,
  };
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}
