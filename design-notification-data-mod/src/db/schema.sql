CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         VARCHAR(255) NOT NULL UNIQUE,
  display_name  VARCHAR(128) NOT NULL,
  created_at    TIMESTAMPTZ  NOT NULL DEFAULT now()
);

CREATE TABLE channels (
  id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name  VARCHAR(64) NOT NULL UNIQUE  -- e.g. 'email','sms','push','in_app','websocket'
);

CREATE TABLE preferences (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  UUID NOT NULL REFERENCES channels(id) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT TRUE,
  quiet_start TIME                   -- e.g. '22:00'
, quiet_end   TIME                   -- e.g. '07:00'
, UNIQUE(user_id, channel_id)
);

CREATE TABLE notifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  channel_id  UUID NOT NULL REFERENCES channels(id),
  title       VARCHAR(255) NOT NULL,
  body        TEXT NOT NULL DEFAULT '',
  priority    VARCHAR(16) NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high','urgent')),
  metadata    JSONB NOT NULL DEFAULT '{}',
  read        BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE delivery_status (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  notification_id UUID NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
  channel_id      UUID NOT NULL REFERENCES channels(id),
  status          VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','delivered','failed')),
  attempts        INTEGER NOT NULL DEFAULT 0,
  last_attempt_at TIMESTAMPTZ,
  error_message   TEXT,
  delivered_at    TIMESTAMPTZ,
  UNIQUE(notification_id, channel_id)
);

CREATE INDEX idx_notifications_user    ON notifications(user_id, created_at DESC);
CREATE INDEX idx_notifications_unread  ON notifications(user_id) WHERE read = FALSE;
CREATE INDEX idx_delivery_pending      ON delivery_status(status) WHERE status = 'pending';