import { useEffect, useId, useMemo, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useQueries } from "@tanstack/react-query";
import { CopilotAuthSection } from "@/components/providers/forms/CopilotAuthSection";
import { CodexOAuthSection } from "@/components/providers/forms/CodexOAuthSection";
import { XaiOAuthSection } from "@/components/providers/forms/XaiOAuthSection";
import { AgyOAuthSection } from "@/components/providers/forms/AgyOAuthSection";
import { ClaudeOfficialSection } from "@/components/providers/forms/ClaudeOfficialSection";
import { KimiAccountLogin } from "@/components/providers/KimiAccountLogin";
import { DshAccountLogin } from "@/components/providers/DshAccount";
import { WorkBuddyAccountSection } from "@/components/settings/auth/WorkBuddyAccountSection";
import {
  AUTH_SECTION_IDS,
  isManagedAuthSection,
  managedAuthStatusKey,
  managedStatusNeedsReauth,
  useHiddenAuthSections,
  visibleAuthSectionIds,
} from "@/components/settings/auth/authSections";
import { Switch } from "@/components/ui/switch";
import { useAuthOpenBrowser, writeAuthOpenBrowser } from "@/lib/authLoginLink";
import { authApi } from "@/lib/api";
import type { AuthCenterTarget, ManagedAuthProvider } from "@/lib/api";

interface AuthCenterPanelProps {
  authScrollTarget?: AuthCenterTarget | null;
  /**
   * 页头没有「?」说明时（供应商表单里打开的全屏「授权中心」）在最上面写一行说明；
   * 侧栏「授权中心」页的页头已经有了，就不再显示。
   */
  showIntro?: boolean;
}

/**
 * 「登录时自动打开浏览器」：所有服务的登录共用。关掉后只复制登录链接，用户自己选浏览器打开
 * （用独立浏览器环境管多个账号时，不让登录混进系统默认浏览器）。
 */
function OpenBrowserToggle() {
  const { t } = useTranslation();
  const openBrowser = useAuthOpenBrowser();
  const titleId = useId();
  const descriptionId = useId();
  return (
    <div className="flex shrink-0 items-center gap-4 rounded-panel border border-border bg-surface py-3 pe-4 ps-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p id={titleId} className="m-0 text-body font-medium text-fg-1">
          {t("authCenter.openBrowser.title", {
            defaultValue: "登录时自动打开浏览器",
          })}
        </p>
        <p id={descriptionId} className="m-0 text-caption text-fg-2">
          {t("authCenter.openBrowser.description", {
            defaultValue:
              "关掉后只复制登录链接，由你自己选浏览器打开，适合用独立的浏览器环境管理多个账号。",
          })}
        </p>
      </div>
      <Switch
        checked={openBrowser}
        onCheckedChange={writeAuthOpenBrowser}
        aria-labelledby={titleId}
        aria-describedby={descriptionId}
      />
    </div>
  );
}

type HelpSide = "top" | "bottom";

/**
 * 各组怎么画。传进来的 `helpSide` 只在这一组是页面上最后一组时给（"top"，免得说明气泡
 * 贴着页面底部被裁掉）；其余时候用各组原来的方向。
 */
const AUTH_SECTION_RENDERERS: Record<
  AuthCenterTarget,
  (helpSide?: HelpSide) => ReactNode
> = {
  claude_official: (side = "bottom") => (
    <ClaudeOfficialSection helpSide={side} />
  ),
  github_copilot: (side) => <CopilotAuthSection helpSide={side} />,
  codex_oauth: (side) => <CodexOAuthSection showAccountQuota helpSide={side} />,
  xai_oauth: (side = "bottom") => (
    <XaiOAuthSection mode="manage" helpSide={side} />
  ),
  kimi_oauth: (side = "bottom") => <KimiAccountLogin helpSide={side} />,
  dsh_account: (side = "bottom") => <DshAccountLogin helpSide={side} />,
  agy_oauth: (side = "bottom") => <AgyOAuthSection helpSide={side} />,
  workbuddy_account: () => <WorkBuddyAccountSection helpSide="top" />,
};

/**
 * 隐藏的托管账号组里有没有要重新登录的账号。只读已有缓存（侧栏一直在查 Copilot、ChatGPT、
 * xAI 的状态），不为隐藏的分组发请求：隐藏就是不想再让它在后台查。
 */
function useHiddenSectionsNeedingAttention(
  hidden: ReadonlySet<AuthCenterTarget>,
): ReadonlySet<AuthCenterTarget> {
  const providers = AUTH_SECTION_IDS.filter(
    (id): id is ManagedAuthProvider =>
      hidden.has(id) && isManagedAuthSection(id),
  );
  const statuses = useQueries({
    queries: providers.map((provider) => ({
      queryKey: managedAuthStatusKey(provider),
      queryFn: () => authApi.authGetStatus(provider),
      enabled: false,
    })),
  });
  const key = providers
    .filter((_, index) => managedStatusNeedsReauth(statuses[index]?.data))
    .join(",");
  return useMemo(
    () => new Set(key ? (key.split(",") as AuthCenterTarget[]) : []),
    [key],
  );
}

