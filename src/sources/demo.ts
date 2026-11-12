import { setIndex } from "../app/index-store";
import { setDemoUsage } from "../app/usage";
import { norm } from "../app/search";
import type { ParsedQuery, ResultItem, SourceKey } from "./types";

/** Données fictives pour prévisualiser l'interface hors de Windows (mode démo). */

const H = 3600000;
const D = 24 * H;
const now = Date.now();

const notion: ResultItem[] = [
  ["n1", "Projets clients", "database", 2 * H, "📁"],
  ["n2", "Maison Lumière — Refonte site & SEO", "page", 3 * H, "🏠"],
  ["n3", "CR réunion Maison Lumière 04/11", "page", 26 * H, "📝"],
  ["n4", "Process onboarding client", "page", 4 * D, "🚀"],
  ["n5", "Audit SEO — checklist technique", "page", 6 * D, "✅"],
  ["n6", "Campagnes SEA — suivi mensuel", "database", 9 * D, "📊"],
  ["n7", "Atelier Brun — stratégie contenu 2027", "page", 12 * D, "✍️"],
  ["n8", "Recrutement Head of SEO", "page", 2 * D, "👥"],
].map(([id, title, kind, age, icon]) => ({
  id: id as string,
  source: "notion" as const,
  kind: kind as string,
  title: title as string,
  url: `https://www.notion.so/${id}`,
  app: `notion://www.notion.so/${id}`,
  t: now - (age as number),
  icon: icon as string,
  f: { p: id === "n1" || id === "n6" ? undefined : "n1", cb: "u1" },
}));

/** Arborescence de démo : « Mon Drive » (root-demo), un drive partagé (sd1), un dossier partagé avec moi. */
const DEMO_PARENT: Record<string, string> = {
  d1: "d14",
  d5: "d8",
  d13: "d8",
  d14: "d13",
  d6: "root-demo",
  d8: "root-demo",
  d9: "root-demo",
  d10: "sd1",
  d15: "sd1",
  d17: "d15",
  d16: "ext-1",
};
const DEMO_DRIVE_META = {
  rootId: "root-demo",
  drives: [
    { id: "sd1", name: "Yateo — Équipe" },
    { id: "sd2", name: "Clients — Archives" },
  ],
  rootsAt: Date.now(),
};

const drive: ResultItem[] = [
  ["d1", "Devis Maison Lumière — SEO 2027", "sheet", 5 * H],
  ["d2", "Proposition commerciale Groupe Navarre", "slides", 30 * H],
  ["d3", "Audit SEO Atelier Brun.pdf", "pdf", 3 * D],
  ["d4", "Reporting SEA octobre", "sheet", 8 * D],
  ["d5", "Brief refonte Maison Lumière", "doc", 2 * D],
  ["d6", "Clients 2026", "folder", 20 * D],
  ["d7", "Contrat cadre Groupe Navarre.docx", "doc", 40 * D],
  ["d8", "Clients en cours", "folder", 2 * D],
  ["d9", "Prospects en cours", "folder", 3 * D],
  ["d10", "Devis type", "folder", 30 * D],
  ["d11", "Password client en cours", "sheet", 6 * D],
  ["d12", "Password prospects en cours", "sheet", 9 * D],
  ["d13", "Maison Lumière", "folder", 2 * D],
  ["d14", "Devis", "folder", 2 * D],
  ["d15", "Modèles", "folder", 12 * D],
  ["d16", "Dossier partagé par Paul", "folder", 6 * D],
  ["d17", "Charte graphique Yateo.pdf", "pdf", 12 * D],
].map(([id, title, kind, age], i) => ({
  id: id as string,
  source: "drive" as const,
  kind: kind as string,
  title: title as string,
  url: `https://drive.google.com/open?id=${id}`,
  t: now - (age as number),
  f: { o: i % 2 ? "Paul Martin" : "Moi", me: i % 2 ? 0 : 1, p: DEMO_PARENT[id as string] ?? "d6", sh: 1, v: now - (age as number) },
}));

