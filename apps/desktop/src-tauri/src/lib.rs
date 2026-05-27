use std::{
    env,
    fs::{self, File},
    io::{self, Cursor, Read},
    net::TcpListener,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::Mutex,
    thread,
    time::{Duration, Instant},
};

use serde::Serialize;
use tauri::{Manager, Runtime};

const MIN_NODE_MAJOR: u32 = 22;
const SERVER_HOST: &str = "127.0.0.1";
const SERVER_PORT: &str = "3711";
const NODE_RELEASE_INDEX: &str = "https://nodejs.org/download/release/latest-v22.x/";

struct ServerProcess(Mutex<Option<Child>>);

struct DesktopStartupState(Mutex<DesktopStartupStatus>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct DesktopStartupStatus {
    server_started: bool,
    server_error: Option<String>,
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .manage(ServerProcess(Mutex::new(None)))
        .manage(DesktopStartupState(Mutex::new(DesktopStartupStatus {
            server_started: false,
            server_error: None,
        })))
        .invoke_handler(tauri::generate_handler![get_desktop_startup_status])
        .setup(|app| {
            let startup_status = match start_server(app.handle()) {
                Ok(()) => DesktopStartupStatus {
                    server_started: true,
                    server_error: None,
                },
                Err(error) => DesktopStartupStatus {
                    server_started: false,
                    server_error: Some(error),
                },
            };

            let state = app.state::<DesktopStartupState>();
            *state
                .0
                .lock()
                .map_err(|_| "无法保存 desktop 启动状态。")? = startup_status;

            Ok(())
        })
        .on_window_event(|window, event| {
            if matches!(event, tauri::WindowEvent::CloseRequested { .. }) {
                stop_server(window.app_handle());
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if matches!(event, tauri::RunEvent::ExitRequested { .. }) {
                stop_server(app_handle);
            }
        });
}

#[tauri::command]
fn get_desktop_startup_status(
    state: tauri::State<'_, DesktopStartupState>,
) -> Result<DesktopStartupStatus, String> {
    state
        .0
        .lock()
        .map(|status| status.clone())
        .map_err(|_| "无法读取 desktop 启动状态。".to_string())
}

fn start_server<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<(), String> {
    let node = resolve_node(app)?;
    let server_entry = app
        .path()
        .resolve("server/index.js", tauri::path::BaseDirectory::Resource)
        .map_err(|error| format!("无法定位内置 server：{error}"))?;

    if !server_entry.is_file() {
        return Err(format!("内置 server 文件不存在：{}", server_entry.display()));
    }
    let server_dir = server_entry
        .parent()
        .ok_or_else(|| format!("无法定位内置 server 目录：{}", server_entry.display()))?;
    let server_entry_arg = node_path_argument(&server_entry);

    ensure_server_port_available()?;

    let mut child = Command::new(&node)
        .arg(&server_entry_arg)
        .current_dir(server_dir)
        .env("OWNDESIGN_SERVER_HOST", SERVER_HOST)
        .env("OWNDESIGN_SERVER_PORT", SERVER_PORT)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            format!(
                "无法启动 OwnDesign server。Node: {}。入口：{}。错误：{error}",
                node.display(),
                server_entry_arg
            )
        })?;

    wait_for_server_ready(&mut child)?;

    let state = app.state::<ServerProcess>();
    *state
        .0
        .lock()
        .map_err(|_| "无法保存 server 进程状态。".to_string())? = Some(child);

    Ok(())
}

fn node_path_argument(path: &Path) -> String {
    let path = path.to_string_lossy();

    #[cfg(windows)]
    {
        if let Some(stripped) = path.strip_prefix(r"\\?\UNC\") {
            return format!(r"\\{stripped}");
        }

        if let Some(stripped) = path.strip_prefix(r"\\?\") {
            return stripped.to_string();
        }
    }

    path.to_string()
}

fn ensure_server_port_available() -> Result<(), String> {
    TcpListener::bind((SERVER_HOST, SERVER_PORT.parse::<u16>().unwrap_or(3711)))
        .map(|_| ())
        .map_err(|error| {
            format!(
                "端口 {SERVER_PORT} 当前不可用，OwnDesign server 无法启动。请确认是否已有其它程序监听 http://{SERVER_HOST}:{SERVER_PORT}。系统错误：{error}"
            )
        })
}

fn wait_for_server_ready(child: &mut Child) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_millis(400))
        .build()
        .map_err(|error| format!("无法创建 server 健康检查客户端：{error}"))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    let health_url = format!("http://{SERVER_HOST}:{SERVER_PORT}/api/workspace");

    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("无法检查 server 进程状态：{error}"))?
        {
            let stderr = read_child_stderr(child);
            if !stderr.is_empty() {
                return Err(format!(
                    "OwnDesign server 已退出，状态：{status}。\n\nserver 错误输出：\n{stderr}"
                ));
            }

            return Err(format!(
                "OwnDesign server 已退出，状态：{status}，但没有输出错误日志。"
            ));
        }

        let health_error = match client.get(&health_url).send() {
            Ok(response) if response.status().is_success() => return Ok(()),
            Ok(response) => format!(
                "健康检查返回 HTTP {}：{}",
                response.status(),
                response.text().unwrap_or_default()
            ),
            Err(error) => format!("健康检查请求失败：{error}"),
        };

        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            let stderr = read_child_stderr(child);

            if !stderr.is_empty() {
                return Err(format!(
                    "OwnDesign server 启动超时。\n\n最后一次健康检查：{health_error}\n\nserver 错误输出：\n{stderr}"
                ));
            }

            return Err(format!(
                "OwnDesign server 启动超时。\n\n最后一次健康检查：{health_error}"
            ));
        }

        thread::sleep(Duration::from_millis(100));
    }
}

