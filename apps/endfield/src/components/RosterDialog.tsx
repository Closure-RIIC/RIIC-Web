import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ComponentPropsWithRef, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { Dialog } from "@base-ui/react/dialog";
import { Download, RotateCcw } from "lucide-react";
import { Action, ActionContent, actionClassName } from "@riic/endfield-ui";
import { downloadJson, useWorkspace } from "../state";
import { DialogFrame } from "./DialogFrame";
import { restoreSklandRoster } from "../skland-workspace";

const RosterContent = lazy(() => import("./RosterPage").then(module => ({ default: module.RosterPage })));
const RosterDialogContext = createContext<{ openRoster: (trigger?: HTMLElement) => void; rosterOpen: boolean } | null>(null);

export function useRosterDialog() {
  const context = useContext(RosterDialogContext);
  if (!context) throw new Error("RosterDialogProvider is required");
  return context;
}

export function RosterDialogTrigger({ onClick, ...props }: ComponentPropsWithRef<"button">) {
  const { openRoster } = useRosterDialog();
  return <button {...props} type="button" aria-haspopup="dialog" onClick={event => {
    onClick?.(event);
    if (!event.defaultPrevented) openRoster(event.currentTarget);
  }} />;
}

export function RosterDialogProvider({ children }: { children: ReactNode }) {
  const { workspace, update, ready, t } = useWorkspace();
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLElement | null>(null);
  const close = useRef<HTMLButtonElement | null>(null);
  const navigate = useNavigate();
  const legacyRequest = useRouterState({ select: state => state.location.search.roster === true });
  const openRoster = useCallback((element?: HTMLElement) => {
    trigger.current = element ?? null;
    setOpen(true);
  }, []);
  const context = useMemo(() => ({ openRoster, rosterOpen: open }), [openRoster, open]);

  useEffect(() => {
    if (!legacyRequest) return;
    openRoster();
    void navigate({ to: ".", search: previous => ({ ...previous, roster: undefined }), replace: true, resetScroll: false });
  }, [legacyRequest, navigate, openRoster]);

  return <RosterDialogContext.Provider value={context}>
    {children}
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Portal>
        <Dialog.Backdrop className="ef-dialog-backdrop" />
        <DialogFrame className="ef-roster-dialog" bodyClassName="ef-roster-dialog-body" closeRef={close} initialFocus={close}
          title={t("我的干员", "My operators")} closeLabel={t("关闭我的干员", "Close my operators")}
          description={t("勾选已拥有的干员并设置精英化阶段，修改会自动保存。", "Select your operators and elite stages. Changes are saved automatically.")}
          footer={<>
            <Action size="sm" icon={<RotateCcw />} disabled={!ready || !workspace.sklandRoster}
              title={workspace.sklandRoster ? t("恢复最近同步的干员、精英化与技能，保留设施设置。", "Restore the last synced operators, elite stages and skills; keep facility settings.") : t("请先前往森空岛完成一次完整同步。", "Complete a full Skland sync first.")}
              onClick={() => update(restoreSklandRoster)}>{t("恢复森空岛数据", "Restore Skland data")}</Action>
            <Action size="sm" variant="dark" icon={<Download />} disabled={!ready} onClick={() => downloadJson("endfield-roster.json", { operators: workspace.operators })}>{t("导出名单", "Export roster")}</Action>
            <Dialog.Close className={actionClassName({ size: "sm", variant: "yellow" })}><ActionContent>{t("完成", "Done")}</ActionContent></Dialog.Close>
          </>} finalFocus={() => {
          if (trigger.current?.isConnected && trigger.current.getClientRects().length) return trigger.current;
          return document.querySelector<HTMLElement>("[data-endfield-mobile-navigation]")?.getClientRects().length
            ? document.querySelector<HTMLElement>("[data-endfield-mobile-navigation]")
            : document.querySelector<HTMLElement>("[data-roster-edit]");
        }}>
            <Suspense fallback={<p className="ef-muted" role="status">{t("正在加载干员…", "Loading operators…")}</p>}>
              {open ? <RosterContent embedded /> : null}
            </Suspense>
        </DialogFrame>
      </Dialog.Portal>
    </Dialog.Root>
  </RosterDialogContext.Provider>;
}
