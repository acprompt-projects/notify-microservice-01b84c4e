const express = require('express');
const { Notification, UserPreference, initDB } = require('./models');

const app = express();
app.use(express.json());

// --- Notification Controllers ---

async function createNotification(req, res) {
  try {
    const { user_id, type, title, message } = req.body;
    if (!user_id || !type || !title || !message) {
      return res.status(400).json({ error: 'user_id, type, title, and message are required' });
    }
    const pref = await UserPreference.findOne({ where: { user_id } });
    if (pref && !pref.enabled) {
      return res.status(403).json({ error: 'Notifications disabled for this user' });
    }
    if (pref && pref.type_filters && pref.type_filters[type] === false) {
      return res.status(403).json({ error: `Notification type "${type}" disabled for this user` });
    }
    const notification = await Notification.create({ user_id, type, title, message });
    res.status(201).json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function getNotifications(req, res) {
  try {
    const { userId } = req.params;
    const { status, type, limit = '50', offset = '0' } = req.query;
    const where = { user_id: userId };
    if (status) where.status = status;
    if (type) where.type = type;
    const notifications = await Notification.findAll({
      where,
      order: [['created_at', 'DESC']],
      limit: parseInt(limit, 10),
      offset: parseInt(offset, 10),
    });
    const total = await Notification.count({ where });
    res.json({ notifications, total, limit: +limit, offset: +offset });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updateStatus(req, res) {
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!['read', 'archived'].includes(status)) {
      return res.status(400).json({ error: 'Status must be "read" or "archived"' });
    }
    const notification = await Notification.findByPk(id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    await notification.update({ status });
    res.json(notification);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function deleteNotification(req, res) {
  try {
    const { id } = req.params;
    const notification = await Notification.findByPk(id);
    if (!notification) return res.status(404).json({ error: 'Notification not found' });
    await notification.destroy();
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Preference Controllers ---

async function getPreferences(req, res) {
  try {
    const { userId } = req.params;
    let pref = await UserPreference.findOne({ where: { user_id: userId } });
    if (!pref) pref = await UserPreference.create({ user_id: userId });
    res.json(pref);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

async function updatePreferences(req, res) {
  try {
    const { userId } = req.params;
    const { enabled, channels, type_filters, quiet_hours_start, quiet_hours_end } = req.body;
    let pref = await UserPreference.findOne({ where: { user_id: userId } });
    if (!pref) pref = await UserPreference.create({ user_id: userId });
    await pref.update({ enabled, channels, type_filters, quiet_hours_start, quiet_hours_end });
    res.json(pref);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
}

// --- Routes ---

app.post('/notifications', createNotification);
app.get('/notifications/:userId', getNotifications);
app.put('/notifications/:id/status', updateStatus);
app.delete('/notifications/:id', deleteNotification);
app.get('/preferences/:userId', getPreferences);
app.put('/preferences/:userId', updatePreferences);

// --- Start Server ---

const PORT = process.env.PORT || 3000;

async function start() {
  await initDB();
  app.listen(PORT, () => console.log(`Notification service running on port ${PORT}`));
}

start().catch((err) => {
  console.error('Failed to start:', err);
  process.exit(1);
});

module.exports = app;