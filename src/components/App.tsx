import { useEffect, useState } from "react";
import { useStore } from "../app/store";
import { settingsStore } from "../app/settings";
import { closeSettings, init, openSettings, syncAll, ui } from "../app/controller";
import { platform } from "../app/platform";
import { HomeView } from "./HomeView";
import { SearchView } from "./SearchView";
import { SettingsView } from "./SettingsView";
import { Toast } from "./Toast";

function useTheme(): "light" | "dark" {
  const { theme } = useStore(settingsStore);
  const [systemDark, setSystemDark] = useState(
    () => typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches,
  );
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    if (!mq) return;
    const on = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return theme === "auto" ? (systemDark ? "dark" : "light") : theme;
}

let started = false;

export default function App() {
  const s = useStore(ui);
  const theme = useTheme();

  useEffect(() => {
    if (started) return;
    started = true;
    void init();
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === ",") {
        e.preventDefault();
        if (ui.get().mode === "settings") closeSettings();
        else openSettings();
      } else if ((e.ctrlKey && e.key.toLowerCase() === "r") || e.key === "F5") {
        e.preventDefault();
        void syncAll(e.shiftKey);
      } else if (e.key === "Escape" && ui.get().mode === "settings") {
        e.preventDefault();
        closeSettings();
      }
    };
    const onContext = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!platform.demo && !(t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement)) e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("contextmenu", onContext);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("contextmenu", onContext);
    };
  }, []);

  return (
    <div className="shell" data-mode={s.mode}>
      {s.mode === "settings" ? <SettingsView /> : s.mode === "home" ? <HomeView /> : <SearchView />}
      <Toast />
    </div>
  );
}
