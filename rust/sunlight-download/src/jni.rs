/**
 * JNI bridge for Rust download manager.
 *
 * Exposes chunked download functionality to Kotlin/Java.
 *
 * All entry points are defensive: JNI/string failures raise a Java
 * exception instead of panicking, and calling any method before
 * nativeInit raises IllegalStateException.
 */
use jni::errors::Result as JniResult;
use jni::objects::{JClass, JObject, JString, JValue};
use jni::sys::{jlong, jobject, jstring};
use jni::JNIEnv;
use std::sync::{Arc, OnceLock};
use tokio::runtime::Runtime;

use crate::{DownloadConfig, DownloadManager, DownloadProgress, DownloadStatus};

/// Global download manager, created once by [nativeInit].
static MANAGER: OnceLock<Arc<DownloadManager>> = OnceLock::new();

/// Global Tokio runtime driving async downloads, created once by [nativeInit].
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Throw a Java exception carrying `msg`; failures are ignored because
/// nothing sensible can be done once throwing fails.
fn throw(env: &mut JNIEnv, class: &str, msg: &str) {
    let _ = env.throw_new(class, msg);
}

/// Throw a generic java/lang/Exception wrapping a JNI error.
fn throw_jni(env: &mut JNIEnv, err: &jni::errors::Error) {
    throw(env, "java/lang/Exception", &format!("JNI error: {}", err));
}

/// Decode a JString into an owned String, or throw and return None.
fn jstring_to_string(env: &mut JNIEnv, s: &JString) -> Option<String> {
    match env.get_string(s) {
        Ok(v) => Some(v.into()),
        Err(e) => {
            throw_jni(env, &e);
            None
        }
    }
}

/// Borrow the global manager, or throw IllegalStateException if nativeInit
/// has not run yet.
fn manager_or_throw(env: &mut JNIEnv) -> Option<&'static DownloadManager> {
    match MANAGER.get() {
        Some(m) => Some(m),
        None => {
            throw(
                env,
                "java/lang/IllegalStateException",
                "Download manager not initialized: call nativeInit first",
            );
            None
        }
    }
}

/// Borrow the global runtime, or throw IllegalStateException if nativeInit
/// has not run yet.
fn runtime_or_throw(env: &mut JNIEnv) -> Option<&'static Runtime> {
    match RUNTIME.get() {
        Some(rt) => Some(rt),
        None => {
            throw(
                env,
                "java/lang/IllegalStateException",
                "Tokio runtime not initialized: call nativeInit first",
            );
            None
        }
    }
}

/// Set a String field on `obj`.
fn set_string_field(env: &mut JNIEnv, obj: &JObject, name: &str, value: &str) -> JniResult<()> {
    let jstr = env.new_string(value)?;
    env.set_field(obj, name, "Ljava/lang/String;", JValue::Object(&jstr))?;
    Ok(())
}

/// Map a DownloadStatus to the int codes used by DownloadProgress.java.
fn status_code(status: &DownloadStatus) -> i32 {
    match status {
        DownloadStatus::Pending => 0,
        DownloadStatus::Downloading => 1,
        DownloadStatus::Paused => 2,
        DownloadStatus::Completed => 3,
        DownloadStatus::Failed => 4,
        DownloadStatus::Cancelled => 5,
    }
}

/// Populate a com.moud.sunlight.download.DownloadProgress instance.
fn build_progress<'local>(
    env: &mut JNIEnv<'local>,
    p: &DownloadProgress,
) -> JniResult<JObject<'local>> {
    let cls = env.find_class("com/moud/sunlight/download/DownloadProgress")?;
    let obj = env.alloc_object(cls)?;

    set_string_field(env, &obj, "url", &p.url)?;
    env.set_field(&obj, "totalBytes", "J", JValue::Long(p.total_bytes as jlong))?;
    env.set_field(&obj, "downloadedBytes", "J", JValue::Long(p.downloaded_bytes as jlong))?;
    env.set_field(&obj, "chunksTotal", "I", JValue::Int(p.chunks_total as i32))?;
    env.set_field(&obj, "chunksCompleted", "I", JValue::Int(p.chunks_completed as i32))?;
    env.set_field(&obj, "speedBytesPerSec", "J", JValue::Long(p.speed_bytes_per_sec as jlong))?;
    env.set_field(&obj, "etaSeconds", "J", JValue::Long(p.eta_seconds as jlong))?;
    env.set_field(&obj, "statusCode", "I", JValue::Int(status_code(&p.status)))?;
    if let Some(err) = &p.error {
        set_string_field(env, &obj, "error", err)?;
    }

    Ok(obj)
}

/// Build a progress object, converting any failure into a thrown Java
/// exception plus a null return.
fn build_progress_or_null(env: &mut JNIEnv, p: &DownloadProgress) -> jobject {
    match build_progress(env, p) {
        Ok(obj) => obj.into_raw(),
        Err(e) => {
            throw_jni(env, &e);
            std::ptr::null_mut()
        }
    }
}

