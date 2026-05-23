import type { ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import Home from "./page";

const getProjectState = vi.fn();
const getConversationState = vi.fn();
const getPublicSettings = vi.fn();
const updateSettings = vi.fn();
const createProject = vi.fn();
const initialSetupGuide = vi.fn();

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

vi.mock("@/server/owndesign", () => ({
  createConversationService: () => ({
    getConversationState,
  }),
  createProjectService: () => ({
    createProject,
    getProjectState,
  }),
}));

vi.mock("@/server/settings/settings-service", () => ({
  createSettingsService: () => ({
    getPublicSettings,
    updateSettings,
  }),
}));

vi.mock("@/features/workspace/components/chat-shell", () => ({
  ChatShell: ({
    previewBody,
  }: {
    previewBody?: ReactNode;
  }) => (
    <div>
      <section aria-label="预览面板">{previewBody}</section>
    </div>
  ),
}));

vi.mock("@/features/projects/components/control-bar", () => ({
  ControlBar: () => <div />,
}));

vi.mock("@/features/onboarding/components/initial-setup-guide", () => ({
  InitialSetupGuide: ({
    onComplete,
  }: {
    onComplete: (input: {
      interfaceLanguage: "zh-CN" | "en-US";
      modelConfigurations: Array<{
        apiKey: string;
        baseUrl: string;
        contextSizeK: number;
        id: string;
        model: string;
        provider: "deepseek" | "openai-compatible";
      }>;
    }) => Promise<{ href?: string } | void>;
  }) => {
    initialSetupGuide(onComplete);

    return (
      <button
        onClick={() =>
          void onComplete({
            interfaceLanguage: "zh-CN",
            modelConfigurations: [
              {
                apiKey: "sk-test",
                baseUrl: "https://api.example.com/v1",
                contextSizeK: 200,
                id: "model-1",
                model: "gpt-4o",
                provider: "openai-compatible",
              },
            ],
          })
        }
        type="button"
      >
        项目初始化向导
      </button>
    );
  },
}));

beforeEach(() => {
  getProjectState.mockResolvedValue({ projects: [] });
  getConversationState.mockResolvedValue({ conversations: [] });
  getPublicSettings.mockResolvedValue({
    defaultModelId: null,
    interfaceLanguage: "zh-CN",
    modelConfigurations: [],
    resources: { fontLibraries: [], iconLibraries: [] },
  });
  updateSettings.mockResolvedValue({});
  createProject.mockResolvedValue({
    conversation: { id: "conversation-1" },
    project: { id: "project-1" },
  });
  initialSetupGuide.mockClear();
});

describe("Home page", () => {
  it("renders initial setup guide when no projects or model configurations exist", async () => {
    render(await Home({ searchParams: Promise.resolve({}) }));

    expect(screen.getByRole("button", { name: "项目初始化向导" })).toBeInTheDocument();
    expect(initialSetupGuide).toHaveBeenCalled();
  });

  it("completes initial setup by saving settings and creating helloworld project", async () => {
    const user = userEvent.setup();

    render(await Home({ searchParams: Promise.resolve({}) }));
    await user.click(screen.getByRole("button", { name: "项目初始化向导" }));

    await waitFor(() =>
      expect(updateSettings).toHaveBeenCalledWith(
        expect.objectContaining({
          defaultModelId: "model-1",
          interfaceLanguage: "zh-CN",
          modelConfigurations: [
            expect.objectContaining({
              apiKey: "sk-test",
              baseUrl: "https://api.example.com/v1",
              contextSizeK: 200,
              id: "model-1",
              model: "gpt-4o",
              provider: "openai-compatible",
            }),
          ],
        }),
      ),
    );
    expect(createProject).toHaveBeenCalledWith({ name: "helloworld" });
  });

  it("renders unified preview empty state when no active project exists", async () => {
    vi.mocked(getPublicSettings).mockResolvedValueOnce({
      defaultModelId: "model-1",
      interfaceLanguage: "zh-CN",
      modelConfigurations: [{ id: "model-1" }],
      resources: { fontLibraries: [], iconLibraries: [] },
    });

    render(await Home({ searchParams: Promise.resolve({}) }));

    const previewPane = screen.getByRole("region", { name: "预览面板" });

    expect(
      within(previewPane).getByText("尚无预览内容"),
    ).toBeInTheDocument();
    expect(
      within(previewPane).getByText(
        "在对话中向 AI 描述你的设计需求，生成的页面将在此处实时预览。",
      ),
    ).toBeInTheDocument();
    expect(within(previewPane).getByText("Preview")).toBeInTheDocument();
  });
});
