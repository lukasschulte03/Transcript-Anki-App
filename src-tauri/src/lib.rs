use base64::{engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD}, Engine as _};
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
    sync::{oneshot, Mutex as AsyncMutex},
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

#[derive(Serialize, Deserialize)]
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

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlideLayoutBox {
    label: String,
    score: f64,
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlideLayoutOutput {
    boxes: Option<Vec<SlideLayoutBox>>,
    text_boxes: Option<Vec<SlideOcrBox>>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SlideOcrBox {
    text: String,
    score: f64,
    left: f64,
    top: f64,
    right: f64,
    bottom: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PpStructureReady {
    ready: Option<bool>,
    device: Option<String>,
    model: Option<String>,
    error: Option<String>,
}

struct PpStructureWorker {
    python: PathBuf,
    script: PathBuf,
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
    device: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LocalVisionReady {
    ready: Option<bool>,
    model: Option<String>,
    device: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalVisionResult {
    description: Option<String>,
    keywords: Option<Vec<String>>,
    error: Option<String>,
}

struct LocalVisionWorker {
    python: PathBuf,
    script: PathBuf,
    child: tokio::process::Child,
    stdin: tokio::process::ChildStdin,
    stdout: tokio::io::Lines<BufReader<tokio::process::ChildStdout>>,
}

static PP_STRUCTURE_WORKER: OnceLock<AsyncMutex<Option<PpStructureWorker>>> = OnceLock::new();
static LOCAL_VISION_WORKER: OnceLock<AsyncMutex<Option<LocalVisionWorker>>> = OnceLock::new();

fn pp_structure_worker() -> &'static AsyncMutex<Option<PpStructureWorker>> {
    PP_STRUCTURE_WORKER.get_or_init(|| AsyncMutex::new(None))
}

fn local_vision_worker() -> &'static AsyncMutex<Option<LocalVisionWorker>> {
    LOCAL_VISION_WORKER.get_or_init(|| AsyncMutex::new(None))
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
        "access_denied" => {
            "Google-inloggningen avbröts eller nekades. Du kan försöka igen när du vill.".into()
        }
        "temporarily_unavailable" => {
            "Google är tillfälligt otillgängligt. Försök igen om en stund.".into()
        }
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

// Keep the existing one-process path for ordinary recordings. Long recordings
// are deliberately split only after conversion to the canonical 16 kHz WAV
// format, which makes every boundary deterministic and avoids touching the
// user's original audio file.
const LONG_TRANSCRIPTION_THRESHOLD_MILLIS: u64 = 35 * 60 * 1_000;
const LONG_TRANSCRIPTION_CHUNK_MILLIS: u64 = 20 * 60 * 1_000;
const LONG_TRANSCRIPTION_OVERLAP_MILLIS: u64 = 5 * 1_000;

async fn transcription_source_fingerprint(path: &Path) -> Result<String, String> {
    let mut file = fs::File::open(path)
        .await
        .map_err(|error| format!("Kunde inte läsa ljudfilen för återupptagning: {error}"))?;
    let mut hasher = Sha256::new();
    let mut buffer = vec![0_u8; 128 * 1024];
    loop {
        let read = file
            .read(&mut buffer)
            .await
            .map_err(|error| format!("Kunde inte läsa ljudfilen för återupptagning: {error}"))?;
        if read == 0 {
            break;
        }
        hasher.update(&buffer[..read]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

async fn read_whisper_json(run_dir: &Path, output_prefix: &Path) -> Result<String, String> {
    let expected_json_path = output_prefix.with_extension("json");
    let json_path = find_whisper_json_output(run_dir, &expected_json_path)
        .await?
        .ok_or_else(|| "Whisper avslutades utan att skapa ett JSON-transkript.".to_string())?;
    fs::read_to_string(&json_path)
        .await
        .map_err(|error| format!("Whisper skapade inget läsbart transkript: {error}"))
}

/// Runs one bounded chunk. Completed chunk JSON files are written by the
/// caller, so cancellation never discards work that was already successful.
async fn transcribe_whisper_chunk(
    app: &AppHandle,
    job_id: &str,
    label: &str,
    whisper: &Path,
    whisper_dir: &Path,
    model_path: &Path,
    wav: &Path,
    output_prefix: &Path,
    language: &str,
    initial_prompt: Option<&str>,
    use_nvidia: bool,
    progress_start: u64,
    progress_total: u64,
    chunk_index: usize,
    chunk_count: usize,
) -> Result<String, String> {
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);
    let threads = cores
        .saturating_sub(1)
        .clamp(2, if use_nvidia { 12 } else { 8 })
        .to_string();
    let mut command = Command::new(whisper);
    command
        .current_dir(whisper_dir)
        .arg("-m")
        .arg(model_path)
        .arg("-f")
        .arg(wav)
        .arg("-oj")
        .arg("-ojf")
        .arg("-of")
        .arg(output_prefix)
        .arg("-t")
        .arg(threads)
        .arg("-l")
        .arg(language)
        // Avoid an unread stdout pipe blocking Whisper on long recordings.
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if use_nvidia {
        command.arg("-dev").arg("0").arg("-fa");
    }
    if let Some(prompt) = initial_prompt.filter(|value| !value.trim().is_empty()) {
        command.arg("-p").arg(prompt);
    }
    emit_progress(
        app,
        job_id,
        "transcription",
        label,
        "transcribing",
        "active",
        progress_start,
        Some(progress_total),
        Some(format!("Transkriberar del {chunk_index} av {chunk_count}…")),
    );
    let mut child = command.spawn().map_err(|error| {
        format!(
            "Kunde inte starta Whisper ({}) i {}: {error}",
            whisper.display(),
            whisper_dir.display()
        )
    })?;
    let mut heartbeat = tokio::time::interval(Duration::from_secs(1));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let status = loop {
        tokio::select! {
            result = child.wait() => break result.map_err(|error| format!("Whisper-processen avbröts: {error}"))?,
            _ = heartbeat.tick() => {
                if transcription_is_cancelled(job_id) {
                    let _ = child.start_kill();
                    let _ = child.wait().await;
                    return Err("TRANSCRIPTION_CANCELLED".into());
                }
                emit_progress(
                    app, job_id, "transcription", label, "transcribing", "active",
                    progress_start, Some(progress_total),
                    Some(format!("Transkriberar del {chunk_index} av {chunk_count}…")),
                );
            }
        }
    };
    if !status.success() {
        return Err("Whisper kunde inte slutföra en del av transkriberingen.".into());
    }
    read_whisper_json(
        output_prefix.parent().unwrap_or(wav.parent().unwrap_or(Path::new("."))),
        output_prefix,
    )
    .await
}

fn merge_chunk_transcript(
    merged: &mut Vec<serde_json::Value>,
    raw: &str,
    offset_millis: u64,
    overlap_start_millis: u64,
) -> Result<(), String> {
    let parsed: serde_json::Value = serde_json::from_str(raw)
        .map_err(|error| format!("Whisper skapade ogiltig JSON: {error}"))?;
    let Some(segments) = parsed.get("transcription").and_then(|value| value.as_array()) else {
        return Err("Whisper skapade ett transkript utan segment.".into());
    };
    for segment in segments {
        let mut segment = segment.clone();
        let text = segment
            .get("text")
            .and_then(|value| value.as_str())
            .unwrap_or("")
            .to_owned();
        let offsets = segment.get_mut("offsets").and_then(|value| value.as_object_mut());
        let from = offsets
            .as_ref()
            .and_then(|value| value.get("from"))
            .and_then(|value| value.as_u64())
            .unwrap_or(0)
            .saturating_add(offset_millis);
        let to = offsets
            .as_ref()
            .and_then(|value| value.get("to"))
            .and_then(|value| value.as_u64())
            .unwrap_or(from)
            .saturating_add(offset_millis);
        // Deduplicate only literally identical text inside the deliberate five
        // second overlap. Similar wording is preserved rather than guessed at.
        let duplicate = from < overlap_start_millis
            && merged.iter().rev().any(|previous| {
                let previous_text = previous.get("text").and_then(|value| value.as_str()).unwrap_or("");
                let previous_to = previous.pointer("/offsets/to").and_then(|value| value.as_u64()).unwrap_or(0);
                previous_text.trim().eq_ignore_ascii_case(text.trim())
                    && previous_to >= overlap_start_millis.saturating_sub(LONG_TRANSCRIPTION_OVERLAP_MILLIS)
            });
        if duplicate {
            continue;
        }
        if let Some(offsets) = offsets {
            offsets.insert("from".into(), serde_json::Value::from(from));
            offsets.insert("to".into(), serde_json::Value::from(to));
        }
        merged.push(segment);
    }
    Ok(())
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
    if let Some(secret) =
        BUNDLED_GOOGLE_DRIVE_CLIENT_SECRET.filter(|value| !value.trim().is_empty())
    {
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
            .map_err(|_| {
                "Google Drive är inte anslutet. Koppla kontot igen under Inställningar.".to_string()
            })
    })
    .await
    .map_err(|error| error.to_string())??;
    let credential: GoogleDriveCredential = serde_json::from_str(&credential).map_err(|_| {
        "Google Drive-anslutningen kunde inte läsas. Koppla kontot igen.".to_string()
    })?;
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
        return Err(
            "Google Drive-sessionen har gått ut. Koppla kontot igen under Inställningar.".into(),
        );
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
        // Inbox files are created by the user's recorder, rather than Lectio.
        // Full Drive scope lets Lectio list only the configured Lectio/Inbox
        // folder and move imported files to its archive folder.
        .append_pair("scope", "https://www.googleapis.com/auth/drive")
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
                .map(|receiver| {
                    (
                        receiver,
                        session.verifier.clone(),
                        session.redirect_uri.clone(),
                    )
                })
                .ok_or_else(|| {
                    "Inloggningen väntar redan på ett svar. Försök igen om en stund.".to_string()
                })
        })?;
    let code_result = receiver
        .await
        .map_err(|_| "Inloggningen hann gå ut. Försök igen.".to_string());
    let _ = google_oauth_sessions()
        .lock()
        .map(|mut sessions| sessions.remove(&session_id));
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

const LOCAL_VISION_MODEL: &str = "moondream3.1-9B-A2B";
const LOCAL_VISION_PYTHON_PACKAGE: &str = "moondream==2.2.0";

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalVisionStatus {
    nvidia_detected: bool,
    nvidia_name: Option<String>,
    nvidia_vram_total_mb: Option<u32>,
    runtime_installed: bool,
    model_installed: bool,
    ready: bool,
}

async fn local_vision_status_inner(app: &AppHandle) -> LocalVisionStatus {
    let nvidia_name = nvidia_gpu_name().await;
    let metrics = nvidia_metrics().await;
    let runtime = pp_structure_sidecar(app).ok();
    let runtime_installed = runtime.is_some();
    let model_installed = if let Some((python, _)) = runtime {
        Command::new(python)
            .args(["-c", "import moondream; print('ok')"])
            .output()
            .await
            .ok()
            .is_some_and(|output| output.status.success())
    } else {
        false
    };
    let nvidia_detected = nvidia_name.is_some();
    LocalVisionStatus {
        nvidia_detected,
        nvidia_name,
        nvidia_vram_total_mb: metrics.vram_total_mb,
        runtime_installed,
        model_installed,
        ready: model_installed && nvidia_detected,
    }
}

#[tauri::command]
async fn local_vision_status(app: AppHandle) -> Result<LocalVisionStatus, String> {
    Ok(local_vision_status_inner(&app).await)
}

fn pp_structure_sidecar(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| format!("Kunde inte hitta Lectios resurser: {error}"))?;
    let bundled_python = resource_dir.join("pp-structure").join("python.exe");
    let bundled_script = resource_dir
        .join("pp-structure")
        .join("pp_structure_layout.py");
    if bundled_python.is_file() && bundled_script.is_file() {
        return Ok((bundled_python, bundled_script));
    }

    // The development runtime is deliberately outside the shipped app. It
    // keeps the repository and normal installer small while PP-Structure is
    // evaluated locally; a later optional runtime installer can populate the
    // same bundled path without changing the frontend contract.
    // `cargo tauri dev` may start the executable in `src-tauri`, `target`, or
    // the project root depending on how the development server was launched.
    // Walk upward from both reliable anchors instead of assuming one CWD.
    let mut development_roots = Vec::new();
    if let Ok(current_dir) = std::env::current_dir() {
        development_roots.push(current_dir);
    }
    if let Ok(executable) = std::env::current_exe() {
        if let Some(parent) = executable.parent() {
            development_roots.push(parent.to_path_buf());
        }
    }
    for root in development_roots {
        for project_dir in root.ancestors() {
            let development_python = project_dir
                .join(".tools")
                .join("pp-structure")
                .join("Scripts")
                .join("python.exe");
            let development_script = project_dir
                .join("src-tauri")
                .join("resources")
                .join("pp-structure")
                .join("pp_structure_layout.py");
            if development_python.is_file() && development_script.is_file() {
                return Ok((development_python, development_script));
            }
        }
    }
    Err("PP-StructureV3 är inte installerad på den här datorn ännu.".into())
}

async fn start_pp_structure_worker(
    python: PathBuf,
    script: PathBuf,
    prefer_gpu: bool,
) -> Result<PpStructureWorker, String> {
    let requested_device = if prefer_gpu { "gpu:0" } else { "cpu" };
    log::info!("vision: startar persistent PP-StructureV3-worker ({requested_device})");
    let mut child = Command::new(&python)
        .arg(&script)
        .arg("--serve")
        .env("LECTIO_PADDLE_DEVICE", requested_device)
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        // The official BOS mirror is consistently reachable from Windows and
        // avoids an interactive HuggingFace availability probe at first use.
        .env("PADDLE_PDX_MODEL_SOURCE", "BOS")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        // The sidecar returns actionable failures through JSON-lines. Keeping
        // stderr detached prevents framework warnings from blocking the pipe.
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Kunde inte starta PP-StructureV3: {error}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "PP-StructureV3 saknar inmatning.".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "PP-StructureV3 saknar utmatning.".to_string())?;
    let mut stdout = BufReader::new(stdout).lines();
    let ready_line = time::timeout(Duration::from_secs(120), stdout.next_line())
        .await
        .map_err(|_| "PP-StructureV3 tog för lång tid att starta.".to_string())?
        .map_err(|error| format!("PP-StructureV3 kunde inte starta: {error}"))?
        .ok_or_else(|| "PP-StructureV3 avslutades under uppstart.".to_string())?;
    let ready: PpStructureReady = serde_json::from_str(&ready_line)
        .map_err(|_| "PP-StructureV3 skickade ett ogiltigt uppstartssvar.".to_string())?;
    if ready.ready != Some(true) {
        return Err(ready
            .error
            .unwrap_or_else(|| "PP-StructureV3 kunde inte initieras.".into()));
    }
    let device = ready.device.unwrap_or_else(|| "cpu".into());
    let model = ready.model.unwrap_or_else(|| "okänd modell".into());
    log::info!("vision: PP-Structure-worker redo med {model} på {device}");
    Ok(PpStructureWorker {
        python,
        script,
        child,
        stdin,
        stdout,
        device,
    })
}

async fn stop_pp_structure_worker(worker: &mut Option<PpStructureWorker>) {
    if let Some(mut worker) = worker.take() {
        let _ = worker.child.start_kill();
        let _ = worker.child.wait().await;
    }
}

#[tauri::command]
async fn detect_slide_layout(
    app: AppHandle,
    input_path: String,
) -> Result<SlideLayoutOutput, String> {
    let input_path = PathBuf::from(input_path);
    if !input_path.is_file() {
        return Err("Slidebilden kunde inte läsas för layoutanalys.".into());
    }
    let (python, script) = pp_structure_sidecar(&app)?;
    let prefer_gpu = nvidia_gpu_name().await.is_some();
    let mut worker_slot = pp_structure_worker().lock().await;
    let restart_worker = worker_slot
        .as_ref()
        .is_some_and(|worker| worker.python != python || worker.script != script);
    if restart_worker {
        stop_pp_structure_worker(&mut worker_slot).await;
    }
    if worker_slot.is_none() {
        *worker_slot = Some(start_pp_structure_worker(python, script, prefer_gpu).await?);
    }
    let worker = worker_slot.as_mut().expect("worker inserted above");
    let request = format!("{}\n", serde_json::json!({ "inputPath": input_path }));
    let response = async {
        worker.stdin.write_all(request.as_bytes()).await?;
        worker.stdin.flush().await?;
        worker.stdout.next_line().await
    };
    let response = match time::timeout(Duration::from_secs(120), response).await {
        Ok(Ok(Some(line))) => line,
        Ok(Ok(None)) => {
            stop_pp_structure_worker(&mut worker_slot).await;
            return Err("PP-StructureV3 avslutades under layoutanalysen.".into());
        }
        Ok(Err(error)) => {
            stop_pp_structure_worker(&mut worker_slot).await;
            return Err(format!(
                "PP-StructureV3 kunde inte läsa slidebilden: {error}"
            ));
        }
        Err(_) => {
            stop_pp_structure_worker(&mut worker_slot).await;
            return Err("PP-StructureV3 tog för lång tid på den här sliden.".into());
        }
    };
    let result: SlideLayoutOutput = serde_json::from_str(&response)
        .map_err(|_| "PP-StructureV3 returnerade ett ogiltigt layoutresultat.".to_string())?;
    if let Some(error) = result.error {
        return Err(format!(
            "PP-StructureV3 kunde inte analysera sliden: {error}"
        ));
    }
    let box_count = result.boxes.as_ref().map_or(0, Vec::len);
    log::info!(
        "vision: PP-StructureV3 ({}) hittade {} bildregioner och {} OCR-rader",
        worker.device,
        box_count,
        result.text_boxes.as_ref().map_or(0, Vec::len)
    );
    Ok(result)
}

#[tauri::command]
async fn install_local_vision_model(app: AppHandle) -> Result<LocalVisionStatus, String> {
    log::info!("vision: installerar direkt lokal Nvidia-bildmotor");
    let job_id = "download:local-vision:moondream";
    if nvidia_gpu_name().await.is_none() {
        return Err("Automatiska bilder kräver en kompatibel Nvidia-GPU.".into());
    }
    let before = local_vision_status_inner(&app).await;
    if before.ready {
        return Ok(before);
    }
    begin_download(job_id);
    let result: Result<(), String> = async {
        let (python, layout_script) = pp_structure_sidecar(&app)?;
        let worker_script = layout_script
            .parent()
            .map(|path| path.join("local_vision_worker.py"))
            .filter(|path| path.is_file())
            .ok_or_else(|| "Lectios lokala Nvidia-bildmotor saknas i installationen. Installera senaste versionen av Lectio.".to_string())?;
        emit_progress(&app, job_id, "download", "Automatiska bilder i Anki", "preparing", "active", 0, Some(3), Some("Förbereder lokal Nvidia-bildmotor…".into()));
        if download_is_cancelled(job_id) { return Err("Nedladdningen avbröts".into()); }
        let output = Command::new(&python)
            .args(["-m", "pip", "install", "--disable-pip-version-check", "--upgrade", LOCAL_VISION_PYTHON_PACKAGE])
            .env("PYTHONUTF8", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::piped())
            .output()
            .await
            .map_err(|error| format!("Kunde inte starta Lectios bildmotor: {error}"))?;
        if !output.status.success() {
            let detail = String::from_utf8_lossy(&output.stderr).replace('\n', " ");
            return Err(format!("Kunde inte installera den lokala Nvidia-bildmotorn. {detail}"));
        }
        if download_is_cancelled(job_id) { return Err("Nedladdningen avbröts".into()); }
        emit_progress(&app, job_id, "download", "Automatiska bilder i Anki", "verifying", "active", 2, Some(3), Some("Verifierar den lokala bildmotorn…".into()));
        let output = Command::new(&python)
            .arg(&worker_script)
            .arg("--check")
            .env("PYTHONUTF8", "1")
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .await
            .map_err(|error| format!("Kunde inte verifiera bildmotorn: {error}"))?;
        if !output.success() { return Err("Den lokala Nvidia-bildmotorn kunde inte verifieras.".into()); }
        Ok(())
    }.await;
    match result {
        Ok(()) => {
            let status = local_vision_status_inner(&app).await;
            if !status.ready {
                return Err(
                    "Bildmotorn hämtades men kunde inte verifieras. Försök igen."
                        .into(),
                );
            }
            emit_progress(
                &app,
                job_id,
                "download",
                "Automatiska bilder i Anki",
                "complete",
                "complete",
                1,
                Some(1),
                Some("Den lokala Nvidia-bildmotorn är redo.".into()),
            );
            Ok(status)
        }
        Err(error) => {
            emit_progress(
                &app,
                job_id,
                "download",
                "Automatiska bilder i Anki",
                if download_is_cancelled(job_id) {
                    "cancelled"
                } else {
                    "error"
                },
                if download_is_cancelled(job_id) {
                    "cancelled"
                } else {
                    "error"
                },
                0,
                None,
                Some(error.clone()),
            );
            Err(error)
        }
    }
}

fn local_vision_sidecar(app: &AppHandle) -> Result<(PathBuf, PathBuf), String> {
    let (python, layout_script) = pp_structure_sidecar(app)?;
    let script = layout_script
        .parent()
        .map(|path| path.join("local_vision_worker.py"))
        .filter(|path| path.is_file())
        .ok_or_else(|| "Lectios lokala Nvidia-bildmotor saknas i installationen. Installera senaste versionen av Lectio.".to_string())?;
    Ok((python, script))
}

async fn start_local_vision_worker(
    python: PathBuf,
    script: PathBuf,
) -> Result<LocalVisionWorker, String> {
    log::info!("vision: startar persistent direkt Nvidia-bildmotor");
    let mut child = Command::new(&python)
        .arg(&script)
        .arg("--serve")
        .env("PYTHONUTF8", "1")
        .env("PYTHONIOENCODING", "utf-8")
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("Kunde inte starta den lokala Nvidia-bildmotorn: {error}"))?;
    let stdin = child.stdin.take().ok_or_else(|| "Bildmotorn saknar inmatning.".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "Bildmotorn saknar utmatning.".to_string())?;
    let mut stdout = BufReader::new(stdout).lines();
    let line = time::timeout(Duration::from_secs(180), stdout.next_line())
        .await
        .map_err(|_| "Bildmotorn tog för lång tid att starta första gången.".to_string())?
        .map_err(|error| format!("Bildmotorn kunde inte starta: {error}"))?
        .ok_or_else(|| "Bildmotorn avslutades under uppstart.".to_string())?;
    let ready: LocalVisionReady = serde_json::from_str(&line)
        .map_err(|_| "Bildmotorn skickade ett ogiltigt uppstartssvar.".to_string())?;
    if ready.ready != Some(true) {
        return Err(ready.error.unwrap_or_else(|| "Bildmotorn kunde inte initieras.".into()));
    }
    log::info!(
        "vision: direkt bildmotor redo med {} på {}",
        ready.model.unwrap_or_else(|| LOCAL_VISION_MODEL.into()),
        ready.device.unwrap_or_else(|| "nvidia".into())
    );
    Ok(LocalVisionWorker { python, script, child, stdin, stdout })
}

async fn stop_local_vision_worker(worker: &mut Option<LocalVisionWorker>) {
    if let Some(mut worker) = worker.take() {
        let _ = worker.child.start_kill();
        let _ = worker.child.wait().await;
    }
}

#[tauri::command]
async fn describe_local_visual(
    app: AppHandle,
    image_base64: String,
    context: Option<String>,
) -> Result<LocalVisionResult, String> {
    if nvidia_gpu_name().await.is_none() {
        return Err("Automatiska bilder kräver en kompatibel Nvidia-GPU.".into());
    }
    let bytes = STANDARD
        .decode(image_base64.as_bytes())
        .map_err(|_| "Bildutklippet kunde inte avkodas lokalt.".to_string())?;
    if bytes.is_empty() { return Err("Bildutklippet saknar bilddata.".into()); }
    let directory = app.path().app_data_dir().map_err(|error| error.to_string())?.join("vision-input");
    fs::create_dir_all(&directory).await.map_err(|error| format!("Kunde inte skapa lokal bildcache: {error}"))?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_nanos())
        .unwrap_or_default();
    let input = directory.join(format!("{nonce}.png"));
    fs::write(&input, bytes).await.map_err(|error| format!("Kunde inte förbereda bildutklippet: {error}"))?;
    let (python, script) = local_vision_sidecar(&app)?;
    let mut slot = local_vision_worker().lock().await;
    if slot.as_ref().is_some_and(|worker| worker.python != python || worker.script != script) {
        stop_local_vision_worker(&mut slot).await;
    }
    if slot.is_none() { *slot = Some(start_local_vision_worker(python, script).await?); }
    let worker = slot.as_mut().expect("worker inserted above");
    let request = format!("{}\n", serde_json::json!({ "inputPath": input, "context": context.unwrap_or_default() }));
    let response = async {
        worker.stdin.write_all(request.as_bytes()).await?;
        worker.stdin.flush().await?;
        worker.stdout.next_line().await
    };
    let line = match time::timeout(Duration::from_secs(120), response).await {
        Ok(Ok(Some(line))) => line,
        Ok(Ok(None)) => { stop_local_vision_worker(&mut slot).await; return Err("Bildmotorn avslutades under analysen.".into()); }
        Ok(Err(error)) => { stop_local_vision_worker(&mut slot).await; return Err(format!("Bildmotorn kunde inte läsa svaret: {error}")); }
        Err(_) => { stop_local_vision_worker(&mut slot).await; return Err("Bildmotorn tog för lång tid på den här bilden.".into()); }
    };
    let _ = fs::remove_file(&input).await;
    let result: LocalVisionResult = serde_json::from_str(&line)
        .map_err(|_| "Bildmotorn returnerade ett ogiltigt svar.".to_string())?;
    if let Some(error) = result.error.as_ref() { return Err(format!("Bildmotorn kunde inte beskriva bilden: {error}")); }
    if result.description.as_deref().unwrap_or_default().trim().is_empty() {
        return Err("Bildmotorn gav ingen beskrivning.".into());
    }
    Ok(result)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalEngineStatus {
    cpu_threads: usize,
    nvidia_detected: bool,
    nvidia_name: Option<String>,
    nvidia_runtime_installed: bool,
    nvidia_runtime_ready: bool,
    nvidia_runtime_size: u64,
    nvidia_vram_total_mb: Option<u32>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LocalTranscriptionBenchmark {
    model: String,
    acceleration: String,
    realtime_factor: f64,
    duration_seconds: f64,
    elapsed_seconds: f64,
    gpu_used: bool,
    gpu_utilization_percent: Option<u32>,
    vram_used_mb: Option<u32>,
    vram_total_mb: Option<u32>,
    measured_at: String,
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

#[derive(Default)]
struct NvidiaMetrics {
    utilization_percent: Option<u32>,
    vram_used_mb: Option<u32>,
    vram_total_mb: Option<u32>,
}

async fn nvidia_metrics() -> NvidiaMetrics {
    let output = Command::new("nvidia-smi")
        .args([
            "--query-gpu=utilization.gpu,memory.used,memory.total",
            "--format=csv,noheader,nounits",
        ])
        .output()
        .await;
    let Ok(output) = output else {
        return NvidiaMetrics::default();
    };
    if !output.status.success() {
        return NvidiaMetrics::default();
    }
    let values = String::from_utf8_lossy(&output.stdout)
        .lines()
        .next()
        .map(|line| {
            line.split(',')
                .map(|value| value.trim().parse::<u32>().ok())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    NvidiaMetrics {
        utilization_percent: values.first().and_then(|value| *value),
        vram_used_mb: values.get(1).and_then(|value| *value),
        vram_total_mb: values.get(2).and_then(|value| *value),
    }
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
    let metrics = nvidia_metrics().await;
    let nvidia_runtime_installed = find_file(&runtime_dir, "whisper-cli.exe").is_some();
    Ok(LocalEngineStatus {
        cpu_threads: std::thread::available_parallelism()
            .map(|parallelism| parallelism.get())
            .unwrap_or(0),
        nvidia_detected: nvidia_name.is_some(),
        nvidia_name,
        nvidia_runtime_installed,
        nvidia_runtime_ready: nvidia_runtime_installed
            && nvidia_runtime_is_ready(&runtime_dir).await,
        nvidia_runtime_size: directory_size(&runtime_dir),
        nvidia_vram_total_mb: metrics.vram_total_mb,
    })
}

#[tauri::command]
async fn local_engine_status(app: AppHandle) -> Result<LocalEngineStatus, String> {
    engine_status(&app).await
}

fn silence_wav(seconds: u32) -> Vec<u8> {
    let sample_rate = 16_000_u32;
    let channels = 1_u16;
    let bits_per_sample = 16_u16;
    let data_size = seconds * sample_rate * u32::from(channels) * u32::from(bits_per_sample) / 8;
    let mut bytes = Vec::with_capacity(44 + data_size as usize);
    bytes.extend_from_slice(b"RIFF");
    bytes.extend_from_slice(&(36 + data_size).to_le_bytes());
    bytes.extend_from_slice(b"WAVEfmt ");
    bytes.extend_from_slice(&16_u32.to_le_bytes());
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&channels.to_le_bytes());
    bytes.extend_from_slice(&sample_rate.to_le_bytes());
    bytes.extend_from_slice(
        &(sample_rate * u32::from(channels) * u32::from(bits_per_sample) / 8).to_le_bytes(),
    );
    bytes.extend_from_slice(&(channels * bits_per_sample / 8).to_le_bytes());
    bytes.extend_from_slice(&bits_per_sample.to_le_bytes());
    bytes.extend_from_slice(b"data");
    bytes.extend_from_slice(&data_size.to_le_bytes());
    bytes.resize(44 + data_size as usize, 0);
    bytes
}

/// Measures local inference on a synthetic WAV. No lecture audio is used or retained.
#[tauri::command]
async fn benchmark_local_engine(
    app: AppHandle,
    model: String,
    acceleration: String,
) -> Result<LocalTranscriptionBenchmark, String> {
    let model = valid_model(&model)?;
    if acceleration != "cpu" && acceleration != "nvidia" {
        return Err("Välj CPU eller NVIDIA för prestandatestet".into());
    }
    let model_path = models_dir(&app)?.join(format!("ggml-{model}.bin"));
    if !model_path.exists() {
        return Err(format!("Whisper {model} är inte nedladdad"));
    }
    let resource_dir = app
        .path()
        .resource_dir()
        .map_err(|error| error.to_string())?;
    let runtime_dir = nvidia_runtime_dir(&app)?;
    let use_nvidia = acceleration == "nvidia";
    let whisper = if use_nvidia {
        if nvidia_gpu_name().await.is_none() || !nvidia_runtime_is_ready(&runtime_dir).await {
            return Err("NVIDIA-motorn är inte redo för prestandatestet".into());
        }
        find_file(&runtime_dir, "whisper-cli.exe")
            .ok_or_else(|| "NVIDIA-runtime saknar Whisper".to_string())?
    } else {
        resource_dir.join("whisper").join("whisper-cli.exe")
    };
    if !whisper.exists() {
        return Err("Whisper-motorn saknas i installationen".into());
    }
    let work_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| error.to_string())?
        .join("benchmark-temp");
    fs::create_dir_all(&work_dir)
        .await
        .map_err(|error| error.to_string())?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|error| error.to_string())?
        .as_millis();
    let wav = work_dir.join(format!("{stamp}.wav"));
    let output = work_dir.join(format!("{stamp}-result"));
    const SAMPLE_SECONDS: u32 = 20;
    fs::write(&wav, silence_wav(SAMPLE_SECONDS))
        .await
        .map_err(|error| error.to_string())?;
    let threads = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4)
        .saturating_sub(1)
        .clamp(2, if use_nvidia { 12 } else { 8 })
        .to_string();
    let started = std::time::Instant::now();
    let mut command = Command::new(&whisper);
    command
        .current_dir(whisper.parent().unwrap_or(&work_dir))
        .arg("-m")
        .arg(&model_path)
        .arg("-f")
        .arg(&wav)
        .arg("-otxt")
        .arg("-nt")
        .arg("-of")
        .arg(&output)
        .arg("-t")
        .arg(threads)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if use_nvidia {
        command.arg("-dev").arg("0").arg("-fa");
    }
    let result = command
        .output()
        .await
        .map_err(|error| format!("Kunde inte starta Whisper-testet: {error}"))?;
    let elapsed_seconds = started.elapsed().as_secs_f64();
    let metrics = nvidia_metrics().await;
    let report = format!(
        "{}{}",
        String::from_utf8_lossy(&result.stdout),
        String::from_utf8_lossy(&result.stderr)
    )
    .to_ascii_lowercase();
    let gpu_used = report.contains("use gpu    = 1") || report.contains("use gpu = 1");
    let _ = fs::remove_file(&wav).await;
    let _ = fs::remove_file(output.with_extension("txt")).await;
    if !result.status.success() {
        return Err(format!(
            "Whisper-testet misslyckades: {}",
            process_output_excerpt(&result.stderr)
        ));
    }
    if use_nvidia && !gpu_used {
        return Err("NVIDIA-testet startade men Whisper bekräftade inte GPU-användning".into());
    }
    Ok(LocalTranscriptionBenchmark {
        model: model.into(),
        acceleration,
        realtime_factor: elapsed_seconds / f64::from(SAMPLE_SECONDS),
        duration_seconds: f64::from(SAMPLE_SECONDS),
        elapsed_seconds,
        gpu_used,
        gpu_utilization_percent: if use_nvidia {
            metrics.utilization_percent
        } else {
            None
        },
        vram_used_mb: if use_nvidia {
            metrics.vram_used_mb
        } else {
            None
        },
        vram_total_mb: if use_nvidia {
            metrics.vram_total_mb
        } else {
            None
        },
        measured_at: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| error.to_string())?
            .as_secs()
            .to_string(),
    })
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
    log::info!("transcription: startar lokal Whisper med modell={model}");
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
    // The frontend creates a fresh temporary input path for every attempt.
    // Use a streamed content hash instead, so retries can resume safely.
    let fingerprint = transcription_source_fingerprint(&input).await?;
    let prompt_fingerprint = format!(
        "{:x}",
        Sha256::digest(
            format!("{model}:{}:{}", language.as_deref().unwrap_or("auto"), initial_prompt.as_deref().unwrap_or(""))
                .as_bytes()
        )
    );
    // Keep all temporary output for one invocation together. Besides avoiding
    // collisions between concurrent transcriptions, this lets us safely discover
    // JSON output from Whisper builds with slightly different naming behaviour.
    let run_dir = work_dir.join(format!("{fingerprint}-{prompt_fingerprint}"));
    fs::create_dir_all(&run_dir)
        .await
        .map_err(|error| format!("Kunde inte skapa tillfällig transkriptionsmapp: {error}"))?;
    let wav = run_dir.join("input.wav");
    let output_prefix = run_dir.join("result");
    if !wav.is_file() {
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
    }
    if transcription_is_cancelled(&job_id) {
        let _ = fs::remove_dir_all(&run_dir).await;
        finish_transcription(&job_id);
        emit_progress(
            &app,
            &job_id,
            "transcription",
            label,
            "cancelled",
            "cancelled",
            0,
            None,
            Some("Transkriberingen avbröts.".into()),
        );
        return Err("TRANSCRIPTION_CANCELLED".into());
    }
    let whisper_language = language.clone().unwrap_or_else(|| "auto".into());
    let total_millis = wav_duration_millis(&wav).await.unwrap_or(0);
    if total_millis >= LONG_TRANSCRIPTION_THRESHOLD_MILLIS {
        let chunk_count = total_millis.div_ceil(LONG_TRANSCRIPTION_CHUNK_MILLIS) as usize;
        let chunks_dir = run_dir.join("chunks");
        fs::create_dir_all(&chunks_dir)
            .await
            .map_err(|error| format!("Kunde inte skapa transkriptionsdelar: {error}"))?;
        let manifest = serde_json::json!({
            "version": 1,
            "source": fingerprint,
            "model": model,
            "language": whisper_language,
            "totalMillis": total_millis,
            "chunkMillis": LONG_TRANSCRIPTION_CHUNK_MILLIS,
            "overlapMillis": LONG_TRANSCRIPTION_OVERLAP_MILLIS,
        });
        let _ = fs::write(run_dir.join("resume.json"), manifest.to_string()).await;
        emit_progress(
            &app, &job_id, "transcription", label, "transcribing", "active", 0,
            Some(total_millis),
            Some(format!("Delar upp lång inspelning i {chunk_count} säkra delar…")),
        );
        let mut merged = Vec::new();
        for index in 0..chunk_count {
            if transcription_is_cancelled(&job_id) {
                // Keep completed JSON and the converted WAV. A retry with the
                // same audio, model and glossary resumes at the missing part.
                finish_transcription(&job_id);
                emit_progress(
                    &app, &job_id, "transcription", label, "cancelled", "cancelled",
                    index as u64 * LONG_TRANSCRIPTION_CHUNK_MILLIS, Some(total_millis),
                    Some("Transkriberingen avbröts. Klara delar sparas för återupptagning.".into()),
                );
                return Err("TRANSCRIPTION_CANCELLED".into());
            }
            let base_start = index as u64 * LONG_TRANSCRIPTION_CHUNK_MILLIS;
            let start = if index == 0 {
                0
            } else {
                base_start.saturating_sub(LONG_TRANSCRIPTION_OVERLAP_MILLIS)
            };
            let length = (LONG_TRANSCRIPTION_CHUNK_MILLIS
                + if index == 0 { 0 } else { LONG_TRANSCRIPTION_OVERLAP_MILLIS })
                .min(total_millis.saturating_sub(start));
            let chunk_dir = chunks_dir.join(format!("part-{index:04}"));
            fs::create_dir_all(&chunk_dir)
                .await
                .map_err(|error| format!("Kunde inte skapa ljuddel: {error}"))?;
            let chunk_wav = chunk_dir.join("input.wav");
            let chunk_json = chunk_dir.join("complete.json");
            let raw = if chunk_json.is_file() {
                fs::read_to_string(&chunk_json)
                    .await
                    .map_err(|error| format!("Kunde inte läsa sparad transkriptionsdel: {error}"))?
            } else {
                if !chunk_wav.is_file() {
                    let chunked = Command::new(&ffmpeg)
                        .args(["-hide_banner", "-loglevel", "error", "-y", "-ss"])
                        .arg(format!("{:.3}", start as f64 / 1_000.0))
                        .arg("-t")
                        .arg(format!("{:.3}", length as f64 / 1_000.0))
                        .arg("-i")
                        .arg(&wav)
                        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
                        .arg(&chunk_wav)
                        .output()
                        .await
                        .map_err(|error| format!("Kunde inte förbereda ljuddel {}: {error}", index + 1))?;
                    if !chunked.status.success() {
                        return Err(format!(
                            "Kunde inte förbereda ljuddel {}: {}",
                            index + 1,
                            String::from_utf8_lossy(&chunked.stderr)
                        ));
                    }
                }
                let prefix = chunk_dir.join("result");
                let raw = transcribe_whisper_chunk(
                    &app, &job_id, label, &whisper, &whisper_dir, &model_path,
                    &chunk_wav, &prefix, &whisper_language, initial_prompt.as_deref(), use_nvidia,
                    start, total_millis, index + 1, chunk_count,
                ).await?;
                // Atomic enough for a single-process queue: only write after a
                // complete, parseable Whisper result exists.
                fs::write(&chunk_json, &raw)
                    .await
                    .map_err(|error| format!("Kunde inte spara transkriptionsdel: {error}"))?;
                raw
            };
            merge_chunk_transcript(
                &mut merged,
                &raw,
                start,
                if index == 0 { 0 } else { base_start },
            )?;
            emit_progress(
                &app, &job_id, "transcription", label, "transcribing", "active",
                (base_start + LONG_TRANSCRIPTION_CHUNK_MILLIS).min(total_millis), Some(total_millis),
                Some(format!("Transkriberade del {} av {}…", index + 1, chunk_count)),
            );
        }
        let result = serde_json::json!({ "transcription": merged }).to_string();
        let _ = fs::remove_file(&input).await;
        let _ = fs::remove_dir_all(&run_dir).await;
        finish_transcription(&job_id);
        emit_progress(
            &app, &job_id, "transcription", label, "complete", "complete", total_millis,
            Some(total_millis), Some("Transkriptet är klart.".into()),
        );
        return Ok(result);
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
    let mut nvidia_confirmed = false;
    let status = loop {
        tokio::select! {
            line = stdout_lines.next_line(), if stdout_open => match line {
                Ok(Some(line)) => {
                    if stdout_output.len() < 4_000 {
                        stdout_output.push_str(&line);
                        stdout_output.push('\n');
                    }
                    let lower = line.to_ascii_lowercase();
                    if use_nvidia && (lower.contains("no gpu found") || lower.contains("use gpu    = 0") || lower.contains("use gpu = 0")) {
                        execution_detail = "NVIDIA kunde inte initieras — kör på CPU.".into();
                    } else if use_nvidia && (lower.contains("use gpu    = 1") || lower.contains("use gpu = 1")) {
                        nvidia_confirmed = true;
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
                    if use_nvidia && (lower.contains("no gpu found") || lower.contains("use gpu    = 0") || lower.contains("use gpu = 0")) {
                        execution_detail = "NVIDIA kunde inte initieras — kör på CPU.".into();
                        emit_progress(
                            &app, &job_id, "transcription", label, "transcribing", "active",
                            last_progress_millis, total_millis, Some(execution_detail.clone()),
                        );
                    } else if use_nvidia && (lower.contains("use gpu    = 1") || lower.contains("use gpu = 1")) {
                        nvidia_confirmed = true;
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
    if use_nvidia && !nvidia_confirmed {
        // A CUDA-capable binary can still silently fall back on some driver
        // combinations. Keep the transcript, but make that uncertainty visible.
        execution_detail = "NVIDIA kunde inte bekräftas i Whisper-utdata; kontrollera prestandatestet eller kör CPU-läget för jämförelse.".into();
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

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct OptimizedAudio {
    path: String,
    bytes: u64,
}

/// Re-encodes a local recording for compact archival. The caller owns both
/// input and output cleanup, so a failed conversion can never replace audio.
#[tauri::command]
async fn optimize_audio_for_storage(
    app: AppHandle,
    input_path: String,
) -> Result<OptimizedAudio, String> {
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
    let output_dir = app_data.join("audio-optimisation");
    fs::create_dir_all(&output_dir)
        .await
        .map_err(|error| error.to_string())?;
    let output = output_dir.join(format!("{stamp}.m4a"));
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
            "32000",
            "-c:a",
            "aac",
            "-b:a",
            "64k",
            "-movflags",
            "+faststart",
        ])
        .arg(&output)
        .output()
        .await
        .map_err(|error| format!("Kunde inte starta ljudkonverteraren: {error}"))?;
    if !result.status.success() || !output.is_file() {
        let _ = fs::remove_file(&output).await;
        return Err(format!(
            "Ljudoptimering misslyckades: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    let bytes = fs::metadata(&output)
        .await
        .map_err(|error| error.to_string())?
        .len();
    Ok(OptimizedAudio {
        path: output.to_string_lossy().into_owned(),
        bytes,
    })
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

#[cfg(test)]
mod transcription_tests {
    use super::*;

    #[test]
    fn merge_chunk_transcript_only_removes_identical_overlap_segments() {
        let mut merged = Vec::new();
        merge_chunk_transcript(
            &mut merged,
            r#"{"transcription":[{"text":"Första raden","offsets":{"from":0,"to":3000}},{"text":"Gränsrad","offsets":{"from":1196000,"to":1200000}}]}"#,
            0,
            0,
        )
        .unwrap();
        merge_chunk_transcript(
            &mut merged,
            r#"{"transcription":[{"text":"Gränsrad","offsets":{"from":0,"to":3000}},{"text":"Ny rad","offsets":{"from":5000,"to":8000}}]}"#,
            1_195_000,
            1_200_000,
        )
        .unwrap();
        assert_eq!(merged.len(), 3);
        assert_eq!(merged[2].pointer("/offsets/from").and_then(|value| value.as_u64()), Some(1_200_000));
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_fs::init());
    // Included only in the separate QA binary. Production builds neither
    // contain the WebDriver bridge nor grant its test-only permissions.
    #[cfg(feature = "tauri-plugin-wdio")]
    let builder = builder.plugin(tauri_plugin_wdio::init());

    builder
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
            benchmark_local_engine,
            diagnostic_snapshot,
            install_nvidia_runtime,
            remove_nvidia_runtime,
            local_model_status,
            download_local_model,
            remove_local_model,
            local_vision_status,
            install_local_vision_model,
            describe_local_visual,
            detect_slide_layout,
            open_anki_desktop,
            transcribe_local,
            prepare_api_audio,
            optimize_audio_for_storage
        ])
        .setup(|app| {
            app.handle().plugin(
                tauri_plugin_log::Builder::default()
                    .level(log::LevelFilter::Info)
                    .build(),
            )?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Lectio");
}
