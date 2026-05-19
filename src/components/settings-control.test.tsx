import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { SettingsControl } from "./settings-control";

const defaultSettings = {
  defaultModelId: null,
  interfaceLanguage: "zh-CN",
  modelConfigurations: [],
  resources: {
    fontLibraries: [
      {
        cdn: "https://fonts.googleapis.com/css2?family=Inter:ital,opsz,wght@0,14..32,100..900;1,14..32,100..900&family=Noto+Sans+SC:wght@100..900&display=swap",
        id: "font-1",
        isDefault: true,
        name: "Google Fonts",
      },
    ],
    iconLibraries: [
      {
        cdn: "https://unpkg.com/lucide@latest/dist/umd/lucide.js",
        id: "icon-1",
        isDefault: true,
        name: "Lucide Icons",
      },
    ],
  },
};

beforeEach(() => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PUT") {
        return Response.json(JSON.parse(String(init.body)));
      }

      return Response.json(defaultSettings);
    }),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SettingsControl", () => {
  it("renders resource settings with prototype copy and defaults", async () => {
    const user = userEvent.setup();

    render(<SettingsControl />);
    await user.click(screen.getByTitle("设置"));
    await user.click(await screen.findByRole("button", { name: "资源管理" }));

    expect(screen.getAllByText("资源管理").length).toBeGreaterThan(0);
    expect(
      screen.getByText("管理设计页面可使用的字体库和图标库。"),
    ).toBeInTheDocument();
    expect(screen.getByText("字体库")).toBeInTheDocument();
    expect(screen.getByText("图标库")).toBeInTheDocument();
    expect(screen.getByText("Google Fonts")).toBeInTheDocument();
    expect(screen.getByText("Lucide Icons")).toBeInTheDocument();
    expect(screen.queryByText("启用 Tailwind CSS")).not.toBeInTheDocument();
  });

  it("adds and edits resource settings before saving", async () => {
    const user = userEvent.setup();

    render(<SettingsControl />);
    await user.click(screen.getByTitle("设置"));
    await user.click(await screen.findByRole("button", { name: "资源管理" }));

    await user.click(screen.getByRole("button", { name: /添加字体库/ }));
    await user.type(screen.getByPlaceholderText("字体库名称"), "HarmonyOS Sans");
    await user.type(
      screen.getByPlaceholderText("CDN URL (https://...)"),
      "https://cdn.example.com/harmony.css",
    );
    await user.click(screen.getByTitle("确认添加"));

    await user.click(screen.getByRole("button", { name: /添加图标库/ }));
    await user.type(screen.getByPlaceholderText("图标库名称"), "Remix Icon");
    await user.type(
      screen.getByPlaceholderText("CDN URL (https://...)"),
      "https://cdn.example.com/remix.js",
    );
    await user.click(screen.getByTitle("确认添加"));

    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    const putCall = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "PUT");
    const payload = JSON.parse(String(putCall?.[1]?.body));

    expect(payload.resources.fontLibraries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cdn: "https://cdn.example.com/harmony.css",
          name: "HarmonyOS Sans",
        }),
      ]),
    );
    expect(payload.resources.iconLibraries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          cdn: "https://cdn.example.com/remix.js",
          name: "Remix Icon",
        }),
      ]),
    );
    expect(payload.resources).not.toHaveProperty("tailwind");
  });

  it("sets a resource as default and removes resources", async () => {
    const user = userEvent.setup();

    render(<SettingsControl />);
    await user.click(screen.getByTitle("设置"));
    await user.click(await screen.findByRole("button", { name: "资源管理" }));

    await user.click(screen.getByRole("button", { name: /添加字体库/ }));
    await user.type(screen.getByPlaceholderText("字体库名称"), "HarmonyOS Sans");
    await user.type(
      screen.getByPlaceholderText("CDN URL (https://...)"),
      "https://cdn.example.com/harmony.css",
    );
    await user.click(screen.getByTitle("确认添加"));

    await user.click(screen.getAllByRole("button", { name: "设为默认" })[0]);
    await user.click(screen.getAllByTitle("移除")[0]);
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    const putCall = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "PUT");
    const payload = JSON.parse(String(putCall?.[1]?.body));

    expect(payload.resources.fontLibraries).toEqual([
      expect.objectContaining({
        isDefault: true,
        name: "HarmonyOS Sans",
      }),
    ]);
  });

  it("uses fixed DeepSeek model options", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsControl />);

    await user.click(screen.getByTitle("设置"));
    await user.click(await screen.findByRole("button", { name: "AI 模型" }));
    await user.click(screen.getByRole("button", { name: /添加模型/ }));

    const providerSelect = container.querySelector("select");
    expect(providerSelect).not.toBeNull();
    await user.selectOptions(providerSelect!, "deepseek");

    const selects = container.querySelectorAll("select");
    const modelSelect = selects[1];

    expect(modelSelect).toBeInTheDocument();
    expect(
      Array.from(modelSelect.options).map((option) => option.value),
    ).toEqual(["deepseek-v4-flash", "deepseek-v4-pro"]);
  });

  it("saves OpenAI Compatible context size field", async () => {
    const user = userEvent.setup();
    const { container } = render(<SettingsControl />);

    await user.click(screen.getByTitle("设置"));
    await user.click(await screen.findByRole("button", { name: "AI 模型" }));
    await user.click(screen.getByRole("button", { name: /添加模型/ }));

    const providerSelect = container.querySelector("select");
    expect(providerSelect).not.toBeNull();
    await user.selectOptions(providerSelect!, "openai-compatible");

    expect(screen.getByText("Context Size (K)")).toBeInTheDocument();
    await user.type(screen.getByPlaceholderText("例如 gpt-4o"), "gpt-4o");
    const textInputs = container.querySelectorAll("input[type='text']");
    await user.type(textInputs[1], "https://api.example.com/v1");
    await user.type(screen.getByPlaceholderText("sk-..."), "key");
    await user.type(screen.getByPlaceholderText("200"), "512");
    await user.click(screen.getByRole("button", { name: "保存设置" }));

    await waitFor(() =>
      expect(vi.mocked(fetch)).toHaveBeenCalledWith(
        "/api/settings",
        expect.objectContaining({ method: "PUT" }),
      ),
    );
    const putCall = vi
      .mocked(fetch)
      .mock.calls.find(([, init]) => init?.method === "PUT");
    const payload = JSON.parse(String(putCall?.[1]?.body));

    expect(payload.modelConfigurations[0]).toMatchObject({
      contextSizeK: "512",
      model: "gpt-4o",
      provider: "openai-compatible",
    });
  });
});
