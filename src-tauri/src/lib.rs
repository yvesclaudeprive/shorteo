//! Yateo Search — partie native (Rust).
//!
//! Rôle : fenêtre flottante + raccourci global, icône dans la barre des tâches,
//! coffre-fort Windows pour les clés, requêtes HTTP (sans contraintes CORS),
//! détection des applications installées / ouvertes, ouverture des liens
//! (deeplinks), connexion Google (OAuth loopback) et import des historiques
//! ChatGPT / Claude.

use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Write};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, State, WebviewWindow, WindowEvent};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};
use tauri_plugin_opener::OpenerExt;

const DEFAULT_SHORTCUT: &str = "Ctrl+Shift+Space";

/// Hôtes autorisés pour les requêtes HTTP (aucune autre destination possible).
const ALLOWED_HOST_SUFFIXES: &[&str] = &["api.notion.com", ".pipedrive.com", ".googleapis.com"];

/// Schémas autorisés à l'ouverture (sites web + applications).
const ALLOWED_SCHEMES: &[&str] = &[
    "https://",
    "http://",
    "notion://",
    "superhuman://",
    "claude://",
    "chatgpt://",
    "mailto:",
    "tel:",
];

struct AppState {
    shortcut: Mutex<Option<Shortcut>>,
    shortcut_error: Mutex<Option<String>>,
    hide_on_blur: Mutex<bool>,
    blur_suspended: Mutex<bool>,
    oauth: Mutex<Option<TcpListener>>,
    sys: Mutex<sysinfo::System>,
    http: reqwest::Client,
}

// ---------------------------------------------------------------------------
// Fenêtre
// ---------------------------------------------------------------------------

fn main_window(app: &AppHandle) -> Option<WebviewWindow> {
    app.get_webview_window("main")
}

/// Centre la fenêtre (un peu au-dessus du milieu) sur l'écran où se trouve la souris.
fn place_on_active_monitor(app: &AppHandle, w: &WebviewWindow) {
    let size = match w.outer_size() {
        Ok(s) => s,
        Err(_) => return,
    };
    if let (Ok(cursor), Ok(monitors)) = (app.cursor_position(), w.available_monitors()) {
        for m in monitors {
            let p = m.position();
            let s = m.size();
            let (x0, y0) = (p.x as f64, p.y as f64);
            let (x1, y1) = (x0 + s.width as f64, y0 + s.height as f64);
            if cursor.x >= x0 && cursor.x < x1 && cursor.y >= y0 && cursor.y < y1 {
                let x = p.x + (s.width as i32 - size.width as i32) / 2;
                let y = p.y + ((s.height as i32 - size.height as i32) / 3).max(0);
                let _ = w.set_position(PhysicalPosition::new(x, y));
                return;
            }
        }
    }
    let _ = w.center();
}

fn show_window(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        if !w.is_visible().unwrap_or(false) {
            place_on_active_monitor(app, &w);
        }
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
        let _ = w.emit("window-shown", ());
    }
}

fn hide_window_inner(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let _ = w.hide();
        let _ = w.emit("window-hidden", ());
    }
}

fn toggle_window(app: &AppHandle) {
    if let Some(w) = main_window(app) {
        let visible = w.is_visible().unwrap_or(false);
        let focused = w.is_focused().unwrap_or(false);
        if visible && focused {
            hide_window_inner(app);
        } else {
            show_window(app);
        }
    }
}

#[tauri::command]
fn hide_window(app: AppHandle) {
    hide_window_inner(&app);
}

#[tauri::command]
fn show_main_window(app: AppHandle) {
    show_window(&app);
}

/// Empêche temporairement la fenêtre de se masquer quand elle perd le focus
/// (sélecteur de fichier, connexion Google…).
#[tauri::command]
fn suspend_blur(state: State<AppState>, suspended: bool) {
    *state.blur_suspended.lock().unwrap() = suspended;
}

#[tauri::command]
fn quit_app(app: AppHandle) {
    app.exit(0);
}

// ---------------------------------------------------------------------------
// Fichiers locaux (paramètres + index)
// ---------------------------------------------------------------------------

fn data_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

fn write_atomic(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, bytes).map_err(|e| e.to_string())?;
    fs::rename(&tmp, path).map_err(|e| e.to_string())
}

fn safe_name(name: &str) -> Result<&str, String> {
    let ok = !name.is_empty()
        && name.len() < 64
        && name.chars().all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');
    if ok {
        Ok(name)
    } else {
        Err("Nom de fichier invalide".into())
    }
}

