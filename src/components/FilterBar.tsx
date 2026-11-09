import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronDown, Plus, X, Search } from "lucide-react";
import { useStore } from "../app/store";
import { applyFilter, clearFilter, focusInput, insertOperator, toggleChip, ui } from "../app/controller";
import { hasOp, parseQuery, valueLabel } from "../app/query";
import { norm } from "../app/search";
import { sourceDef } from "../sources/registry";
import type { OperatorDef, OperatorValue, SourceDef } from "../sources/types";

interface MenuState {
  key: string;
  x: number;
  y: number;
}

interface Option {
  value: string;
  label: string;
  detail?: string;
}

/** Menu déroulant avec recherche : valeurs d'un filtre, ou liste de tous les filtres. */
function FilterMenu({ src, menu, onClose }: { src: SourceDef; menu: MenuState; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState("");
  const [index, setIndex] = useState(0);
  const isOps = menu.key === "__ops";
  const op = src.operators.find((o) => o.key === menu.key);

  const options: Option[] = useMemo(() => {
    if (isOps) {
      return src.operators.map((o) => ({ value: o.aliases[0], label: o.label, detail: `${o.aliases[0]}:` }));
    }
    return (op?.values?.() ?? []).map((v: OperatorValue) => ({ value: v.value, label: v.label ?? v.value, detail: v.detail }));
  }, [isOps, op, src]);

  const filtered = useMemo(() => {
    const n = norm(q.trim());
    if (!n) return options.slice(0, 80);
    return options
      .filter((o) => norm(`${o.label} ${o.value} ${o.detail ?? ""}`).includes(n))
      .slice(0, 80);
  }, [options, q]);

  useEffect(() => {
    inputRef.current?.focus();
    const onDown = (e: globalThis.MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [onClose]);

  useEffect(() => setIndex(0), [q]);

  const choose = (o: Option) => {
    onClose();
    if (isOps) insertOperator(o.value);
    else if (op) applyFilter(op.key, o.value);
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    e.stopPropagation();
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setIndex((i) => Math.min(filtered.length - 1, i + 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setIndex((i) => Math.max(0, i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const o = filtered[index];
      if (o) choose(o);
      else if (op && q.trim()) {
        onClose();
        applyFilter(op.key, q.trim());
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      focusInput();
    }
  };

  const left = Math.max(8, Math.min(menu.x, window.innerWidth - 308));
  return (
    <div ref={ref} className="fmenu" style={{ left, top: menu.y }} role="dialog">
      <div className="fmenu-search">
        <Search size={14} />
        <input
          ref={inputRef}
          value={q}
          placeholder={isOps ? "Rechercher un filtre…" : `Rechercher (${op?.label ?? ""})…`}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKey}
          spellCheck={false}
        />
      </div>
      <div className="fmenu-list" role="listbox">
        {filtered.map((o, i) => (
          <div
            key={`${o.value}-${i}`}
            className={`fmenu-item ${i === index ? "sel" : ""}`}
            onMouseMove={() => setIndex(i)}
            onMouseDown={(e) => {
              e.preventDefault();
              choose(o);
            }}
          >
            <span className="fmenu-label">{o.label}</span>
            {o.detail && <span className="fmenu-detail">{o.detail}</span>}
          </div>
        ))}
        {!filtered.length && (
          <div className="fmenu-empty">
            {op && q.trim() ? (
              <>
                Entrée pour filtrer sur « {q.trim()} »
              </>
            ) : (
              "Aucune valeur connue pour l'instant"
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Filtres sous la barre de recherche, à la manière de la recherche native des outils. */
export function FilterBar() {
  const s = useStore(ui);
  const src = sourceDef(s.source);
  const [menu, setMenu] = useState<MenuState | null>(null);

  useEffect(() => setMenu(null), [s.source]);

  if (!src) {
    return (
      <div className="chips">
        <span className="chips-hint">
          Astuce : <kbd>Alt+2</kbd> à <kbd>Alt+7</kbd> relance la même recherche dans un seul outil, avec ses filtres.
        </span>
      </div>
    );
  }

  const q = parseQuery(s.query, src);
  const bar = (src.filterBar ?? [])
    .map((k) => src.operators.find((o) => o.key === k))
    .filter((o): o is OperatorDef => !!o);
  const quick = src.chips.filter((c) => !(src.filterBar ?? []).includes(c.op));

  const open = (key: string, e: MouseEvent<HTMLElement>) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setMenu((m) => (m?.key === key ? null : { key, x: r.left, y: r.bottom + 6 }));
  };

  return (
    <div className="chips">
      {bar.map((op) => {
        const active = q.ops.filter((o) => o.key === op.key && !o.negate);
        const text = active.length ? active.map((a) => valueLabel(op, a.value)).join(", ") : null;
        return (
          <span key={op.key} className={`fchip ${active.length ? "on" : ""} ${menu?.key === op.key ? "open" : ""}`}>
            <button className="fchip-main" onMouseDown={(e) => e.preventDefault()} onClick={(e) => open(op.key, e)}>
              <span className="fchip-label">{op.label}</span>
              {text && <span className="fchip-value">{text}</span>}
              {!text && <ChevronDown size={13} />}
            </button>
            {active.length > 0 && (
              <button
                className="fchip-x"
                title="Retirer ce filtre"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => clearFilter(op.key)}
              >
                <X size={12} />
              </button>
            )}
          </span>
        );
      })}
      {quick.map((c) => (
        <button
          key={`${c.op}:${c.value}`}
          className={`chip ${hasOp(q, c.op, c.value) ? "on" : ""}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => toggleChip(c)}
        >
          {c.label}
        </button>
      ))}
      <button
        className={`chip chip-more ${menu?.key === "__ops" ? "on" : ""}`}
        title="Tous les filtres"
        onMouseDown={(e) => e.preventDefault()}
        onClick={(e) => open("__ops", e)}
      >
        <Plus size={13} /> Filtre
      </button>
      {menu && <FilterMenu src={src} menu={menu} onClose={() => setMenu(null)} />}
    </div>
  );
}
