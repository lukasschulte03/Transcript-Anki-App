use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::TryRngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::{HashMap, HashSet},
    io,
    path::{Path, PathBuf},
    process::Stdio,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{
    fs,
    io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader},
    net::TcpListener,
    process::Command,
    sync::oneshot,
    time,
};

static CANCELLED_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static CANCELLED_TRANSCRIPTIONS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();
static GOOGLE_OAUTH_SESSIONS: OnceLock<Mutex<HashMap<String, GoogleOAuthSession>>> =
    OnceLock::new();

const GOOGLE_DRIVE_CLIENT_ID: &str =
    "607463229684-df99plb7hagdnlfsr1uleko6q6g78lpi.apps.googleusercontent.com";
const GOOGLE_DRIVE_CREDENTIAL_KEY: &str = "cloud-sync-google-drive";
const GOOGLE_DRIVE_CLIENT_SECRET_KEY: &str = "google-drive-client-secret";
const BUNDLED_GOOGLE_DRIVE_CLIENT_SECRET: Option<&str> =
    option_env!("LECTIO_GOOGLE_DRIVE_CLIENT_SECRET");

struct GoogleOAuthSession {
    receiver: Option<oneshot::Receiver<Result<String, String>>>,
    cancel: Option<oneshot::Sender<()>>,
    verifier: String,
    redirect_uri: String,
}

