import type { ReactNode } from "react";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthSectionVisibilityMenu } from "@/components/settings/auth/AuthSectionVisibilityMenu";

const mocks = vi.hoisted(() => ({
  settings: {} as { hiddenAuthSections?: string[] },
  updateSettings: vi.fn(),
  autoSaveSettings: vi.fn(),
  authGetStatus: vi.fn(),
  kimiStatus: vi.fn(),
  dshStatus: vi.fn(),
  canSwitchAgy: true,
}));

vi.mock("@/hooks/useSettings", () => ({
  useSettings: () => ({
    settings: mocks.settings,
    updateSettings: mocks.updateSettings,
    autoSaveSettings: mocks.autoSaveSettings,
  }),
}));
vi.mock("@/lib/authBinding", () => ({
  canSwitchAgyAccount: () => mocks.canSwitchAgy,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  authApi: { authGetStatus: mocks.authGetStatus },
}));
vi.mock("@/lib/api/kimiOAuth", () => ({
  kimiOAuthApi: { status: mocks.kimiStatus },
}));
vi.mock("@/lib/api/dsh", () => ({
  dshApi: { accountStatus: mocks.dshStatus },
}));
vi.mock("@/components/providers/DshAccount", () => ({
  DSH_ACCOUNT_STATUS_KEY: ["dsh-account-status"],
}));
vi.mock("@/components/providers/forms/hooks/useKimiOAuth", () => ({
  KIMI_OAUTH_STATUS_KEY: ["kimi-oauth-status"],
}));

let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const managedStatus = (accounts: number) => ({
  provider: "github_copilot",
  authenticated: accounts > 0,
  default_account_id: null,
  accounts: Array.from({ length: accounts }, (_, index) => ({
    id: `account-${index}`,
  })),
});

/** 打开菜单；按钮名带着「已隐藏 n」，用开头匹配 */
const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /^显示的服务/ }));
  // Radix 用触发按钮给菜单命名，名字里也带着「已隐藏 n」
  return screen.findByRole("menu", { name: /^显示的服务/ });
};

const item = (name: string) => screen.getByRole("menuitemcheckbox", { name });

beforeEach(() => {
  mocks.settings = {};
  mocks.canSwitchAgy = true;
  mocks.autoSaveSettings.mockResolvedValue(null);
  mocks.authGetStatus.mockResolvedValue(managedStatus(0));
  mocks.kimiStatus.mockResolvedValue({ accounts: [], currentAccountId: null });
  mocks.dshStatus.mockResolvedValue({ signedIn: false });
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
});

afterEach(() => {
  queryClient.clear();
});