fn read_child_stderr(child: &mut Child) -> String {
    let Some(mut stderr) = child.stderr.take() else {
        return String::new();
    };

    let mut output = String::new();
    if stderr.read_to_string(&mut output).is_err() {
        return String::new();
    }

    output.trim().to_string()
}

fn stop_server<R: Runtime>(app: &tauri::AppHandle<R>) {
    let state = app.state::<ServerProcess>();
    let Ok(mut process) = state.0.lock() else {
        return;
    };

    if let Some(mut child) = process.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
}

fn resolve_node<R: Runtime>(app: &tauri::AppHandle<R>) -> Result<PathBuf, String> {
    if command_has_supported_node("node") {
        return Ok(PathBuf::from("node"));
    }

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("无法定位应用数据目录：{error}"))?;
    let runtime_dir = app_data_dir.join("runtime").join("node-v22");
    let cached_node = runtime_dir.join(platform_node_binary_name()?);

    if cached_node.is_file() && executable_has_supported_node(&cached_node) {
        return Ok(cached_node);
    }

    fs::create_dir_all(&runtime_dir)
        .map_err(|error| format!("无法创建 Node runtime 缓存目录：{error}"))?;
    download_node_runtime(&runtime_dir)?;

    if cached_node.is_file() && executable_has_supported_node(&cached_node) {
        return Ok(cached_node);
    }

    Err(format!(
        "已下载 Node.js，但版本校验失败：{}",
        cached_node.display()
    ))
}

fn command_has_supported_node(command: &str) -> bool {
    Command::new(command)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
        .is_some_and(|version| is_supported_node_version(&version))
}

fn executable_has_supported_node(path: &Path) -> bool {
    Command::new(path)
        .arg("--version")
        .output()
        .ok()
        .and_then(|output| {
            if output.status.success() {
                Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
            } else {
                None
            }
        })
        .is_some_and(|version| is_supported_node_version(&version))
}

fn is_supported_node_version(version: &str) -> bool {
    let version = version.trim().trim_start_matches('v');
    let Some(major) = version.split('.').next() else {
        return false;
    };

    major
        .parse::<u32>()
        .is_ok_and(|major| major >= MIN_NODE_MAJOR)
}

fn download_node_runtime(runtime_dir: &Path) -> Result<(), String> {
    let archive_name = resolve_node_archive_name()?;
    let archive_url = format!("{NODE_RELEASE_INDEX}{archive_name}");
    let response = reqwest::blocking::get(&archive_url)
        .map_err(|error| format!("无法下载 Node.js：{archive_url}。错误：{error}"))?;

    if !response.status().is_success() {
        return Err(format!(
            "无法下载 Node.js：{archive_url}。HTTP 状态：{}",
            response.status()
        ));
    }

    let archive = response
        .bytes()
        .map_err(|error| format!("无法读取 Node.js 下载内容：{error}"))?;

    extract_node_archive(&archive, runtime_dir)
        .map_err(|error| format!("无法解压 Node.js runtime：{error}"))?;

    Ok(())
}

fn resolve_node_archive_name() -> Result<String, String> {
    let platform = platform_archive_suffix()?;
    let index = reqwest::blocking::get(NODE_RELEASE_INDEX)
        .and_then(|response| response.error_for_status())
        .map_err(|error| format!("无法读取 Node.js v22 下载目录：{error}"))?
        .text()
        .map_err(|error| format!("无法解析 Node.js v22 下载目录：{error}"))?;

    index
        .split('"')
        .find(|value| value.starts_with("node-v22.") && value.ends_with(platform))
        .map(ToOwned::to_owned)
        .ok_or_else(|| format!("Node.js 下载目录缺少当前平台包：*{platform}"))
}

fn platform_archive_suffix() -> Result<&'static str, String> {
    match (env::consts::OS, env::consts::ARCH) {
        ("windows", "x86_64") => Ok("-win-x64.zip"),
        ("windows", "aarch64") => Ok("-win-arm64.zip"),
        ("macos", "x86_64") => Ok("-darwin-x64.tar.gz"),
        ("macos", "aarch64") => Ok("-darwin-arm64.tar.gz"),
        ("linux", "x86_64") => Ok("-linux-x64.tar.xz"),
        ("linux", "aarch64") => Ok("-linux-arm64.tar.xz"),
        (os, arch) => Err(format!("暂不支持自动下载 Node.js：{os}/{arch}")),
    }
}

fn platform_node_binary_name() -> Result<&'static str, String> {
    match env::consts::OS {
        "windows" => Ok("node.exe"),
        "macos" | "linux" => Ok("bin/node"),
        os => Err(format!("暂不支持当前系统：{os}")),
    }
}

fn extract_node_archive(bytes: &[u8], runtime_dir: &Path) -> io::Result<()> {
    match env::consts::OS {
        "windows" => extract_windows_node_zip(bytes, runtime_dir),
        _ => Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "automatic Node.js extraction is implemented for Windows zip packages first",
        )),
    }
}

fn extract_windows_node_zip(bytes: &[u8], runtime_dir: &Path) -> io::Result<()> {
    let reader = Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(reader)?;

    for index in 0..archive.len() {
        let mut file = archive.by_index(index)?;
        let Some(enclosed_name) = file.enclosed_name() else {
            continue;
        };
        let mut components = enclosed_name.components();

        components.next();

        let relative_path = components.as_path();
        if relative_path.as_os_str().is_empty() || file.is_dir() {
            continue;
        }

        let output_path = runtime_dir.join(relative_path);

        if let Some(parent) = output_path.parent() {
            fs::create_dir_all(parent)?;
        }

        let mut output = File::create(output_path)?;
        io::copy(&mut file, &mut output)?;
    }

    Ok(())
}
