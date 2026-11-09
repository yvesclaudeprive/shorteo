import { settings } from "../app/settings";
import { getIndex, searchIndex, setIndex } from "../app/index-store";
import { fullDate, relativeDate, periodMs, PERIOD_VALUES } from "../app/format";
import { opValues } from "../app/query";
import { platform, type ImportedConversation } from "../app/platform";
import type { ParsedQuery, ResultItem, SourceDef, SourceKey } from "./types";

/**
 * ChatGPT et Claude : poser une question (nouvelle conversation pré-remplie)
 * + retrouver une conversation passée grâce à l'export officiel de vos données.
 */

function periodFilter(q: ParsedQuery): ((it: ResultItem) => boolean) | null {
  const p = opValues(q, "modifie")
    .map(periodMs)
    .find((x) => x !== null);
  return p ? (it) => !!it.t && it.t >= Date.now() - p : null;
}

export async function importHistory(kind: "chatgpt" | "claude"): Promise<number | null> {
  const path = await platform.pickFile();
  if (!path) return null;
  const convs: ImportedConversation[] = await platform.importHistory(path, kind);
  const items: ResultItem[] = convs.map((c) => {
    const t = c.updated_ms ?? (c.updated_iso ? Date.parse(c.updated_iso) : undefined);
    return kind === "chatgpt"
      ? {
          id: c.id,
          source: "chatgpt",
          kind: "conversation",
          title: c.title,
          url: `https://chatgpt.com/c/${c.id}`,
          t: t || undefined,
          text: c.text,
        }
      : {
          id: c.id,
          source: "claude",
          kind: "conversation",
          title: c.title,
          url: `https://claude.ai/chat/${c.id}`,
          app: `claude://claude.ai/chat/${c.id}`,
          t: t || undefined,
          text: c.text,
        };
  });
  setIndex(kind, items, { importedAt: Date.now() });
  return items.length;
}

function historyCount(key: SourceKey): number {
  return getIndex(key).items.length;
}

function makeSource(key: "chatgpt" | "claude"): SourceDef {
  const isClaude = key === "claude";
  const label = isClaude ? "Claude" : "ChatGPT";

  const ask = (q: string): ResultItem[] => {
    const enc = encodeURIComponent(q);
    if (isClaude) {
      return [
        {
          id: "ask",
          source: key,
          kind: "ask",
          action: "ask",
          title: q ? `Demander à Claude : « ${q} »` : "Nouvelle conversation avec Claude",
          url: `https://claude.ai/new${q ? `?q=${enc}` : ""}`,
          app: `claude://claude.ai/new${q ? `?q=${enc}` : ""}`,
        },
      ];
    }
    return [
      {
        id: "ask",
        source: key,
        kind: "ask",
        action: "ask",
        title: q ? `Demander à ChatGPT : « ${q} »` : "Nouvelle conversation avec ChatGPT",
        url: `https://chatgpt.com/${q ? `?q=${enc}` : ""}`,
      },
      ...(q
        ? [
            {
              id: "ask-web",
              source: key,
              kind: "ask-web",
              action: "ask" as const,
              title: `Recherche web avec ChatGPT : « ${q} »`,
              url: `https://chatgpt.com/?hints=search&q=${enc}`,
            },
          ]
        : []),
    ];
  };

  return {
    key,
    label,
    color: isClaude ? "#e07a55" : "#10a37f",
    placeholder: isClaude ? "Demander à Claude ou retrouver une conversation…" : "Demander à ChatGPT ou retrouver une conversation…",
    operators: [{ key: "modifie", aliases: ["modifié", "depuis"], label: "Conversation depuis", values: () => PERIOD_VALUES }],
    chips: [
      { label: "7 jours", op: "modifie", value: "7j" },
      { label: "30 jours", op: "modifie", value: "30j" },
    ],
    configured: () => true,
    actions: (q) => ask(q.raw.trim()),
    localSearch(q, limit) {
      return searchIndex(key, q.tokens, periodFilter(q), limit);
    },
    emptyResults() {
      return [...ask(""), ...searchIndex(key, [], null, 12)];
    },
    nativeSearch(q) {
      const [first] = ask(q.raw.trim());
      return { label: isClaude ? "Demander à Claude" : "Demander à ChatGPT", url: first.url, app: first.app };
    },
    describe(item) {
      if (item.action === "ask") return { sub: isClaude ? "Nouvelle conversation" : item.kind === "ask-web" ? "Avec recherche web" : "Nouvelle conversation" };
      return { sub: item.text ? item.text.slice(0, 90) : undefined, meta: relativeDate(item.t), badge: "Conversation", badgeTone: "gray" };
    },
    details(item) {
      if (item.action === "ask") return [{ label: "Action", value: "Ouvre une nouvelle conversation pré-remplie" }];
      const rows = [{ label: "Dernière activité", value: fullDate(item.t) }];
      if (item.text) rows.push({ label: "Vos messages", value: item.text.slice(0, 400) + (item.text.length > 400 ? "…" : "") });
      const n = historyCount(key);
      rows.push({ label: "Historique importé", value: `${n.toLocaleString("fr-FR")} conversations` });
      return rows;
    },
    appTarget: isClaude
      ? { name: "Claude", process: "Claude.exe", scheme: "claude", mode: () => settings().claudeOpen }
      : undefined,
  };
}

export const chatgptSource = makeSource("chatgpt");
export const claudeSource = makeSource("claude");
