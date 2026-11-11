import { dragHandle } from "../app/drag";
import { useEffect, useState, type ReactNode, type KeyboardEvent } from "react";
import {
  ArrowLeft,
  ArrowLeftRight,
  Check,
  Download,
  Eye,
  EyeOff,
  Database,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Power,
  RefreshCw,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  Upload,
} from "lucide-react";
import { useStore } from "../app/store";
import { settingsStore, updateSettings, saveSettingsNow, type OpenMode } from "../app/settings";
import { closeSettings, errorText, syncAll, toast, ui } from "../app/controller";
import { clearAllIndexes, getIndex, indexVersion, setIndex } from "../app/index-store";
import { deleteSecret, getSecret, setSecret } from "../app/secrets";
import { platform } from "../app/platform";
import { fullDate, relativeDate } from "../app/format";
import { testNotion } from "../sources/notion";
import { connectNotionMcp, disconnectNotionMcp, testNotionMcp } from "../sources/notion-mcp";
import { testPipedrive } from "../sources/pipedrive";
import { connectGoogle, disconnectGoogle, gapi, parseClientJson, testGoogle, type CheckResult } from "../sources/google";
import { superhumanLinks } from "../sources/mail";
import { importHistory } from "../sources/ai";
import { exportConfig, importConfig } from "../app/transfer";
import { driveShortcuts } from "../sources/drive";
import type { SourceId } from "../sources/types";
import { SourceTile, ShorteoLogo } from "./icons";
import { MinimizeButton } from "./TopBar";

const TABS: Array<{ id: string; label: string; tile?: SourceId; icon?: typeof Database }> = [
  { id: "welcome", label: "Bienvenue", icon: Sparkles },
  { id: "general", label: "Général", icon: SlidersHorizontal },
  { id: "notion", label: "Notion", tile: "notion" },
  { id: "pipedrive", label: "Pipedrive", tile: "pipedrive" },
  { id: "google", label: "Drive & Mails", tile: "drive" },
  { id: "superhuman", label: "Superhuman", tile: "mail" },
  { id: "ai", label: "ChatGPT & Claude", tile: "claude" },
  { id: "index", label: "Index & données", icon: Database },
  { id: "transfer", label: "Transfert vers un PC", icon: ArrowLeftRight },
];

function Link({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        void platform.openUrl(href);
      }}
    >
      {children}
      <ExternalLink size={11} />
    </a>
  );
}

function Field({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="field-control">{children}</div>
      {hint && <div className="field-hint">{hint}</div>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button className={`toggle ${checked ? "on" : ""}`} role="switch" aria-checked={checked} onClick={() => onChange(!checked)}>
      <span />
    </button>
  );
}

function OpenModeSelect({ value, onChange, app }: { value: OpenMode; onChange: (v: OpenMode) => void; app: string }) {
  return (
    <select value={value} onChange={(e) => onChange(e.target.value as OpenMode)}>
      <option value="app-if-running">App {app} si elle est ouverte, sinon navigateur</option>
      <option value="app-if-installed">App {app} si elle est installée, sinon navigateur</option>
      <option value="browser">Toujours le navigateur</option>
    </select>
  );
}

function useSecretPresent(key: string): [boolean, () => void] {
  const [present, setPresent] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    void getSecret(key).then((v) => setPresent(!!v));
  }, [key, n]);
  return [present, () => setN((x) => x + 1)];
}

function SecretInput({
  label,
  secretKey,
  placeholder,
  onSave,
}: {
  label: string;
  secretKey: string;
  placeholder: string;
  onSave: () => Promise<void>;
}) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const [present, refresh] = useSecretPresent(secretKey);
  const save = async () => {
    if (!value.trim()) return;
    setBusy(true);
    try {
      await setSecret(secretKey, value.trim());
      setValue("");
      setShown(false);
      refresh();
      await onSave();
    } catch (e) {
      toast(errorText(e), "error", 6000);
    } finally {
      setBusy(false);
    }
  };
  const toggle = async () => {
    if (shown) {
      setShown(false);
      setValue("");
      return;
    }
    const v = await getSecret(secretKey);
    setValue(v ?? "");
    setShown(true);
  };
  return (
    <Field
      label={label}
      hint={present ? <span className="ok"><Check size={12} /> Enregistrée dans le coffre-fort Windows</span> : "Stockée dans le coffre-fort Windows, jamais dans un fichier."}
    >
      <div className="inline">
        <div className="secret-wrap">
          <input
            type={shown ? "text" : "password"}
            value={value}
            placeholder={present ? "•••••••• (déjà enregistrée : collez pour remplacer)" : placeholder}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void save()}
            spellCheck={false}
          />
          <button className="eye" title={shown ? "Masquer" : "Afficher la clé enregistrée"} onClick={() => void toggle()}>
            {shown ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
        <button className="btn primary" disabled={busy || !value.trim()} onClick={() => void save()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />} Enregistrer
        </button>
      </div>
    </Field>
  );
}

function Status({ ok, children }: { ok: boolean; children: ReactNode }) {
  return <div className={`status-line ${ok ? "ok" : "off"}`}>{children}</div>;
}

// ---------------------------------------------------------------------------

