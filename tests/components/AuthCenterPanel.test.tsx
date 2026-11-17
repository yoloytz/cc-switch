import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthCenterPanel } from "@/components/settings/AuthCenterPanel";

const mocks = vi.hoisted(() => ({
  settings: undefined as { hiddenAuthSections?: string[] } | undefined,
  canSwitchAgy: true,
  authGetStatus: vi.fn(),
}));

vi.mock("@/components/providers/forms/ClaudeOfficialSection", () => ({
  ClaudeOfficialSection: () => <div data-testid="claude" />,
}));
vi.mock("@/components/providers/forms/CopilotAuthSection", () => ({
  CopilotAuthSection: () => <div data-testid="copilot" />,
}));
vi.mock("@/components/providers/forms/CodexOAuthSection", () => ({
  CodexOAuthSection: () => <div data-testid="codex" />,
}));
vi.mock("@/components/providers/forms/XaiOAuthSection", () => ({
  XaiOAuthSection: () => <div data-testid="xai" />,
}));
vi.mock("@/components/providers/forms/AgyOAuthSection", () => ({
  AgyOAuthSection: () => <div data-testid="agy" />,
}));
vi.mock("@/components/providers/KimiAccountLogin", () => ({
  KimiAccountLogin: () => <div data-testid="kimi" />,
}));
vi.mock("@/components/settings/auth/WorkBuddyAccountSection", () => ({
  WorkBuddyAccountSection: () => <div data-testid="workbuddy" />,
}));
vi.mock("@/components/providers/DshAccount", () => ({
  DshAccountLogin: () => <div data-testid="dsh" />,
}));
vi.mock("@/lib/query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/query")>()),
  useSettingsQuery: () => ({ data: mocks.settings }),
}));
vi.mock("@/lib/authBinding", () => ({
  canSwitchAgyAccount: () => mocks.canSwitchAgy,
}));
vi.mock("@/lib/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/api")>()),
  authApi: { authGetStatus: mocks.authGetStatus },
}));

let resizeCallbacks: Array<() => void> = [];
let queryClient: QueryClient;

const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
);

const rect = (top: number) => ({ top }) as DOMRect;

const ALL_SECTIONS = [
  "claude",
  "copilot",
  "codex",
  "xai",
  "kimi",
  "dsh",
  "agy",
  "workbuddy",
];

const renderedSections = () =>
  screen
    .queryAllByTestId(/.+/)
    .map((element) => element.dataset.testid)
    .filter((id) => id && ALL_SECTIONS.includes(id));

/** 正文 overflow-y:auto，外层 #content-area overflow:hidden，和 FullScreenPanel 一致 */
const renderInPanel = (
  ui: React.ReactElement = <AuthCenterPanel authScrollTarget="codex_oauth" />,
) => {
  const outer = document.createElement("main");
  outer.style.overflow = "hidden";
  const container = document.createElement("div");
  container.style.overflowY = "auto";
  outer.appendChild(container);
  document.body.appendChild(outer);

  Object.defineProperty(container, "clientHeight", { value: 400 });
  Object.defineProperty(container, "scrollHeight", { value: 2000 });
  container.getBoundingClientRect = () => rect(100);

  const result = render(ui, { container, wrapper });
  return { ...result, outer, container };
};

/** 让 codex 卡片在文档里的位置是 offset，屏幕位置随正文滚动变化 */
const placeCodexAt = (container: HTMLElement, offset: () => number) => {
  const codex = container.querySelector('[data-testid="codex"]')!
    .parentElement as HTMLElement;
  codex.getBoundingClientRect = () =>
    rect(100 + offset() - container.scrollTop);
};

/** 卡片位置摆好后重新定位一次（首次挂载时 jsdom 还量不出位置） */
const retarget = (rerender: (ui: React.ReactElement) => void) => {
  rerender(<AuthCenterPanel authScrollTarget={null} />);
  resizeCallbacks = [];
  rerender(<AuthCenterPanel authScrollTarget="codex_oauth" />);
};

