fn main() {
    if std::env::args().nth(1).as_deref() == Some("--codex-night-worker") {
        god_of_sessions_lib::run_codex_night_worker();
        return;
    }
    if std::env::args().nth(1).as_deref() == Some("--claude-night-worker") {
        god_of_sessions_lib::run_claude_night_worker();
        return;
    }
    god_of_sessions_lib::run();
}
