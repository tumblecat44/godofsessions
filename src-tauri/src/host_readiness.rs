use std::{
    ffi::CString,
    os::unix::ffi::OsStrExt,
    path::Path,
    process::{Command, Stdio},
    time::Duration,
};

use chrono::{DateTime, Utc};
use wait_timeout::ChildExt;

use crate::model::{
    HostReadiness, HostReadinessCheck, HostReadinessLevel, HostReadinessState, NightRunDraft,
};

const COMMAND_TIMEOUT: Duration = Duration::from_secs(2);
const MAX_OUTPUT: usize = 32 * 1024;
const DISK_WARNING_GIB: f64 = 5.0;

pub(crate) fn inspect(drafts: &[NightRunDraft], now: DateTime<Utc>) -> HostReadiness {
    let power = command_output("/usr/bin/pmset", &["-g", "batt"])
        .as_deref()
        .map(parse_power)
        .unwrap_or_default();
    let checks = vec![
        power_check(&power),
        sleep_assertion_check(),
        lid_check(&power),
        disk_check(drafts),
    ];
    let state = if checks
        .iter()
        .any(|check| check.level == HostReadinessLevel::Warning)
    {
        HostReadinessState::NeedsAttention
    } else {
        HostReadinessState::Ready
    };
    HostReadiness {
        observed_at: now.to_rfc3339(),
        state,
        checks,
        read_only: true,
        methodology:
            "macOS 전원 소스, coordinator의 idle-sleep 보호 도구, 노트북 덮개 제약, 선택된 작업공간의 디스크 여유를 읽기 전용으로 확인했습니다."
                .to_owned(),
    }
}

#[derive(Default)]
struct PowerObservation {
    source: Option<String>,
    has_internal_battery: bool,
    battery_percent: Option<u8>,
}

fn parse_power(output: &str) -> PowerObservation {
    let source = output
        .lines()
        .find_map(|line| line.split_once('\'').map(|(_, rest)| rest))
        .and_then(|rest| rest.split_once('\'').map(|(value, _)| value.to_owned()));
    let has_internal_battery = output.contains("InternalBattery");
    let battery_percent = output
        .split(|character: char| !character.is_ascii_digit() && character != '%')
        .find_map(|part| {
            part.strip_suffix('%')
                .and_then(|value| value.parse::<u8>().ok())
                .filter(|value| *value <= 100)
        });
    PowerObservation {
        source,
        has_internal_battery,
        battery_percent,
    }
}

fn power_check(power: &PowerObservation) -> HostReadinessCheck {
    match (
        power.source.as_deref(),
        power.has_internal_battery,
        power.battery_percent,
    ) {
        (Some("AC Power"), _, percent) => HostReadinessCheck {
            key: "power".to_owned(),
            level: HostReadinessLevel::Pass,
            label: "전원".to_owned(),
            message: percent
                .map(|value| format!("AC 전원 연결 · 배터리 {value}%"))
                .unwrap_or_else(|| "AC 전원에 연결되어 있습니다.".to_owned()),
            action: None,
        },
        (Some("Battery Power"), true, percent) => HostReadinessCheck {
            key: "power".to_owned(),
            level: HostReadinessLevel::Warning,
            label: "전원".to_owned(),
            message: percent
                .map(|value| format!("배터리 {value}%로 밤 계획을 시작하려고 합니다."))
                .unwrap_or_else(|| "배터리 전원으로 밤 계획을 시작하려고 합니다.".to_owned()),
            action: Some("잠들기 전에 전원 어댑터 연결".to_owned()),
        },
        _ => HostReadinessCheck {
            key: "power".to_owned(),
            level: HostReadinessLevel::Info,
            label: "전원".to_owned(),
            message: "macOS 전원 소스를 확인하지 못했습니다.".to_owned(),
            action: Some("장시간 실행 전 전원 상태 직접 확인".to_owned()),
        },
    }
}

fn sleep_assertion_check() -> HostReadinessCheck {
    if Path::new("/usr/bin/caffeinate").is_file() {
        HostReadinessCheck {
            key: "idle_sleep".to_owned(),
            level: HostReadinessLevel::Pass,
            label: "Idle sleep".to_owned(),
            message: "coordinator가 caffeinate -i 아래에서 실행됩니다.".to_owned(),
            action: None,
        }
    } else {
        HostReadinessCheck {
            key: "idle_sleep".to_owned(),
            level: HostReadinessLevel::Warning,
            label: "Idle sleep".to_owned(),
            message: "idle sleep을 막을 시스템 도구를 찾지 못했습니다.".to_owned(),
            action: Some("시스템 sleep 설정을 직접 확인".to_owned()),
        }
    }
}

