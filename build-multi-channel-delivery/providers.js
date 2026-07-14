const { EventEmitter } = require('events');

class BaseProvider extends EventEmitter {
  constructor(channel, config = {}) {
    super();
    this.channel = channel;
    this.config = config;
    this.maxRetries = config.maxRetries ?? 3;
    this.baseDelayMs = config.baseDelayMs ?? 1000;
    this.maxDelayMs = config.maxDelayMs ?? 30000;
  }

  async send(notification, recipient) {
    throw new Error(`send() not implemented on ${this.channel} provider`);
  }

  async sendWithRetry(notification, recipient, attempt = 0) {
    try {
      const result = await this.send(notification, recipient);
      this.emit('delivered', { channel: this.channel, notificationId: notification.id, recipient, result, attempt });
      return { status: 'delivered', channel: this.channel, attempt, result };
    } catch (error) {
      const nextAttempt = attempt + 1;
      if (nextAttempt > this.maxRetries) {
        this.emit('failed', { channel: this.channel, notificationId: notification.id, recipient, error: error.message, attempts: nextAttempt });
        return { status: 'failed', channel: this.channel, attempts: nextAttempt, error: error.message };
      }
      const delay = Math.min(this.baseDelayMs * Math.pow(2, attempt), this.maxDelayMs) + Math.floor(Math.random() * 500);
      this.emit('retrying', { channel: this.channel, notificationId: notification.id, recipient, attempt: nextAttempt, delay, error: error.message });
      await new Promise(r => setTimeout(r, delay));
      return this.sendWithRetry(notification, recipient, nextAttempt);
    }
  }
}

class EmailProvider extends BaseProvider {
  constructor(config = {}) {
    super('email', config);
  }
  async send(notification, recipient) {
    if (!recipient.email) throw new Error('Recipient has no email address');
    // Simulate email sending via SMTP/API
    const result = { to: recipient.email, subject: notification.subject || notification.title, body: notification.body, provider: 'smtp' };
    return result;
  }
}

class SmsProvider extends BaseProvider {
  constructor(config = {}) {
    super('sms', config);
  }
  async send(notification, recipient) {
    if (!recipient.phone) throw new Error('Recipient has no phone number');
    const result = { to: recipient.phone, body: notification.body, provider: this.config.provider || 'twilio' };
    return result;
  }
}

class PushProvider extends BaseProvider {
  constructor(config = {}) {
    super('push', config);
  }
  async send(notification, recipient) {
    if (!recipient.pushTokens || recipient.pushTokens.length === 0) throw new Error('Recipient has no push tokens');
    const result = { tokens: recipient.pushTokens, title: notification.title, body: notification.body, provider: this.config.provider || 'fcm' };
    return result;
  }
}

class InAppProvider extends BaseProvider {
  constructor(config = {}) {
    super('in_app', config);
  }
  async send(notification, recipient) {
    if (!recipient.userId) throw new Error('Recipient has no userId');
    const result = { userId: recipient.userId, notificationId: notification.id, title: notification.title, body: notification.body, read: false };
    return result;
  }
}

const PROVIDER_MAP = { email: EmailProvider, sms: SmsProvider, push: PushProvider, in_app: InAppProvider };

function createProvider(channel, config) {
  const ProviderClass = PROVIDER_MAP[channel];
  if (!ProviderClass) throw new Error(`Unknown channel: ${channel}`);
  return new ProviderClass(config);
}

module.exports = { BaseProvider, EmailProvider, SmsProvider, PushProvider, InAppProvider, createProvider, PROVIDER_MAP };