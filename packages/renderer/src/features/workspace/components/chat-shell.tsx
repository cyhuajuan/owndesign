'use client';

import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import {
  DownloadIcon,
  ExternalLinkIcon,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  RefreshCwIcon,
} from 'lucide-react';

import { AppBrand } from '@/components/app-brand';
import {
  Conversation,
  ConversationContent,
  ConversationEmptyState,
} from '@/components/ai-elements/conversation';
import { Message, MessageContent } from '@/components/ai-elements/message';
import {
  PromptInput,
  PromptInputBody,
  PromptInputFooter,
  PromptInputSubmit,
  PromptInputTextarea,
  PromptInputTools,
} from '@/components/ai-elements/prompt-input';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SettingsControl } from '@/features/settings/components/settings-control';
import { useI18n } from '@/features/i18n/context';
import { Separator } from '@/components/ui/separator';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { FrontendCapabilityBridge } from '@/features/preview/components/frontend-capability-bridge';
import type { PreviewDevice } from '@/features/preview/preview-device';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarProvider,
} from '@/components/ui/sidebar';
import { cn } from '@/lib/utils';
import { useApiClient } from '@/api/context';

const CONVERSATION_PANE_STORAGE_KEY = 'owndesign.app.conversation-pane-collapsed';
const PREVIEW_DEVICE_BY_PROJECT_STORAGE_KEY = 'owndesign.app.preview-device-by-project';
const LEGACY_PREVIEW_DEVICE_BY_HTML_STORAGE_KEY = 'owndesign.app.preview-device-by-html';
const CONVERSATION_PANE_EVENT = 'owndesign:conversation-pane';
const PREVIEW_REFRESH_EVENT = 'owndesign:preview-refresh';
const PREVIEW_HREF_EVENT = 'owndesign:preview-href-updated';
const PREVIEW_ROUTE_EVENT = 'owndesign:preview-route-updated';

type PreviewStatus = 'ready' | 'loading' | 'error';

type PreviewBodyContext = {
  previewDevice: PreviewDevice;
};

export type ChatShellSlots = {
  topBarDragRegion?: ReactNode;
  topBarTrailing?: ReactNode;
};

type ChatShellProps = {
  composer?: ReactNode;
  conversationBody?: ReactNode;
  controlBar?: ReactNode;
  messageHistory?: ReactNode;
  previewActions?: ReactNode;
  previewBody?: ReactNode | ((context: PreviewBodyContext) => ReactNode);
  previewHref?: string;
  previewProjectId?: string;
  previewStatus?: PreviewStatus;
  shellSlots?: ChatShellSlots;
};