/** 定位到某一组时，卡片上沿离正文顶部留的距离 */
const SECTION_SCROLL_MARGIN = 16;

/** 最近的纵向可滚动祖先（FullScreenPanel 的正文） */
function findScrollContainer(element: HTMLElement): HTMLElement | null {
  for (
    let node = element.parentElement;
    node && node !== document.body;
    node = node.parentElement
  ) {
    const { overflowY } = window.getComputedStyle(node);
    if (overflowY === "auto" || overflowY === "scroll") return node;
  }
  return null;
}

/**
 * 授权中心：Claude 官方账号、GitHub Copilot、ChatGPT、xAI、Kimi Code、DeepSeek Harness、WorkBuddy，一组一张卡片；
 * macOS、Windows 上另有 Antigravity 一组（切 agy 的官方登录：macOS 钥匙串、Windows 凭据管理器）。
 * WorkBuddy 收录桌面端登录的快照再切换（macOS 已确认路径，Windows / Linux 按推断路径）。
 * 侧栏的「授权中心」页和供应商表单里「管理账号」打开的全屏页共用。
 *
 * 用户可以在页头「显示的服务」里隐藏不用的分组（设置 `hiddenAuthSections`）。隐藏的分组不挂载，
 * 也就不再查状态、不再轮询；账号和用到它们的供应商都不受影响。
 */
export function AuthCenterPanel({
  authScrollTarget,
  showIntro = true,
}: AuthCenterPanelProps) {
  const { t } = useTranslation();
  const rootRef = useRef<HTMLDivElement | null>(null);
  const sectionRefs = useRef(new Map<AuthCenterTarget, HTMLDivElement>());
  const hidden = useHiddenAuthSections();
  const needsAttention = useHiddenSectionsNeedingAttention(hidden);
  const sections = visibleAuthSectionIds({
    hidden,
    scrollTarget: authScrollTarget,
    needsAttention,
  });

  useEffect(() => {
    if (!authScrollTarget) return;
    const root = rootRef.current;
    if (!root) return;

    // 目标组这台机器上没有（比如 Linux 上的 Antigravity）时找不到，不滚动
    const target = sectionRefs.current.get(authScrollTarget);
    const container = findScrollContainer(root);
    if (!target || !container) return;

    // 不用 scrollIntoView：面板滑入时目标还在右侧视口外，它会连带滚动外壳里
    // overflow-hidden 的 #content-area，把整块内容区横向/纵向带偏。只滚面板自己的正文。
    // 上面几组的账号是异步加载的，加载完会把目标挤下去：内容尺寸变化时重新对齐，
    // 直到用户自己滚动或操作。
    // 对齐期间关掉正文的滚动锚定：否则上方分组变高时浏览器（Chromium / WebView2）
    // 会自己改 scrollTop，被下面当成用户拖了滚动条而提前停止跟随。
    const previousOverflowAnchor = container.style.overflowAnchor;
    container.style.overflowAnchor = "none";
    const inputListeners = new AbortController();
    let resizeObserver: ResizeObserver | undefined;
    let frame = 0;
    let expectedTop: number | null = null;
    const stopPinning = () => {
      cancelAnimationFrame(frame);
      resizeObserver?.disconnect();
      inputListeners.abort();
      container.style.overflowAnchor = previousOverflowAnchor;
    };
    const alignTarget = () => {
      // 位置已被外部改变（比如拖滚动条）：让出控制
      if (expectedTop !== null && container.scrollTop !== expectedTop) {
        stopPinning();
        return;
      }
      const viewportTop =
        container.getBoundingClientRect().top + container.clientTop;
      const delta =
        target.getBoundingClientRect().top -
        viewportTop -
        SECTION_SCROLL_MARGIN;
      container.scrollTop = Math.max(
        0,
        Math.min(
          container.scrollTop + delta,
          container.scrollHeight - container.clientHeight,
        ),
      );
      expectedTop = container.scrollTop;
    };

    const inputOptions = {
      capture: true,
      passive: true,
      signal: inputListeners.signal,
    };
    for (const event of ["wheel", "touchstart", "pointerdown"]) {
      container.addEventListener(event, stopPinning, inputOptions);
    }
    window.addEventListener("keydown", stopPinning, inputOptions);

    frame = requestAnimationFrame(() => {
      alignTarget();
      if (
        inputListeners.signal.aborted ||
        typeof ResizeObserver === "undefined"
      )
        return;
      resizeObserver = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(alignTarget);
      });
      resizeObserver.observe(root);
    });

    return stopPinning;
  }, [authScrollTarget]);

  return (
    <div ref={rootRef} className="flex flex-col gap-3">
      {showIntro && (
        <p className="m-0 max-w-[700px] text-caption text-fg-2">
          {t("settings.authCenter.description")}
        </p>
      )}
      <OpenBrowserToggle />
      {sections.map((id, index) => (
        <div
          key={id}
          data-auth-section={id}
          ref={(element) => {
            if (element) sectionRefs.current.set(id, element);
            else sectionRefs.current.delete(id);
          }}
        >
          {AUTH_SECTION_RENDERERS[id](
            index === sections.length - 1 ? "top" : undefined,
          )}
        </div>
      ))}
    </div>
  );
}
