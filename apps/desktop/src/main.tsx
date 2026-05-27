import { StrictMode, useCallback, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ComponentType, ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  CopyIcon,
  MinusIcon,
  SquareIcon,
  XIcon,
} from "lucide-react";
import type { OwnDesignAppProps } from "@owndesign/renderer";

import "./main.css";

type DesktopStartupStatus = {
  serverError?: string;
  serverStarted: boolean;
};

type OwnDesignAppComponent = ComponentType<OwnDesignAppProps>;

function DesktopBootstrap() {
  const [status, setStatus] = useState<DesktopStartupStatus>();
  const [statusError, setStatusError] = useState<string>();
  const [OwnDesignApp, setOwnDesignApp] = useState<OwnDesignAppComponent>();

  const retryStatusCheck = useCallback(async () => {
    setStatus(undefined);
    setStatusError(undefined);

    try {
      const nextStatus = await invoke<DesktopStartupStatus>(
        "get_desktop_startup_status",
      );

      setStatus(nextStatus);
      setStatusError(undefined);

      if (nextStatus.serverStarted) {
        const renderer = await import("@owndesign/renderer");
        setOwnDesignApp(() => renderer.OwnDesignApp);
      } else {
        setOwnDesignApp(undefined);
      }
    } catch (error) {
      setOwnDesignApp(undefined);
      setStatus(undefined);
      setStatusError(
        error instanceof Error
          ? error.message
          : "无法读取桌面端启动状态。",
      );
    }
  }, []);

  useEffect(() => {
    let isActive = true;

    void invoke<DesktopStartupStatus>("get_desktop_startup_status")
      .then(async (nextStatus) => {
        if (!isActive) {
          return;
        }

        setStatus(nextStatus);
        setStatusError(undefined);

        if (nextStatus.serverStarted) {
          const renderer = await import("@owndesign/renderer");

          if (isActive) {
            setOwnDesignApp(() => renderer.OwnDesignApp);
          }
        } else {
          setOwnDesignApp(undefined);
        }
      })
      .catch((error: unknown) => {
        if (!isActive) {
          return;
        }

        setOwnDesignApp(undefined);
        setStatus(undefined);
        setStatusError(
          error instanceof Error
            ? error.message
            : "无法读取桌面端启动状态。",
        );
      });

    return () => {
      isActive = false;
    };
  }, []);

  if (statusError) {
    return (
      <DesktopStartupError
        detail={statusError}
        onRetry={() => void retryStatusCheck()}
        title="无法读取桌面端启动状态"
      />
    );
  }

  if (!status) {
    return <DesktopStartupLoading />;
  }

  if (!status.serverStarted) {
    return (
      <DesktopStartupError
        detail={status.serverError ?? "本地 server 未能启动，但没有返回错误详情。"}
        onRetry={() => void retryStatusCheck()}
        title="本地服务启动失败"
      />
    );
  }

  if (!OwnDesignApp) {
    return <DesktopStartupLoading />;
  }

  return (
    <OwnDesignApp
      apiBaseUrl="http://127.0.0.1:3711"
      shellSlots={{
        topBarDragRegion: <DesktopTitlebarDragRegion />,
        topBarTrailing: <DesktopWindowControls />,
      }}
    />
  );
}

function DesktopStartupLoading() {
  return (
    <DesktopWindowShell>
      <main className="desktop-startup-shell">
        <section className="desktop-startup-panel" aria-live="polite">
          <div className="desktop-startup-mark" />
          <h1>正在启动 OwnDesign</h1>
          <p>正在检查本地服务状态...</p>
        </section>
      </main>
    </DesktopWindowShell>
  );
}

function DesktopStartupError({
  detail,
  onRetry,
  title,
}: {
  detail: string;
  onRetry: () => void;
  title: string;
}) {
  return (
    <DesktopWindowShell>
      <main className="desktop-startup-shell">
        <section className="desktop-startup-panel desktop-startup-panel-error">
          <div className="desktop-startup-error-icon" />
          <h1>{title}</h1>
          <p>桌面端已打开，但本地 server 未能正常启动。</p>
          <pre>{detail}</pre>
          <button onClick={onRetry} type="button">
            重试检测
          </button>
        </section>
      </main>
    </DesktopWindowShell>
  );
}

function DesktopWindowShell({ children }: { children: ReactNode }) {
  return (
    <div className="desktop-window-shell">
      <header className="desktop-window-titlebar">
        <div className="desktop-window-brand">OwnDesign</div>
        <DesktopTitlebarDragRegion />
        <DesktopWindowControls />
      </header>
      {children}
    </div>
  );
}

function DesktopTitlebarDragRegion() {
  const toggleMaximize = useCallback(() => {
    void getCurrentWindow().toggleMaximize();
  }, []);

  return (
    <div
      className="desktop-titlebar-drag-region"
      data-tauri-drag-region
      onDoubleClick={toggleMaximize}
    />
  );
}

function DesktopWindowControls() {
  const [isMaximized, setIsMaximized] = useState(false);

  const syncMaximizedState = useCallback(() => {
    void getCurrentWindow()
      .isMaximized()
      .then(setIsMaximized)
      .catch(() => setIsMaximized(false));
  }, []);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    let isActive = true;

    void appWindow
      .isMaximized()
      .then((maximized) => {
        if (isActive) {
          setIsMaximized(maximized);
        }
      })
      .catch(() => {
        if (isActive) {
          setIsMaximized(false);
        }
      });

    void appWindow.onResized(() => {
      if (isActive) {
        syncMaximizedState();
      }
    }).then((nextUnlisten) => {
      if (isActive) {
        unlisten = nextUnlisten;
      } else {
        nextUnlisten();
      }
    });

    return () => {
      isActive = false;
      unlisten?.();
    };
  }, [syncMaximizedState]);

  const minimize = useCallback(() => {
    void getCurrentWindow().minimize();
  }, []);

  const toggleMaximize = useCallback(() => {
    void getCurrentWindow().toggleMaximize().then(syncMaximizedState);
  }, [syncMaximizedState]);

  const close = useCallback(() => {
    void getCurrentWindow().close();
  }, []);

  return (
    <div className="desktop-window-controls">
      <button
        aria-label="最小化窗口"
        className="desktop-window-control"
        onClick={minimize}
        title="最小化"
        type="button"
      >
        <MinusIcon />
      </button>
      <button
        aria-label={isMaximized ? "还原窗口" : "最大化窗口"}
        className="desktop-window-control"
        onClick={toggleMaximize}
        title={isMaximized ? "还原" : "最大化"}
        type="button"
      >
        {isMaximized ? <CopyIcon /> : <SquareIcon />}
      </button>
      <button
        aria-label="关闭窗口"
        className="desktop-window-control desktop-window-control-close"
        onClick={close}
        title="关闭"
        type="button"
      >
        <XIcon />
      </button>
    </div>
  );
}

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found.");
}

createRoot(root).render(
  <StrictMode>
    <DesktopBootstrap />
  </StrictMode>,
);
