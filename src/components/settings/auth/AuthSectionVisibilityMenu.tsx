import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { Check, ChevronDown, Eye } from "lucide-react";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DSH_ACCOUNT_STATUS_KEY } from "@/components/providers/DshAccount";
import { KIMI_OAUTH_STATUS_KEY } from "@/components/providers/forms/hooks/useKimiOAuth";
import { useSettings } from "@/hooks/useSettings";
import { authApi, type AuthCenterTarget } from "@/lib/api";
import { dshApi } from "@/lib/api/dsh";
import { kimiOAuthApi } from "@/lib/api/kimiOAuth";
import { cn } from "@/lib/utils";
import {
  AUTH_SECTION_IDS,
  AUTH_SECTION_NAMES,
  hiddenAuthSectionSet,
  isAuthSectionAvailable,
  isManagedAuthSection,
  managedAuthStatusKey,
} from "./authSections";

/** 和 ChecklistMenu（请求日志「显示的列」）的菜单项一个样子 */
const itemClass = "h-[30px] gap-2 rounded-control px-2 text-body";

/**
 * 这一组现在有几个账号。和各组用同一份查询缓存：分组正显示着时直接读缓存，不另发请求。
 */
async function countSectionAccounts(
  queryClient: QueryClient,
  id: AuthCenterTarget,
): Promise<number> {
  if (id === "kimi_oauth") {
    const status = await queryClient.ensureQueryData({
      queryKey: KIMI_OAUTH_STATUS_KEY,
      queryFn: kimiOAuthApi.status,
    });
    return status.accounts.length;
  }
  if (id === "dsh_account") {
    const status = await queryClient.ensureQueryData({
      queryKey: DSH_ACCOUNT_STATUS_KEY,
      queryFn: dshApi.accountStatus,
    });
    return status.signedIn ? 1 : 0;
  }
  if (!isManagedAuthSection(id)) return 0;
  const status = await queryClient.ensureQueryData({
    queryKey: managedAuthStatusKey(id),
    queryFn: () => authApi.authGetStatus(id),
  });
  return status.accounts.length;
}

/**
 * 授权中心页头的「显示的服务」：勾掉不用的服务，它在授权中心里就不显示、也不再查状态。
 * 勾选清单的样子和请求日志「显示的列」（ChecklistMenu）一致：勾一项菜单不关，可以接着勾。
 * 保存照「应用」页的显示开关：先改界面再自动保存，保存失败改回来；至少留一组。
 * 只是不显示：账号不退出、不删除，用到它们的供应商照常工作；还有账号的分组隐藏前先确认
 * （这里自己控制菜单开合，是为了先收起菜单再弹确认，免得两个弹层抢焦点）。
 */