fn lid_check(power: &PowerObservation) -> HostReadinessCheck {
    if power.has_internal_battery {
        HostReadinessCheck {
            key: "lid".to_owned(),
            level: HostReadinessLevel::Warning,
            label: "MacBook 덮개".to_owned(),
            message: "caffeinate는 덮개를 닫아 생기는 sleep까지 보장하지 않습니다.".to_owned(),
            action: Some("덮개를 열어두거나 전원 연결된 정상 clamshell 환경 사용".to_owned()),
        }
    } else {
        HostReadinessCheck {
            key: "lid".to_owned(),
            level: HostReadinessLevel::Pass,
            label: "덮개 제약".to_owned(),
            message: "내장 배터리가 있는 MacBook으로 감지되지 않았습니다.".to_owned(),
            action: None,
        }
    }
}

fn disk_check(drafts: &[NightRunDraft]) -> HostReadinessCheck {
    let minimum = drafts
        .iter()
        .filter_map(|draft| available_gib(&draft.workspace))
        .min_by(f64::total_cmp);
    match minimum {
        Some(gib) if gib < DISK_WARNING_GIB => HostReadinessCheck {
            key: "disk".to_owned(),
            level: HostReadinessLevel::Warning,
            label: "디스크".to_owned(),
            message: format!("선택된 작업공간의 최소 여유가 {gib:.1} GiB입니다."),
            action: Some("빌드·로그 공간을 확보한 뒤 승인".to_owned()),
        },
        Some(gib) => HostReadinessCheck {
            key: "disk".to_owned(),
            level: HostReadinessLevel::Pass,
            label: "디스크".to_owned(),
            message: format!("선택된 작업공간에 최소 {gib:.1} GiB가 남아 있습니다."),
            action: None,
        },
        None => HostReadinessCheck {
            key: "disk".to_owned(),
            level: HostReadinessLevel::Info,
            label: "디스크".to_owned(),
            message: "선택된 작업공간의 디스크 여유를 확인하지 못했습니다.".to_owned(),
            action: Some("장시간 빌드 전 디스크 여유 직접 확인".to_owned()),
        },
    }
}

fn available_gib(value: &str) -> Option<f64> {
    let canonical = Path::new(value).canonicalize().ok()?;
    let path = CString::new(canonical.as_os_str().as_bytes()).ok()?;
    let mut stats = std::mem::MaybeUninit::<libc::statvfs>::uninit();
    // SAFETY: `path` is a live NUL-terminated pathname and `stats` points to
    // writable storage for the duration of the libc call.
    let result = unsafe { libc::statvfs(path.as_ptr(), stats.as_mut_ptr()) };
    if result != 0 {
        return None;
    }
    // SAFETY: statvfs initialized the structure after returning success.
    let stats = unsafe { stats.assume_init() };
    let bytes = stats.f_bavail as f64 * stats.f_frsize as f64;
    Some(bytes / 1024.0_f64.powi(3))
}

fn command_output(program: &str, arguments: &[&str]) -> Option<String> {
    if !Path::new(program).is_file() {
        return None;
    }
    let mut child = Command::new(program)
        .args(arguments)
        .env_clear()
        .env("PATH", "/usr/bin:/bin:/usr/sbin:/sbin")
        .env("LC_ALL", "C")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .ok()?;
    match child.wait_timeout(COMMAND_TIMEOUT).ok()? {
        Some(status) if status.success() => {}
        Some(_) => return None,
        None => {
            let _ = child.kill();
            let _ = child.wait();
            return None;
        }
    }
    let output = child.wait_with_output().ok()?;
    if output.stdout.len() > MAX_OUTPUT {
        return None;
    }
    String::from_utf8(output.stdout).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_ac_power_and_battery_percentage() {
        let observation = parse_power(
            "Now drawing from 'AC Power'\n -InternalBattery-0\t100%; charged; present: true\n",
        );
        assert_eq!(observation.source.as_deref(), Some("AC Power"));
        assert!(observation.has_internal_battery);
        assert_eq!(observation.battery_percent, Some(100));
        assert_eq!(power_check(&observation).level, HostReadinessLevel::Pass);
        assert_eq!(lid_check(&observation).level, HostReadinessLevel::Warning);
    }

    #[test]
    fn battery_power_requires_attention() {
        let observation = parse_power(
            "Now drawing from 'Battery Power'\n -InternalBattery-0\t42%; discharging\n",
        );
        let check = power_check(&observation);
        assert_eq!(check.level, HostReadinessLevel::Warning);
        assert!(check
            .action
            .as_deref()
            .is_some_and(|value| value.contains("전원")));
    }
}
