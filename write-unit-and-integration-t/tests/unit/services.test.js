const deliveryEngine = require('../../src/services/deliveryEngine');
const queueProcessor = require('../../src/services/queueProcessor');
const { validatePreferences, applyPreferences } = require('../../src/services/preferences');

describe('Delivery Engine routing', () => {
  const clients = { u1: { send: jest.fn(), readyState: 1 }, u2: { send: jest.fn(), readyState: 3 } };

  beforeEach(() => { clients.u1.send.mockClear(); clients.u2.send.mockClear(); deliveryEngine.setClients(clients); });

  test('delivers to connected WebSocket client', () => {
    const notif = { userId: 'u1', type: 'info', message: 'Hi' };
    const result = deliveryEngine.deliver(notif);
    expect(clients.u1.send).toHaveBeenCalledWith(JSON.stringify(notif));
    expect(result).toEqual({ delivered: true, channel: 'websocket' });
  });

  test('queues for offline user (no client entry)', () => {
    const result = deliveryEngine.deliver({ userId: 'u3', type: 'alert', message: 'M' });
    expect(result).toEqual({ delivered: false, channel: 'queued', reason: 'offline' });
  });

  test('queues when WebSocket not open (readyState != 1)', () => {
    const result = deliveryEngine.deliver({ userId: 'u2', type: 'alert', message: 'M' });
    expect(clients.u2.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, channel: 'queued', reason: 'connection_not_open' });
  });

  test('skips delivery when preference filters out type', () => {
    const notif = { userId: 'u1', type: 'promo', message: 'Sale' };
    const prefs = { channels: ['websocket'], typeFilters: { promo: false } };
    const result = deliveryEngine.deliver(notif, prefs);
    expect(clients.u1.send).not.toHaveBeenCalled();
    expect(result).toEqual({ delivered: false, channel: 'none', reason: 'filtered_by_preference' });
  });
});

describe('Queue Processor', () => {
  let queue, deliveryMock;

  beforeEach(() => {
    queue = [];
    deliveryMock = { deliver: jest.fn() };
    queueProcessor.setQueue(queue);
    queueProcessor.setDelivery(deliveryMock);
  });

  test('processes queued items for newly connected user', () => {
    queue.push({ userId: 'u3', type: 'alert', message: 'Welcome' });
    deliveryMock.deliver.mockReturnValue({ delivered: true, channel: 'websocket' });
    const count = queueProcessor.processForUser('u3');
    expect(count).toBe(1);
    expect(queue).toHaveLength(0);
  });

  test('increments attempts on failed delivery', () => {
    const item = { userId: 'u3', type: 'alert', message: 'X', attempts: 0 };
    queue.push(item);
    deliveryMock.deliver.mockReturnValue({ delivered: false, reason: 'timeout' });
    queueProcessor.processForUser('u3');
    expect(item.attempts).toBe(1);
    expect(queue).toHaveLength(1);
  });

  test('drops item after max retries (3)', () => {
    queue.push({ userId: 'u3', type: 'alert', message: 'X', attempts: 3 });
    deliveryMock.deliver.mockReturnValue({ delivered: false });
    queueProcessor.processForUser('u3');
    expect(queue).toHaveLength(0);
  });
});

describe('Preference logic', () => {
  test('validates correct preferences', () => {
    const prefs = { userId: 'u1', channels: ['websocket', 'email'], quietHours: { start: '22:00', end: '08:00' } };
    expect(validatePreferences(prefs).valid).toBe(true);
  });

  test('rejects invalid channels', () => {
    const result = validatePreferences({ userId: 'u1', channels: ['websocket', 'fax'] });
    expect(result.valid).toBe(false);
    expect(result.errors).toContain('Invalid channel: fax');
  });

  test('rejects bad quietHours format', () => {
    const result = validatePreferences({ userId: 'u1', channels: ['websocket'], quietHours: { start: 'bad', end: '08:00' } });
    expect(result.valid).toBe(false);
  });

  test('filters blocked notification type', () => {
    const result = applyPreferences({ type: 'promo' }, { typeFilters: { promo: false } });
    expect(result.allowed).toBe(false);
  });

  test('allows unfiltered notification type', () => {
    const result = applyPreferences({ type: 'info' }, { typeFilters: { promo: false } });
    expect(result.allowed).toBe(true);
  });

  test('defaults to allowed when no typeFilters set', () => {
    const result = applyPreferences({ type: 'alert' }, {});
    expect(result.allowed).toBe(true);
  });
});