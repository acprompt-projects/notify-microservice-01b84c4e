const { EventEmitter } = require('events');
const { createProvider } = require('./providers');

const CHANNELS = ['email', 'sms', 'push', 'in_app'];

class DeliveryEngine extends EventEmitter {
  constructor(config = {}) {
    super();
    this.providers = {};
    this.webhookUrl = config.webhookUrl || null;
    this.webhookTimeout = config.webhookTimeout || 5000;
    this._initProviders(config.providers || {});
  }

  _initProviders(providerConfigs) {
    for (const channel of CHANNELS) {
      const cfg = providerConfigs[channel] || {};
      this.providers[channel] = createProvider(channel, cfg);
      this.providers[channel].on('delivered', (e) => this.emit('channel:delivered', e));
      this.providers[channel].on('failed', (e) => this.emit('channel:failed', e));
      this.providers[channel].on('retrying', (e) => this.emit('channel:retrying', e));
    }
  }

  getProvider(channel) {
    return this.providers[channel] || null;
  }

  resolveChannels(preferences) {
    if (!preferences || Object.keys(preferences).length === 0) return ['in_app'];
    return CHANNELS.filter(ch => preferences[ch] === true);
  }

  async deliver(notification, recipient, preferences) {
    const channels = this.resolveChannels(preferences);
    const results = {};
    const settled = await Promise.allSettled(
      channels.map(async (channel) => {
        const provider = this.providers[channel];
        const result = await provider.sendWithRetry(notification, recipient);
        results[channel] = result;
        return result;
      })
    );
    const delivery = {
      notificationId: notification.id,
      recipientId: recipient.userId || recipient.email || recipient.phone,
      channels,
      results,
      timestamp: new Date().toISOString(),
    };
    this.emit('delivery:complete', delivery);
    await this._fireWebhook(delivery);
    return delivery;
  }

  async _fireWebhook(delivery) {
    if (!this.webhookUrl) return;
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.webhookTimeout);
      const res = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ event: 'delivery_status', delivery }),
        signal: controller.signal,
      });
      clearTimeout(timer);
      if (!res.ok) this.emit('webhook:error', { url: this.webhookUrl, status: res.status });
      else this.emit('webhook:sent', { url: this.webhookUrl, status: res.status });
    } catch (err) {
      this.emit('webhook:error', { url: this.webhookUrl, error: err.message });
    }
  }
}

module.exports = { DeliveryEngine, CHANNELS };