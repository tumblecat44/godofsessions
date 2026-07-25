use chrono::{TimeZone, Utc};

pub fn unix_seconds_to_rfc3339(value: i64) -> Option<String> {
    Utc.timestamp_opt(value, 0)
        .single()
        .map(|value| value.to_rfc3339())
}

pub fn unix_millis_to_rfc3339(value: i64) -> Option<String> {
    Utc.timestamp_millis_opt(value)
        .single()
        .map(|value| value.to_rfc3339())
}
