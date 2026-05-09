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