export function AuthSectionVisibilityMenu() {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { settings, updateSettings, autoSaveSettings } = useSettings();
  const [open, setOpen] = useState(false);
  const [pendingHide, setPendingHide] = useState<{
    id: AuthCenterTarget;
    count: number;
  } | null>(null);

  // 原样保留不认识的 ID（更新版本里才有的分组），回到新版本时它们仍是隐藏的
  const hiddenList = settings?.hiddenAuthSections ?? [];
  const hidden = hiddenAuthSectionSet(hiddenList);
  // 数账号要等一下，等回来时用最新的名单，不用点击那一刻的
  const hiddenListRef = useRef(hiddenList);
  hiddenListRef.current = hiddenList;

  const available = AUTH_SECTION_IDS.filter(isAuthSectionAvailable);
  const hiddenCount = available.filter((id) => hidden.has(id)).length;
  const shownCount = available.length - hiddenCount;
  const label = t("authCenter.sections.menu", { defaultValue: "显示的服务" });

  const save = (next: string[]) => {
    if (!settings) return;
    const previous = settings.hiddenAuthSections;
    updateSettings({ hiddenAuthSections: next });
    void autoSaveSettings({ hiddenAuthSections: next }).catch(() =>
      updateSettings({ hiddenAuthSections: previous }),
    );
  };

  const hide = (id: AuthCenterTarget) =>
    save([...hiddenListRef.current.filter((item) => item !== id), id]);

  const show = (id: AuthCenterTarget) =>
    save(hiddenListRef.current.filter((item) => item !== id));

  const requestHide = async (id: AuthCenterTarget) => {
    // 至少留一组，免得整页只剩一个开关
    if (shownCount <= 1) return;
    let count = 0;
    try {
      count = await countSectionAccounts(queryClient, id);
    } catch (error) {
      // 查不到账号也照样隐藏：隐藏不动账号，随时能勾回来
      console.debug("[AuthCenter] Failed to count accounts:", error);
    }
    if (count > 0) {
      setOpen(false);
      setPendingHide({ id, count });
      return;
    }
    hide(id);
  };

  return (
    <>
      <DropdownMenu open={open} onOpenChange={setOpen}>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="quiet"
            size="regular"
            disabled={!settings}
          >
            <Eye className="h-4 w-4" strokeWidth={2} />
            {label}
            {hiddenCount > 0 && (
              <span className="text-caption text-fg-2">
                {t("authCenter.sections.hiddenCount", {
                  defaultValue: "已隐藏 {{count}}",
                  count: hiddenCount,
                })}
              </span>
            )}
            <ChevronDown aria-hidden="true" className="h-4 w-4 opacity-50" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          aria-label={label}
          className="min-w-[192px] max-w-[320px] rounded-panel border-border bg-surface p-1 shadow-v7-md"
        >
          {available.map((id) => {
            const shown = !hidden.has(id);
            return (
              <DropdownMenuItem
                key={id}
                role="menuitemcheckbox"
                aria-checked={shown}
                disabled={shown && shownCount <= 1}
                className={itemClass}
                onSelect={(event) => {
                  event.preventDefault();
                  if (shown) void requestHide(id);
                  else show(id);
                }}
              >
                <Check
                  aria-hidden="true"
                  strokeWidth={1.75}
                  className={cn("h-3.5 w-3.5 shrink-0", !shown && "invisible")}
                />
                {AUTH_SECTION_NAMES[id]}
              </DropdownMenuItem>
            );
          })}
          <DropdownMenuSeparator />
          <p className="m-0 px-2 py-1 text-caption text-fg-3">
            {t("authCenter.sections.menuHint", {
              defaultValue: "只影响这一页的显示，不会退出或删除账号。",
            })}
          </p>
          {hiddenCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                className={itemClass}
                onSelect={(event) => {
                  event.preventDefault();
                  save([]);
                }}
              >
                <span aria-hidden="true" className="w-3.5 shrink-0" />
                {t("authCenter.sections.showAll", {
                  defaultValue: "全部显示",
                })}
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <ConfirmDialog
        isOpen={pendingHide !== null}
        variant="info"
        title={t("authCenter.sections.confirmHideTitle", {
          defaultValue: "隐藏 {{name}}？",
          name: pendingHide ? AUTH_SECTION_NAMES[pendingHide.id] : "",
        })}
        message={t("authCenter.sections.confirmHideMessage", {
          defaultValue:
            "{{name}} 里还有 {{count}} 个账号。隐藏后账号照常保留，用到它们的供应商不受影响；从供应商表单跳过来时会临时显示，也可以随时在「显示的服务」里勾回来。",
          name: pendingHide ? AUTH_SECTION_NAMES[pendingHide.id] : "",
          count: pendingHide?.count ?? 0,
        })}
        confirmText={t("authCenter.sections.confirmHide", {
          defaultValue: "隐藏",
        })}
        onConfirm={() => {
          if (pendingHide) hide(pendingHide.id);
          setPendingHide(null);
        }}
        onCancel={() => setPendingHide(null)}
      />
    </>
  );
}
