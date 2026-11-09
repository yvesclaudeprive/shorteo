import { dragHandle } from "../app/drag";
import { useEffect, useRef, type KeyboardEvent } from "react";
import { History } from "lucide-react";
import { useStore } from "../app/store";
import { settingsStore } from "../app/settings";
import { openItem, openSettings, setSource, ui } from "../app/controller";
import { recentItems } from "../app/usage";
import { getIndex, indexVersion } from "../app/index-store";
import { relativeDate } from "../app/format";
import { platform } from "../app/platform";
import { BAR_ORDER, SOURCES, sourceLabel } from "../sources/registry";
import type { SourceId } from "../sources/types";
import { ItemIcon, SourceTile, ShorteoLogo } from "./icons";
import { TopActions } from "./TopBar";

const UNITS: Partial<Record<SourceId, string>> = {
  notion: "pages",
  drive: "fichiers",
  pipedrive: "fiches",
  chatgpt: "conversations",
  claude: "conversations",
};

/** Petit indicateur d'état sous forme de chiffre (éléments indexés). */
function barMeta(id: SourceId): string | null {
  if (id === "all") return null;
  if (id === "mail") {
    const n = (getIndex("contacts").meta.list?.length as number | undefined) ?? 0;
    return n ? `${n.toLocaleString("fr-FR")} contacts` : "en direct";
  }
  const n = getIndex(id).items.length;
  return n ? `${n.toLocaleString("fr-FR")} ${UNITS[id]}` : null;
}

const PLACEHOLDERS: Record<SourceId, string> = {
  all: "Rechercher partout…",
  notion: "Pages, bases…",
  drive: "Fichiers, dossiers…",
  pipedrive: "Affaires, contacts…",
  mail: "Mails, contacts…",
  chatgpt: "Demander à ChatGPT…",
  claude: "Demander à Claude…",
};

export function HomeView() {
  const s = useStore(ui);
  useStore(settingsStore);
  useStore(indexVersion);
  const recents = recentItems(5);
  const refs = useRef<Array<HTMLElement | null>>([]);
  const total = BAR_ORDER.length + recents.length;

  useEffect(() => {
    const focus = () => refs.current[ui.get().homeFocus]?.focus();
    focus();
    window.addEventListener("ys-focus", focus);
    return () => window.removeEventListener("ys-focus", focus);
  }, [s.homeFocus]);

  const move = (delta: number) => {
    const next = Math.min(total - 1, Math.max(0, s.homeFocus + delta));
    ui.set({ homeFocus: next });
  };

  const onKey = (e: KeyboardEvent<HTMLElement>, index: number) => {
    if ((e.altKey || e.ctrlKey) && /^[1-7]$/.test(e.key)) {
      e.preventDefault();
      setSource(BAR_ORDER[Number(e.key) - 1], { query: "" });
      return;
    }
    if (e.key === "ArrowDown" || (e.key === "Tab" && !e.shiftKey)) {
      e.preventDefault();
      move(index === 0 ? 1 : index <= 5 ? 2 : 1);
    } else if (e.key === "ArrowUp" || (e.key === "Tab" && e.shiftKey)) {
      e.preventDefault();
      move(index === 2 || (index >= 3 && index <= 6) ? -2 : -1);
    } else if (e.key === "ArrowRight" && index >= 1 && index <= 6 && index % 2 === 1) {
      const el = e.target as HTMLInputElement;
      if (!el.value) {
        e.preventDefault();
        move(1);
      }
    } else if (e.key === "ArrowLeft" && index >= 2 && index <= 6 && index % 2 === 0) {
      const el = e.target as HTMLInputElement;
      if (!el.value) {
        e.preventDefault();
        move(-1);
      }
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (index < BAR_ORDER.length) setSource(BAR_ORDER[index], { query: "" });
      else {
        const r = recents[index - BAR_ORDER.length];
        if (r) void openItem(r);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      ui.set({ hiddenAt: Date.now() });
      void platform.hide();
    }
  };

  const bar = (id: SourceId, index: number, big = false) => {
    const src = id === "all" ? null : SOURCES[id];
    const needsSetup = src && !src.configured();
    return (
      <label
        key={id}
        className={`bar ${big ? "bar-big" : ""} ${s.homeFocus === index ? "focused" : ""}`}
        style={{ ["--src" as string]: src?.color ?? "var(--accent)" }}
        onMouseDown={() => ui.set({ homeFocus: index })}
      >
        <SourceTile id={id} size={big ? 26 : 22} />
        <span className="bar-label">{sourceLabel(id)}</span>
        <input
          ref={(el) => {
            refs.current[index] = el;
          }}
          className="bar-input"
          placeholder={needsSetup ? "Non connecté" : PLACEHOLDERS[id]}
          spellCheck={false}
          autoComplete="off"
          value=""
          onFocus={() => s.homeFocus !== index && ui.set({ homeFocus: index })}
          onChange={(e) => setSource(id, { query: e.target.value })}
          onKeyDown={(e) => onKey(e, index)}
        />
        {needsSetup ? (
          <button
            className="bar-setup"
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => openSettings(id === "mail" || id === "drive" ? "google" : id)}
          >
            Connecter
          </button>
        ) : (
          <>
            {barMeta(id) && <span className="bar-meta">{barMeta(id)}</span>}
            <kbd className="bar-kbd">Alt+{index + 1}</kbd>
          </>
        )}
      </label>
    );
  };

  return (
    <div className="view home-view">
      <header className="top" onMouseDown={dragHandle}>
        <div className="brand">
          <ShorteoLogo size={22} />
          <span>Shorteo</span>
          <span className="brand-by">
            by Yateo
          </span>
        </div>
        <TopActions />
      </header>

      <div className="home-body">
        {bar("all", 0, true)}
        <div className="bar-grid">{BAR_ORDER.slice(1).map((id, i) => bar(id, i + 1))}</div>

        {recents.length > 0 && (
          <section className="recents">
            <div className="section-title">
              <History size={13} /> Ouverts récemment
            </div>
            {recents.map((r, i) => {
              const index = BAR_ORDER.length + i;
              return (
                <button
                  key={`${r.source}:${r.id}`}
                  ref={(el) => {
                    refs.current[index] = el;
                  }}
                  className={`recent ${s.homeFocus === index ? "focused" : ""}`}
                  onClick={() => void openItem(r)}
                  onFocus={() => s.homeFocus !== index && ui.set({ homeFocus: index })}
                  onKeyDown={(e) => onKey(e, index)}
                >
                  <ItemIcon item={r} size={16} />
                  <span className="recent-title">{r.title}</span>
                  <span className="recent-src">
                    <SourceTile id={r.source} size={14} />
                    {SOURCES[r.source].label}
                  </span>
                  <span className="recent-date">{relativeDate(r.t)}</span>
                </button>
              );
            })}
          </section>
        )}
      </div>

      <footer className="footer">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> Naviguer
        </span>
        <span>
          <kbd>Alt+1…7</kbd> Choisir un outil
        </span>
        <span>
          <kbd>↵</kbd> Ouvrir
        </span>
        <span>
          <kbd>Ctrl+,</kbd> Paramètres
        </span>
        <span className="grow" />
        <span>
          <kbd>Échap</kbd> Fermer
        </span>
      </footer>
    </div>
  );
}
