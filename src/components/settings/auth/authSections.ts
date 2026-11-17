import { useMemo } from "react";
import type {
  AuthCenterTarget,
  ManagedAuthProvider,
  ManagedAuthStatus,
} from "@/lib/api";
import { canSwitchAgyAccount } from "@/lib/authBinding";
import { useSettingsQuery } from "@/lib/query";

/**
 * 授权中心的分组：顺序就是页面上的顺序。ID 直接用 `AuthCenterTarget`，
 * 「显示哪些服务」的设置和别的页面跳过来定位（`authScrollTarget`）共用一套 ID。
 */
export const AUTH_SECTION_IDS = [
  "claude_official",
  "github_copilot",
  "codex_oauth",
  "xai_oauth",
  "kimi_oauth",
  "dsh_account",
  "agy_oauth",
  "workbuddy_account",
] as const satisfies readonly AuthCenterTarget[];

/**
 * 各组的服务名（和各组卡片标题一致，品牌名不翻译）。写成 Record：`AuthCenterTarget`
 * 新增一组而这里没登记时类型检查不过，免得新分组在「显示的服务」里漏掉。
 */
export const AUTH_SECTION_NAMES: Record<AuthCenterTarget, string> = {
  claude_official: "Claude",
  github_copilot: "GitHub Copilot",
  codex_oauth: "ChatGPT",
  xai_oauth: "xAI",
  kimi_oauth: "Kimi Code",
  dsh_account: "DeepSeek Harness",
  agy_oauth: "Antigravity",
  workbuddy_account: "WorkBuddy",
};

// 编译期检查：AUTH_SECTION_IDS 要列全 AuthCenterTarget（少列一个这里就报错）
type MissingAuthSection = Exclude<
  AuthCenterTarget,
  (typeof AUTH_SECTION_IDS)[number]
>;
const _allAuthSectionsListed: [MissingAuthSection] extends [never]
  ? true
  : MissingAuthSection = true;
void _allAuthSectionsListed;

const AUTH_SECTION_ID_SET: ReadonlySet<string> = new Set(AUTH_SECTION_IDS);

export function isAuthSectionId(id: string): id is AuthCenterTarget {
  return AUTH_SECTION_ID_SET.has(id);
}

/** 这台机器上有没有这一组：Antigravity 只在能切 agy 登录的平台上有，和隐藏设置无关。 */
export function isAuthSectionAvailable(id: AuthCenterTarget): boolean {
  return id === "agy_oauth" ? canSwitchAgyAccount() : true;
}

/** 走 `auth_get_status` 的托管账号组（Kimi Code、DeepSeek Harness 各有自己的状态接口）。 */
export function isManagedAuthSection(
  id: AuthCenterTarget,
): id is ManagedAuthProvider {
  return id !== "kimi_oauth" && id !== "dsh_account";
}

/** 各托管账号组状态的查询键，授权中心各组、侧栏提醒共用这一份缓存。 */
export function managedAuthStatusKey(provider: ManagedAuthProvider) {
  return ["managed-auth-status", provider] as const;
}

/** 这一组有没有要重新登录的账号；侧栏「授权中心」的提醒也按这个算。 */
export function managedStatusNeedsReauth(
  status: ManagedAuthStatus | undefined,
): boolean {
  return (
    status?.accounts.some(
      (account) => account.requires_reauth || account.reauth_required === true,
    ) ?? false
  );
}

/**
 * 设置里的 `hiddenAuthSections` → 隐藏的分组。缺省或空 = 全部显示（老配置升级后界面不变）；
 * 不认识的 ID（更新版本里才有的分组）忽略，但保存时原样保留。
 */
export function hiddenAuthSectionSet(
  list: readonly string[] | undefined,
): ReadonlySet<AuthCenterTarget> {
  return new Set((list ?? []).filter(isAuthSectionId));
}

/** 读设置里隐藏的分组（和侧栏读 `visibleApps` 一样直接用设置查询）。 */
export function useHiddenAuthSections(): ReadonlySet<AuthCenterTarget> {
  const { data } = useSettingsQuery();
  const list = data?.hiddenAuthSections;
  return useMemo(() => hiddenAuthSectionSet(list), [list]);
}

/**
 * 授权中心这次要画哪些分组（按页面顺序）。隐藏的分组在两种情况下照样显示，都不写回设置：
 * - 别的页面带着 `scrollTarget` 跳过来定位到它（比如供应商表单的「管理账号」），否则跳过来是空的；
 * - 它有账号要重新登录（`needsAttention`）：侧栏正为它提醒，藏起来就找不到要处理的地方。
 */
export function visibleAuthSectionIds({
  hidden,
  scrollTarget,
  needsAttention,
}: {
  hidden: ReadonlySet<AuthCenterTarget>;
  scrollTarget?: AuthCenterTarget | null;
  needsAttention?: ReadonlySet<AuthCenterTarget>;
}): AuthCenterTarget[] {
  return AUTH_SECTION_IDS.filter(
    (id) =>
      isAuthSectionAvailable(id) &&
      (!hidden.has(id) ||
        id === scrollTarget ||
        (needsAttention?.has(id) ?? false)),
  );
}
