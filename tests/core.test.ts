import { describe, it, expect, beforeEach, vi } from "vitest";
import { periodRange, rangeLabel, inRange } from "../src/app/format";
import { parseQuery, computeCompletions, applyCompletion, toggleOperator, removeOperator } from "../src/app/query";
import { setIndex } from "../src/app/index-store";
import { settingsStore, DEFAULT_SETTINGS } from "../src/app/settings";
import { mailSource, toGmailQuery } from "../src/sources/mail";
import { driveSource, childFolders, folderByValue } from "../src/sources/drive";
import { notionSource } from "../src/sources/notion";
import { pipedriveSource } from "../src/sources/pipedrive";
import { claudeSource, chatgptSource } from "../src/sources/ai";
import { ui, runNative, setHover, previewItem, itemKey, openSelected, moveSelection } from "../src/app/controller";
import { platform } from "../src/app/platform";
import type { ResultItem } from "../src/sources/types";

const DAY = 86400000;

describe("Dates", () => {
  it("hier = la journée d'hier entière", () => {
    const r = periodRange("hier")!;
    expect(r.to! - r.from!).toBe(DAY);
    expect(inRange(Date.now(), r)).toBe(false);
    expect(inRange(r.from! + 1000, r)).toBe(true);
  });
  it("7 derniers jours", () => {
    const r = periodRange("7j")!;
    expect(Math.abs(Date.now() - 7 * DAY - r.from!)).toBeLessThan(2000);
    expect(r.to).toBeUndefined();
  });
  it("mois dernier", () => {
    const now = new Date();
    const r = periodRange("mois-dernier")!;
    expect(new Date(r.from!).getDate()).toBe(1);
    expect(new Date(r.from!).getMonth()).toBe((now.getMonth() + 11) % 12);
    expect(new Date(r.to!).getMonth()).toBe(now.getMonth());
  });
  it("dates personnalisées (fin incluse)", () => {
    const r = periodRange("2026-01-01..2026-03-31")!;
    expect(new Date(r.from!).toDateString()).toBe(new Date(2026, 0, 1).toDateString());
    expect(new Date(r.to!).toDateString()).toBe(new Date(2026, 3, 1).toDateString());
    expect(rangeLabel("2026-01-01..2026-03-31")).toBe("du 01/01/2026 au 31/03/2026");
    expect(periodRange("2026-05-01..")!.to).toBeUndefined();
  });
});

describe("Mails : autocomplétion et requête Gmail", () => {
  beforeEach(() => {
    setIndex("contacts", [], { learned: [{ n: "Hanane Chedani", e: "hanane.chedani@sanoflore.fr" }], list: [] }, false);
  });
  it("to:ha propose to:hanane (comme Superhuman)", () => {
    const c = computeCompletions("to:ha", 5, mailSource);
    expect(c.items[0].insert).toBe("to:hanane ");
    expect(c.ghost).toBe("nane");
    expect(applyCompletion("to:ha", c, c.items[0]).value).toBe("to:hanane ");
  });
  it("un point ou une arobase propose l'adresse complète", () => {
    const c = computeCompletions("to:hanane.", 10, mailSource);
    expect(c.items[0].insert).toBe("to:hanane.chedani@sanoflore.fr ");
  });
  it("alias français traduits pour Gmail", () => {
    const g = toGmailQuery(parseQuery("de:hanane avec:pj facture", mailSource));
    expect(g).toContain("from:hanane");
    expect(g).toContain("has:attachment");
    expect(g).toContain("facture");
  });
  it("filtre Date → after:/before:", () => {
    const g = toGmailQuery(parseQuery("date:2026-01-01..2026-03-31 devis", mailSource));
    expect(g).toContain("after:2025/12/31");
    expect(g).toContain("before:2026/04/01");
    expect(g).toContain("devis");
  });
});

function folder(id: string, title: string, p?: string): ResultItem {
  return { id, source: "drive", kind: "folder", title, url: `https://drive.google.com/drive/folders/${id}`, f: { p } };
}
function file(id: string, title: string, p: string, kind = "doc"): ResultItem {
  return { id, source: "drive", kind, title, url: `https://docs.google.com/${id}`, t: Date.now(), f: { p } };
}

