import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ArrowUpRight, LoaderCircle, X } from "lucide-react";
import { useStore } from "../app/store";
import {
  acceptCompletion,
  handleSearchKey,
  runNative,
  setCaret,
  setQuery,
  titleGhost,
  ui,
} from "../app/controller";
import { parseQuery } from "../app/query";
import { sourceDef } from "../sources/registry";
import { SourceTile } from "./icons";

export function SearchBar() {
  const s = useStore(ui);
  const inputRef = useRef<HTMLInputElement>(null);
  const [overflow, setOverflow] = useState(false);
  const src = sourceDef(s.source);
  const ghost = s.comp.open ? s.comp.ghost : titleGhost(s);

  useEffect(() => {
    const focus = () => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      const pos = ui.get().caret;
      el.setSelectionRange(pos, pos);
    };
    focus();
    window.addEventListener("ys-focus", focus);
    return () => window.removeEventListener("ys-focus", focus);
  }, [s.source]);

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (el) setOverflow(el.scrollWidth > el.clientWidth + 1);
  }, [s.query]);

  const native = src && !src.actions && s.query.trim() ? src.nativeSearch(parseQuery(s.query, src)) : null;

  return (
    <div className="searchbar" style={{ ["--src" as string]: src?.color ?? "var(--accent)" }}>
      <SourceTile id={s.source} size={26} />
      <div className="input-wrap">
        {!overflow && ghost && (
          <div className="ghost" aria-hidden>
            <span className="ghost-typed">{s.query}</span>
            <span className="ghost-rest">{ghost}</span>
            <kbd className="ghost-kbd">Tab</kbd>
          </div>
        )}
        <input
          ref={inputRef}
          className="search-input"
          value={s.query}
          placeholder={src ? src.placeholder : "Rechercher dans Notion, Drive, Pipedrive, Mails, ChatGPT, Claude…"}
          spellCheck={false}
          autoComplete="off"
          autoFocus
          onChange={(e) => setQuery(e.target.value, e.target.selectionStart ?? e.target.value.length)}
          onKeyDown={handleSearchKey}
          onKeyUp={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight" || e.key === "Home" || e.key === "End")
              setCaret(e.currentTarget.selectionStart ?? 0);
          }}
          onClick={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
        />
      </div>
      {s.liveLoading && <LoaderCircle size={16} className="spin muted" />}
      {s.query && (
        <button className="icon-btn" title="Effacer (Échap)" onClick={() => setQuery("", 0)}>
          <X size={15} />
        </button>
      )}
      {native && (
        <button className="native-btn" title={`${native.label} (Maj+Entrée)`} onClick={() => void runNative()}>
          {native.label.replace("Rechercher dans ", "")}
          <ArrowUpRight size={14} />
        </button>
      )}

      {s.comp.open && s.comp.items.length > 0 && (
        <div className="popover" role="listbox">
          {s.comp.items.map((c, i) => (
            <div
              key={`${c.insert}-${i}`}
              className={`pop-item ${i === s.comp.index ? "sel" : ""}`}
              onMouseDown={(e) => {
                e.preventDefault();
                acceptCompletion(i);
              }}
              onMouseMove={() => i !== s.comp.index && ui.set({ comp: { ...s.comp, index: i, touched: true } })}
            >
              <span className={`pop-kind pop-${c.kind}`}>
                {c.kind === "operator" ? "filtre" : c.kind === "contact" ? "contact" : "valeur"}
              </span>
              <span className="pop-label">{c.label}</span>
              {c.detail && <span className="pop-detail">{c.detail}</span>}
              {i === s.comp.index && <kbd>Tab</kbd>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