#[tauri::command]
fn settings_load(app: AppHandle) -> Result<Option<String>, String> {
    let p = data_dir(&app)?.join("settings.json");
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn settings_save(app: AppHandle, state: State<AppState>, data: String) -> Result<(), String> {
    let v: serde_json::Value = serde_json::from_str(&data).map_err(|e| e.to_string())?;
    if let Some(b) = v.get("hideOnBlur").and_then(|x| x.as_bool()) {
        *state.hide_on_blur.lock().unwrap() = b;
    }
    write_atomic(&data_dir(&app)?.join("settings.json"), data.as_bytes())
}

#[tauri::command]
fn index_load(app: AppHandle, name: String) -> Result<Option<String>, String> {
    let p = data_dir(&app)?.join("index").join(format!("{}.json", safe_name(&name)?));
    if !p.exists() {
        return Ok(None);
    }
    fs::read_to_string(p).map(Some).map_err(|e| e.to_string())
}

#[tauri::command]
fn index_save(app: AppHandle, name: String, data: String) -> Result<(), String> {
    let dir = data_dir(&app)?.join("index");
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    write_atomic(&dir.join(format!("{}.json", safe_name(&name)?)), data.as_bytes())
}

#[tauri::command]
fn index_clear(app: AppHandle) -> Result<(), String> {
    let dir = data_dir(&app)?.join("index");
    if dir.exists() {
        fs::remove_dir_all(dir).map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Coffre-fort des clés (Gestionnaire d'identification Windows)
// ---------------------------------------------------------------------------

#[cfg(windows)]
mod secrets {
    use std::path::Path;
    const SERVICE: &str = "yateo-search";

    fn entry(key: &str) -> Result<keyring::Entry, String> {
        keyring::Entry::new(SERVICE, key).map_err(|e| e.to_string())
    }

    pub fn get(_dir: &Path, key: &str) -> Result<Option<String>, String> {
        match entry(key)?.get_password() {
            Ok(v) => Ok(Some(v)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(e) => Err(e.to_string()),
        }
    }

    pub fn set(_dir: &Path, key: &str, value: &str) -> Result<(), String> {
        entry(key)?.set_password(value).map_err(|e| e.to_string())
    }

    pub fn delete(_dir: &Path, key: &str) -> Result<(), String> {
        match entry(key)?.delete_credential() {
            Ok(_) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(e) => Err(e.to_string()),
        }
    }
}

/// Hors Windows (développement uniquement) : simple fichier local.
#[cfg(not(windows))]
mod secrets {
    use std::collections::HashMap;
    use std::fs;
    use std::path::Path;

    fn load(dir: &Path) -> HashMap<String, String> {
        fs::read_to_string(dir.join("secrets.json"))
            .ok()
            .and_then(|s| serde_json::from_str(&s).ok())
            .unwrap_or_default()
    }

    fn save(dir: &Path, map: &HashMap<String, String>) -> Result<(), String> {
        let data = serde_json::to_string(map).map_err(|e| e.to_string())?;
        fs::write(dir.join("secrets.json"), data).map_err(|e| e.to_string())
    }

    pub fn get(dir: &Path, key: &str) -> Result<Option<String>, String> {
        Ok(load(dir).get(key).cloned())
    }

    pub fn set(dir: &Path, key: &str, value: &str) -> Result<(), String> {
        let mut m = load(dir);
        m.insert(key.to_string(), value.to_string());
        save(dir, &m)
    }

    pub fn delete(dir: &Path, key: &str) -> Result<(), String> {
        let mut m = load(dir);
        m.remove(key);
        save(dir, &m)
    }
}

#[tauri::command]
fn secret_get(app: AppHandle, key: String) -> Result<Option<String>, String> {
    secrets::get(&data_dir(&app)?, safe_name(&key)?)
}

#[tauri::command]
fn secret_set(app: AppHandle, key: String, value: String) -> Result<(), String> {
    secrets::set(&data_dir(&app)?, safe_name(&key)?, &value)
}

#[tauri::command]
fn secret_delete(app: AppHandle, key: String) -> Result<(), String> {
    secrets::delete(&data_dir(&app)?, safe_name(&key)?)
}

// ---------------------------------------------------------------------------
// Applications : installées (protocole enregistré) / ouvertes (processus)
// ---------------------------------------------------------------------------

#[derive(Serialize)]
struct AppsStatus {
    running: HashMap<String, bool>,
    installed: HashMap<String, bool>,
}

#[cfg(windows)]
fn protocol_registered(scheme: &str) -> bool {
    use winreg::enums::HKEY_CLASSES_ROOT;
    use winreg::RegKey;
    RegKey::predef(HKEY_CLASSES_ROOT)
        .open_subkey(scheme)
        .map(|k| k.get_value::<String, _>("URL Protocol").is_ok())
        .unwrap_or(false)
}

#[cfg(not(windows))]
fn protocol_registered(_scheme: &str) -> bool {
    false
}

#[tauri::command]
fn apps_status(state: State<AppState>, processes: Vec<String>, schemes: Vec<String>) -> AppsStatus {
    let mut running = HashMap::new();
    if !processes.is_empty() {
        let mut sys = state.sys.lock().unwrap();
        sys.refresh_processes_specifics(
            sysinfo::ProcessesToUpdate::All,
            true,
            sysinfo::ProcessRefreshKind::nothing(),
        );
        let names: HashSet<String> = sys
            .processes()
            .values()
            .map(|p| p.name().to_string_lossy().to_lowercase())
            .collect();
        for p in processes {
            let key = p.to_lowercase();
            running.insert(p, names.contains(&key));
        }
    }
    let installed = schemes
        .into_iter()
        .map(|s| {
            let r = protocol_registered(&s);
            (s, r)
        })
        .collect();
    AppsStatus { running, installed }
}

#[tauri::command]
fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let lower = url.to_lowercase();
    if !ALLOWED_SCHEMES.iter().any(|p| lower.starts_with(p)) {
        return Err(format!("Lien non autorisé : {url}"));
    }
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Raccourci global
// ---------------------------------------------------------------------------

fn register_shortcut(app: &AppHandle, s: &str) -> Result<Shortcut, String> {
    let sc: Shortcut = s
        .parse()
        .map_err(|e| format!("Raccourci invalide « {s} » : {e}"))?;
    app.global_shortcut()
        .register(sc)
        .map_err(|e| format!("Raccourci « {s} » indisponible (déjà utilisé par une autre application ?) : {e}"))?;
    Ok(sc)
}

#[tauri::command]
fn set_shortcut(app: AppHandle, state: State<AppState>, shortcut: String) -> Result<(), String> {
    let mut current = state.shortcut.lock().unwrap();
    let previous = current.take();
    if let Some(old) = previous {
        let _ = app.global_shortcut().unregister(old);
    }
    match register_shortcut(&app, &shortcut) {
        Ok(sc) => {
            *current = Some(sc);
            *state.shortcut_error.lock().unwrap() = None;
            Ok(())
        }
        Err(e) => {
            if let Some(old) = previous {
                if app.global_shortcut().register(old).is_ok() {
                    *current = Some(old);
                }
            }
            Err(e)
        }
    }
}

#[derive(Serialize)]
struct ShortcutStatus {
    error: Option<String>,
}

#[tauri::command]
fn shortcut_status(state: State<AppState>) -> ShortcutStatus {
    ShortcutStatus {
        error: state.shortcut_error.lock().unwrap().clone(),
    }
}

// ---------------------------------------------------------------------------
// HTTP (les appels API passent par ici : pas de CORS, hôtes limités)
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct HttpReq {
    method: String,
    url: String,
    headers: Option<HashMap<String, String>>,
    body: Option<String>,
    timeout_ms: Option<u64>,
}

#[derive(Serialize)]
struct HttpRes {
    status: u16,
    body: String,
    retry_after: Option<String>,
}

fn host_allowed(url: &str) -> bool {
    match reqwest::Url::parse(url) {
        Ok(u) if u.scheme() == "https" => {
            let host = u.host_str().unwrap_or("").to_lowercase();
            ALLOWED_HOST_SUFFIXES
                .iter()
                .any(|s| host == s.trim_start_matches('.') || (s.starts_with('.') && host.ends_with(s)))
        }
        _ => false,
    }
}

#[tauri::command]
async fn http_request(state: State<'_, AppState>, req: HttpReq) -> Result<HttpRes, String> {
    if !host_allowed(&req.url) {
        return Err(format!("Destination non autorisée : {}", req.url));
    }
    let method = reqwest::Method::from_bytes(req.method.to_uppercase().as_bytes())
        .map_err(|e| e.to_string())?;
    let mut rb = state
        .http
        .request(method, &req.url)
        .timeout(Duration::from_millis(req.timeout_ms.unwrap_or(20_000)));
    if let Some(headers) = req.headers {
        for (k, v) in headers {
            rb = rb.header(k, v);
        }
    }
    if let Some(b) = req.body {
        rb = rb.body(b);
    }
    let res = rb.send().await.map_err(|e| format!("Erreur réseau : {e}"))?;
    let status = res.status().as_u16();
    let retry_after = res
        .headers()
        .get("retry-after")
        .and_then(|v| v.to_str().ok())
        .map(|s| s.to_string());
    let body = res.text().await.map_err(|e| e.to_string())?;
    Ok(HttpRes {
        status,
        body,
        retry_after,
    })
}

// ---------------------------------------------------------------------------
// Connexion Google : redirection vers 127.0.0.1 (flux « loopback » OAuth)
// ---------------------------------------------------------------------------

#[tauri::command]
fn oauth_prepare(state: State<AppState>) -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    *state.oauth.lock().unwrap() = Some(listener);
    Ok(port)
}

fn oauth_page(ok: bool) -> String {
    let (title, text) = if ok {
        ("Connexion réussie", "Yateo Search est connecté à Google. Vous pouvez fermer cet onglet.")
    } else {
        ("Connexion annulée", "La connexion à Google n'a pas abouti. Vous pouvez fermer cet onglet et réessayer.")
    };
    format!(
        "<!doctype html><html lang=\"fr\"><head><meta charset=\"utf-8\"><title>{title}</title>\
         <style>body{{font-family:'Segoe UI',system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#0f0f14;color:#f4f4f6}}\
         .c{{text-align:center;padding:40px;border-radius:16px;background:#1a1a22;border:1px solid #2a2a35}}\
         h1{{font-size:20px;margin:0 0 8px}}p{{color:#a1a1aa;margin:0}}</style></head>\
         <body><div class=\"c\"><h1>{title}</h1><p>{text}</p></div></body></html>"
    )
}

fn wait_for_redirect(listener: TcpListener) -> Result<String, String> {
    listener.set_nonblocking(true).map_err(|e| e.to_string())?;
    let deadline = Instant::now() + Duration::from_secs(300);
    loop {
        match listener.accept() {
            Ok((mut stream, _)) => {
                let _ = stream.set_nonblocking(false);
                let _ = stream.set_read_timeout(Some(Duration::from_secs(5)));
                let mut buf = [0u8; 8192];
                let n = stream.read(&mut buf).unwrap_or(0);
                let request = String::from_utf8_lossy(&buf[..n]).to_string();
                let path = request
                    .lines()
                    .next()
                    .and_then(|l| l.split_whitespace().nth(1))
                    .unwrap_or("")
                    .to_string();
                if path.contains("code=") || path.contains("error=") {
                    let body = oauth_page(path.contains("code="));
                    let _ = write!(
                        stream,
                        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        body.len(),
                        body
                    );
                    let _ = stream.flush();
                    return Ok(path);
                }
                let _ = write!(stream, "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
            }
            Err(ref e) if e.kind() == std::io::ErrorKind::WouldBlock => {
                if Instant::now() > deadline {
                    return Err("Délai dépassé : connexion Google annulée".into());
                }
                std::thread::sleep(Duration::from_millis(150));
            }
            Err(e) => return Err(e.to_string()),
        }
    }
}

#[tauri::command]
async fn oauth_wait(app: AppHandle) -> Result<String, String> {
    let listener = {
        let state = app.state::<AppState>();
        let mut guard = state.oauth.lock().unwrap();
        guard.take()
    }
    .ok_or_else(|| "Aucune connexion en attente".to_string())?;
    let result = tauri::async_runtime::spawn_blocking(move || wait_for_redirect(listener))
        .await
        .map_err(|e| e.to_string())?;
    show_window(&app);
    result
}

// ---------------------------------------------------------------------------
// Import des historiques ChatGPT / Claude (export officiel .zip ou .json)
// ---------------------------------------------------------------------------

const HISTORY_TEXT_LIMIT: usize = 4000;

#[derive(Serialize)]
struct Conversation {
    id: String,
    title: String,
    updated_ms: Option<f64>,
    updated_iso: Option<String>,
    text: String,
}

#[derive(Deserialize)]
struct GptConv {
    id: Option<String>,
    conversation_id: Option<String>,
    title: Option<String>,
    update_time: Option<serde_json::Value>,
    create_time: Option<serde_json::Value>,
    mapping: Option<HashMap<String, GptNode>>,
}

#[derive(Deserialize)]
struct GptNode {
    message: Option<GptMsg>,
}

#[derive(Deserialize)]
struct GptMsg {
    author: Option<GptAuthor>,
    content: Option<GptContent>,
    create_time: Option<serde_json::Value>,
}

#[derive(Deserialize)]
struct GptAuthor {
    role: Option<String>,
}

#[derive(Deserialize)]
struct GptContent {
    parts: Option<Vec<serde_json::Value>>,
}

#[derive(Deserialize)]
struct ClaudeConv {
    uuid: Option<String>,
    name: Option<String>,
    updated_at: Option<String>,
    created_at: Option<String>,
    chat_messages: Option<Vec<ClaudeMsg>>,
}

#[derive(Deserialize)]
struct ClaudeMsg {
    sender: Option<String>,
    text: Option<String>,
}

fn as_f64(v: &Option<serde_json::Value>) -> Option<f64> {
    match v {
        Some(serde_json::Value::Number(n)) => n.as_f64(),
        Some(serde_json::Value::String(s)) => s.parse().ok(),
        _ => None,
    }
}

fn push_limited(out: &mut String, s: &str) {
    if out.len() >= HISTORY_TEXT_LIMIT {
        return;
    }
    if !out.is_empty() {
        out.push_str(" · ");
    }
    let remaining = HISTORY_TEXT_LIMIT.saturating_sub(out.len());
    if s.len() <= remaining {
        out.push_str(s);
    } else {
        let mut end = remaining;
        while end > 0 && !s.is_char_boundary(end) {
            end -= 1;
        }
        out.push_str(&s[..end]);
    }
}

fn read_conversation_files(path: &str) -> Result<Vec<Vec<u8>>, String> {
    if path.to_lowercase().ends_with(".zip") {
        let file = fs::File::open(path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        let mut out = Vec::new();
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let name = entry.name().to_lowercase();
            let base = name.rsplit('/').next().unwrap_or(&name).to_string();
            if base.starts_with("conversations") && base.ends_with(".json") {
                let mut buf = Vec::with_capacity(entry.size() as usize);
                entry.read_to_end(&mut buf).map_err(|e| e.to_string())?;
                out.push(buf);
            }
        }
        if out.is_empty() {
            return Err("Aucun fichier conversations.json trouvé dans l'archive".into());
        }
        Ok(out)
    } else {
        Ok(vec![fs::read(path).map_err(|e| e.to_string())?])
    }
}

fn import_history_blocking(path: &str, kind: &str) -> Result<Vec<Conversation>, String> {
    let files = read_conversation_files(path)?;
    let mut out = Vec::new();
    for bytes in files {
        if kind == "chatgpt" {
            let convs: Vec<GptConv> = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Fichier ChatGPT illisible : {e}"))?;
            for c in convs {
                let id = match c.conversation_id.or(c.id) {
                    Some(id) => id,
                    None => continue,
                };
                let mut msgs: Vec<(f64, String)> = Vec::new();
                for node in c.mapping.unwrap_or_default().into_values() {
                    if let Some(m) = node.message {
                        let is_user = m.author.and_then(|a| a.role).as_deref() == Some("user");
                        if !is_user {
                            continue;
                        }
                        let t = as_f64(&m.create_time).unwrap_or(0.0);
                        let text = m
                            .content
                            .and_then(|c| c.parts)
                            .unwrap_or_default()
                            .into_iter()
                            .filter_map(|p| p.as_str().map(|s| s.to_string()))
                            .collect::<Vec<_>>()
                            .join(" ");
                        if !text.trim().is_empty() {
                            msgs.push((t, text));
                        }
                    }
                }
                msgs.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
                let mut text = String::new();
                for (_, m) in msgs {
                    push_limited(&mut text, m.trim());
                }
                let updated = as_f64(&c.update_time).or(as_f64(&c.create_time));
                out.push(Conversation {
                    id,
                    title: c.title.unwrap_or_else(|| "Sans titre".into()),
                    updated_ms: updated.map(|t| t * 1000.0),
                    updated_iso: None,
                    text,
                });
            }
        } else {
            let convs: Vec<ClaudeConv> = serde_json::from_slice(&bytes)
                .map_err(|e| format!("Fichier Claude illisible : {e}"))?;
            for c in convs {
                let id = match c.uuid {
                    Some(id) => id,
                    None => continue,
                };
                let mut text = String::new();
                for m in c.chat_messages.unwrap_or_default() {
                    if m.sender.as_deref() == Some("human") {
                        if let Some(t) = m.text {
                            if !t.trim().is_empty() {
                                push_limited(&mut text, t.trim());
                            }
                        }
                    }
                }
                let title = c.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| "Sans titre".into());
                out.push(Conversation {
                    id,
                    title,
                    updated_ms: None,
                    updated_iso: c.updated_at.or(c.created_at),
                    text,
                });
            }
        }
    }
    Ok(out)
}

#[tauri::command]
async fn import_ai_history(path: String, kind: String) -> Result<Vec<Conversation>, String> {
    tauri::async_runtime::spawn_blocking(move || import_history_blocking(&path, &kind))
        .await
        .map_err(|e| e.to_string())?
}

// ---------------------------------------------------------------------------
// Démarrage
// ---------------------------------------------------------------------------

fn read_startup_settings(app: &AppHandle) -> (String, bool, bool) {
    let path = data_dir(app).ok().map(|d| d.join("settings.json"));
    let raw = path.as_ref().and_then(|p| fs::read_to_string(p).ok());
    let first_run = raw.is_none();
    let v: serde_json::Value = raw
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or(serde_json::Value::Null);
    let shortcut = v
        .get("shortcut")
        .and_then(|x| x.as_str())
        .filter(|s| !s.trim().is_empty())
        .unwrap_or(DEFAULT_SHORTCUT)
        .to_string();
    let hide = v.get("hideOnBlur").and_then(|x| x.as_bool()).unwrap_or(true);
    (shortcut, hide, first_run)
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
    let open_i = MenuItem::with_id(app, "open", "Ouvrir Yateo Search", true, None::<&str>)?;
    let settings_i = MenuItem::with_id(app, "settings", "Paramètres", true, None::<&str>)?;
    let sync_i = MenuItem::with_id(app, "sync", "Synchroniser maintenant", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit_i = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open_i, &settings_i, &sync_i, &sep, &quit_i])?;

    let mut builder = TrayIconBuilder::with_id("main")
        .tooltip("Yateo Search")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "settings" => {
                show_window(app);
                let _ = app.emit("open-settings", ());
            }
            "sync" => {
                let _ = app.emit("sync-now", ());
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                toggle_window(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        builder = builder.icon(icon.clone());
    }
    builder.build(app)?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let http = reqwest::Client::builder()
        .user_agent(concat!("YateoSearch/", env!("CARGO_PKG_VERSION")))
        .gzip(true)
        .build()
        .expect("client HTTP");

    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_window(app);
        }))
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == ShortcutState::Pressed {
                        toggle_window(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .manage(AppState {
            shortcut: Mutex::new(None),
            shortcut_error: Mutex::new(None),
            hide_on_blur: Mutex::new(true),
            blur_suspended: Mutex::new(false),
            oauth: Mutex::new(None),
            sys: Mutex::new(sysinfo::System::new()),
            http,
        })
        .setup(|app| {
            let handle = app.handle().clone();
            let (shortcut, hide, first_run) = read_startup_settings(&handle);
            {
                let state = handle.state::<AppState>();
                *state.hide_on_blur.lock().unwrap() = hide;
                match register_shortcut(&handle, &shortcut) {
                    Ok(sc) => *state.shortcut.lock().unwrap() = Some(sc),
                    Err(e) => {
                        *state.shortcut_error.lock().unwrap() = Some(e);
                        if shortcut != DEFAULT_SHORTCUT {
                            if let Ok(sc) = register_shortcut(&handle, DEFAULT_SHORTCUT) {
                                *state.shortcut.lock().unwrap() = Some(sc);
                            }
                        }
                    }
                }
            }
            build_tray(&handle)?;
            if first_run {
                show_window(&handle);
            }
            Ok(())
        })
        .on_window_event(|window, event| match event {
            WindowEvent::Focused(false) => {
                let app = window.app_handle();
                let state = app.state::<AppState>();
                let hide = *state.hide_on_blur.lock().unwrap();
                let suspended = *state.blur_suspended.lock().unwrap();
                if hide && !suspended {
                    let _ = window.hide();
                    let _ = window.emit("window-hidden", ());
                }
            }
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let _ = window.hide();
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            hide_window,
            show_main_window,
            suspend_blur,
            quit_app,
            settings_load,
            settings_save,
            index_load,
            index_save,
            index_clear,
            secret_get,
            secret_set,
            secret_delete,
            apps_status,
            open_url,
            set_shortcut,
            shortcut_status,
            http_request,
            oauth_prepare,
            oauth_wait,
            import_ai_history
        ])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de Yateo Search");
}
