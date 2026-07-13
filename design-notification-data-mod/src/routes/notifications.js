const express = require('express');
const router = express.Router();

// POST /notify — create a notification and initial delivery records
router.post('/notify', async (req, res) => {
  const { userId, title, body, priority, channels, metadata } = req.body;
  if (!userId || !title) return res.status(400).json({ error: 'userId and title required' });

  const notification = await req.db.query(
    `INSERT INTO notifications (user_id, title, body, priority, metadata)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    [userId, title, body || '', priority || 'normal', JSON.stringify(metadata || {})]
  );

  const channelIdRows = channels?.length
    ? await req.db.query(`SELECT id FROM channels WHERE name = ANY($1)`, [channels])
    : await req.db.query(`SELECT id FROM channels`);

  for (const ch of channelIdRows.rows) {
    await req.db.query(
      `INSERT INTO delivery_status (notification_id, channel_id) VALUES ($1, $2)`,
      [notification.rows[0].id, ch.id]
    );
  }

  req.ws.broadcast(userId, notification.rows[0]);
  res.status(201).json(notification.rows[0]);
});

// GET /notifications/:userId — list notifications for a user
router.get('/notifications/:userId', async (req, res) => {
  const { limit = 50, offset = 0, unreadOnly = false } = req.query;
  const where = unreadOnly === 'true' ? 'AND read = FALSE' : '';
  const result = await req.db.query(
    `SELECT n.*, c.name AS channel_name
     FROM notifications n
     JOIN channels c ON c.id = n.channel_id
     WHERE n.user_id = $1 ${where}
     ORDER BY n.created_at DESC LIMIT $2 OFFSET $3`,
    [req.params.userId, Number(limit), Number(offset)]
  );
  res.json({ count: result.rows.length, notifications: result.rows });
});

// PUT /preferences/:userId — upsert per-channel preferences
router.put('/preferences/:userId', async (req, res) => {
  const { userId } = req.params;
  const { prefs } = req.body; // [{ channel: 'email', enabled: true, quiet_start: '22:00', quiet_end: '07:00' }]
  if (!Array.isArray(prefs)) return res.status(400).json({ error: 'prefs must be an array' });

  const upserted = [];
  for (const p of prefs) {
    const ch = await req.db.query(`SELECT id FROM channels WHERE name = $1`, [p.channel]);
    if (!ch.rows[0]) continue;
    const row = await req.db.query(
      `INSERT INTO preferences (user_id, channel_id, enabled, quiet_start, quiet_end)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, channel_id) DO UPDATE
       SET enabled = EXCLUDED.enabled, quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end
       RETURNING *`,
      [userId, ch.rows[0].id, p.enabled ?? true, p.quiet_start || null, p.quiet_end || null]
    );
    upserted.push(row.rows[0]);
  }
  res.json({ preferences: upserted });
});

// DELETE /notifications/:id — remove a notification and its delivery records
router.delete('/notifications/:id', async (req, res) => {
  const result = await req.db.query(
    `DELETE FROM notifications WHERE id = $1 RETURNING id`, [req.params.id]
  );
  if (!result.rows[0]) return res.status(404).json({ error: 'notification not found' });
  res.json({ deleted: result.rows[0].id });
});

module.exports = router;