beforeEach(() => {
  mocks.settings = undefined;
  mocks.canSwitchAgy = true;
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  resizeCallbacks = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback: () => void) {
        resizeCallbacks.push(callback);
      }
      observe() {}
      disconnect() {}
    },
  );
  vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
    cb(0);
    return 0;
  });
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  queryClient.clear();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("AuthCenterPanel scroll target", () => {
  it("scrolls only the panel body, never the outer content area", () => {
    let offset = 600;
    const { outer, container, rerender } = renderInPanel();
    placeCodexAt(container, () => offset);
    retarget(rerender);

    expect(container.scrollTop).toBe(584);
    expect(outer.scrollTop).toBe(0);
    expect(outer.scrollLeft).toBe(0);
    expect(Element.prototype.scrollIntoView).not.toHaveBeenCalled();

    // 上面几组加载完把目标挤下去：跟着重新对齐
    offset = 800;
    resizeCallbacks.forEach((callback) => callback());
    expect(container.scrollTop).toBe(784);
  });

  it("stops re-aligning once the user scrolls", () => {
    let offset = 600;
    const { container, rerender } = renderInPanel();
    placeCodexAt(container, () => offset);
    retarget(rerender);
    expect(container.scrollTop).toBe(584);

    fireEvent.wheel(container);
    container.scrollTop = 300;
    offset = 800;
    resizeCallbacks.forEach((callback) => callback());
    expect(container.scrollTop).toBe(300);
  });

  it("disables scroll anchoring while pinning and restores it afterwards", () => {
    const { container, rerender, unmount } = renderInPanel();
    placeCodexAt(container, () => 600);
    retarget(rerender);
    // 浏览器滚动锚定会自己改 scrollTop，被误判成用户接管
    expect(container.style.overflowAnchor).toBe("none");

    fireEvent.wheel(container);
    expect(container.style.overflowAnchor).toBe("");

    retarget(rerender);
    expect(container.style.overflowAnchor).toBe("none");
    unmount();
    expect(container.style.overflowAnchor).toBe("");
  });
});

describe("AuthCenterPanel section visibility", () => {
  it("renders every section in page order when nothing is hidden", () => {
    render(<AuthCenterPanel />, { wrapper });
    expect(renderedSections()).toEqual(ALL_SECTIONS);
  });

  it("treats an empty list or unknown ids as everything shown", () => {
    mocks.settings = { hiddenAuthSections: [] };
    const { unmount } = render(<AuthCenterPanel />, { wrapper });
    expect(renderedSections()).toEqual(ALL_SECTIONS);
    unmount();

    // 更新版本里才有的分组 ID：这里不认识，忽略
    mocks.settings = { hiddenAuthSections: ["future_section"] };
    render(<AuthCenterPanel />, { wrapper });
    expect(renderedSections()).toEqual(ALL_SECTIONS);
  });

  it("does not mount hidden sections, so they stop querying", () => {
    mocks.settings = {
      hiddenAuthSections: ["github_copilot", "workbuddy_account"],
    };
    render(<AuthCenterPanel />, { wrapper });
    expect(renderedSections()).toEqual([
      "claude",
      "codex",
      "xai",
      "kimi",
      "dsh",
      "agy",
    ]);
    // 不为隐藏的分组另查状态（WorkBuddy 原来每 5 秒查一次）
    expect(mocks.authGetStatus).not.toHaveBeenCalled();
  });

  it("shows a hidden section while another page targets it, without saving it", () => {
    mocks.settings = { hiddenAuthSections: ["codex_oauth"] };
    const { container, rerender } = renderInPanel();
    expect(
      container.querySelector('[data-testid="codex"]'),
    ).toBeInTheDocument();

    // 定位照常：目标组临时显示后跟着对齐
    placeCodexAt(container, () => 600);
    resizeCallbacks.forEach((callback) => callback());
    expect(container.scrollTop).toBe(584);

    // 不再指向它（比如关掉全屏页后在侧栏打开）就按设置隐藏
    rerender(<AuthCenterPanel authScrollTarget={null} />);
    expect(
      container.querySelector('[data-testid="codex"]'),
    ).not.toBeInTheDocument();
    expect(mocks.settings.hiddenAuthSections).toEqual(["codex_oauth"]);
  });

  it("keeps showing a hidden section whose account needs signing in again", () => {
    mocks.settings = { hiddenAuthSections: ["github_copilot", "xai_oauth"] };
    queryClient.setQueryData(["managed-auth-status", "github_copilot"], {
      provider: "github_copilot",
      authenticated: true,
      default_account_id: "a",
      accounts: [{ id: "a", requires_reauth: true }],
    });
    queryClient.setQueryData(["managed-auth-status", "xai_oauth"], {
      provider: "xai_oauth",
      authenticated: true,
      default_account_id: "b",
      accounts: [{ id: "b", requires_reauth: false }],
    });
    render(<AuthCenterPanel />, { wrapper });

    // 侧栏正为 Copilot 提醒「要重新登录」，这里不能藏；xAI 的账号没问题，照设置隐藏
    expect(screen.getByTestId("copilot")).toBeInTheDocument();
    expect(screen.queryByTestId("xai")).not.toBeInTheDocument();
    expect(mocks.authGetStatus).not.toHaveBeenCalled();
  });

  it("leaves Antigravity out where agy logins can't be switched, even when targeted", () => {
    mocks.canSwitchAgy = false;
    const { container } = renderInPanel(
      <AuthCenterPanel authScrollTarget="agy_oauth" />,
    );
    expect(
      container.querySelector('[data-testid="agy"]'),
    ).not.toBeInTheDocument();
    expect(container.scrollTop).toBe(0);
  });
});
