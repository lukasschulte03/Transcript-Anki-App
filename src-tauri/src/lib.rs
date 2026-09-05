use serde::Serialize;
use std::{
    collections::HashSet,
    io,
    path::PathBuf,
    sync::{Mutex, OnceLock},
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use tokio::{fs, io::AsyncWriteExt, process::Command};

static CANCELLED_DOWNLOADS: OnceLock<Mutex<HashSet<String>>> = OnceLock::new();

fn cancelled_downloads() -> &'static Mutex<HashSet<String>> {
    CANCELLED_DOWNLOADS.get_or_init(|| Mutex::new(HashSet::new()))
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

fn credential_entry(key: &str) -> Result<keyring::Entry, String> {
    if key.is_empty() || !key.chars().all(|character| character.is_ascii_alphanumeric() || matches!(character, ':' | '-' | '_')) {
        return Err("Ogiltigt credential-namn".into());
    }
    keyring::Entry::new("Lectio", key).map_err(|error| error.to_string())
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
    nvidia_runtime_size: u64,
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

const NVIDIA_RUNTIME_URL: &str = "https://github.com/ggml-org/whisper.cpp/releases/download/b4938/whisper-cublas-11.8.0-bin-x64.zip";

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
        .map(|path| path.join("runtimes").join("nvidia-cuda-11.8"))
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

async fn engine_status(app: &AppHandle) -> Result<LocalEngineStatus, String> {
    let runtime_dir = nvidia_runtime_dir(app)?;
    let nvidia_name = nvidia_gpu_name().await;
    Ok(LocalEngineStatus {
        nvidia_detected: nvidia_name.is_some(),
        nvidia_name,
        nvidia_runtime_installed: find_file(&runtime_dir, "whisper-cli.exe").is_some(),
        nvidia_runtime_size: directory_size(&runtime_dir),
    })
}

#[tauri::command]
async fn local_engine_status(app: AppHandle) -> Result<LocalEngineStatus, String> {
    engine_status(&app).await
}

#[tauri::command]
async fn install_nvidia_runtime(app: AppHandle) -> Result<LocalEngineStatus, String> {
    let job_id = "download:nvidia-runtime";
    let label = "NVIDIA-stöd för Whisper";
    let runtime_dir = nvidia_runtime_dir(&app)?;
    if find_file(&runtime_dir, "whisper-cli.exe").is_some() {
        return engine_status(&app).await;
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
    emit_progress(&app, job_id, "download", label, "downloading", "active", 0, total, None);
    let mut archive_file = fs::File::create(&archive_path)
        .await
        .map_err(|error| error.to_string())?;
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        if download_is_cancelled(job_id) {
            drop(archive_file);
            emit_progress(&app, job_id, "download", label, "error", "error", downloaded, total, Some("Nedladdningen avbröts. Delvis fil kan återanvändas vid nästa försök.".into()));
            return Err("Nedladdningen avbröts".into());
        }
        archive_file
            .write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_reported) >= 1_000_000 || total == Some(downloaded) {
            emit_progress(&app, job_id, "download", label, "downloading", "active", downloaded, total, None);
            last_reported = downloaded;
        }
    }
    archive_file
        .flush()
        .await
        .map_err(|error| error.to_string())?;
    drop(archive_file);
    if total.is_some_and(|expected| expected != downloaded) {
        emit_progress(&app, job_id, "download", label, "error", "error", downloaded, total, Some("Filstorleken stämmer inte; försök igen.".into()));
        return Err("NVIDIA-paketets storlek stämmer inte med nedladdningen".into());
    }
    emit_progress(&app, job_id, "download", label, "extracting", "active", downloaded, total, Some("Packar upp CUDA-runtime…".into()));

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
        emit_progress(&app, job_id, "download", label, "error", "error", downloaded, total, Some("CUDA-paketet saknade Whisper.".into()));
        return Err("CUDA-paketet saknade whisper-cli.exe".into());
    }
    emit_progress(&app, job_id, "download", label, "complete", "complete", downloaded, total, Some("NVIDIA-stöd är klart.".into()));
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
            emit_progress(&app, &job_id, "download", &label, "error", "error", downloaded, total, Some("Nedladdningen avbröts. Delvis fil kan återupptas senare.".into()));
            return Err("Nedladdningen avbröts".into());
        }
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        downloaded += chunk.len() as u64;
        if downloaded.saturating_sub(last_reported) >= 1_000_000 || total == Some(downloaded) {
            emit_progress(&app, &job_id, "download", &label, "downloading", "active", downloaded, total, None);
            last_reported = downloaded;
        }
    }
    file.flush().await.map_err(|error| error.to_string())?;
    drop(file);
    if total.is_some_and(|expected| expected != downloaded) {
        emit_progress(&app, &job_id, "download", &label, "error", "error", downloaded, total, Some("Filstorleken stämmer inte; försök igen.".into()));
        return Err("Modellfilens storlek stämmer inte med nedladdningen".into());
    }
    fs::rename(&partial, &destination)
        .await
        .map_err(|error| error.to_string())?;
    let size = fs::metadata(&destination)
        .await
        .map_err(|error| error.to_string())?
        .len();
    emit_progress(&app, &job_id, "download", &label, "complete", "complete", size, total, Some("Modellen är klar att använda.".into()));
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
        candidates.push(PathBuf::from(local_app_data).join("Programs").join("Anki").join("anki.exe"));
    }
    let anki = candidates
        .into_iter()
        .find(|path| path.is_file())
        .ok_or_else(|| "Kunde inte hitta Anki Desktop. Öppna Anki manuellt och försök igen.".to_string())?;
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
    let label = "Lokal transkribering";
    emit_progress(&app, &job_id, "transcription", label, "preparing", "active", 0, None, Some("Förbereder ljudfilen…".into()));
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
        return Err("Ljudfilen kunde inte hittas lokalt. Importera ljudfilen igen och försök på nytt.".into());
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
    let nvidia_detected = nvidia_gpu_name().await.is_some();
    let use_nvidia = match requested_acceleration.as_str() {
        "cpu" => false,
        "nvidia" => {
            if !nvidia_detected {
                return Err("Inget kompatibelt NVIDIA-grafikkort hittades".into());
            }
            if nvidia_whisper.is_none() {
                return Err("NVIDIA-runtime behöver installeras under Inställningar".into());
            }
            true
        }
        "auto" => nvidia_detected && nvidia_whisper.is_some(),
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
    let wav = work_dir.join(format!("{stamp}.wav"));
    let output_prefix = work_dir.join(format!("{stamp}-result"));
    let converted = Command::new(&ffmpeg)
        .args(["-hide_banner", "-loglevel", "error", "-y", "-i"])
        .arg(&input)
        .args(["-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le"])
        .arg(&wav)
        .output()
        .await
        .map_err(|error| error.to_string())?;
    if !converted.status.success() {
        emit_progress(&app, &job_id, "transcription", label, "error", "error", 0, None, Some("Ljudkonvertering misslyckades.".into()));
        return Err(format!(
            "Ljudkonvertering misslyckades: {}",
            String::from_utf8_lossy(&converted.stderr)
        ));
    }
    let cores = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);
    let threads = cores.saturating_sub(1).clamp(2, 8).to_string();
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
        .arg(language.unwrap_or_else(|| "auto".into()))
        .arg("--no-context");
    if let Some(prompt) = initial_prompt.filter(|value| !value.trim().is_empty()) {
        command.arg("-p").arg(prompt);
    }
    emit_progress(&app, &job_id, "transcription", label, "starting", "active", 0, None, Some(if use_nvidia { "Startar Whisper med NVIDIA…".into() } else { "Startar Whisper på processorn…".into() }));
    let child = command
        .spawn()
        .map_err(|error| format!("Kunde inte starta Whisper: {error}"))?;
    let mut result = Box::pin(child.wait_with_output());
    let mut heartbeat = tokio::time::interval(Duration::from_secs(2));
    heartbeat.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let started = std::time::Instant::now();
    let result = loop {
        tokio::select! {
            output = &mut result => break output.map_err(|error| error.to_string())?,
            _ = heartbeat.tick() => emit_progress(
                &app, &job_id, "transcription", label, "transcribing", "active", 0, None,
                Some(format!("Whisper arbetar · {} min", started.elapsed().as_secs() / 60)),
            ),
        }
    };
    let _ = fs::remove_file(&wav).await;
    let _ = fs::remove_file(&input).await;
    if !result.status.success() {
        emit_progress(&app, &job_id, "transcription", label, "error", "error", 0, None, Some("Whisper kunde inte slutföra transkriberingen.".into()));
        return Err(format!(
            "Whisper misslyckades: {}",
            String::from_utf8_lossy(&result.stderr)
        ));
    }
    let json_path = output_prefix.with_extension("json");
    emit_progress(&app, &job_id, "transcription", label, "saving", "active", 0, None, Some("Läser in transkriptet…".into()));
    let json = fs::read_to_string(&json_path)
        .await
        .map_err(|error| error.to_string())?;
    let _ = fs::remove_file(json_path).await;
    emit_progress(&app, &job_id, "transcription", label, "complete", "complete", 0, None, Some("Transkriptet är klart.".into()));
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
            "-map", "0:a:0", "-vn", "-ac", "1", "-ar", "16000", "-c:a", "aac",
            "-b:a", "64k", "-f", "segment", "-segment_time", "480", "-reset_timestamps", "1",
            "-segment_format", "mp4",
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
    while let Some(entry) = entries.next_entry().await.map_err(|error| error.to_string())? {
        let path = entry.path();
        if path.extension().is_some_and(|extension| extension.eq_ignore_ascii_case("m4a")) {
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
            local_engine_status,
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
