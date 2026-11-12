import type { OpenMode } from "../app/settings";

/** Recherche saisie dans l'application : raccourci + collage (côté natif). */
export type Recipe = "notion" | "superhuman" | "pipedrive" | "claude" | "chatgpt";

export type SourceKey = "notion" | "drive" | "pipedrive" | "mail" | "chatgpt" | "claude";
export type SourceId = "all" | SourceKey;

/** Un résultat affichable (index local, recherche en direct ou action). */
export interface ResultItem {
  id: string;
  source: SourceKey;
  kind: string;
  title: string;
  url: string;
  /** Lien profond vers l'application (notion://, claude://, superhuman://…) */
  app?: string;
  /** Date de dernière modification (ms) */
  t?: number;
  icon?: string;
  /** Texte supplémentaire indexé (non affiché) */
  text?: string;
  snippet?: string;
  unread?: boolean;
  /** Champs bruts compacts pour filtres et aperçu */
  f?: Record<string, any>;
  /** Type de ligne : ouvrir (défaut), recherche native, changer d'outil, poser une question */
  action?: "open" | "native" | "switch" | "ask";
  /** Outil cible pour action « switch » */
  target?: SourceId;
  live?: boolean;
  score?: number;
}

export interface Completion {
  label: string;
  insert: string;
  detail?: string;
  kind: "operator" | "value" | "contact";
}

export interface OperatorValue {
  value: string;
  label?: string;
  detail?: string;
  aliases?: string[];
}

export interface OperatorDef {
  key: string;
  /** Formes acceptées à la saisie ; la première est celle proposée */
  aliases: string[];
  label: string;
  values?: () => OperatorValue[];
  /** Valeurs fermées : une valeur inconnue (en cours de saisie) est ignorée */
  strict?: boolean;
  /** Filtre de dates : le menu propose aussi des dates personnalisées */
  dates?: boolean;
  /** Suggestions calculées à partir de ce qui est tapé (prioritaire sur values) */
  complete?: (partial: string) => OperatorValue[];
}

export interface ParsedOp {
  key: string;
  value: string;
  negate: boolean;
  raw: string;
}

export interface ParsedQuery {
  raw: string;
  /** Texte libre (sans opérateurs) */
  text: string;
  tokens: string[];
  ops: ParsedOp[];
  /** Opérateurs inconnus de l'outil (transmis tels quels pour Gmail) */
  unknown: string[];
  /** Le texte libre contient une expression entre guillemets */
  exact: boolean;
}

export interface Chip {
  label: string;
  op: string;
  value: string;
}

export interface DetailRow {
  label: string;
  value: string;
}

export type Tone = "green" | "red" | "blue" | "gray" | "amber" | "violet";

export interface Described {
  sub?: string;
  meta?: string;
  badge?: string;
  badgeTone?: Tone;
  /** Étiquettes de classement (ex. Client, Prospect) */
  tags?: Array<{ label: string; tone: Tone }>;
}

export interface NativeTarget {
  label: string;
  url: string;
  app?: string;
  /** Texte copié dans le presse-papiers quand l'outil n'accepte pas de recherche par lien */
  copy?: string;
  hint?: string;
  /** Recherche saisie automatiquement dans l'application ouverte (raccourci + collage) */
  recipe?: Recipe;
}

export interface ContactInfo {
  kind: "email" | "phone";
  value: string;
  /** Travail, Mobile, Domicile… */
  label?: string;
  /** Personne concernée (pour une affaire ou une organisation) */
  who?: string;
}

export interface SecondaryAction {
  label: string;
  run: () => Promise<void> | void;
}

export interface AppTarget {
  name: string;
  process: string;
  scheme: string;
  mode: () => OpenMode;
}

export interface SyncOptions {
  full: boolean;
  progress: (message: string) => void;
}

export interface SourceDef {
  key: SourceKey;
  label: string;
  color: string;
  placeholder: string;
  operators: OperatorDef[];
  /** Filtres affichés en menus déroulants sous la barre (clés d'opérateurs) */
  filterBar?: string[];
  /** Raccourcis de filtres (pastilles) pour les opérateurs hors menus */
  chips: Chip[];
  configured(): boolean;
  /** Recherche instantanée dans l'index local */
  localSearch?(q: ParsedQuery, limit: number): ResultItem[];
  /** Recherche en direct dans l'outil */
  liveSearch?(q: ParsedQuery, limit: number): Promise<ResultItem[]>;
  /** Délai avant la recherche en direct (ms) */
  liveDelay?(): number;
  /** Doit-on lancer la recherche en direct pour cette requête ? */
  wantsLive?(q: ParsedQuery): boolean;
  /** Résultats quand la barre est vide */
  emptyResults?(): Promise<ResultItem[]> | ResultItem[];
  /** Lignes d'action affichées en tête (ex. « Demander à Claude ») */
  actions?(q: ParsedQuery): ResultItem[];
  nativeSearch(q: ParsedQuery): NativeTarget;
  /** La ligne « Rechercher dans l'outil » s'affiche en tête (Entrée = recherche native) */
  nativeFirst?: boolean;
  /** Autres outils où relancer la même recherche (ex. Gmail) */
  extraNative?(q: ParsedQuery): NativeTarget[];
  describe(item: ResultItem): Described;
  details(item: ResultItem): DetailRow[];
  secondaryActions?(item: ResultItem): SecondaryAction[];
  /** Coordonnées cliquables (appeler, écrire) */
  contacts?(item: ResultItem): ContactInfo[];
  sync?(opts: SyncOptions): Promise<void>;
  /** Suggestions pour un mot libre (ex. contacts pour les mails) */
  textCompletions?(token: string): Completion[];
  appTarget?: AppTarget;
}
