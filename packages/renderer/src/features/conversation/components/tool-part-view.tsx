'use client';

import { isToolUIPart, type DynamicToolUIPart, type ToolUIPart } from 'ai';

import { Shimmer } from '@/components/ai-elements/shimmer';
import { useI18n } from '@/features/i18n/context';

export function ToolPartView({ part }: { part: ToolLikePart }) {
  const { t } = useI18n();
  const description = getToolDescription(part, t);

  return (
    <div className="w-full text-muted-foreground text-sm">
      {isPendingToolPart(part) ? <Shimmer as="span">{description}</Shimmer> : description}
    </div>
  );
}

export function isToolPart(part: unknown): part is ToolLikePart {
  return isToolUIPart(part as never);
}

export type ToolLikePart = ToolUIPart | DynamicToolUIPart;

function getToolDescription(part: ToolLikePart, t: ReturnType<typeof useI18n>['t']) {
  const toolName = getToolName(part);
  const target = getToolTarget(part);
  const action = getToolAction(toolName, target, t);
  const visibleTarget = getVisibleToolTarget(target);
  const targetSuffix = visibleTarget ? t('tool.targetSuffix', { target: visibleTarget }) : '';

  if (isFailedToolPart(part)) {
    return t('tool.failed', { action, target: targetSuffix });
  }

  if (part.state === 'output-denied') {
    return t('tool.cancelled', { action, target: targetSuffix });
  }

  if (part.state === 'output-available') {
    return t('tool.completed', { action, target: targetSuffix });
  }

  return t('tool.running', { action, target: targetSuffix });
}

function isPendingToolPart(part: ToolLikePart) {
  return (
    part.state !== 'output-available' &&
    part.state !== 'output-error' &&
    part.state !== 'output-denied'
  );
}

function isFailedToolPart(part: ToolLikePart) {
  return part.state === 'output-error' || getToolOutputOk(part) === false;
}

function getToolName(part: ToolLikePart) {
  return part.type === 'dynamic-tool' ? part.toolName : part.type.split('-').slice(1).join('-');
}

function getToolTarget(part: ToolLikePart) {
  return getPathFromValue(part.output) ?? getPathFromValue(part.input) ?? getPathFromValue(part);
}

function getPathFromValue(value: unknown): string | undefined {
  if (!value || typeof value !== 'object') {
    return undefined;
  }

  const path = 'path' in value ? value.path : 'targetPath' in value ? value.targetPath : undefined;

  if (typeof path === 'string' && path.length > 0) {
    return path;
  }

  const nestedOutput = 'output' in value ? value.output : undefined;

  if (nestedOutput && typeof nestedOutput === 'object') {
    return getPathFromValue(nestedOutput);
  }

  return undefined;
}

function getToolOutputOk(part: ToolLikePart) {
  const output = part.output;

  if (!output || typeof output !== 'object' || !('ok' in output)) {
    return undefined;
  }

  return typeof output.ok === 'boolean' ? output.ok : undefined;
}

function isIndexHtmlPath(path?: string) {
  return path === 'index.html';
}

function getVisibleToolTarget(path?: string) {
  return isIndexHtmlPath(path) ? undefined : path;
}

function getToolAction(
  toolName: string,
  target: string | undefined,
  t: ReturnType<typeof useI18n>['t'],
) {
  const actionKeys: Record<string, Parameters<typeof t>[0]> = {
    edit: isIndexHtmlPath(target) ? 'tool.action.editPage' : 'tool.action.editFile',
    glob: 'tool.action.glob',
    grep: 'tool.action.grep',
    previewRefresh: 'tool.action.previewRefresh',
    read: isIndexHtmlPath(target) ? 'tool.action.readPage' : 'tool.action.readFile',
    write: isIndexHtmlPath(target) ? 'tool.action.writePage' : 'tool.action.writeFile',
  };
  const key = actionKeys[toolName];

  return key ? t(key) : toolName;
}
