use serde_json::Value;

pub enum DecodeResult {
    Ok(Value),
    Err(String),
}

pub struct Decoder {
    buf: Vec<u8>,
}

impl Decoder {
    pub fn new() -> Self {
        Self { buf: Vec::new() }
    }

    pub fn push(&mut self, bytes: &[u8]) -> Vec<DecodeResult> {
        self.buf.extend_from_slice(bytes);
        let mut out = Vec::new();
        loop {
            let Some(pos) = self.buf.iter().position(|&b| b == b'\n') else {
                break;
            };
            let mut line: Vec<u8> = self.buf.drain(..=pos).collect();
            line.pop();
            if line.last() == Some(&b'\r') {
                line.pop();
            }
            if line.is_empty() {
                continue;
            }
            match serde_json::from_slice::<Value>(&line) {
                Ok(v) => out.push(DecodeResult::Ok(v)),
                Err(e) => out.push(DecodeResult::Err(e.to_string())),
            }
        }
        out
    }
}

pub fn encode_command(value: &Value) -> Vec<u8> {
    let mut bytes = serde_json::to_vec(value).expect("command is valid json");
    bytes.push(b'\n');
    bytes
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn round_trip_prompt_command() {
        let cmd = json!({"id":"req-1","type":"prompt","message":"Hello"});
        let bytes = encode_command(&cmd);
        assert_eq!(*bytes.last().unwrap(), b'\n');
        let mut dec = Decoder::new();
        let out = dec.push(&bytes);
        assert_eq!(out.len(), 1);
        match &out[0] {
            DecodeResult::Ok(v) => assert_eq!(v, &cmd),
            DecodeResult::Err(e) => panic!("parse error: {e}"),
        }
    }

    #[test]
    fn split_two_events_without_breaking_u2028_inside_json_string() {
        let first = json!({"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"one"}});
        let inner = format!("hello\u{2028}world");
        let second = json!({
            "type": "message_update",
            "assistantMessageEvent": {"type":"text_delta","delta": inner}
        });
        let third = json!({"type":"tool_execution_start","toolCallId":"c1","toolName":"bash"});

        let mut buf = encode_command(&first);
        buf.extend_from_slice(&encode_command(&second));
        buf.extend_from_slice(&encode_command(&third));

        let mut dec = Decoder::new();
        let out = dec.push(&buf);
        assert_eq!(out.len(), 3, "U+2028 inside a JSON string must not split a record");
        match &out[1] {
            DecodeResult::Ok(v) => {
                let delta = v["assistantMessageEvent"]["delta"].as_str().unwrap();
                assert!(delta.contains('\u{2028}'));
                assert_eq!(delta, "hello\u{2028}world");
            }
            DecodeResult::Err(e) => panic!("{e}"),
        }
        match &out[2] {
            DecodeResult::Ok(v) => assert_eq!(v["type"], "tool_execution_start"),
            DecodeResult::Err(e) => panic!("{e}"),
        }
    }
}