function Welcome() {
  return (
    <div className="tab">
      <h2>
        <ShorteoLogo size={26} /> Bienvenue dans Shorteo
      </h2>
      <p className="lead">
        Une fenêtre, un raccourci, toutes vos recherches : Notion, Google Drive, Pipedrive, vos mails (ouverts dans
        Superhuman), ChatGPT et Claude.
      </p>
      <ol className="steps">
        <li>
          <b>Raccourci</b> : par défaut <kbd>Ctrl+Maj+Espace</kbd>. Modifiable dans <a onClick={() => ui.set({ settingsTab: "general" })}>Général</a>.
        </li>
        <li>
          <b>Connectez vos outils</b> (5 minutes chacun, guide pas à pas) :{" "}
          <a onClick={() => ui.set({ settingsTab: "notion" })}>Notion</a>,{" "}
          <a onClick={() => ui.set({ settingsTab: "pipedrive" })}>Pipedrive</a>,{" "}
          <a onClick={() => ui.set({ settingsTab: "google" })}>Drive & Mails</a>.
        </li>
        <li>
          <b>Vérifiez l'ouverture dans Superhuman</b> : <a onClick={() => ui.set({ settingsTab: "superhuman" })}>tester le lien</a>.
        </li>
        <li>
          <b>Facultatif</b> : importez votre historique <a onClick={() => ui.set({ settingsTab: "ai" })}>ChatGPT et Claude</a>.
        </li>
      </ol>
      <p className="muted small">
        Vos clés restent sur ce PC (coffre-fort Windows). L'index local ne contient que des titres et des métadonnées,
        mis à jour en arrière-plan ; chaque recherche interroge aussi les outils en direct.
      </p>
    </div>
  );
}

function shortcutFromEvent(e: KeyboardEvent): string | null {
  const mods: string[] = [];
  if (e.ctrlKey) mods.push("Ctrl");
  if (e.altKey) mods.push("Alt");
  if (e.shiftKey) mods.push("Shift");
  if (e.metaKey) mods.push("Super");
  const code = e.code;
  let key: string | null = null;
  if (/^Key[A-Z]$/.test(code)) key = code.slice(3);
  else if (/^Digit\d$/.test(code)) key = code.slice(5);
  else if (/^F\d{1,2}$/.test(code)) key = code;
  else if (code === "Space") key = "Space";
  if (!key || !mods.length) return null;
  return [...mods, key].join("+");
}

function General() {
  const st = useStore(settingsStore);
  const [capturing, setCapturing] = useState(false);
  const [autostart, setAutostart] = useState(false);
  useEffect(() => {
    void platform.autostartEnabled().then(setAutostart).catch(() => {});
  }, []);
  const applyShortcut = async (sc: string) => {
    try {
      await platform.setShortcut(sc);
      updateSettings({ shortcut: sc });
      toast(`Raccourci : ${sc}`, "success");
    } catch (e) {
      toast(errorText(e), "error", 6000);
    }
  };
  return (
    <div className="tab">
      <h2>Général</h2>
      <Field label="Raccourci global" hint="Cliquez puis appuyez sur la combinaison voulue (au moins Ctrl, Alt ou Maj). Évitez Alt+Espace, déjà utilisé par ChatGPT.">
        <input
          readOnly
          className={`shortcut ${capturing ? "capturing" : ""}`}
          value={capturing ? "Appuyez sur la combinaison…" : st.shortcut.replace("Shift", "Maj").replace("Space", "Espace")}
          onFocus={() => setCapturing(true)}
          onBlur={() => setCapturing(false)}
          onKeyDown={(e) => {
            e.preventDefault();
            const sc = shortcutFromEvent(e);
            if (sc) {
              setCapturing(false);
              (e.target as HTMLInputElement).blur();
              void applyShortcut(sc);
            }
          }}
        />
      </Field>
      <Field label="Thème">
        <select value={st.theme} onChange={(e) => updateSettings({ theme: e.target.value as typeof st.theme })}>
          <option value="auto">Automatique (comme Windows)</option>
          <option value="dark">Sombre</option>
          <option value="light">Clair</option>
        </select>
      </Field>
      <Field label="Masquer la fenêtre quand je clique ailleurs">
        <Toggle checked={st.hideOnBlur} onChange={(v) => updateSettings({ hideOnBlur: v })} />
      </Field>
      <Field label="Lancer au démarrage de Windows">
        <Toggle
          checked={autostart}
          onChange={(v) => {
            setAutostart(v);
            void platform.setAutostart(v).catch((e) => toast(errorText(e), "error"));
          }}
        />
      </Field>
      <Field label="Fréquence de mise à jour de l'index">
        <select value={st.syncMinutes} onChange={(e) => updateSettings({ syncMinutes: Number(e.target.value) })}>
          <option value={1}>Toutes les minutes</option>
          <option value={2}>Toutes les 2 minutes</option>
          <option value={5}>Toutes les 5 minutes</option>
          <option value={15}>Toutes les 15 minutes</option>
        </select>
      </Field>
      <div className="danger-zone">
        <button className="btn" onClick={() => void platform.quit()}>
          <Power size={14} /> Quitter Shorteo
        </button>
      </div>
    </div>
  );
}

