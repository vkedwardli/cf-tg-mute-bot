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
    is_admin              BOOLEAN,
    admin_permissions     TEXT,
    admin_custom_title    TEXT,
    created_at            INTEGER,
    poll_message_id       INTEGER,
    is_closed             BOOLEAN DEFAULT FALSE
);

CREATE TABLE IF NOT EXISTS silence_poll_vote
(
    poll_id    TEXT,
    user_id    INTEGER,
    full_name  TEXT,
    username   TEXT,
    option_idx INTEGER,
    updated_at INTEGER,
    PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS pending_join_cleanup
(
    chat_id                 INTEGER,
    user_id                 INTEGER,
    display_name            TEXT,
    join_message_id         INTEGER,
    rose_welcome_message_id INTEGER,
    joined_at               INTEGER,
    processed               BOOLEAN DEFAULT FALSE,
    result                  TEXT,
    processed_at            INTEGER,
    PRIMARY KEY (chat_id, user_id, join_message_id)
);

CREATE INDEX IF NOT EXISTS pending_join_cleanup_pending_idx
    ON pending_join_cleanup (processed, joined_at);
