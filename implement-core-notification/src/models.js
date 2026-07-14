const { Sequelize, DataTypes } = require('sequelize');

const DB_URL = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/notify_db';

const sequelize = new Sequelize(DB_URL, {
  dialect: 'postgres',
  logging: false,
  define: { underscored: true, timestamps: true },
});

const Notification = sequelize.define('Notification', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  user_id: { type: DataTypes.STRING, allowNull: false, index: true },
  type: { type: DataTypes.STRING, allowNull: false },
  title: { type: DataTypes.STRING, allowNull: false },
  message: { type: DataTypes.TEXT, allowNull: false },
  status: {
    type: DataTypes.ENUM('unread', 'read', 'archived'),
    defaultValue: 'unread',
    index: true,
  },
});

const UserPreference = sequelize.define('UserPreference', {
  id: { type: DataTypes.UUID, defaultValue: DataTypes.UUIDV4, primaryKey: true },
  user_id: { type: DataTypes.STRING, allowNull: false, unique: true, index: true },
  enabled: { type: DataTypes.BOOLEAN, defaultValue: true },
  channels: { type: DataTypes.JSONB, defaultValue: { email: true, push: true, sms: false } },
  type_filters: { type: DataTypes.JSONB, defaultValue: {} },
  quiet_hours_start: { type: DataTypes.STRING, defaultValue: null },
  quiet_hours_end: { type: DataTypes.STRING, defaultValue: null },
});

async function initDB() {
  await sequelize.authenticate();
  await sequelize.sync({ alter: true });
  console.log('Database synced');
}

module.exports = { sequelize, Notification, UserPreference, initDB };