describe("Drive : arborescence, filtres, lien de recherche, étiquettes", () => {
  beforeEach(() => {
    settingsStore.set({ ...DEFAULT_SETTINGS, connected: { notion: false, notionMcp: false, pipedrive: false, google: true } });
    setIndex(
      "drive",
      [
        folder("f1", "Clients en cours"),
        folder("f2", "ACME", "f1"),
        folder("f3", "Devis", "f2"),
        folder("f4", "Prospects en cours"),
        folder("f5", "Devis", "f4"),
        file("x1", "Devis ACME 2026", "f3", "sheet"),
        file("x2", "Devis Beta", "f5", "sheet"),
        file("x3", "Password client en cours", "f1", "sheet"),
      ],
      {},
      false,
    );
  });
  it("dossiers racine et sous-dossiers", () => {
    expect(childFolders(null).map((f) => f.id).sort()).toEqual(["f1", "f4"]);
    expect(childFolders("f1").map((f) => f.id)).toEqual(["f2"]);
  });
  it("filtre Dossier par nom : sous-dossiers compris", () => {
    const r = driveSource.localSearch!(parseQuery('devis dossier:"Clients en cours"', driveSource), 20).map((i) => i.id);
    expect(r).toContain("x1");
    expect(r).not.toContain("x2");
  });
  it("filtre Dossier par chemin : distingue deux « Devis »", () => {
    const r = driveSource.localSearch!(parseQuery('devis dossier:"Prospects en cours / Devis"', driveSource), 20).map((i) => i.id);
    expect(r).toEqual(["x2"]);
    expect(folderByValue("Clients en cours / ACME / Devis")?.id).toBe("f3");
  });
  it("Entrée avec un dossier seul : ouvre le dossier dans Drive", () => {
    const t = driveSource.nativeSearch(parseQuery('dossier:"Clients en cours"', driveSource));
    expect(t.url).toBe("https://drive.google.com/drive/folders/f1");
  });
  it("Entrée avec texte + dossier : recherche limitée au dossier", () => {
    const t = driveSource.nativeSearch(parseQuery('devis dossier:"Clients en cours / ACME / Devis" type:sheet', driveSource));
    const q = decodeURIComponent(t.url.split("q=")[1]);
    expect(q).toContain("devis");
    expect(q).toContain("type:spreadsheet");
    expect(q).toContain("parent:f3");
  });
  it("étiquettes Client / Password client", () => {
    const tags1 = driveSource.describe(file("x1", "Devis ACME 2026", "f3")).tags!.map((t) => t.label);
    expect(tags1).toContain("Client");
    const tags3 = driveSource.describe(file("x3", "Password client en cours", "f1")).tags!.map((t) => t.label);
    expect(tags3).toEqual(expect.arrayContaining(["Client", "Password client"]));
  });
  it("pastille de filtre : ajout puis retrait", () => {
    const v = toggleOperator("devis", driveSource, "type", "pdf");
    expect(v.trim()).toBe("devis type:pdf");
    expect(removeOperator(v, driveSource, "type").trim()).toBe("devis");
  });
});

describe("Notion : filtres Espace / Dans sur les résultats de la recherche complète", () => {
  it("espace et dossier parent depuis le chemin", () => {
    settingsStore.set({ connected: { notion: false, notionMcp: true, pipedrive: false, google: false } });
    const page = (id: string, title: string, path: string): ResultItem => ({
      id,
      source: "notion",
      kind: "page",
      title,
      url: `https://app.notion.com/p/${id}`,
      t: Date.now(),
      f: { path, mcp: 1 },
    });
    setIndex(
      "notion",
      [
        page("n1", "Audit CRO - Sanoflore", "Pôle Conception / CRO - audits clients"),
        page("n2", "Sanoflore", "Rétention / Clients à risques"),
      ],
      {},
      false,
    );
    const inSpace = notionSource.localSearch!(parseQuery('sanoflore espace:"Pôle Conception"', notionSource), 10).map((i) => i.id);
    expect(inSpace).toEqual(["n1"]);
    const inside = notionSource.localSearch!(parseQuery('sanoflore dans:"Clients à risques"', notionSource), 10).map((i) => i.id);
    expect(inside).toEqual(["n2"]);
  });
});