describe("AuthSectionVisibilityMenu", () => {
  it("lists every service on this machine, all checked by default", async () => {
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    const names = screen
      .getAllByRole("menuitemcheckbox")
      .map((element) => element.textContent);
    expect(names).toEqual([
      "Claude",
      "GitHub Copilot",
      "ChatGPT",
      "xAI",
      "Kimi Code",
      "DeepSeek Harness",
      "Antigravity",
      "WorkBuddy",
    ]);
    for (const element of screen.getAllByRole("menuitemcheckbox")) {
      expect(element).toHaveAttribute("aria-checked", "true");
    }
    // 没隐藏时没有「全部显示」
    expect(
      screen.queryByRole("menuitem", { name: "全部显示" }),
    ).not.toBeInTheDocument();
  });

  it("leaves Antigravity out where agy logins can't be switched", async () => {
    mocks.canSwitchAgy = false;
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);
    expect(
      screen.queryByRole("menuitemcheckbox", { name: "Antigravity" }),
    ).not.toBeInTheDocument();
  });

  it("hides a service without accounts right away and saves the hidden list", async () => {
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    await user.click(item("WorkBuddy"));

    await waitFor(() =>
      expect(mocks.autoSaveSettings).toHaveBeenCalledWith({
        hiddenAuthSections: ["workbuddy_account"],
      }),
    );
    expect(mocks.updateSettings).toHaveBeenCalledWith({
      hiddenAuthSections: ["workbuddy_account"],
    });
    expect(mocks.authGetStatus).toHaveBeenCalledWith("workbuddy_account");
    // 菜单不关，可以接着勾
    expect(screen.getByRole("menu")).toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("reads Kimi Code and DeepSeek Harness accounts from their own status", async () => {
    mocks.kimiStatus.mockResolvedValue({
      accounts: [{ id: "k" }],
      currentAccountId: "k",
    });
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    await user.click(item("DeepSeek Harness"));
    await waitFor(() =>
      expect(mocks.autoSaveSettings).toHaveBeenCalledWith({
        hiddenAuthSections: ["dsh_account"],
      }),
    );

    // 菜单还开着，接着勾 Kimi Code：它有账号，要确认
    await user.click(item("Kimi Code"));
    expect(await screen.findByText("隐藏 Kimi Code？")).toBeInTheDocument();
    expect(mocks.authGetStatus).not.toHaveBeenCalled();
  });

  it("asks before hiding a service that still has accounts", async () => {
    mocks.authGetStatus.mockResolvedValue(managedStatus(2));
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    await user.click(item("GitHub Copilot"));

    // 先收起菜单再弹确认
    expect(
      await screen.findByText("隐藏 GitHub Copilot？"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/GitHub Copilot 里还有 2 个账号/),
    ).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(mocks.autoSaveSettings).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "隐藏" }));
    expect(mocks.autoSaveSettings).toHaveBeenCalledWith({
      hiddenAuthSections: ["github_copilot"],
    });
  });

  it("keeps the service when the confirmation is cancelled", async () => {
    mocks.authGetStatus.mockResolvedValue(managedStatus(1));
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    await user.click(item("ChatGPT"));
    await screen.findByText("隐藏 ChatGPT？");
    await user.click(screen.getByRole("button", { name: "common.cancel" }));

    expect(mocks.autoSaveSettings).not.toHaveBeenCalled();
    expect(mocks.updateSettings).not.toHaveBeenCalled();
  });

  it("shows a hidden service again, keeping ids this version doesn't know", async () => {
    mocks.settings = {
      hiddenAuthSections: ["github_copilot", "future_section", "xai_oauth"],
    };
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });

    // 按钮上写着隐藏了几个（不认识的 ID 不算）
    expect(
      screen.getByRole("button", { name: /^显示的服务\s*已隐藏 2/ }),
    ).toBeInTheDocument();
    await openMenu(user);
    expect(item("GitHub Copilot")).toHaveAttribute("aria-checked", "false");

    await user.click(item("GitHub Copilot"));
    expect(mocks.autoSaveSettings).toHaveBeenCalledWith({
      hiddenAuthSections: ["future_section", "xai_oauth"],
    });
    // 勾回来不用数账号
    expect(mocks.authGetStatus).not.toHaveBeenCalled();
  });

  it("shows everything again with one click", async () => {
    mocks.settings = {
      hiddenAuthSections: ["github_copilot", "workbuddy_account"],
    };
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    await user.click(screen.getByRole("menuitem", { name: "全部显示" }));
    expect(mocks.autoSaveSettings).toHaveBeenCalledWith({
      hiddenAuthSections: [],
    });
  });

  it("keeps at least one service shown", async () => {
    mocks.settings = {
      hiddenAuthSections: [
        "claude_official",
        "github_copilot",
        "codex_oauth",
        "xai_oauth",
        "kimi_oauth",
        "dsh_account",
        "agy_oauth",
      ],
    };
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    const last = item("WorkBuddy");
    expect(last).toHaveAttribute("aria-checked", "true");
    expect(last).toHaveAttribute("aria-disabled", "true");
    await user.click(last);
    expect(mocks.autoSaveSettings).not.toHaveBeenCalled();
  });

  it("puts the list back when saving fails", async () => {
    mocks.settings = { hiddenAuthSections: ["xai_oauth"] };
    let rejectSave: (error: Error) => void = () => {};
    mocks.autoSaveSettings.mockImplementation(
      () =>
        new Promise((_, reject) => {
          rejectSave = reject;
        }),
    );
    const user = userEvent.setup();
    render(<AuthSectionVisibilityMenu />, { wrapper });
    await openMenu(user);

    await user.click(item("WorkBuddy"));
    await waitFor(() =>
      expect(mocks.updateSettings).toHaveBeenCalledWith({
        hiddenAuthSections: ["xai_oauth", "workbuddy_account"],
      }),
    );
    await act(async () => rejectSave(new Error("disk full")));
    expect(mocks.updateSettings).toHaveBeenLastCalledWith({
      hiddenAuthSections: ["xai_oauth"],
    });
  });
});
