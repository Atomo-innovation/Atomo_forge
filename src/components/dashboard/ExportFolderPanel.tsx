import { useCallback, useEffect, useState, type MouseEvent } from "react";
import { FolderOpen } from "lucide-react";
import { toast } from "sonner";
import {
  EXPORT_FOLDER_LINK_CHANGED,
  type ExportFolderLinkChangedDetail,
  type ExportWorkspaceId,
  canUseBrowserFolderPicker,
  clearExportRootDirectoryHandle,
  loadExportRootDirectoryHandle,
  pickAndLinkExportFolder,
} from "@/services/detectionFolderExport";
import {
  clearServerExportFolder,
  fetchServerExportAvailable,
  getServerExportPath,
  pickServerExportFolder,
} from "@/services/detectionExportServer";
import { cn } from "@/lib/utils";

type Props = {
  workspaceId: ExportWorkspaceId;
  workspaceTitle: string;
};

const btnBase =
  "relative z-10 pointer-events-auto flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors cursor-pointer shrink-0";

const ExportFolderPanel = ({ workspaceId, workspaceTitle }: Props) => {
  const [browserLinked, setBrowserLinked] = useState(false);
  const [serverLinked, setServerLinked] = useState(false);
  const [serverOk, setServerOk] = useState(false);
  const [folderMsg, setFolderMsg] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const browserPicker = canUseBrowserFolderPicker();

  const refresh = useCallback(async () => {
    const [handle, path, serverAvailable] = await Promise.all([
      loadExportRootDirectoryHandle(workspaceId),
      getServerExportPath(workspaceId),
      fetchServerExportAvailable(),
    ]);
    setBrowserLinked(Boolean(handle));
    setServerLinked(Boolean(path));
    setServerOk(serverAvailable);
  }, [workspaceId]);

  useEffect(() => {
    void refresh();
    const onLink = (e: Event) => {
      const detail = (e as CustomEvent<ExportFolderLinkChangedDetail>).detail;
      if (detail?.workspaceId && detail.workspaceId !== workspaceId) return;
      void refresh();
    };
    window.addEventListener(EXPORT_FOLDER_LINK_CHANGED, onLink as EventListener);
    return () => window.removeEventListener(EXPORT_FOLDER_LINK_CHANGED, onLink as EventListener);
  }, [workspaceId, refresh]);

  const linked = browserLinked || serverLinked;

  const runServerPick = () => {
    setFolderMsg(null);
    setPicking(true);
    void pickServerExportFolder(workspaceId, `${workspaceTitle} — select export folder`).then((r) => {
      setPicking(false);
      if (r.ok) {
        toast.success(`${workspaceTitle}: folder selected`);
        void refresh();
        return;
      }
      if (r.aborted) return;
      const err = r.error ?? "Could not open folder picker";
      setFolderMsg(err);
      toast.error(err);
    });
  };

  const runBrowserPick = () => {
    setFolderMsg(null);
    setPicking(true);
    void pickAndLinkExportFolder(workspaceId).then((r) => {
      setPicking(false);
      if (r.ok) {
        toast.success(`${workspaceTitle}: folder selected`);
        void refresh();
        return;
      }
      if (r.aborted) return;
      if (serverOk) {
        runServerPick();
        return;
      }
      const err = r.error ?? "Could not open folder picker";
      setFolderMsg(err);
      toast.error(err);
    });
  };

  const onSelectFolder = (e: MouseEvent) => {
    e.stopPropagation();
    setPicking(true);
    if (browserPicker) {
      runBrowserPick();
      return;
    }
    if (serverOk) {
      runServerPick();
      return;
    }
    setPicking(false);
    toast.error("Restart npm run dev", {
      description: "Auth-server must reload to open the folder dialog.",
    });
  };

  const onUnlink = (e: MouseEvent) => {
    e.stopPropagation();
    setFolderMsg(null);
    void Promise.all([
      clearExportRootDirectoryHandle(workspaceId),
      clearServerExportFolder(workspaceId),
    ]).then(() => {
      toast.message(`${workspaceTitle}: folder cleared`);
      void refresh();
    });
  };

  const pickLabel = picking ? "Opening…" : linked ? "Change folder" : "Select folder";

  return (
    <div className="relative z-10 flex flex-col items-end gap-1 pointer-events-auto">
      <div className="flex flex-wrap items-center justify-end gap-2">
        {linked ? (
          <span className="text-xs font-medium text-success whitespace-nowrap">Folder linked</span>
        ) : null}
        <button
          type="button"
          disabled={picking}
          onClick={onSelectFolder}
          className={cn(
            btnBase,
            linked
              ? "border border-border bg-card hover:bg-muted text-foreground"
              : "bg-primary text-primary-foreground hover:opacity-90 shadow-sm",
          )}
        >
          <FolderOpen className="w-3.5 h-3.5" />
          {pickLabel}
        </button>
        {linked ? (
          <button
            type="button"
            onClick={onUnlink}
            className={cn(btnBase, "border border-destructive/40 text-destructive hover:bg-destructive/10")}
          >
            Unlink
          </button>
        ) : null}
      </div>
      {folderMsg ? <p className="text-[11px] text-destructive text-right max-w-[260px]">{folderMsg}</p> : null}
    </div>
  );
};

export default ExportFolderPanel;