export function ChatShell({
  composer,
  conversationBody,
  controlBar,
  messageHistory,
  previewActions,
  previewBody,
  previewHref,
  previewProjectId,
  previewStatus = 'ready',
  shellSlots,
}: ChatShellProps) {
  const api = useApiClient();
  const { t } = useI18n();
  const [sessionPreviewHref, setSessionPreviewHref] = useState<string>();
  const [previewDevice, setPreviewDevice] = useState<PreviewDevice>('desktop');
  const previewDeviceRef = useRef<PreviewDevice>('desktop');
  const [activePreviewRoute, setActivePreviewRoute] = useState('');
  const isConversationCollapsed = useSyncExternalStore(
    subscribeToConversationPaneState,
    readConversationPaneState,
    () => false,
  );
  const isSidebarOpen = !isConversationCollapsed;
  const effectivePreviewHref = previewHref ?? sessionPreviewHref;
  const statusClassName = useMemo(
    () =>
      cn(
        'size-1.5 rounded-full',
        previewStatus === 'ready' && 'bg-[var(--status-ready)]',
        previewStatus === 'loading' && 'animate-pulse bg-[var(--status-warning)]',
        previewStatus === 'error' && 'bg-destructive',
      ),
    [previewStatus],
  );

  useEffect(() => {
    previewDeviceRef.current = previewDevice;
  }, [previewDevice]);

  useEffect(() => {
    if (!previewProjectId) {
      return;
    }

    const storedDevice = readStoredPreviewDevice(previewProjectId);

    if (storedDevice) {
      previewDeviceRef.current = storedDevice;
      setPreviewDevice(storedDevice);
      return;
    }

    writeStoredPreviewDevice(previewProjectId, previewDeviceRef.current);
  }, [previewProjectId]);

  useEffect(() => {
    const handlePreviewHrefUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      setSessionPreviewHref(typeof event.detail?.href === 'string' ? event.detail.href : undefined);
    };

    window.addEventListener(PREVIEW_HREF_EVENT, handlePreviewHrefUpdated);

    return () => {
      window.removeEventListener(PREVIEW_HREF_EVENT, handlePreviewHrefUpdated);
    };
  }, []);

  useEffect(() => {
    setActivePreviewRoute('');
  }, [previewProjectId]);

  useEffect(() => {
    const handlePreviewRouteUpdated = (event: Event) => {
      if (!(event instanceof CustomEvent)) {
        return;
      }

      const projectId =
        typeof event.detail?.projectId === 'string' ? event.detail.projectId : undefined;
      const hash = typeof event.detail?.hash === 'string' ? event.detail.hash : undefined;

      if (projectId !== previewProjectId || hash === undefined) {
        return;
      }

      if (hash !== '' && !hash.startsWith('#')) {
        return;
      }

      setActivePreviewRoute(hash);
    };

    window.addEventListener(PREVIEW_ROUTE_EVENT, handlePreviewRouteUpdated);

    return () => {
      window.removeEventListener(PREVIEW_ROUTE_EVENT, handlePreviewRouteUpdated);
    };
  }, [previewProjectId]);

  const handlePreviewDeviceChange = (value: string | null) => {
    if (value !== 'desktop' && value !== 'mobile') {
      return;
    }

    previewDeviceRef.current = value;
    setPreviewDevice(value);

    if (previewProjectId) {
      writeStoredPreviewDevice(previewProjectId, value);
    }
  };
  const currentHtmlDownloadUrl =
    previewProjectId && effectivePreviewHref
      ? api.buildUrl(buildProjectDownloadPath(previewProjectId, 'current-html'))
      : undefined;
  const currentScreenshotDownloadUrl =
    previewProjectId && effectivePreviewHref
      ? api.buildUrl(
          buildProjectDownloadPath(
            previewProjectId,
            'current-screenshot',
            previewDevice,
            activePreviewRoute,
          ),
        )
      : undefined;
  const workspaceZipDownloadUrl = previewProjectId
    ? api.buildUrl(buildProjectDownloadPath(previewProjectId, 'workspace-zip'))
    : undefined;
  const statusLabels: Record<PreviewStatus, string> = {
    error: t('shell.error'),
    loading: t('app.loading'),
    ready: t('shell.ready'),
  };
  const demoMessages = [
    {
      content: t('shell.demoUser'),
      role: 'user' as const,
    },
    {
      content: t('shell.demoAssistant'),
      role: 'assistant' as const,
    },
  ];
  const previewBodyNode =
    typeof previewBody === 'function' ? previewBody({ previewDevice }) : previewBody;

  return (
    <SidebarProvider
      className="h-screen min-h-0 bg-background text-foreground"
      open={isSidebarOpen}
      onOpenChange={(open) => writeConversationPaneState(!open)}
      style={
        {
          '--sidebar-width': '400px',
          '--sidebar-width-icon': '0px',
        } as CSSProperties
      }
    >
      <FrontendCapabilityBridge projectId={previewProjectId} />
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background">
        <header
          className={cn(
            'flex h-11 shrink-0 items-center gap-2 border-b border-border bg-card py-0 pl-3',
            shellSlots?.topBarTrailing ? 'pr-0' : 'pr-3',
          )}
        >
          <AppBrand />
          <Separator orientation="vertical" className="h-5" />
          {controlBar ? (
            <div key="control-bar" className="min-w-0">
              {controlBar}
            </div>
          ) : null}
          {shellSlots?.topBarDragRegion ?? <div className="flex-1" />}
          <SettingsControl />
          {shellSlots?.topBarTrailing}
        </header>

        <div className="flex min-h-0 flex-1 overflow-hidden">
          <Sidebar
            aria-label={t('shell.conversationWorkflow')}
            className="top-11 h-[calc(100vh-2.75rem)] border-r border-border bg-card"
            collapsible="offcanvas"
            role="region"
          >
            <SidebarContent className="bg-card">
              {conversationBody ?? (
                <Conversation className="min-h-0">
                  <ConversationContent className="gap-2 p-4">
                    {messageHistory ??
                      (demoMessages.length === 0 ? (
                        <ConversationEmptyState />
                      ) : (
                        demoMessages.map((message, index) => (
                          <Message from={message.role} key={`${message.role}-${index}`}>
                            <MessageContent>{message.content}</MessageContent>
                          </Message>
                        ))
                      ))}
                  </ConversationContent>
                </Conversation>
              )}
            </SidebarContent>
            {conversationBody ? null : (
              <SidebarFooter className="border-t border-border bg-card p-3">
                {composer ?? (
                  <PromptInput onSubmit={() => {}}>
                    <PromptInputBody>
                      <PromptInputTextarea placeholder={t('conversation.placeholder')} />
                    </PromptInputBody>
                    <PromptInputFooter>
                      <PromptInputTools />
                      <PromptInputSubmit />
                    </PromptInputFooter>
                  </PromptInput>
                )}
              </SidebarFooter>
            )}
          </Sidebar>

          <SidebarInset
            aria-label={t('preview.panel')}
            className="min-w-0 bg-background"
            role="region"
          >
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex h-[38px] shrink-0 items-center gap-2 border-b border-border bg-card px-3">
                <Button
                  aria-label={
                    isConversationCollapsed
                      ? t('shell.expandConversation')
                      : t('shell.collapseConversation')
                  }
                  onClick={() => writeConversationPaneState(!isConversationCollapsed)}
                  size="icon-sm"
                  type="button"
                  variant="ghost"
                >
                  {isConversationCollapsed ? <PanelLeftOpenIcon /> : <PanelLeftCloseIcon />}
                </Button>

                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <span className={statusClassName} />
                  <span>{statusLabels[previewStatus]}</span>
                  {activePreviewRoute ? (
                    <span
                      className="max-w-[min(320px,32vw)] truncate font-mono text-[11px] text-foreground/70"
                      title={activePreviewRoute}
                    >
                      {activePreviewRoute}
                    </span>
                  ) : null}
                </div>
                <div className="min-w-0 flex-1" />
                <div className="flex items-center gap-1">
                  {previewActions ?? (
                    <>
                      <Select onValueChange={handlePreviewDeviceChange} value={previewDevice}>
                        <SelectTrigger
                          aria-label={t('preview.device')}
                          className="h-7 w-22 px-2 text-xs"
                          size="sm"
                        >
                          <SelectValue>
                            {previewDevice === 'desktop'
                              ? t('preview.deviceDesktop')
                              : t('preview.deviceMobile')}
                          </SelectValue>
                        </SelectTrigger>
                        <SelectContent align="end" className="min-w-28">
                          <SelectGroup>
                            <SelectItem value="desktop">{t('preview.deviceDesktop')}</SelectItem>
                            <SelectItem value="mobile">{t('preview.deviceMobile')}</SelectItem>
                          </SelectGroup>
                        </SelectContent>
                      </Select>
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          disabled={!previewProjectId}
                          render={
                            <Button
                              aria-label={t('download.label')}
                              size="icon-sm"
                              type="button"
                              variant="ghost"
                            >
                              <DownloadIcon />
                            </Button>
                          }
                        />
                        <DropdownMenuContent align="end" className="min-w-44">
                          <DropdownMenuItem
                            disabled={!currentHtmlDownloadUrl}
                            onClick={() => {
                              if (currentHtmlDownloadUrl) {
                                triggerBrowserDownload(currentHtmlDownloadUrl);
                              }
                            }}
                          >
                            {t('download.currentHtml')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!currentScreenshotDownloadUrl}
                            onClick={() => {
                              if (currentScreenshotDownloadUrl) {
                                triggerBrowserDownload(currentScreenshotDownloadUrl);
                              }
                            }}
                          >
                            {t('download.screenshotPng')}
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={!workspaceZipDownloadUrl}
                            onClick={() => {
                              if (workspaceZipDownloadUrl) {
                                triggerBrowserDownload(workspaceZipDownloadUrl);
                              }
                            }}
                          >
                            {t('download.zip')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                      <Button
                        aria-label={t('preview.refresh')}
                        onClick={() => {
                          window.dispatchEvent(new Event(PREVIEW_REFRESH_EVENT));
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <RefreshCwIcon />
                      </Button>
                      <Button
                        aria-label={t('preview.openExternal')}
                        disabled={!effectivePreviewHref}
                        onClick={() => {
                          if (effectivePreviewHref) {
                            window.open(effectivePreviewHref, '_blank', 'noopener');
                          }
                        }}
                        size="icon-sm"
                        type="button"
                        variant="ghost"
                      >
                        <ExternalLinkIcon />
                      </Button>
                    </>
                  )}
                </div>
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden">
                {previewBodyNode ?? (
                  <div className="flex size-full items-center justify-center p-10">
                    <ConversationEmptyState
                      description={t('preview.emptyDescription')}
                      title={t('preview.emptyTitle')}
                    />
                  </div>
                )}
              </div>
            </div>
          </SidebarInset>
        </div>
      </div>
    </SidebarProvider>
  );
}

function subscribeToConversationPaneState(onStoreChange: () => void) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const handleStorage = (event: StorageEvent) => {
    if (event.key === null || event.key === CONVERSATION_PANE_STORAGE_KEY) {
      onStoreChange();
    }
  };

  window.addEventListener('storage', handleStorage);
  window.addEventListener(CONVERSATION_PANE_EVENT, onStoreChange);

  return () => {
    window.removeEventListener('storage', handleStorage);
    window.removeEventListener(CONVERSATION_PANE_EVENT, onStoreChange);
  };
}

function readConversationPaneState() {
  if (typeof window === 'undefined') {
    return false;
  }

  return window.localStorage.getItem(CONVERSATION_PANE_STORAGE_KEY) === 'true';
}

function writeConversationPaneState(value: boolean) {
  if (typeof window === 'undefined') {
    return;
  }

  window.localStorage.setItem(CONVERSATION_PANE_STORAGE_KEY, String(value));
  window.dispatchEvent(new Event(CONVERSATION_PANE_EVENT));
}

function readStoredPreviewDevice(projectId: string): PreviewDevice | undefined {
  const storedDevices = readStoredPreviewDevices(PREVIEW_DEVICE_BY_PROJECT_STORAGE_KEY);
  const value = storedDevices[projectId];

  if (isPreviewDevice(value)) {
    return value;
  }

  const legacyStoredDevices = readStoredPreviewDevices(LEGACY_PREVIEW_DEVICE_BY_HTML_STORAGE_KEY);
  const legacyValue = legacyStoredDevices[buildLegacyPreviewDeviceStorageKey(projectId)];

  return isPreviewDevice(legacyValue) ? legacyValue : undefined;
}

function writeStoredPreviewDevice(projectId: string, previewDevice: PreviewDevice) {
  try {
    const storedDevices = readStoredPreviewDevices(PREVIEW_DEVICE_BY_PROJECT_STORAGE_KEY);
    storedDevices[projectId] = previewDevice;
    window.localStorage.setItem(
      PREVIEW_DEVICE_BY_PROJECT_STORAGE_KEY,
      JSON.stringify(storedDevices),
    );
  } catch {
    // Ignore storage failures; runtime selection still works for this session.
  }
}

function readStoredPreviewDevices(storageKey: string) {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? '{}');

    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function buildLegacyPreviewDeviceStorageKey(projectId: string) {
  return JSON.stringify([projectId, 'index.html']);
}

function isPreviewDevice(value: unknown): value is PreviewDevice {
  return value === 'desktop' || value === 'mobile';
}

function buildProjectDownloadPath(
  projectId: string,
  kind: 'current-html' | 'current-screenshot' | 'workspace-zip',
  device?: PreviewDevice,
  route?: string,
) {
  const params = new URLSearchParams({ kind });

  if (kind === 'current-screenshot') {
    params.set('device', device ?? 'desktop');
    if (route) {
      params.set('route', route);
    }
  }

  return `/api/projects/${encodeURIComponent(projectId)}/download?${params.toString()}`;
}

function triggerBrowserDownload(url: string) {
  const link = document.createElement('a');
  link.href = url;
  link.download = '';
  document.body.append(link);
  link.click();
  link.remove();
}
