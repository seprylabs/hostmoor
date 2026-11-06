import { useCallback, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type Update } from "@tauri-apps/plugin-updater";
import i18n from "i18next";
import { toast } from "sonner";

/** Delay before the automatic check, so it doesn't compete with loading the data */
const STARTUP_DELAY_MS = 5000;

export interface Updater {
  /** Available update, null = none found or dismissed */
  update: Update | null;
  checking: boolean;
  /** Download progress in percent while installing, null = not installing */
  progress: number | null;
  /** Manual check from the menu; reports "up to date" and errors */
  check: () => void;
  install: () => Promise<void>;
  dismiss: () => void;
}

export function useUpdater(): Updater {
  const [update, setUpdate] = useState<Update | null>(null);
  const [checking, setChecking] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);

  // i18n.t instead of useTranslation: a language switch must not trigger another check
  const runCheck = useCallback(async (manual: boolean) => {
    if (!isTauri()) {
      if (manual) toast.info(i18n.t("update.browserOnly"));
      return;
    }
    setChecking(true);
    try {
      const found = await check();
      if (found) setUpdate(found);
      else if (manual) toast.success(i18n.t("update.upToDate", { version: await getVersion() }));
    } catch (e) {
      // Being offline at startup is normal; only report errors of a manual check
      if (manual) toast.error(i18n.t("update.checkFailed"), { description: String(e) });
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void runCheck(false), STARTUP_DELAY_MS);
    return () => clearTimeout(timer);
  }, [runCheck]);

  const install = async () => {
    if (!update) return;
    let total = 0;
    let done = 0;
    setProgress(0);
    try {
      await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        else if (event.event === "Progress") {
          done += event.data.chunkLength;
          if (total > 0) setProgress(Math.min(100, Math.round((done / total) * 100)));
        }
      });
      // On Windows the installer has already quit the app at this point
      await relaunch();
    } catch (e) {
      setProgress(null);
      toast.error(i18n.t("update.installFailed"), { description: String(e) });
    }
  };

  const dismiss = () => {
    if (progress !== null) return;
    void update?.close();
    setUpdate(null);
  };

  return { update, checking, progress, check: () => void runCheck(true), install, dismiss };
}