describe("Entrée : recherche dans l'outil, jamais l'élément survolé", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    settingsStore.set({
      ...DEFAULT_SETTINGS,
      pipedriveDomain: "yateo",
      connected: { notion: true, notionMcp: true, pipedrive: true, google: true },
    });
  });

  function setup(source: "mail" | "drive" | "pipedrive" | "notion" | "claude" | "chatgpt", query: string) {
    const src = { mail: mailSource, drive: driveSource, pipedrive: pipedriveSource, notion: notionSource, claude: claudeSource, chatgpt: chatgptSource }[source];
    const native: ResultItem = { id: "native", source, kind: "native", action: "native", title: "native", url: "" };
    const other: ResultItem = { id: "x", source, kind: "doc", title: "Résultat", url: "https://example.com/x" };
    ui.set({ mode: "search", source, query, groups: [{ key: source, items: [native, other] }], selectedKey: itemKey(native), hoverKey: null });
    return { src, native, other };
  }

  it("le survol met à jour l'aperçu sans changer la sélection", () => {
    const { native, other } = setup("drive", "devis");
    setHover(itemKey(other));
    expect(previewItem()?.id).toBe("x");
    expect(ui.get().selectedKey).toBe(itemKey(native));
  });

  it("Mails : Superhuman au premier plan + recherche saisie, aucun lien ouvert", async () => {
    const { other } = setup("mail", "to:hanane");
    setHover(itemKey(other));
    const copy = vi.spyOn(platform, "copy").mockResolvedValue();
    const ns = vi.spyOn(platform, "nativeSearch").mockResolvedValue("typed");
    const open = vi.spyOn(platform, "openUrl").mockResolvedValue();
    await openSelected();
    expect(copy).toHaveBeenCalledWith("to:hanane");
    expect(ns).toHaveBeenCalledWith("superhuman");
    expect(open).not.toHaveBeenCalled();
  });

  it("Mails : Superhuman absent → site web", async () => {
    setup("mail", "to:hanane");
    vi.spyOn(platform, "copy").mockResolvedValue();
    vi.spyOn(platform, "nativeSearch").mockResolvedValue("not_installed");
    const open = vi.spyOn(platform, "openUrl").mockResolvedValue();
    vi.spyOn(platform, "hide").mockResolvedValue();
    await runNative();
    expect(open).toHaveBeenCalledWith("https://mail.superhuman.com/");
  });

  it("Pipedrive : ouvre le site puis y saisit la recherche", async () => {
    setup("pipedrive", "sanoflore");
    const calls: string[] = [];
    vi.spyOn(platform, "copy").mockResolvedValue();
    vi.spyOn(platform, "openUrl").mockImplementation(async (u) => void calls.push(`open:${u}`));
    vi.spyOn(platform, "nativeSearch").mockImplementation(async (r) => (calls.push(`search:${r}`), "typed"));
    await runNative();
    expect(calls).toEqual(["open:https://yateo.pipedrive.com/", "search:pipedrive"]);
  });

  it("Notion, Claude, ChatGPT : recherche saisie dans l'application", async () => {
    for (const s of ["notion", "claude", "chatgpt"] as const) {
      setup(s, "jeans");
      vi.spyOn(platform, "copy").mockResolvedValue();
      const ns = vi.spyOn(platform, "nativeSearch").mockResolvedValue("typed");
      await runNative();
      expect(ns).toHaveBeenLastCalledWith(s);
    }
  });

  it("↓ puis Entrée ouvre bien le résultat", async () => {
    setup("drive", "devis");
    const open = vi.spyOn(platform, "openUrl").mockResolvedValue();
    vi.spyOn(platform, "appsStatus").mockResolvedValue({ running: {}, installed: {} });
    vi.spyOn(platform, "hide").mockResolvedValue();
    moveSelection(1);
    await openSelected();
    expect(open).toHaveBeenCalledWith("https://example.com/x");
  });
});
