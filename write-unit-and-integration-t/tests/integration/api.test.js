const request = require('supertest');
const app = require('../../src/app');

jest.mock('../../src/store/notifications', () => {
  const store = { create: jest.fn(), findByUser: jest.fn(), findById: jest.fn(), update: jest.fn(), delete: jest.fn() };
  return { getInstance: () => store };
});
jest.mock('../../src/store/preferences', () => {
  const store = { findByUser: jest.fn(), update: jest.fn() };
  return { getInstance: () => store };
});

const { getInstance: getNotifStore } = require('../../src/store/notifications');
const { getInstance: getPrefStore } = require('../../src/store/preferences');

describe('Notification CRUD API', () => {
  const nStore = getNotifStore();

  beforeEach(() => jest.clearAllMocks());

  test('POST /api/notifications → 201 with created notification', async () => {
    const payload = { userId: 'u1', type: 'info', message: 'Hello' };
    nStore.create.mockResolvedValue({ id: 'n1', ...payload, read: false, createdAt: Date.now() });
    const res = await request(app).post('/api/notifications').send(payload);
    expect(res.status).toBe(201);
    expect(res.body.id).toBe('n1');
    expect(res.body.userId).toBe('u1');
  });

  test('POST /api/notifications → 400 missing userId', async () => {
    const res = await request(app).post('/api/notifications').send({ type: 'info', message: 'X' });
    expect(res.status).toBe(400);
  });

  test('GET /api/notifications/:userId → 200 with list', async () => {
    nStore.findByUser.mockResolvedValue([{ id: 'n1', userId: 'u1', type: 'info', message: 'Hi' }]);
    const res = await request(app).get('/api/notifications/u1');
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  test('GET /api/notifications/:userId → 200 empty for unknown', async () => {
    nStore.findByUser.mockResolvedValue([]);
    const res = await request(app).get('/api/notifications/ghost');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  test('PUT /api/notifications/:id → 200 mark read', async () => {
    nStore.findById.mockResolvedValue({ id: 'n1', read: false });
    nStore.update.mockResolvedValue({ id: 'n1', read: true });
    const res = await request(app).put('/api/notifications/n1').send({ read: true });
    expect(res.status).toBe(200);
    expect(res.body.read).toBe(true);
  });

  test('PUT /api/notifications/:id → 404 not found', async () => {
    nStore.findById.mockResolvedValue(null);
    const res = await request(app).put('/api/notifications/missing').send({ read: true });
    expect(res.status).toBe(404);
  });

  test('DELETE /api/notifications/:id → 204', async () => {
    nStore.findById.mockResolvedValue({ id: 'n1' });
    nStore.delete.mockResolvedValue(true);
    const res = await request(app).delete('/api/notifications/n1');
    expect(res.status).toBe(204);
  });
});

describe('Preferences API', () => {
  const pStore = getPrefStore();

  beforeEach(() => jest.clearAllMocks());

  test('GET /api/preferences/:userId → 200', async () => {
    const prefs = { userId: 'u1', channels: ['websocket', 'email'], quietHours: { start: '22:00', end: '08:00' } };
    pStore.findByUser.mockResolvedValue(prefs);
    const res = await request(app).get('/api/preferences/u1');
    expect(res.status).toBe(200);
    expect(res.body.channels).toContain('websocket');
  });

  test('PUT /api/preferences/:userId → 200 updated', async () => {
    const updated = { userId: 'u1', channels: ['websocket'], quietHours: { start: '23:00', end: '07:00' } };
    pStore.update.mockResolvedValue(updated);
    const res = await request(app).put('/api/preferences/u1').send({ channels: ['websocket'], quietHours: { start: '23:00', end: '07:00' } });
    expect(res.status).toBe(200);
    expect(res.body.channels).toEqual(['websocket']);
  });

  test('PUT /api/preferences/:userId → 400 invalid channel', async () => {
    const res = await request(app).put('/api/preferences/u1').send({ channels: ['fax'] });
    expect(res.status).toBe(400);
  });
});