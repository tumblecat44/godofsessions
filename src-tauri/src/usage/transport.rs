use std::{
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    time::{Duration, Instant},
};

use serde_json::Value;
use wait_timeout::ChildExt;

const COMMAND_TIMEOUT: Duration = Duration::from_secs(30);

fn spawn_usage_command(binary: &Path, arguments: &[&str]) -> Result<Child, String> {
    Command::new(binary)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| "로컬 사용량 조회 프로세스를 시작하지 못했습니다.".to_owned())
}

fn terminate(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

pub(super) fn run_one_shot(
    binary: &Path,
    arguments: &[&str],
    input: &str,
) -> Result<String, String> {
    let mut child = spawn_usage_command(binary, arguments)?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(input.as_bytes())
            .map_err(|_| "로컬 사용량 요청을 전달하지 못했습니다.".to_owned())?;
    }
    match child
        .wait_timeout(COMMAND_TIMEOUT)
        .map_err(|_| "로컬 사용량 조회 상태를 확인하지 못했습니다.".to_owned())?
    {
        Some(_) => {
            let output = child
                .wait_with_output()
                .map_err(|_| "로컬 사용량 응답을 읽지 못했습니다.".to_owned())?;
            let text = String::from_utf8_lossy(&output.stdout).to_string();
            if text.trim().is_empty() {
                Err("로컬 도구가 사용량 응답을 반환하지 않았습니다.".to_owned())
            } else {
                Ok(text)
            }
        }
        None => {
            terminate(&mut child);
            Err("사용량 조회가 30초 안에 끝나지 않았습니다.".to_owned())
        }
    }
}

pub(super) fn run_streaming_protocol(
    binary: &Path,
    arguments: &[&str],
    input: &str,
    response_received: impl Fn(&str) -> bool,
) -> Result<String, String> {
    let mut child = spawn_usage_command(binary, arguments)?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "로컬 사용량 응답 통로를 열지 못했습니다.".to_owned())?;
    let (sender, receiver) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            if sender.send(line).is_err() {
                break;
            }
        }
    });
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "로컬 사용량 요청 통로를 열지 못했습니다.".to_owned())?;
    stdin
        .write_all(input.as_bytes())
        .and_then(|_| stdin.flush())
        .map_err(|_| "로컬 사용량 요청을 전달하지 못했습니다.".to_owned())?;

    let started = Instant::now();
    let mut output = String::new();
    while started.elapsed() < COMMAND_TIMEOUT {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(line) => {
                output.push_str(&line);
                output.push('\n');
                if response_received(&output) {
                    terminate(&mut child);
                    drop(stdin);
                    let _ = reader.join();
                    return Ok(output);
                }
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    terminate(&mut child);
    drop(stdin);
    let _ = reader.join();
    if output.trim().is_empty() {
        Err("로컬 도구가 사용량 응답을 반환하지 않았습니다.".to_owned())
    } else {
        Ok(output)
    }
}

pub(super) fn find_json_value(output: &str, predicate: impl Fn(&Value) -> bool) -> Option<Value> {
    output.char_indices().find_map(|(index, character)| {
        if character != '{' {
            return None;
        }
        let mut values = serde_json::Deserializer::from_str(&output[index..]).into_iter::<Value>();
        values
            .next()
            .and_then(Result::ok)
            .filter(|value| predicate(value))
    })
}

pub(super) fn first_existing(paths: &[&str]) -> Option<PathBuf> {
    paths.iter().map(PathBuf::from).find(|path| path.is_file())
}
