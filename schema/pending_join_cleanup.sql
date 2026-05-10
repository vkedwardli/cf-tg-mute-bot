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