/// Build an ArrayList<DownloadProgress> from Rust progress snapshots.
fn build_active_list<'local>(
    env: &mut JNIEnv<'local>,
    downloads: &[DownloadProgress],
) -> JniResult<JObject<'local>> {
    let cls = env.find_class("java/util/ArrayList")?;
    let list = env.new_object(cls, "()V", &[])?;

    for p in downloads {
        let obj = build_progress(env, p)?;
        let _added =
            env.call_method(&list, "add", "(Ljava/lang/Object;)Z", &[JValue::Object(&obj)])?;
    }

    Ok(list)
}

/// Initialize the download manager. Idempotent: repeated calls keep the
/// first configuration.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativeInit(
    mut env: JNIEnv,
    _class: JClass,
    chunk_size: jlong,
    max_concurrent: jlong,
) {
    // Clamp values coming from Java before they reach Rust unsigned types.
    let chunk_size = chunk_size.max(1) as u64;
    let max_concurrent = max_concurrent.clamp(1, 64) as usize;

    let config = DownloadConfig {
        chunk_size,
        max_concurrent_chunks: max_concurrent,
        ..Default::default()
    };

    let _ = MANAGER.set(Arc::new(DownloadManager::with_config(config)));

    if RUNTIME.get().is_none() {
        match Runtime::new() {
            Ok(rt) => {
                let _ = RUNTIME.set(rt);
            }
            Err(e) => throw(
                &mut env,
                "java/lang/Exception",
                &format!("Failed to create Tokio runtime: {}", e),
            ),
        }
    }
}

/// Start a download. Returns the download id (the URL), or null on error.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativeStartDownload(
    mut env: JNIEnv,
    _class: JClass,
    url: JString,
    destination: JString,
) -> jstring {
    let url = match jstring_to_string(&mut env, &url) {
        Some(u) => u,
        None => return std::ptr::null_mut(),
    };
    let dest = match jstring_to_string(&mut env, &destination) {
        Some(d) => d,
        None => return std::ptr::null_mut(),
    };

    let manager = match manager_or_throw(&mut env) {
        Some(m) => m,
        None => return std::ptr::null_mut(),
    };
    let runtime = match runtime_or_throw(&mut env) {
        Some(r) => r,
        None => return std::ptr::null_mut(),
    };

    match runtime.block_on(manager.start_download(&url, &dest)) {
        Ok(id) => match env.new_string(id) {
            Ok(s) => s.into_raw(),
            Err(e) => {
                throw_jni(&mut env, &e);
                std::ptr::null_mut()
            }
        },
        Err(e) => {
            throw(&mut env, "java/lang/Exception", &e.to_string());
            std::ptr::null_mut()
        }
    }
}

/// Get download progress, or null if the URL is unknown or the manager
/// is not initialized.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativeGetProgress(
    mut env: JNIEnv,
    _class: JClass,
    url: JString,
) -> jobject {
    let url = match jstring_to_string(&mut env, &url) {
        Some(u) => u,
        None => return std::ptr::null_mut(),
    };
    let manager = match manager_or_throw(&mut env) {
        Some(m) => m,
        None => return std::ptr::null_mut(),
    };

    match manager.get_progress(&url) {
        Some(progress) => build_progress_or_null(&mut env, &progress),
        None => std::ptr::null_mut(),
    }
}

/// Cancel a download.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativeCancelDownload(
    mut env: JNIEnv,
    _class: JClass,
    url: JString,
) {
    let url = match jstring_to_string(&mut env, &url) {
        Some(u) => u,
        None => return,
    };

    if let Some(manager) = manager_or_throw(&mut env) {
        manager.cancel_download(&url);
    }
}

/// Pause a download.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativePauseDownload(
    mut env: JNIEnv,
    _class: JClass,
    url: JString,
) {
    let url = match jstring_to_string(&mut env, &url) {
        Some(u) => u,
        None => return,
    };

    if let Some(manager) = manager_or_throw(&mut env) {
        manager.pause_download(&url);
    }
}

/// Resume a paused download.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativeResumeDownload(
    mut env: JNIEnv,
    _class: JClass,
    url: JString,
) {
    let url = match jstring_to_string(&mut env, &url) {
        Some(u) => u,
        None => return,
    };
    let manager = match manager_or_throw(&mut env) {
        Some(m) => m,
        None => return,
    };
    let runtime = match runtime_or_throw(&mut env) {
        Some(r) => r,
        None => return,
    };

    if let Err(e) = runtime.block_on(manager.resume_download(&url)) {
        throw(&mut env, "java/lang/Exception", &e.to_string());
    }
}

/// Get all active downloads as a java/util/ArrayList of DownloadProgress,
/// or null if the manager is not initialized.
#[no_mangle]
pub extern "C" fn Java_com_moud_sunlight_download_RustDownloadModule_nativeGetActiveDownloads(
    mut env: JNIEnv,
    _class: JClass,
) -> jobject {
    let manager = match manager_or_throw(&mut env) {
        Some(m) => m,
        None => return std::ptr::null_mut(),
    };

    let downloads = manager.get_active_downloads();

    match build_active_list(&mut env, &downloads) {
        Ok(list) => list.into_raw(),
        Err(e) => {
            throw_jni(&mut env, &e);
            std::ptr::null_mut()
        }
    }
}