#[derive(Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    refresh_token: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveAbout {
    user: Option<GoogleDriveUser>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveUser {
    display_name: Option<String>,
    email_address: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveCredential {
    refresh_token: String,
    account_label: String,
    connected_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleDriveConnection {
    account_label: String,
    connected_at: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct GoogleOAuthStart {
    session_id: String,
    authorization_url: String,
}

fn google_oauth_sessions() -> &'static Mutex<HashMap<String, GoogleOAuthSession>> {
    GOOGLE_OAUTH_SESSIONS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn secure_random_url_value(bytes: usize) -> Result<String, String> {
    let mut buffer = vec![0_u8; bytes];
    rand::rngs::OsRng
        .try_fill_bytes(&mut buffer)
        .map_err(|error| format!("Kunde inte skapa en säker OAuth-session: {error}"))?;
    Ok(URL_SAFE_NO_PAD.encode(buffer))
}

fn oauth_response(status: &str, body: &str) -> String {
    let document = format!(
        "<!doctype html><html lang=\"sv\"><meta charset=\"utf-8\"><title>Lectio</title><body style=\"font-family:system-ui;max-width:38rem;margin:12vh auto;padding:0 1.5rem\"><h1>{}</h1><p>{}</p><p>Du kan stänga det här fönstret och återgå till Lectio.</p></body></html>",
        if status.starts_with("200") { "Google Drive är anslutet" } else { "Kunde inte ansluta Google Drive" },
        body
    );
    format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{document}",
        document.len(),
    )
}

fn google_oauth_error(error: &str) -> String {
    match error {
        "access_denied" => "Google-inloggningen avbröts eller nekades. Du kan försöka igen när du vill.".into(),
        "temporarily_unavailable" => "Google är tillfälligt otillgängligt. Försök igen om en stund.".into(),
        _ => "Google kunde inte slutföra inloggningen. Försök igen.".into(),
    }
}

async fn receive_google_oauth_callback(
    listener: TcpListener,
    expected_state: String,
    sender: oneshot::Sender<Result<String, String>>,
) {
    let result = async {
        let (mut stream, _) = listener.accept().await.map_err(|error| error.to_string())?;
        let mut request = vec![0_u8; 8_192];
        let size = stream
            .read(&mut request)
            .await
            .map_err(|error| error.to_string())?;
        let request = String::from_utf8_lossy(&request[..size]);
        let target = request
            .lines()
            .next()
            .and_then(|line| line.split_whitespace().nth(1))
            .ok_or_else(|| "Ogiltigt svar från webbläsaren".to_string())?;
        let callback = url::Url::parse(&format!("http://127.0.0.1{target}"))
            .map_err(|_| "Ogiltigt OAuth-svar".to_string())?;
        let parameters: HashMap<_, _> = callback.query_pairs().into_owned().collect();
        let outcome = match (
            parameters.get("code"),
            parameters.get("state"),
            parameters.get("error"),
        ) {
            (_, _, Some(error)) => Err(google_oauth_error(error)),
            (Some(code), Some(state), _) if state == &expected_state => Ok(code.clone()),
            (Some(_), _, _) => Err("OAuth-svaret kunde inte verifieras. Försök igen.".into()),
            _ => Err("Google skickade ingen auktoriseringskod.".into()),
        };
        let response = match &outcome {
            Ok(_) => oauth_response("200 OK", "Kontot har verifierats säkert."),
            Err(error) => oauth_response("400 Bad Request", error),
        };
        let _ = stream.write_all(response.as_bytes()).await;
        outcome
    }
    .await;
    let _ = sender.send(result);
}

/// Finds Whisper's JSON output without relying on a single filename convention.
/// Each transcription uses its own directory, so any JSON file found there belongs
/// to that invocation even when a Whisper build formats `--output-file` differently.
async fn find_whisper_json_output(
    run_dir: &Path,
    expected: &Path,
) -> Result<Option<PathBuf>, String> {
    if expected.is_file() {
        return Ok(Some(expected.to_path_buf()));
    }

    let mut entries = fs::read_dir(run_dir)
        .await
        .map_err(|error| format!("Kunde inte läsa Whispers resultatmapp: {error}"))?;
    let mut candidates = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Kunde inte läsa Whispers resultatfiler: {error}"))?
    {
        let path = entry.path();
        let is_json = path
            .extension()
            .map(|extension| extension.to_string_lossy().eq_ignore_ascii_case("json"))
            .unwrap_or(false);
        if is_json
            && entry
                .file_type()
                .await
                .map(|file_type| file_type.is_file())
                .unwrap_or(false)
        {
            candidates.push(path);
        }
    }
    candidates.sort();
    Ok(candidates.into_iter().next())
}

fn process_output_excerpt(bytes: &[u8]) -> String {
    let output = String::from_utf8_lossy(bytes)
        .replace('\0', "")
        .trim()
        .to_string();
    if output.is_empty() {
        return String::new();
    }
    let mut excerpt: String = output.chars().take(1_200).collect();
    if output.chars().count() > excerpt.chars().count() {
        excerpt.push('…');
    }
    excerpt
}

/// Extracts the end timestamp from whisper.cpp's streaming output, for example
/// `[00:01:12.500 --> 00:01:18.300]  Text`.
fn whisper_progress_seconds(line: &str) -> Option<f64> {
    let end = line.split("-->").nth(1)?.split(']').next()?.trim();
    let values = end
        .split(':')
        .map(str::trim)
        .map(|value| value.parse::<f64>().ok())
        .collect::<Option<Vec<_>>>()?;
    match values.as_slice() {
        [minutes, seconds] => Some(minutes * 60.0 + seconds),
        [hours, minutes, seconds] => Some(hours * 3600.0 + minutes * 60.0 + seconds),
        _ => None,
    }
}

/// The WAV created immediately before inference is always 16 kHz, mono and
/// signed 16-bit PCM. Its byte size therefore gives a stable duration without
/// a second probe process.
async fn wav_duration_millis(path: &Path) -> Option<u64> {
    let bytes = fs::metadata(path).await.ok()?.len().saturating_sub(44);
    Some(bytes.saturating_mul(1_000) / 32_000)
}

#[cfg(test)]
mod whisper_progress_tests {
    use super::whisper_progress_seconds;

    #[test]
    fn reads_whisper_segment_end_timestamps() {
        assert_eq!(
            whisper_progress_seconds("[00:01:12.500 --> 00:01:18.300]  Ett segment"),
            Some(78.3),
        );
        assert_eq!(
            whisper_progress_seconds("[01:02:03.000 --> 01:02:10.000]  Senare"),
            Some(3_730.0),
        );
        assert_eq!(whisper_progress_seconds("ingen tidsstämpel"), None);
    }
}

fn cancelled_downloads() -> &'static Mutex<HashSet<String>> {
    CANCELLED_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn cancelled_transcriptions() -> &'static Mutex<HashSet<String>> {
    CANCELLED_TRANSCRIPTIONS.get_or_init(|| Mutex::new(HashSet::new()))
}

fn begin_transcription(id: &str) {
    if let Ok(mut transcriptions) = cancelled_transcriptions().lock() {
        transcriptions.remove(id);
    }
}

fn transcription_is_cancelled(id: &str) -> bool {
    cancelled_transcriptions()
        .lock()
        .map(|transcriptions| transcriptions.contains(id))
        .unwrap_or(false)
}

fn finish_transcription(id: &str) {
    if let Ok(mut transcriptions) = cancelled_transcriptions().lock() {
        transcriptions.remove(id);
    }
}

fn begin_download(id: &str) {
    if let Ok(mut downloads) = cancelled_downloads().lock() {
        downloads.remove(id);
    }
}

fn download_is_cancelled(id: &str) -> bool {
    cancelled_downloads()
        .lock()
        .map(|downloads| downloads.contains(id))
        .unwrap_or(false)
}

#[tauri::command]
async fn cancel_download(job_id: String) -> Result<(), String> {
    let mut downloads = cancelled_downloads()
        .lock()
        .map_err(|_| "Kunde inte avbryta nedladdningen".to_string())?;
    downloads.insert(job_id);
    Ok(())
}

#[tauri::command]
async fn cancel_transcription(job_id: String) -> Result<(), String> {
    let mut transcriptions = cancelled_transcriptions()
        .lock()
        .map_err(|_| "Kunde inte avbryta transkriberingen".to_string())?;
    transcriptions.insert(job_id);
    Ok(())
}

fn credential_entry(key: &str) -> Result<keyring::Entry, String> {
    if key.is_empty()
        || !key.chars().all(|character| {
            character.is_ascii_alphanumeric() || matches!(character, ':' | '-' | '_')
        })
    {
        return Err("Ogiltigt credential-namn".into());
    }
    keyring::Entry::new("Lectio", key).map_err(|error| error.to_string())
}

async fn google_drive_client_secret() -> Result<String, String> {
    if let Some(secret) = BUNDLED_GOOGLE_DRIVE_CLIENT_SECRET.filter(|value| !value.trim().is_empty()) {
        return Ok((*secret).to_string());
    }
    tokio::task::spawn_blocking(|| {
        credential_entry(GOOGLE_DRIVE_CLIENT_SECRET_KEY)?
            .get_password()
            .map_err(|_| {
                "Google Drive-klientkonfigurationen saknas. Installera den senaste Lectio-versionen."
                    .to_string()
            })
    })
    .await
    .map_err(|error| error.to_string())?
}

async fn refresh_google_drive_access_token() -> Result<String, String> {
    let credential = tokio::task::spawn_blocking(|| {
        credential_entry(GOOGLE_DRIVE_CREDENTIAL_KEY)?
            .get_password()
            .map_err(|_| "Google Drive är inte anslutet. Koppla kontot igen under Inställningar.".to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    let credential: GoogleDriveCredential = serde_json::from_str(&credential)
        .map_err(|_| "Google Drive-anslutningen kunde inte läsas. Koppla kontot igen.".to_string())?;
    let client_secret = google_drive_client_secret().await?;
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", GOOGLE_DRIVE_CLIENT_ID),
            ("client_secret", &client_secret),
            ("refresh_token", &credential.refresh_token),
            ("grant_type", "refresh_token"),
        ])
        .send()
        .await
        .map_err(|error| format!("Kunde inte förnya Google Drive-anslutningen: {error}"))?;
    if !response.status().is_success() {
        return Err("Google Drive-sessionen har gått ut. Koppla kontot igen under Inställningar.".into());
    }
    response
        .json::<GoogleTokenResponse>()
        .await
        .map(|token| token.access_token)
        .map_err(|error| format!("Kunde inte läsa Googles sessionssvar: {error}"))
}

#[tauri::command]
async fn read_credential(key: String) -> Result<Option<String>, String> {
    tokio::task::spawn_blocking(move || {
        let entry = credential_entry(&key)?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn write_credential(key: String, secret: String) -> Result<(), String> {
    if secret.trim().is_empty() {
        return Err("API-nyckeln kan inte vara tom".into());
    }
    tokio::task::spawn_blocking(move || {
        credential_entry(&key)?
            .set_password(&secret)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_credential(key: String) -> Result<(), String> {
    tokio::task::spawn_blocking(move || {
        let entry = credential_entry(&key)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn start_google_drive_oauth() -> Result<GoogleOAuthStart, String> {
    if !google_oauth_sessions()
        .lock()
        .map_err(|_| "Kunde inte läsa OAuth-sessioner".to_string())?
        .is_empty()
    {
        return Err("En Google-inloggning pågår redan. Avbryt den eller slutför den först.".into());
    }
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|error| format!("Kunde inte starta den lokala inloggningen: {error}"))?;
    let port = listener
        .local_addr()
        .map_err(|error| error.to_string())?
        .port();
    let session_id = secure_random_url_value(24)?;
    let state = secure_random_url_value(32)?;
    let verifier = secure_random_url_value(64)?;
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let redirect_uri = format!("http://127.0.0.1:{port}/oauth/google-drive");
    let (sender, receiver) = oneshot::channel();
    let (cancel_sender, cancel_receiver) = oneshot::channel();
    let callback_state = state.clone();
    tauri::async_runtime::spawn(async move {
        let receive = receive_google_oauth_callback(listener, callback_state, sender);
        tokio::select! {
            _ = time::timeout(Duration::from_secs(300), receive) => {},
            _ = cancel_receiver => {},
        }
    });
    google_oauth_sessions()
        .lock()
        .map_err(|_| "Kunde inte spara OAuth-sessionen".to_string())?
        .insert(
            session_id.clone(),
            GoogleOAuthSession {
                receiver: Some(receiver),
                cancel: Some(cancel_sender),
                verifier,
                redirect_uri: redirect_uri.clone(),
            },
        );

    let authorization_url = url::Url::parse("https://accounts.google.com/o/oauth2/v2/auth")
        .map_err(|error| error.to_string())?
        .query_pairs_mut()
        .append_pair("client_id", GOOGLE_DRIVE_CLIENT_ID)
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", "https://www.googleapis.com/auth/drive.file")
        .append_pair("state", &state)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .finish()
        .to_string();

    Ok(GoogleOAuthStart {
        session_id,
        authorization_url,
    })
}

/// Stops a locally pending OAuth attempt. The browser page may remain open,
/// but its state/verifier is immediately discarded and cannot be reused.
#[tauri::command]
async fn cancel_google_drive_oauth(session_id: String) -> Result<(), String> {
    let removed = google_oauth_sessions()
        .lock()
        .map_err(|_| "Kunde inte avbryta inloggningen".to_string())?
        .remove(&session_id);
    if let Some(mut session) = removed {
        if let Some(cancel) = session.cancel.take() {
            let _ = cancel.send(());
        }
        Ok(())
    } else {
        Err("Inloggningssessionen är redan avslutad. Försök igen.".into())
    }
}

#[tauri::command]
async fn complete_google_drive_oauth(session_id: String) -> Result<GoogleDriveConnection, String> {
    let (receiver, verifier, redirect_uri) = google_oauth_sessions()
        .lock()
        .map_err(|_| "Kunde inte läsa OAuth-sessionen".to_string())?
        .get_mut(&session_id)
        .ok_or_else(|| "Inloggningssessionen saknas eller har gått ut. Försök igen.".to_string())
        .and_then(|session| {
            session
                .receiver
                .take()
                .map(|receiver| (receiver, session.verifier.clone(), session.redirect_uri.clone()))
                .ok_or_else(|| "Inloggningen väntar redan på ett svar. Försök igen om en stund.".to_string())
        })?;
    let code_result = receiver
        .await
        .map_err(|_| "Inloggningen hann gå ut. Försök igen.".to_string());
    let _ = google_oauth_sessions().lock().map(|mut sessions| sessions.remove(&session_id));
    let code = code_result??;
    let client_secret = google_drive_client_secret().await?;
    let response = reqwest::Client::new()
        .post("https://oauth2.googleapis.com/token")
        .form(&[
            ("client_id", GOOGLE_DRIVE_CLIENT_ID),
            ("client_secret", &client_secret),
            ("code", &code),
            ("code_verifier", &verifier),
            ("redirect_uri", &redirect_uri),
            ("grant_type", "authorization_code"),
        ])
        .send()
        .await
        .map_err(|error| format!("Kunde inte kontakta Google: {error}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let detail = response.text().await.unwrap_or_default();
        return Err(format!(
            "Google kunde inte slutföra inloggningen ({status}): {detail}"
        ));
    }
    let token: GoogleTokenResponse = response
        .json()
        .await
        .map_err(|error| format!("Kunde inte läsa Googles tokensvar: {error}"))?;
    let refresh_token = token.refresh_token.ok_or_else(|| {
        "Google skickade ingen förnyelsetoken. Koppla bort kontot i Googles kontoinställningar och försök igen."
            .to_string()
    })?;
    let about_response = reqwest::Client::new()
        .get("https://www.googleapis.com/drive/v3/about?fields=user(displayName,emailAddress)")
        .bearer_auth(&token.access_token)
        .send()
        .await
        .map_err(|error| format!("Kunde inte verifiera Google Drive-kontot: {error}"))?;
    if !about_response.status().is_success() {
        return Err("Google Drive avvisade den nya anslutningen. Försök igen.".into());
    }
    let about: GoogleDriveAbout = about_response
        .json()
        .await
        .map_err(|error| format!("Kunde inte läsa Google Drive-kontot: {error}"))?;
    let account_label = about
        .user
        .and_then(|user| user.display_name.or(user.email_address))
        .unwrap_or_else(|| "Google Drive".into());
    let connected_at = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_secs()
        .to_string();
    let credential = GoogleDriveCredential {
        refresh_token,
        account_label: account_label.clone(),
        connected_at: connected_at.clone(),
    };
    tokio::task::spawn_blocking(move || {
        credential_entry(GOOGLE_DRIVE_CREDENTIAL_KEY)?
            .set_password(
                &serde_json::to_string(&credential)
                    .map_err(|error| format!("Kunde inte skydda Google-token: {error}"))?,
            )
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(GoogleDriveConnection {
        account_label,
        connected_at,
    })
}

#[tauri::command]
async fn disconnect_google_drive() -> Result<(), String> {
    tokio::task::spawn_blocking(|| {
        let entry = credential_entry(GOOGLE_DRIVE_CREDENTIAL_KEY)?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Returns a short-lived token for the current sync operation. The refresh
/// token remains in Windows Credential Manager and is never exposed to JS.
#[tauri::command]
async fn google_drive_access_token() -> Result<String, String> {
    refresh_google_drive_access_token().await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalModelStatus {
    model: String,
    installed: bool,
    size: u64,
    path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalEngineStatus {
    nvidia_detected: bool,
    nvidia_name: Option<String>,
    nvidia_runtime_installed: bool,
    nvidia_runtime_ready: bool,
    nvidia_runtime_size: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticSnapshot {
    os: String,
    architecture: String,
    app_version: String,
    cpu_threads: usize,
    nvidia_detected: bool,
    nvidia_runtime_installed: bool,
    nvidia_runtime_ready: bool,
    whisper_models: Vec<String>,
    ffmpeg_available: bool,
    bundled_whisper_available: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent {
    id: String,
    kind: String,
    label: String,
    phase: String,
    status: String,
    current: u64,
    total: Option<u64>,
    detail: Option<String>,
}

fn emit_progress(
    app: &AppHandle,
    id: &str,
    kind: &str,
    label: &str,
    phase: &str,
    status: &str,
    current: u64,
    total: Option<u64>,
    detail: Option<String>,
) {
    let _ = app.emit(
        "lectio:progress",
        ProgressEvent {
            id: id.into(),
            kind: kind.into(),
            label: label.into(),
            phase: phase.into(),
            status: status.into(),
            current,
            total,
            detail,
        },
    );
}

// CUDA 12.4's official whisper.cpp package includes the complete backend
// dependency set required by recent NVIDIA drivers. The older 11.8 package
// could leave ggml-cuda.dll unloadable on otherwise compatible Windows PCs.
const NVIDIA_RUNTIME_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-cublas-12.4.0-bin-x64.zip";

fn valid_model(model: &str) -> Result<&str, String> {
    match model {
        "tiny" | "base" | "small" | "medium" | "large-v3-turbo" | "large-v3" => Ok(model),
        _ => Err("Okänd Whisper-modell".into()),
    }
}

fn models_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("models"))
        .map_err(|error| error.to_string())
}

fn nvidia_runtime_dir(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|path| path.join("runtimes").join("nvidia-cuda-12.4"))
        .map_err(|error| error.to_string())
}

fn find_file(directory: &std::path::Path, name: &str) -> Option<PathBuf> {
    let entries = std::fs::read_dir(directory).ok()?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            if let Some(found) = find_file(&path, name) {
                return Some(found);
            }
        } else if path
            .file_name()
            .is_some_and(|file_name| file_name.to_string_lossy().eq_ignore_ascii_case(name))
        {
            return Some(path);
        }
    }
    None
}

fn directory_size(directory: &std::path::Path) -> u64 {
    std::fs::read_dir(directory)
        .map(|entries| {
            entries
                .flatten()
                .map(|entry| {
                    let path = entry.path();
                    if path.is_dir() {
                        directory_size(&path)
                    } else {
                        entry.metadata().map(|metadata| metadata.len()).unwrap_or(0)
                    }
                })
                .sum()
        })
        .unwrap_or(0)
}

async fn nvidia_gpu_name() -> Option<String> {
    let output = Command::new("nvidia-smi")
        .args(["--query-gpu=name", "--format=csv,noheader"])
        .output()
        .await
        .ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .find(|line| !line.is_empty())
        .map(str::to_string)
}

/// Presence of an executable is not enough: a partial CUDA runtime can leave
/// whisper.cpp silently running on CPU. The binary reports its loaded backend
/// during `--version`, which is a quick, model-free verification.
async fn nvidia_runtime_is_ready(runtime_dir: &Path) -> bool {
    let Some(whisper) = find_file(runtime_dir, "whisper-cli.exe") else {
        return false;
    };
    let output = Command::new(&whisper)
        .current_dir(whisper.parent().unwrap_or(runtime_dir))
        .arg("--version")
        .output()
        .await;
    let Ok(output) = output else {
        return false;
    };
    let report = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
    .to_ascii_lowercase();
    report.contains("loaded cuda backend")
}

async fn engine_status(app: &AppHandle) -> Result<LocalEngineStatus, String> {
    let runtime_dir = nvidia_runtime_dir(app)?;
    let nvidia_name = nvidia_gpu_name().await;
    let nvidia_runtime_installed = find_file(&runtime_dir, "whisper-cli.exe").is_some();
    Ok(LocalEngineStatus {
        nvidia_detected: nvidia_name.is_some(),
        nvidia_name,
        nvidia_runtime_installed,
        nvidia_runtime_ready: nvidia_runtime_installed && nvidia_runtime_is_ready(&runtime_dir).await,
        nvidia_runtime_size: directory_size(&runtime_dir),
    })
}

#[tauri::command]
async fn local_engine_status(app: AppHandle) -> Result<LocalEngineStatus, String> {
    engine_status(&app).await
}

#[tauri::command]
async fn diagnostic_snapshot(app: AppHandle) -> Result<DiagnosticSnapshot, String> {
    let engine = engine_status(&app).await?;
    let models = [
        "tiny",
        "base",
        "small",
        "medium",
        "large-v3-turbo",
        "large-v3",
    ]
    .into_iter()
    .filter(|model| {
        models_dir(&app)
            .map(|dir| dir.join(format!("ggml-{model}.bin")).is_file())
            .unwrap_or(false)
    })
    .map(str::to_string)
    .collect();
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    Ok(DiagnosticSnapshot {
        os: std::env::consts::OS.into(),
        architecture: std::env::consts::ARCH.into(),
        app_version: env!("CARGO_PKG_VERSION").into(),
        cpu_threads: std::thread::available_parallelism()
            .map(|value| value.get())
            .unwrap_or(0),
        nvidia_detected: engine.nvidia_detected,
        nvidia_runtime_installed: engine.nvidia_runtime_installed,
        nvidia_runtime_ready: engine.nvidia_runtime_ready,
        whisper_models: models,
        ffmpeg_available: resource_dir.join("ffmpeg").join("ffmpeg.exe").is_file(),
        bundled_whisper_available: resource_dir
            .join("whisper")
            .join("whisper-cli.exe")
            .is_file(),
    })
}

#[tauri::command]
async fn install_nvidia_runtime(app: AppHandle) -> Result<LocalEngineStatus, String> {
    let job_id = "download:nvidia-runtime";
    let label = "NVIDIA-stöd för Whisper";
    let runtime_dir = nvidia_runtime_dir(&app)?;
    if nvidia_runtime_is_ready(&runtime_dir).await {
        return engine_status(&app).await;
    }
    if runtime_dir.exists() {
        fs::remove_dir_all(&runtime_dir)
            .await
            .map_err(|error| format!("Kunde inte ersätta ofullständigt NVIDIA-stöd: {error}"))?;
    }
    begin_download(job_id);
    let parent = runtime_dir
        .parent()
        .ok_or_else(|| "Ogiltig runtime-sökväg".to_string())?;
    fs::create_dir_all(parent)
        .await
        .map_err(|error| error.to_string())?;
    let archive_path = parent.join("nvidia-cuda-11.8.zip.part");
    let client = reqwest::Client::builder()
        .user_agent("Lectio/0.4")
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client
        .get(NVIDIA_RUNTIME_URL)
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let total = response.content_length();
    let mut downloaded = 0_u64;
    let mut last_reported = 0_u64;
    emit_progress(
        &app,
        job_id,
        "download",
        label,
        "downloading",
        "active",
        0,
        total,
        None,
    );
    let mut archive_file = fs::File::create(&archive_path)
        .await
        .map_err(|error| error.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if download_is_cancelled(job_id) {
            drop(archive_file);
            emit_progress(
                &app,
                job_id,
                "download",
                label,
                "error",
                "error",
                downloaded,
                total,
                Some("Nedladdningen avbröts. Delvis fil kan återanvändas vid nästa försök.".into()),
            );
            return Err("Nedladdningen avbröts".into());
        }
        archive_file
            .write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_reported) >= 1_000_000 || total == Some(downloaded) {
            emit_progress(
                &app,
                job_id,
                "download",
                label,
                "downloading",
                "active",
                downloaded,
                total,
                None,
            );
            last_reported = downloaded;
        }
    }
    archive_file
        .flush()
        .await
        .map_err(|error| error.to_string())?;
    drop(archive_file);
    if total.is_some_and(|expected| expected != downloaded) {
        emit_progress(
            &app,
            job_id,
            "download",
            label,
            "error",
            "error",
            downloaded,
            total,
            Some("Filstorleken stämmer inte; försök igen.".into()),
        );
        return Err("NVIDIA-paketets storlek stämmer inte med nedladdningen".into());
    }
    emit_progress(
        &app,
        job_id,
        "download",
        label,
        "extracting",
        "active",
        downloaded,
        total,
        Some("Packar upp CUDA-runtime…".into()),
    );

    let archive_for_extract = archive_path.clone();
    let destination_for_extract = runtime_dir.clone();
    tokio::task::spawn_blocking(move || -> Result<(), String> {
        std::fs::create_dir_all(&destination_for_extract).map_err(|error| error.to_string())?;
        let file = std::fs::File::open(&archive_for_extract).map_err(|error| error.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|error| error.to_string())?;
        for index in 0..archive.len() {
            let mut entry = archive.by_index(index).map_err(|error| error.to_string())?;
            let Some(relative_path) = entry.enclosed_name() else {
                continue;
            };
            let output_path = destination_for_extract.join(relative_path);
            if entry.is_dir() {
                std::fs::create_dir_all(&output_path).map_err(|error| error.to_string())?;
            } else {
                if let Some(parent) = output_path.parent() {
                    std::fs::create_dir_all(parent).map_err(|error| error.to_string())?;
                }
                let mut output =
                    std::fs::File::create(&output_path).map_err(|error| error.to_string())?;
                io::copy(&mut entry, &mut output).map_err(|error| error.to_string())?;
            }
        }
        Ok(())
    })
    .await
    .map_err(|error| error.to_string())??;
    let _ = fs::remove_file(&archive_path).await;
    if find_file(&runtime_dir, "whisper-cli.exe").is_none() {
        emit_progress(
            &app,
            job_id,
            "download",
            label,
            "error",
            "error",
            downloaded,
            total,
            Some("CUDA-paketet saknade Whisper.".into()),
        );
        return Err("CUDA-paketet saknade whisper-cli.exe".into());
    }
    emit_progress(
        &app,
        job_id,
        "download",
        label,
        "complete",
        "complete",
        downloaded,
        total,
        Some("NVIDIA-stöd är klart.".into()),
    );
    engine_status(&app).await
}

#[tauri::command]
async fn remove_nvidia_runtime(app: AppHandle) -> Result<(), String> {
    let runtime_dir = nvidia_runtime_dir(&app)?;
    if runtime_dir.exists() {
        fs::remove_dir_all(runtime_dir)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn local_model_status(app: AppHandle, model: String) -> Result<LocalModelStatus, String> {
    let model = valid_model(&model)?;
    let path = models_dir(&app)?.join(format!("ggml-{model}.bin"));
    let metadata = fs::metadata(&path).await.ok();
    Ok(LocalModelStatus {
        model: model.to_string(),
        installed: metadata.is_some(),
        size: metadata.map(|value| value.len()).unwrap_or(0),
        path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn download_local_model(app: AppHandle, model: String) -> Result<LocalModelStatus, String> {
    let model = valid_model(&model)?.to_string();
    let job_id = format!("download:model:{model}");
    let label = format!("Whisper {model}");
    let directory = models_dir(&app)?;
    fs::create_dir_all(&directory)
        .await
        .map_err(|error| error.to_string())?;
    let destination = directory.join(format!("ggml-{model}.bin"));
    let partial = directory.join(format!("ggml-{model}.bin.part"));
    let url = format!("https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-{model}.bin");
    begin_download(&job_id);
    let existing_size = fs::metadata(&partial)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let client = reqwest::Client::builder()
        .user_agent("Lectio/0.1")
        .build()
        .map_err(|error| error.to_string())?;
    let mut request = client.get(url);
    if existing_size > 0 {
        request = request.header(reqwest::header::RANGE, format!("bytes={existing_size}-"));
    }
    let mut response = request
        .send()
        .await
        .map_err(|error| error.to_string())?
        .error_for_status()
        .map_err(|error| error.to_string())?;
    let resumed = existing_size > 0 && response.status() == reqwest::StatusCode::PARTIAL_CONTENT;
    let mut downloaded = if resumed { existing_size } else { 0 };
    let total = response.content_length().map(|size| size + downloaded);
    let mut last_reported = downloaded;
    emit_progress(
        &app,
        &job_id,
        "download",
        &label,
        "downloading",
        "active",
        downloaded,
        total,
        if resumed {
            Some("Återupptar tidigare nedladdning…".into())
        } else {
            None
        },
    );
    let mut file = if resumed {
        fs::OpenOptions::new().append(true).open(&partial).await
    } else {
        fs::File::create(&partial).await
    }
    .map_err(|error| error.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if download_is_cancelled(&job_id) {
            drop(file);
            emit_progress(
                &app,
                &job_id,
                "download",
                &label,
                "error",
                "error",
                downloaded,
                total,
                Some("Nedladdningen avbröts. Delvis fil kan återupptas senare.".into()),
            );
            return Err("Nedladdningen avbröts".into());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_reported) >= 1_000_000 || total == Some(downloaded) {
            emit_progress(
                &app,
                &job_id,
                "download",
                &label,
                "downloading",
                "active",
                downloaded,
                total,
                None,
            );
            last_reported = downloaded;
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    if total.is_some_and(|expected| expected != downloaded) {
        emit_progress(
            &app,
            &job_id,
            "download",
            &label,
            "error",
            "error",
            downloaded,
            total,
            Some("Filstorleken stämmer inte; försök igen.".into()),
        );
        return Err("Modellfilens storlek stämmer inte med nedladdningen".into());
    }
    fs::rename(&partial, &destination)
        .await
        .map_err(|error| error.to_string())?;
    let size = fs::metadata(&destination)
        .await
        .map_err(|error| error.to_string())?
        .len();
    emit_progress(
        &app,
        &job_id,
        "download",
        &label,
        "complete",
        "complete",
        size,
        total,
        Some("Modellen är klar att använda.".into()),
    );
    Ok(LocalModelStatus {
        model,
        installed: true,
        size,
        path: destination.to_string_lossy().to_string(),
    })
}

#[tauri::command]
async fn remove_local_model(app: AppHandle, model: String) -> Result<(), String> {
    let model = valid_model(&model)?;
    let path = models_dir(&app)?.join(format!("ggml-{model}.bin"));
    if path.exists() {
        fs::remove_file(path)
            .await
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn open_anki_desktop() -> Result<(), String> {
    let mut candidates = vec![
        PathBuf::from(r"C:\Program Files\Anki\anki.exe"),
        PathBuf::from(r"C:\Program Files (x86)\Anki\anki.exe"),
    ];
    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        candidates.push(
            PathBuf::from(local_app_data)
                .join("Programs")
                .join("Anki")
                .join("anki.exe"),
        );
    }
    let anki = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| {
            "Kunde inte hitta Anki Desktop. Öppna Anki manuellt och försök igen.".to_string()
        })?;
    std::process::Command::new(anki)
        .spawn()
        .map_err(|error| format!("Kunde inte öppna Anki: {error}"))?;
    Ok(())
}

#[tauri::command]
async fn transcribe_local(
    app: AppHandle,
    input_path: String,
    model: String,
    language: Option<String>,
    acceleration: Option<String>,
    job_id: String,
    initial_prompt: Option<String>,
) -> Result<String, String> {
    begin_transcription(&job_id);
    let label = "Lokal transkribering";
    emit_progress(
        &app,
        &job_id,
        "transcription",
        label,
        "preparing",
        "active",
        0,
        None,
        Some("Förbereder ljudfilen…".into()),
    );
    let model = valid_model(&model)?;
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let input = PathBuf::from(&input_path);
    if !input.starts_with(&app_data) {
        return Err("Ljudfilen ligger utanför appens tillåtna lagring".into());
    }
    if !input.is_file() {
        return Err(
            "Ljudfilen kunde inte hittas lokalt. Importera ljudfilen igen och försök på nytt."
                .into(),
        );
    }
    let model_path = models_dir(&app)?.join(format!("ggml-{model}.bin"));
    if !model_path.exists() {
        return Err(format!("Whisper {model} är inte nedladdad"));
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Kunde inte starta ljudkonverteraren: {error}"))?;
    let ffmpeg = resource_dir.join("ffmpeg").join("ffmpeg.exe");
    let cpu_whisper_dir = resource_dir.join("whisper");
    let requested_acceleration = acceleration.unwrap_or_else(|| "auto".into());
    let runtime_dir = nvidia_runtime_dir(&app)?;
    let nvidia_whisper = find_file(&runtime_dir, "whisper-cli.exe");
    let nvidia_name = nvidia_gpu_name().await;
    let nvidia_detected = nvidia_name.is_some();
    let nvidia_runtime_ready = nvidia_runtime_is_ready(&runtime_dir).await;
    let use_nvidia = match requested_acceleration.as_str() {
        "cpu" => false,
        "nvidia" => {
            if !nvidia_detected {
                return Err("Inget kompatibelt NVIDIA-grafikkort hittades".into());
            }
            if nvidia_whisper.is_none() {
                return Err("NVIDIA-runtime behöver installeras under Inställningar".into());
            }
            if !nvidia_runtime_ready {
                return Err("NVIDIA-runtime kunde inte initieras. Installera om stödet under Inställningar eller välj Automatiskt för CPU-fallback.".into());
            }
            true
        }
        "auto" => nvidia_detected && nvidia_whisper.is_some() && nvidia_runtime_ready,
        _ => return Err("Okänt accelerationsläge".into()),
    };
    let whisper = if use_nvidia {
        nvidia_whisper.expect("kontrollerad NVIDIA-runtime")
    } else {
        cpu_whisper_dir.join("whisper-cli.exe")
    };
    let whisper_dir = whisper
        .parent()
        .ok_or_else(|| "Whisper-runtime saknar arbetsmapp".to_string())?
        .to_path_buf();
    if !ffmpeg.exists() || !whisper.exists() {
        return Err("Lokala talverktyg saknas i installationen".into());
    }
    let work_dir = app_data.join("transcription-temp");
    fs::create_dir_all(&work_dir)
        .await
        .map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    // Keep all temporary output for one invocation together. Besides avoiding
    // collisions between concurrent transcriptions, this lets us safely discover
    // JSON output from Whisper builds with slightly different naming behaviour.
    let run_dir = work_dir.join(stamp.to_string());
    fs::create_dir_all(&run_dir)
        .await
        .map_err(|error| format!("Kunde inte skapa tillfällig transkriptionsmapp: {error}"))?;
    let wav = run_dir.join("input.wav");
    let output_prefix = run_dir.join("result");
    let converted = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&input)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(&wav)
        .output()
        .await
        .map_err(|error| {
            format!(
                "Kunde inte starta FFmpeg ({}) för {}: {error}",
                ffmpeg.display(),
                input.display()
            )
        })?;
    if !converted.status.success() {
        let _ = fs::remove_dir_all(&run_dir).await;
        emit_progress(
            &app,
            &job_id,
            "transcription",
            label,
            "error",
            "error",
            0,
            None,
            Some("Ljudkonvertering misslyckades.".into()),
        );
        return Err(format!(
            "Ljudkonvertering misslyckades: {}",
            String::from_utf8_lossy(&converted.stderr)
        ));
    }
    if transcription_is_cancelled(&job_id) {
        let _ = fs::remove_dir_all(&run_dir).await;
        finish_transcription(&job_id);
        emit_progress(&app, &job_id, "transcription", label, "cancelled", "cancelled", 0, None, Some("Transkriberingen avbröts.".into()));
        return Err("TRANSCRIPTION_CANCELLED".into());
    }
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);
    // GPU inference still benefits from CPU decoding and token work. Leave one
    // core for the UI but allow a stronger machine to feed CUDA more readily.
    let threads = cores
        .saturating_sub(1)
        .clamp(2, if use_nvidia { 12 } else { 8 })
        .to_string();
    let mut command = Command::new(&whisper);
    command
        .current_dir(&whisper_dir)
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(&wav)
        .arg("-oj")
        .arg("-ojf")
        .arg("-of")
        .arg(&output_prefix)
        .arg("-t")
        .arg(threads)
        .arg("-l")
        .arg(language.unwrap_or_else(|| "auto".into()));
    if use_nvidia {
        command.arg("-dev").arg("0").arg("-fa");
    }
    if let Some(prompt) = initial_prompt.filter(|value| !value.trim().is_empty()) {
        command.arg("-p").arg(prompt);
    }
    command.stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut execution_detail = if use_nvidia {
        format!(
            "Startar Whisper med NVIDIA {}…",
            nvidia_name.as_deref().unwrap_or("GPU")
        )
    } else if requested_acceleration == "auto" && nvidia_detected {
        "NVIDIA hittades men CUDA-runtime kunde inte initieras — kör på CPU.".into()
    } else {
        "Kör Whisper på processorn.".into()
    };
    emit_progress(
        &app,
        &job_id,
        "transcription",
        label,
        "starting",
        "active",
        0,
        None,
        Some(execution_detail.clone()),
    );
    let child = match command.spawn() {
        Ok(child) => child,
        Err(error) => {
            let _ = fs::remove_dir_all(&run_dir).await;
            return Err(format!(
                "Kunde inte starta Whisper ({}) i {}: {error}",
                whisper.display(),
                whisper_dir.display()
            ));
        }
    };
    let mut child = child;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Kunde inte läsa Whispers förloppsutdata".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Kunde inte läsa Whispers felutdata".to_string())?;
    let mut stdout_lines = BufReader::new(stdout).lines();
    let mut stderr_lines = BufReader::new(stderr).lines();
    let mut heartbeat = tokio::time::interval(Duration::from_secs(2));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let started = std::time::Instant::now();
    let total_millis = wav_duration_millis(&wav).await;
    let mut last_progress_millis = 0_u64;
    let mut latest_preview = String::new();
    let mut stdout_output = String::new();
    let mut stderr_output = String::new();
    let mut stdout_open = true;
    let mut stderr_open = true;
    let status = loop {
        tokio::select! {
            line = stdout_lines.next_line(), if stdout_open => match line {
                Ok(Some(line)) => {
                    if stdout_output.len() < 4_000 {
                        stdout_output.push_str(&line);
                        stdout_output.push('\n');
                    }
                    let lower = line.to_ascii_lowercase();
                    if use_nvidia && (lower.contains("no gpu found") || lower.contains("use gpu    = 0")) {
                        execution_detail = "NVIDIA kunde inte initieras — kör på CPU.".into();
                    } else if use_nvidia && lower.contains("use gpu    = 1") {
                        execution_detail = format!(
                            "Kör Whisper på NVIDIA {}.",
                            nvidia_name.as_deref().unwrap_or("GPU")
                        );
                    }
                    if let Some(seconds) = whisper_progress_seconds(&line) {
                        last_progress_millis = (seconds.max(0.0) * 1_000.0) as u64;
                        latest_preview = line
                            .split(']')
                            .nth(1)
                            .unwrap_or("")
                            .trim()
                            .chars()
                            .take(160)
                            .collect();
                        let detail = if latest_preview.is_empty() {
                            execution_detail.clone()
                        } else {
                            format!("{} · {}", execution_detail, latest_preview)
                        };
                        emit_progress(
                            &app, &job_id, "transcription", label, "transcribing", "active",
                            last_progress_millis, total_millis, Some(detail),
                        );
                    }
                }
                Ok(None) => stdout_open = false,
                Err(error) => {
                    let _ = fs::remove_dir_all(&run_dir).await;
                    return Err(format!("Kunde inte läsa Whispers förloppsutdata: {error}"));
                }
            },
            line = stderr_lines.next_line(), if stderr_open => match line {
                Ok(Some(line)) => {
                    if stderr_output.len() < 4_000 {
                        stderr_output.push_str(&line);
                        stderr_output.push('\n');
                    }
                    let lower = line.to_ascii_lowercase();
                    if use_nvidia && (lower.contains("no gpu found") || lower.contains("use gpu    = 0")) {
                        execution_detail = "NVIDIA kunde inte initieras — kör på CPU.".into();
                        emit_progress(
                            &app, &job_id, "transcription", label, "transcribing", "active",
                            last_progress_millis, total_millis, Some(execution_detail.clone()),
                        );
                    } else if use_nvidia && lower.contains("use gpu    = 1") {
                        execution_detail = format!(
                            "Kör Whisper på NVIDIA {}.",
                            nvidia_name.as_deref().unwrap_or("GPU")
                        );
                    }
                }
                Ok(None) => stderr_open = false,
                Err(error) => {
                    let _ = fs::remove_dir_all(&run_dir).await;
                    return Err(format!("Kunde inte läsa Whispers felutdata: {error}"));
                }
            },
            output = child.wait() => match output {
                Ok(status) => break status,
                Err(error) => {
                    let _ = fs::remove_dir_all(&run_dir).await;
                    return Err(format!("Whisper-processen avbröts: {error}"));
                }
            },
            _ = heartbeat.tick() => {
                if transcription_is_cancelled(&job_id) {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    let _ = fs::remove_dir_all(&run_dir).await;
                    finish_transcription(&job_id);
                    emit_progress(
                        &app, &job_id, "transcription", label, "cancelled", "cancelled",
                        last_progress_millis, total_millis, Some("Transkriberingen avbröts.".into()),
                    );
                    return Err("TRANSCRIPTION_CANCELLED".into());
                }
                emit_progress(
                    &app, &job_id, "transcription", label, "transcribing", "active",
                    last_progress_millis, total_millis,
                    Some(if latest_preview.is_empty() {
                        format!("{} · {} min", execution_detail, started.elapsed().as_secs() / 60)
                    } else {
                        format!("{} · {}", execution_detail, latest_preview)
                    }),
                );
            },
        }
    };
    let stderr = stderr_output.into_bytes();
    let _ = fs::remove_file(&input).await;
    if !status.success() {
        let _ = fs::remove_dir_all(&run_dir).await;
        emit_progress(
            &app,
            &job_id,
            "transcription",
            label,
            "error",
            "error",
            0,
            None,
            Some("Whisper kunde inte slutföra transkriberingen.".into()),
        );
        return Err(format!(
            "Whisper misslyckades: {}",
            String::from_utf8_lossy(&stderr)
        ));
    }
    let expected_json_path = output_prefix.with_extension("json");
    emit_progress(
        &app,
        &job_id,
        "transcription",
        label,
        "saving",
        "active",
        0,
        None,
        Some("Läser in transkriptet…".into()),
    );
    let json_path = match find_whisper_json_output(&run_dir, &expected_json_path).await {
        Ok(Some(path)) => path,
        Ok(None) => {
            let stderr = process_output_excerpt(&stderr);
            let stdout = process_output_excerpt(stdout_output.as_bytes());
            let _ = fs::remove_dir_all(&run_dir).await;
            let details = match (stdout.is_empty(), stderr.is_empty()) {
                (false, false) => format!(" Utdata: {stdout}\nFelutdata: {stderr}"),
                (false, true) => format!(" Utdata: {stdout}"),
                (true, false) => format!(" Felutdata: {stderr}"),
                (true, true) => String::new(),
            };
            return Err(format!(
                "Whisper avslutades utan att skapa ett JSON-transkript.{details}"
            ));
        }
        Err(error) => {
            let _ = fs::remove_dir_all(&run_dir).await;
            return Err(error);
        }
    };
    let json = match fs::read_to_string(&json_path).await {
        Ok(json) => json,
        Err(error) => {
            let _ = fs::remove_dir_all(&run_dir).await;
            return Err(format!("Whisper skapade inget läsbart transkript: {error}"));
        }
    };
    let _ = fs::remove_dir_all(&run_dir).await;
    emit_progress(
        &app,
        &job_id,
        "transcription",
        label,
        "complete",
        "complete",
        0,
        None,
        Some(format!("Transkriptet är klart · {}", execution_detail)),
    );
    Ok(json)
}

/// Converts oversized recordings into conservative, provider-safe API chunks.
/// The originals remain in the library; these are temporary upload artefacts.
#[tauri::command]
async fn prepare_api_audio(app: AppHandle, input_path: String) -> Result<Vec<String>, String> {
    let app_data = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?;
    let input = PathBuf::from(&input_path);
    if !input.starts_with(&app_data) || !input.is_file() {
        return Err("Ljudfilen kunde inte hittas i Lectios lokala lagring".into());
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let ffmpeg = resource_dir.join("ffmpeg").join("ffmpeg.exe");
    if !ffmpeg.exists() {
        return Err("FFmpeg saknas i Lectios installation".into());
    }
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let output_dir = app_data.join("api-audio").join(stamp.to_string());
    fs::create_dir_all(&output_dir)
        .await
        .map_err(|error| error.to_string())?;
    let output_pattern = output_dir.join("part-%03d.m4a");
    let result = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&input)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-ac",
            "1",
            "-ar",
            "16000",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-f",
            "segment",
            "-segment_time",
            "480",
            "-reset_timestamps",
            "1",
            "-segment_format",
            "mp4",
        ])
        .arg(&output_pattern)
        .output()
        .await
        .map_err(|error| format!("Kunde inte starta ljudkonverteraren: {error}"))?;
    if !result.status.success() {
        let _ = fs::remove_dir_all(&output_dir).await;
        return Err(format!(
            "Kunde inte förbereda ljudfilen för API-transkribering: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    let mut entries = fs::read_dir(&output_dir)
        .await
        .map_err(|error| error.to_string())?;
    let mut paths = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| error.to_string())?
    {
        let path = entry.path();
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("m4a"))
        {
            paths.push(path);
        }
    }
    paths.sort();
    if paths.is_empty() {
        return Err("Ljudkonverteringen skapade inga uppladdningsdelar".into());
    }
    Ok(paths
        .into_iter()
        .map(|path| path.to_string_lossy().into_owned())
        .collect())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init())
        .invoke_handler(tauri::generate_handler![
            cancel_download,
            read_credential,
            write_credential,
            delete_credential,
            start_google_drive_oauth,
            complete_google_drive_oauth,
            cancel_google_drive_oauth,
            disconnect_google_drive,
            google_drive_access_token,
            cancel_transcription,
            local_engine_status,
            diagnostic_snapshot,
            install_nvidia_runtime,
            remove_nvidia_runtime,
            local_model_status,
            download_local_model,
            remove_local_model,
            open_anki_desktop,
            transcribe_local,
            prepare_api_audio
        ])
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lectio");
}