function NotionTab() {
  const st = useStore(settingsStore);
  const s = useStore(ui);
  useStore(indexVersion);
  const [busy, setBusy] = useState(false);
  const notionErrors = s.sync.errors.filter((e) => e.startsWith("Notion"));
  const userList = Object.entries((getIndex("notion").meta.users as Record<string, string> | undefined) ?? {});

  const connectFull = async () => {
    setBusy(true);
    try {
      toast("Validez l'accès dans votre navigateur…", "info", 10000);
      await connectNotionMcp();
      updateSettings({ connected: { ...settingsStore.get().connected, notionMcp: true } });
      toast(await testNotionMcp(), "success", 6000);
    } catch (e) {
      toast(errorText(e), "error", 12000);
    } finally {
      setBusy(false);
    }
  };

  const connectToken = async () => {
    const res = await testNotion();
    updateSettings({ connected: { ...settingsStore.get().connected, notion: true } });
    toast(res.message, res.ok ? "success" : "info", res.ok ? 4000 : 14000);
    void syncAll(true);
  };

  return (
    <div className="tab">
      <h2>
        <SourceTile id="notion" size={22} /> Notion
      </h2>
      <p className="lead small">
        Deux connexions complémentaires. La <b>recherche complète</b> fouille tout votre Notion, titres et contenu, avec
        vos propres droits. L'<b>index instantané</b> affiche les titres dès la première lettre tapée. Les deux sont en
        lecture seule.
      </p>

      <h3>1. Recherche complète (recommandée)</h3>
      <Status ok={st.connected.notionMcp}>{st.connected.notionMcp ? "Connectée" : "Non connectée"}</Status>
      <ol className="steps">
        <li>
          Cliquez sur <b>Se connecter à Notion</b> : votre navigateur s'ouvre sur Notion.
        </li>
        <li>
          Choisissez l'espace de travail Yateo, puis <b>Autoriser l'accès</b>. Revenez ici : c'est terminé.
        </li>
      </ol>
      <div className="row-buttons">
        <button className="btn primary" disabled={busy} onClick={() => void connectFull()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
          {st.connected.notionMcp ? "Reconnecter Notion" : "Se connecter à Notion"}
        </button>
        {st.connected.notionMcp && (
          <button
            className="btn"
            onClick={async () => {
              await disconnectNotionMcp();
              updateSettings({ connected: { ...settingsStore.get().connected, notionMcp: false } });
            }}
          >
            Déconnecter
          </button>
        )}
      </div>

      <h3>2. Index instantané des titres (facultatif)</h3>
      <Status ok={st.connected.notion}>
        {st.connected.notion
          ? `Connecté · ${getIndex("notion").items.length.toLocaleString("fr-FR")} pages indexées`
          : "Non connecté"}
      </Status>
      {notionErrors.length > 0 && <div className="errors">{notionErrors.join(" — ")}</div>}
      <ol className="steps detailed">
        <li>
          <b>Créer l'intégration</b>
          <span>
            Ouvrez <Link href="https://www.notion.so/profile/integrations">notion.so/profile/integrations</Link> →{" "}
            <b>Nouvelle intégration</b> : type <b>Interne</b>, nom « Shorteo », espace de travail Yateo.
          </span>
        </li>
        <li>
          <b>Capacités</b>
          <span>
            Cochez uniquement <b>Lire le contenu</b> et <b>Lire les informations des utilisateurs</b> (nécessaire pour le
            filtre « Créé par »). Enregistrez.
          </span>
        </li>
        <li>
          <b>Donner accès aux pages, en une fois</b>
          <span>
            Dans la même page, onglet <b>Accès au contenu</b> (Content access) → <b>Modifier l'accès</b> : cochez les
            pages principales de chaque espace (Pôle Conception, Pôle Biz Dev, Rétention…). Les sous-pages suivent
            automatiquement. Sans cette étape, l'index reste vide.
          </span>
        </li>
        <li>
          <b>Copier la clé</b>
          <span>
            Onglet <b>Configuration</b> → <b>Secret d'intégration interne</b> → Afficher → Copier, puis collez-la
            ci-dessous.
          </span>
        </li>
      </ol>
      <SecretInput label="Secret d'intégration" secretKey="notion_token" placeholder="ntn_…" onSave={connectToken} />
      {st.connected.notion && (
        <div className="row-buttons">
          <button className="btn" onClick={() => void connectToken().catch((e) => toast(errorText(e), "error", 8000))}>
            <RefreshCw size={14} /> Tester et resynchroniser
          </button>
          <button
            className="btn"
            onClick={async () => {
              await deleteSecret("notion_token");
              updateSettings({ connected: { ...settingsStore.get().connected, notion: false } });
              setIndex("notion", [], {});
            }}
          >
            Déconnecter
          </button>
        </div>
      )}

      <h3>Réglages</h3>
      <Field label="Vous dans Notion" hint="Sert au filtre « Créé par : Moi ». La liste vient de l'index instantané.">
        <select value={st.notionMe} onChange={(e) => updateSettings({ notionMe: e.target.value })}>
          <option value="">— Choisir —</option>
          {userList.map(([id, name]) => (
            <option key={id} value={id}>
              {name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Au clic sur un résultat">
        <OpenModeSelect app="Notion" value={st.notionOpen} onChange={(v) => updateSettings({ notionOpen: v })} />
      </Field>
      <Field
        label="Lien de recherche Notion (avancé)"
        hint="Laissez vide : Shorteo ouvre Notion et copie la requête (Ctrl+K puis Ctrl+V). Variable disponible : {q}"
      >
        <input value={st.notionSearchUrl} placeholder="(vide)" onChange={(e) => updateSettings({ notionSearchUrl: e.target.value })} />
      </Field>
    </div>
  );
}

function PipedriveTab() {
  const st = useStore(settingsStore);
  const connect = async () => {
    await saveSettingsNow();
    const msg = await testPipedrive();
    updateSettings({ connected: { ...st.connected, pipedrive: true } });
    toast(msg, "success");
    void syncAll(true);
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="pipedrive" size={22} /> Pipedrive
      </h2>
      <Status ok={st.connected.pipedrive}>{st.connected.pipedrive ? "Connecté" : "Non connecté"}</Status>
      <ol className="steps">
        <li>
          <b>Domaine</b> : la partie avant « .pipedrive.com » dans l'adresse de votre Pipedrive.
        </li>
        <li>
          <b>Jeton API</b> : dans Pipedrive, cliquez sur votre photo → <b>Préférences personnelles</b> → onglet <b>API</b> → copiez le jeton.
        </li>
      </ol>
      <Field label="Domaine Pipedrive">
        <div className="inline">
          <input
            value={st.pipedriveDomain}
            placeholder="votre-societe"
            onChange={(e) => updateSettings({ pipedriveDomain: e.target.value.trim() })}
          />
          <span className="suffix">.pipedrive.com</span>
        </div>
      </Field>
      <SecretInput label="Jeton API personnel" secretKey="pipedrive_token" placeholder="Collez votre jeton API" onSave={connect} />
      <Field
        label="Lien de recherche Pipedrive (avancé)"
        hint="Pipedrive n'a pas de lien de recherche officiel : par défaut, Shorteo ouvre Pipedrive et copie la requête. Variable : {q}"
      >
        <input value={st.pipedriveSearchUrl} placeholder="(vide)" onChange={(e) => updateSettings({ pipedriveSearchUrl: e.target.value })} />
      </Field>
      {st.connected.pipedrive && (
        <div className="row-buttons">
          <button className="btn" onClick={() => void connect().catch((e) => toast(errorText(e), "error", 6000))}>
            <RefreshCw size={14} /> Tester et resynchroniser
          </button>
          <button
            className="btn"
            onClick={async () => {
              await deleteSecret("pipedrive_token");
              updateSettings({ connected: { ...st.connected, pipedrive: false } });
              setIndex("pipedrive", [], {});
            }}
          >
            Déconnecter
          </button>
        </div>
      )}
    </div>
  );
}

function Checks({ results }: { results: CheckResult[] }) {
  return (
    <ul className="checks">
      {results.map((r) => (
        <li key={r.label} className={r.ok ? "ok" : "ko"}>
          <span className="check-dot">{r.ok ? <Check size={12} /> : "!"}</span>
          <span className="check-label">{r.label}</span>
          <span className="check-msg">
            {r.message}
            {r.fixUrl && (
              <>
                {" "}
                <Link href={r.fixUrl}>Ouvrir</Link>
              </>
            )}
          </span>
        </li>
      ))}
    </ul>
  );
}

function DriveShortcutsSettings() {
  const st = useStore(settingsStore);
  useStore(indexVersion);
  const [name, setName] = useState("");
  const list = driveShortcuts();
  const suggestions = getIndex("drive")
    .items.filter((i) => i.kind === "folder" || i.kind === "sheet" || i.kind === "doc")
    .sort((a, b) => (b.t ?? 0) - (a.t ?? 0))
    .slice(0, 400);
  const add = () => {
    const n = name.trim();
    if (!n || st.driveFavorites.some((x) => x.toLowerCase() === n.toLowerCase())) return;
    updateSettings({ driveFavorites: [...st.driveFavorites, n] });
    setName("");
  };
  const move = (i: number, d: number) => {
    const a = [...st.driveFavorites];
    const j = i + d;
    if (j < 0 || j >= a.length) return;
    [a[i], a[j]] = [a[j], a[i]];
    updateSettings({ driveFavorites: a });
  };
  return (
    <>
      <h3>Raccourcis en tête de la recherche Drive</h3>
      <p className="lead small">
        Un dossier limite la recherche à son contenu (sous-dossiers compris) ; un fichier s'ouvre directement. Les éléments
        sont retrouvés par leur nom exact dans votre Drive.
      </p>
      <ul className="checks">
        {list.map((x, i) => (
          <li key={x.name} className={x.item ? "ok" : "ko"}>
            <span className="check-dot">{x.item ? <Check size={12} /> : "?"}</span>
            <span className="check-label">{x.name}</span>
            <span className="check-msg fav-row">
              {x.item ? (x.item.kind === "folder" ? "Dossier trouvé" : "Fichier trouvé") : "Introuvable dans l'index Drive (vérifiez le nom exact)"}
              <span className="fav-actions">
                <button className="icon-btn" title="Monter" onClick={() => move(i, -1)}>↑</button>
                <button className="icon-btn" title="Descendre" onClick={() => move(i, 1)}>↓</button>
                <button
                  className="icon-btn"
                  title="Retirer"
                  onClick={() => updateSettings({ driveFavorites: st.driveFavorites.filter((n) => n !== x.name) })}
                >
                  <Trash2 size={13} />
                </button>
              </span>
            </span>
          </li>
        ))}
      </ul>
      <div className="inline" style={{ marginBottom: 16 }}>
        <input
          list="drive-folders"
          value={name}
          placeholder="Nom d'un dossier ou d'un fichier Drive"
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && add()}
          className="plain-input"
        />
        <datalist id="drive-folders">
          {suggestions.map((i) => (
            <option key={i.id} value={i.title} />
          ))}
        </datalist>
        <button className="btn" onClick={add}>
          Ajouter
        </button>
      </div>
    </>
  );
}

function GoogleTab() {
  const st = useStore(settingsStore);
  const [cid, setCid] = useState("");
  const [secret, setSecretValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [checks, setChecks] = useState<CheckResult[] | null>(null);
  const [secretSaved, setSecretSaved] = useState(false);
  const [showSecret, setShowSecret] = useState(false);
  useEffect(() => {
    void getSecret("google_client_id").then((v) => v && setCid(v));
    void getSecret("google_client_secret").then((v) => setSecretSaved(!!v));
  }, []);

  const importJson = async () => {
    try {
      const path = await platform.pickJsonFile();
      if (!path) return;
      const { clientId, clientSecret } = await parseClientJson(await platform.readJsonFile(path));
      setCid(clientId);
      setSecretValue(clientSecret);
      toast("Fichier importé : cliquez maintenant sur « Se connecter avec Google »", "success", 6000);
    } catch (e) {
      toast(errorText(e), "error", 8000);
    }
  };

  const runChecks = async () => {
    setChecking(true);
    try {
      setChecks(await testGoogle());
    } finally {
      setChecking(false);
    }
  };

  const connect = async () => {
    const storedSecret = secret || (await getSecret("google_client_secret")) || "";
    if (!cid.trim() || !storedSecret.trim()) {
      toast("Importez le fichier JSON du client, ou collez l'ID client et le code secret", "error", 6000);
      return;
    }
    if (!cid.trim().endsWith(".apps.googleusercontent.com")) {
      toast("L'ID client doit se terminer par .apps.googleusercontent.com", "error", 6000);
      return;
    }
    setBusy(true);
    try {
      toast("Validez l'accès dans votre navigateur…", "info", 10000);
      const email = await connectGoogle(cid, storedSecret);
      updateSettings({ connected: { ...st.connected, google: true }, mailAccount: email });
      setSecretValue("");
      setSecretSaved(true);
      toast(`Connecté : ${email}`, "success");
      void syncAll(true);
      await runChecks();
    } catch (e) {
      const msg = errorText(e);
      toast(
        /redirect_uri_mismatch/i.test(msg)
          ? "Mauvais type de client : il faut un client « Application de bureau »."
          : /access_denied/i.test(msg)
            ? "Accès refusé : acceptez toutes les autorisations demandées par Google."
            : msg,
        "error",
        10000,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="tab">
      <h2>
        <SourceTile id="drive" size={22} /> Google Drive & Mails (Gmail)
      </h2>
      <Status ok={st.connected.google}>{st.connected.google ? `Connecté : ${st.mailAccount}` : "Non connecté"}</Status>
      <p className="lead small">
        Une seule connexion Google sert à Drive, aux mails (ouverts ensuite dans Superhuman) et à l'autocomplétion des
        contacts. L'accès est en lecture seule. Comptez 5 minutes, une seule fois.
      </p>

      <ol className="steps detailed">
        <li>
          <b>Créer un projet Google Cloud</b>
          <span>
            Ouvrez <Link href="https://console.cloud.google.com/projectcreate">la page de création de projet</Link>,
            connecté avec votre compte <b>{st.mailAccount || "@yateo.com"}</b>. Nom : « Shorteo », puis <b>Créer</b>.
            Vérifiez en haut de la console que ce projet est bien sélectionné.
          </span>
        </li>
        <li>
          <b>Activer les 3 API</b> (bouton bleu « Activer » sur chaque page)
          <span>
            <Link href="https://console.cloud.google.com/apis/library/drive.googleapis.com">Google Drive API</Link>,{" "}
            <Link href="https://console.cloud.google.com/apis/library/gmail.googleapis.com">Gmail API</Link>,{" "}
            <Link href="https://console.cloud.google.com/apis/library/people.googleapis.com">People API</Link> (contacts).
          </span>
        </li>
        <li>
          <b>Configurer l'écran de consentement</b>
          <span>
            Ouvrez <Link href="https://console.cloud.google.com/auth/overview">Google Auth Platform</Link> →{" "}
            <b>Commencer</b>. Nom de l'application : « Shorteo », e-mail d'assistance : le vôtre. Audience :{" "}
            <b>Interne</b> (réservé à votre organisation, aucune validation Google). Coordonnées : votre e-mail. Acceptez
            puis <b>Créer</b>.
          </span>
        </li>
        <li>
          <b>Créer le client de connexion</b>
          <span>
            Ouvrez <Link href="https://console.cloud.google.com/auth/clients">Clients</Link> → <b>Créer un client</b> →
            type d'application <b>Application de bureau</b> (et pas « Application Web ») → nom « Shorteo » →{" "}
            <b>Créer</b>. Dans la fenêtre qui s'affiche, cliquez sur <b>Télécharger le fichier JSON</b> : le code secret
            n'est montré qu'une seule fois.
          </span>
        </li>
        <li>
          <b>Importer le fichier ici</b>, puis cliquer sur <b>Se connecter avec Google</b>
          <span>
            Votre navigateur s'ouvre : choisissez votre compte, puis <b>Autoriser</b>. Revenez ici : un diagnostic
            vérifie Gmail, Drive et les contacts un par un.
          </span>
        </li>
      </ol>

      <div className="row-buttons">
        <button className="btn primary" onClick={() => void importJson()}>
          <Upload size={14} /> Importer le fichier JSON du client
        </button>
        <span className="muted small">ou collez les deux valeurs ci-dessous</span>
      </div>
      <Field label="ID client">
        <input value={cid} placeholder="xxxxxxxx.apps.googleusercontent.com" onChange={(e) => setCid(e.target.value.trim())} />
      </Field>
      <Field
        label="Code secret du client"
        hint={secretSaved ? <span className="ok"><Check size={12} /> Déjà enregistré dans le coffre-fort Windows</span> : "Stocké dans le coffre-fort Windows."}
      >
        <div className="secret-wrap">
          <input
            type={showSecret ? "text" : "password"}
            value={secret}
            placeholder={secretSaved ? "•••••••• (déjà enregistré)" : "GOCSPX-…"}
            onChange={(e) => setSecretValue(e.target.value.trim())}
            spellCheck={false}
          />
          <button
            className="eye"
            title={showSecret ? "Masquer" : "Afficher le code enregistré"}
            onClick={async () => {
              if (showSecret) {
                setShowSecret(false);
                setSecretValue("");
              } else {
                setSecretValue((await getSecret("google_client_secret")) ?? "");
                setShowSecret(true);
              }
            }}
          >
            {showSecret ? <EyeOff size={15} /> : <Eye size={15} />}
          </button>
        </div>
      </Field>
      <div className="row-buttons">
        <button className="btn primary" disabled={busy} onClick={() => void connect()}>
          {busy ? <LoaderCircle size={14} className="spin" /> : <KeyRound size={14} />}
          {st.connected.google ? "Reconnecter Google" : "Se connecter avec Google"}
        </button>
        {st.connected.google && (
          <>
            <button className="btn" disabled={checking} onClick={() => void runChecks()}>
              {checking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Vérifier les accès
            </button>
            <button
              className="btn"
              onClick={async () => {
                await disconnectGoogle();
                updateSettings({ connected: { ...st.connected, google: false } });
                setIndex("drive", [], {});
                setChecks(null);
              }}
            >
              Déconnecter
            </button>
          </>
        )}
      </div>
      {checks && <Checks results={checks} />}

      <h3>En cas de problème</h3>
      <ul className="steps">
        <li>
          <b>« Accès bloqué » ou « application non autorisée »</b> : l'administration Google Workspace bloque les
          applications. Dans <Link href="https://admin.google.com/ac/owl/list?tab=configuredApps">Admin → Sécurité → Commandes des API</Link>,
          autorisez les applications internes, ou ajoutez l'ID client comme application de confiance.
        </li>
        <li>
          <b>« redirect_uri_mismatch »</b> : le client n'est pas de type « Application de bureau ». Recréez-le avec ce type.
        </li>
        <li>
          <b>« API non activée »</b> : le diagnostic donne le lien direct vers l'API à activer.
        </li>
        <li>
          <b>Audience « Interne » indisponible</b> : le projet n'est pas rattaché à l'organisation yateo.com. Recréez-le
          en choisissant l'organisation dans le champ « Emplacement ».
        </li>
      </ul>

      <DriveShortcutsSettings />

      <Field label="Nombre maximum de fichiers Drive indexés">
        <select value={st.driveMaxItems} onChange={(e) => updateSettings({ driveMaxItems: Number(e.target.value) })}>
          <option value={20000}>20 000</option>
          <option value={60000}>60 000</option>
          <option value={150000}>150 000</option>
        </select>
      </Field>
    </div>
  );
}

function SuperhumanTab() {
  const st = useStore(settingsStore);
  const [testing, setTesting] = useState(false);
  const test = async () => {
    setTesting(true);
    try {
      const res = await gapi<any>("https://gmail.googleapis.com/gmail/v1/users/me/threads?maxResults=1&q=in:inbox");
      const id = res.threads?.[0]?.id;
      if (!id) throw new Error("Aucun mail dans la boîte de réception");
      const links = superhumanLinks(id);
      const s = await platform.appsStatus(["Superhuman.exe"], ["superhuman"]);
      const useApp = st.superhumanOpen !== "browser" && links.app && (s.running["Superhuman.exe"] || (st.superhumanOpen === "app-if-installed" && s.installed.superhuman));
      await platform.openUrl(useApp ? links.app! : links.url);
      toast(`Ouverture du dernier mail reçu ${useApp ? "dans l'app" : "dans le navigateur"}…`, "info", 5000);
    } catch (e) {
      toast(errorText(e), "error", 6000);
    } finally {
      setTesting(false);
    }
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="mail" size={22} /> Superhuman
      </h2>
      <p className="lead small">
        La recherche de mails passe par Gmail (mêmes opérateurs : <code>de:</code>, <code>à:</code>, <code>objet:</code>,{" "}
        <code>avec:pj</code>, <code>après:</code>…). Au clic, le fil s'ouvre dans Superhuman.
      </p>
      <Field label="Au clic sur un mail">
        <OpenModeSelect app="Superhuman" value={st.superhumanOpen} onChange={(v) => updateSettings({ superhumanOpen: v })} />
      </Field>
      <Field
        label="Lien vers un fil Superhuman"
        hint={
          <>
            Variables : <code>{"{email}"}</code> <code>{"{threadId}"}</code>. Pour vérifier : ouvrez un mail sur mail.superhuman.com,
            copiez l'adresse de la page et comparez. L'app est ouverte via <code>superhuman://</code> + le même chemin.
          </>
        }
      >
        <input value={st.superhumanThreadUrl} onChange={(e) => updateSettings({ superhumanThreadUrl: e.target.value })} />
      </Field>
      <div className="row-buttons">
        <button className="btn" disabled={testing || !st.connected.google} onClick={() => void test()}>
          {testing ? <LoaderCircle size={14} className="spin" /> : <ExternalLink size={14} />} Tester avec le dernier mail reçu
        </button>
      </div>
      <Field
        label="Lien de recherche Superhuman (avancé)"
        hint="Laissez vide : Shorteo ouvre Superhuman et copie la requête (/ puis Ctrl+V). Variables : {q} {email}"
      >
        <input value={st.superhumanSearchUrl} placeholder="(vide)" onChange={(e) => updateSettings({ superhumanSearchUrl: e.target.value })} />
      </Field>
    </div>
  );
}

function AiTab() {
  const st = useStore(settingsStore);
  useStore(indexVersion);
  const [busy, setBusy] = useState<string | null>(null);
  const run = async (kind: "chatgpt" | "claude") => {
    setBusy(kind);
    try {
      const n = await importHistory(kind);
      if (n !== null) toast(`${n.toLocaleString("fr-FR")} conversations importées`, "success");
    } catch (e) {
      toast(errorText(e), "error", 8000);
    } finally {
      setBusy(null);
    }
  };
  const info = (k: "chatgpt" | "claude") => {
    const idx = getIndex(k);
    return idx.items.length
      ? `${idx.items.length.toLocaleString("fr-FR")} conversations (import du ${fullDate(idx.meta.importedAt)})`
      : "Aucun historique importé";
  };
  return (
    <div className="tab">
      <h2>
        <SourceTile id="claude" size={22} /> ChatGPT & Claude
      </h2>
      <p className="lead small">
        « Demander à… » ouvre une nouvelle conversation pré-remplie (Claude s'ouvre dans l'app si elle est installée). Pour
        retrouver vos anciennes conversations, importez l'export officiel de vos données (aucune API ne permet de les lire
        en direct). Refaites l'import de temps en temps pour ajouter les nouvelles.
      </p>
      <h3>
        <SourceTile id="chatgpt" size={18} /> ChatGPT
      </h3>
      <ol className="steps">
        <li>
          ChatGPT → <b>Paramètres</b> → <b>Contrôles des données</b> → <b>Exporter les données</b>.
        </li>
        <li>Téléchargez le .zip reçu par e-mail, puis importez-le ici (inutile de le décompresser).</li>
      </ol>
      <div className="row-buttons">
        <button className="btn primary" disabled={!!busy} onClick={() => void run("chatgpt")}>
          {busy === "chatgpt" ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Importer l'export ChatGPT
        </button>
        <span className="muted small">{info("chatgpt")}</span>
      </div>
      <h3>
        <SourceTile id="claude" size={18} /> Claude
      </h3>
      <ol className="steps">
        <li>
          Claude → <b>Paramètres</b> → <b>Confidentialité</b> → <b>Exporter les données</b>.
        </li>
        <li>Téléchargez le .zip reçu par e-mail, puis importez-le ici.</li>
      </ol>
      <div className="row-buttons">
        <button className="btn primary" disabled={!!busy} onClick={() => void run("claude")}>
          {busy === "claude" ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Importer l'export Claude
        </button>
        <span className="muted small">{info("claude")}</span>
      </div>
      <Field label="Ouverture de Claude">
        <OpenModeSelect app="Claude" value={st.claudeOpen} onChange={(v) => updateSettings({ claudeOpen: v })} />
      </Field>
    </div>
  );
}

function TransferTab() {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [pwIn, setPwIn] = useState("");
  const [busy, setBusy] = useState<"export" | "import" | null>(null);

  const doExport = async () => {
    if (pw1.length < 8) return toast("Choisissez un mot de passe d'au moins 8 caractères", "error");
    if (pw1 !== pw2) return toast("Les deux mots de passe ne correspondent pas", "error");
    setBusy("export");
    try {
      const { content, count } = await exportConfig(pw1);
      const path = await platform.saveExportFile(content);
      if (path) {
        toast(`Configuration exportée (${count} clés) : ${path}`, "success", 8000);
        setPw1("");
        setPw2("");
      }
    } catch (e) {
      toast(errorText(e), "error", 8000);
    } finally {
      setBusy(null);
    }
  };

  const doImport = async () => {
    if (!pwIn) return toast("Saisissez le mot de passe choisi lors de l'export", "error");
    setBusy("import");
    try {
      const path = await platform.pickConfigFile();
      if (!path) return;
      const before = settingsStore.get().shortcut;
      const count = await importConfig(await platform.readJsonFile(path), pwIn);
      const after = settingsStore.get().shortcut;
      if (after !== before) await platform.setShortcut(after).catch((e) => toast(errorText(e), "error", 8000));
      setPwIn("");
      toast(`Configuration importée (${count} clés). Synchronisation en cours…`, "success", 8000);
      void syncAll(true);
    } catch (e) {
      toast(errorText(e), "error", 8000);
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="tab">
      <h2>Transférer vers un autre PC</h2>
      <p className="lead small">
        Exportez votre configuration dans un fichier <code>.shorteo</code>, puis importez-le dans Shorteo sur l'autre
        ordinateur. Le fichier est chiffré avec le mot de passe que vous choisissez (AES-256) : sans lui, il est
        illisible. Vous pouvez donc le faire passer par clé USB, Drive ou e-mail.
      </p>

      <h3>1. Exporter (sur ce PC)</h3>
      <Field label="Mot de passe du fichier" hint="Au moins 8 caractères. Il vous sera demandé à l'import ; il n'est enregistré nulle part.">
        <input type="password" value={pw1} onChange={(e) => setPw1(e.target.value)} placeholder="Mot de passe" />
      </Field>
      <Field label="Confirmer le mot de passe">
        <input
          type="password"
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void doExport()}
          placeholder="Mot de passe"
        />
      </Field>
      <div className="row-buttons">
        <button className="btn primary" disabled={!!busy} onClick={() => void doExport()}>
          {busy === "export" ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} Exporter la configuration
        </button>
      </div>

      <h3>2. Importer (sur l'autre PC)</h3>
      <Field label="Mot de passe du fichier">
        <input
          type="password"
          value={pwIn}
          onChange={(e) => setPwIn(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && void doImport()}
          placeholder="Mot de passe choisi à l'export"
        />
      </Field>
      <div className="row-buttons">
        <button className="btn primary" disabled={!!busy} onClick={() => void doImport()}>
          {busy === "import" ? <LoaderCircle size={14} className="spin" /> : <Upload size={14} />} Choisir le fichier et importer
        </button>
      </div>

      <h3>Ce qui est transféré</h3>
      <ul className="steps">
        <li>
          <b>Inclus</b> : réglages (raccourci, thème, modes d'ouverture, liens), raccourcis Drive, clé Notion (index),
          domaine et clé Pipedrive, connexion Google (Drive et mails).
        </li>
        <li>
          <b>À refaire sur chaque PC</b> : la « Recherche complète » Notion (un clic sur « Se connecter à Notion »), le
          lancement au démarrage de Windows et l'import de l'historique ChatGPT / Claude.
        </li>
        <li>
          <b>Reconstruit automatiquement</b> : l'index local (titres et métadonnées), en quelques minutes.
        </li>
      </ul>
    </div>
  );
}

function IndexTab() {
  useStore(indexVersion);
  const s = useStore(ui);
  const rows: Array<[string, string]> = [
    ["notion", "Notion"],
    ["drive", "Google Drive"],
    ["pipedrive", "Pipedrive"],
    ["contacts", "Contacts (mails)"],
    ["chatgpt", "ChatGPT"],
    ["claude", "Claude"],
  ];
  return (
    <div className="tab">
      <h2>Index & données</h2>
      <p className="lead small">
        L'index contient uniquement des titres et des métadonnées, enregistrés sur ce PC. Il est mis à jour en arrière-plan
        (seulement les changements) et complété par une recherche en direct à chaque frappe.
      </p>
      <table className="stats">
        <thead>
          <tr>
            <th>Source</th>
            <th>Éléments</th>
            <th>Mise à jour</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, label]) => {
            const idx = getIndex(k);
            const n = k === "contacts" ? (idx.meta.list?.length ?? 0) : idx.items.length;
            const when = idx.meta.lastSync ?? idx.meta.importedAt;
            return (
              <tr key={k}>
                <td>{label}</td>
                <td>{n.toLocaleString("fr-FR")}</td>
                <td>{when ? relativeDate(when) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {s.sync.errors.length > 0 && (
        <div className="errors">
          {s.sync.errors.map((e) => (
            <div key={e}>{e}</div>
          ))}
        </div>
      )}
      <div className="row-buttons">
        <button className="btn primary" disabled={s.sync.running} onClick={() => void syncAll(false)}>
          {s.sync.running ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Synchroniser maintenant
        </button>
        <button className="btn" disabled={s.sync.running} onClick={() => void syncAll(true)}>
          Tout reconstruire
        </button>
        <button
          className="btn"
          onClick={async () => {
            await clearAllIndexes();
            toast("Index vidé", "success");
          }}
        >
          <Trash2 size={14} /> Vider l'index
        </button>
      </div>
      {s.sync.running && <p className="muted small">{s.sync.label}</p>}
    </div>
  );
}

export function SettingsView() {
  const s = useStore(ui);
  const tab = s.settingsTab;
  return (
    <div className="view settings-view">
      <header className="top" onMouseDown={dragHandle}>
        <button className="back" onClick={() => closeSettings()}>
          <ArrowLeft size={15} /> Retour <kbd>Échap</kbd>
        </button>
        <span className="top-title">
          Paramètres
        </span>
        <span className="brand-mini">
          <ShorteoLogo size={16} /> Shorteo
        </span>
        <MinimizeButton />
      </header>
      <div className="settings-body">
        <nav className="settings-nav">
          {TABS.map((t) => (
            <button key={t.id} className={tab === t.id ? "active" : ""} onClick={() => ui.set({ settingsTab: t.id })}>
              {t.tile ? <SourceTile id={t.tile} size={16} /> : t.icon ? <t.icon size={16} /> : null}
              {t.label}
            </button>
          ))}
        </nav>
        <div className="settings-content">
          {tab === "welcome" && <Welcome />}
          {tab === "general" && <General />}
          {tab === "notion" && <NotionTab />}
          {tab === "pipedrive" && <PipedriveTab />}
          {tab === "google" && <GoogleTab />}
          {tab === "superhuman" && <SuperhumanTab />}
          {tab === "ai" && <AiTab />}
          {tab === "index" && <IndexTab />}
          {tab === "transfer" && <TransferTab />}
        </div>
      </div>
    </div>
  );
}
