CREATE TABLE IF NOT EXISTS join_cleanup_announcement
(
    chat_id                  INTEGER PRIMARY KEY,
    message_id               INTEGER,
    last_activity_message_id INTEGER NOT NULL DEFAULT 0,
    members                  TEXT NOT NULL DEFAULT '[]',
    omitted_count            INTEGER NOT NULL DEFAULT 0,
    locked_until             REAL NOT NULL DEFAULT 0
);
