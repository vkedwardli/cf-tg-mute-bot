DROP TABLE IF EXISTS silence_poll;
CREATE TABLE IF NOT EXISTS silence_poll
(
    poll_id               TEXT PRIMARY KEY,
    chat_id               INTEGER,
    triggered_by_user_id  INTEGER,
    triggered_by_username TEXT,
    target_user_id        INTEGER,
    target_username       TEXT,
    target_message        TEXT,
    total_vote            INTEGER,
    positive_vote         INTEGER,
    silence_status        BOOLEAN,
    status_message_id     INTEGER,
    created_at            INTEGER
);