const pipedrive: ResultItem[] = [
  { id: "deal-1", kind: "deal", title: "Maison Lumière — Refonte + SEO", f: { st: "open", v: 18500, cur: "EUR", sgName: "Proposition envoyée", orgName: "Maison Lumière" } },
  { id: "deal-2", kind: "deal", title: "Groupe Navarre — Campagnes SEA 2027", f: { st: "open", v: 42000, cur: "EUR", sgName: "Négociation", orgName: "Groupe Navarre" } },
  { id: "deal-3", kind: "deal", title: "Atelier Brun — Audit SEO", f: { st: "won", v: 6500, cur: "EUR", sgName: "Signé", orgName: "Atelier Brun" } },
  { id: "organization-1", kind: "organization", title: "Maison Lumière", f: { addr: "12 rue des Arts, Lyon" } },
  { id: "organization-2", kind: "organization", title: "Groupe Navarre", f: { addr: "Bordeaux" } },
  { id: "person-1", kind: "person", title: "Claire Dubois", f: { orgName: "Maison Lumière", e: "claire@maison-lumiere.fr", ph: "+33 6 12 34 56 78", em: [{ v: "claire@maison-lumiere.fr", l: "work" }, { v: "c.dubois@gmail.com", l: "home" }], pm: [{ v: "+33 6 12 34 56 78", l: "mobile" }, { v: "+33 4 78 52 10 40", l: "work" }] } },
  { id: "person-2", kind: "person", title: "Marc Navarre", f: { orgName: "Groupe Navarre", e: "marc@navarre.fr" } },
  { id: "lead-a", kind: "lead", title: "Lead — Boulangerie Martin (site e-commerce)", f: { v: 9000, cur: "EUR" } },
].map((x, i) => ({
  ...x,
  source: "pipedrive" as const,
  url: `https://demo.pipedrive.com/${x.kind}/${x.id}`,
  t: now - (i + 1) * 7 * H,
  text: x.f.e,
}));

const chatgpt: ResultItem[] = [
  ["c1", "Plan de contenu SEO pour une boutique de luminaires", 2 * D],
  ["c2", "Annonces Google Ads — variantes de titres", 5 * D],
].map(([id, title, age]) => ({
  id: id as string,
  source: "chatgpt" as const,
  kind: "conversation",
  title: title as string,
  url: `https://chatgpt.com/c/${id}`,
  t: now - (age as number),
  text: "Peux-tu proposer un plan de contenu…",
}));

const claude: ResultItem[] = [
  ["k1", "Structure d'audit SEO technique", 1 * D],
  ["k2", "Rédaction proposition commerciale Navarre", 3 * D],
].map(([id, title, age]) => ({
  id: id as string,
  source: "claude" as const,
  kind: "conversation",
  title: title as string,
  url: `https://claude.ai/chat/${id}`,
  app: `claude://claude.ai/chat/${id}`,
  t: now - (age as number),
  text: "Aide-moi à structurer…",
}));

const mails: ResultItem[] = [
  { id: "m1", title: "Re: Proposition refonte Maison Lumière", f: { from: "Claire Dubois", fe: "claire@maison-lumiere.fr", people: "Claire, Vous", n: 4, star: 1 }, unread: true, snippet: "Bonjour, merci pour la proposition, nous avons quelques questions sur le planning…", t: now - 2 * H },
  { id: "m2", title: "Devis SEA 2027 — Groupe Navarre", f: { from: "Marc Navarre", fe: "marc@navarre.fr", people: "Marc, Paul", n: 2 }, snippet: "Je vous confirme notre accord de principe, pouvez-vous m'envoyer le contrat…", t: now - 20 * H },
  { id: "m3", title: "Audit SEO — rapport final", f: { from: "Vous", fe: "vous@exemple.fr", people: "Vous, Atelier Brun", n: 1 }, snippet: "Vous trouverez ci-joint le rapport final de l'audit, avec les priorités…", t: now - 3 * D },
].map((m) => ({ ...m, source: "mail" as const, kind: "thread", url: `https://mail.superhuman.com/demo/thread/${m.id}` }));

export function loadDemoData(): void {
  setIndex("notion", notion, { users: { u1: "Vous" } }, false);
  setIndex("drive", drive, DEMO_DRIVE_META, false);
  setIndex("pipedrive", pipedrive, {}, false);
  setIndex("chatgpt", chatgpt, {}, false);
  setIndex("claude", claude, {}, false);
  setIndex(
    "contacts",
    [],
    {
      list: [
        { n: "Claire Dubois", e: "claire@maison-lumiere.fr" },
        { n: "Marc Navarre", e: "marc@navarre.fr" },
        { n: "Paul Martin", e: "paul@exemple.fr" },
      ],
      labels: ["Clients", "Recrutement", "Factures"],
    },
    false,
  );
  setDemoUsage([pipedrive[0], notion[1], drive[0], mails[0]]);
}

export async function demoLive(key: SourceKey, q: ParsedQuery): Promise<ResultItem[]> {
  await new Promise((r) => setTimeout(r, 350));
  if (key !== "mail") return [];
  const t = q.tokens;
  return mails.filter((m) => t.every((x) => norm(`${m.title} ${m.snippet} ${m.f?.from}`).includes(x)));
}
