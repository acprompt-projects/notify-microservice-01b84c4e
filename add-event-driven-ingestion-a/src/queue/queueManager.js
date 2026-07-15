===
const EventEmitter = require('events');

const EVENT_TYPES = {
  NOTIFICATION_CREATED: 'notification.created',
  NOTIFICATION_UPDATED: 'notification.updated',
  NOTIFICATION_DELETED: 'notification.deleted',
  WEBHOOK_RECEIVED: 'webhook.received',
  WEBHOOK_PROCESSING_FAILED: 'webhook.processing_failed',
  DLQ_MESSAGE_RETRY: 'dlq.message.retry',
};

const EVENT_SCHEMA = {
  [EVENT_TYPES.NOTIFICATION_CREATED]: {
    required: ['userId', 'type', 'payload', 'timestamp'],
    optional: ['priority', 'source'],
  },
  [EVENT_TYPES.NOTIFICATION_UPDATED]: {
    required: ['notificationId', 'userId', 'changes', 'timestamp'],
    optional: [],
  },
  [EVENT_TYPES.NOTIFICATION_DELETED]: {
    required: ['notificationId', 'userId', 'timestamp'],
    optional: [],
  },
  [EVENT_TYPES.WEBHOOK_RECEIVED]: {
    required: ['source', 'payload', 'timestamp'],
    optional: ['signature', 'headers'],
  },
  [EVENT_TYPES.WEBHOOK_PROCESSING_FAILED]: {
    required: ['originalEvent', 'error', 'attemptCount', 'timestamp'],
    optional: ['stackTrace'],
  },
  [EVENT_TYPES.DLQ_MESSAGE_RETRY]: {
    required: ['originalEvent', 'retryCount', 'timestamp'],
    optional: [],
  },
};

const MAX_RETRIES = 3;
const DLQ_SUFFIX = ':dlq';
const CHANNEL_PREFIX = 'notify:';

class QueueManager extends EventEmitter {
  constructor(redisClient, options = {}) {
    super();
    this.redis = redisClient;
    this.maxRetries = options.maxRetries || MAX_RETRIES;
    this.channelPrefix = options.channelPrefix || CHANNEL_PREFIX;
    this.subscribers = new Map();
    this.processing = false;
  }

  validateEvent(eventType, data) {
    const schema = EVENT_SCHEMA[eventType];
    if (!schema) throw new Error(`Unknown event type: ${eventType}`);
    for (const field of schema.required) {
      if (data[field] === undefined || data[field] === null) {
        throw new Error(`Missing required field "${field}" for ${eventType}`);
      }
    }
    return true;
  }

  async publish(eventType, data) {
    this.validateEvent(eventType, data);
    const channel = `${this.channelPrefix}${eventType}`;
    const message = JSON.stringify({ eventType, data, id: this._generateId(), enqueuedAt: Date.now() });
    await this.redis.publish(channel, message);
    this.emit('published', { eventType, channel, id: message.id });
    return message.id;
  }

  async enqueue(queueName, eventType, data) {
    this.validateEvent(eventType, data);
    const key = `${this.channelPrefix}queue:${queueName}`;
    const message = JSON.stringify({ eventType, data, id: this._generateId(), enqueuedAt: Date.now(), retryCount: 0 });
    await this.redis.rpush(key, message);
    this.emit('enqueued', { eventType, queueName, id: message.id });
    return message.id;
  }

  subscribe(eventType, handler) {
    const channel = `${this.channelPrefix}${eventType}`;
    if (!this.subscribers.has(channel)) {
      this.subscribers.set(channel, []);
    }
    this.subscribers.get(channel).push(handler);
    return this;
  }

  async startSubscription() {
    const channels = Array.from(this.subscribers.keys());
    if (channels.length === 0) return;
    const subscriber = this.redis.duplicate();
    await subscriber.connect();
    await subscriber.subscribe(channels, (rawMessage, receivedChannel) => {
      try {
        const message = JSON.parse(rawMessage);
        const handlers = this.subscribers.get(receivedChannel) || [];
        for (const handler of handlers) {
          Promise.resolve(handler(message)).catch(err => this.emit('handlerError', err, message));
        }
      } catch (err) {
        this.emit('parseError', err, rawMessage);
      }
    });
    this._subscriberClient = subscriber;
    this.emit('subscribed', channels);
  }

  async stopSubscription() {
    if (this._subscriberClient) {
      await this._subscriberClient.disconnect();
      this._subscriberClient = null;
    }
  }

  async consumeQueue(queueName, handler, options = {}) {
    const key = `${this.channelPrefix}queue:${queueName}`;
    const dlqKey = `${this.channelPrefix}queue:${queueName}${DLQ_SUFFIX}`;
    const pollInterval = options.pollInterval || 100;
    this.processing = true;

    const poll = async () => {
      if (!this.processing) return;
      try {
        const raw = await this.redis.lpop(key);
        if (raw) {
          const message = JSON.parse(raw);
          try {
            await handler(message);
            this.emit('consumed', { queueName, id: message.id });
          } catch (err) {
            message.retryCount = (message.retryCount || 0) + 1;
            message.lastError = err.message;
            message.lastErrorAt = Date.now();
            if (message.retryCount >= this.maxRetries) {
              await this.redis.rpush(dlqKey, JSON.stringify(message));
              this.emit('dlqAdded', { queueName, id: message.id, error: err.message });
              await this.publish(EVENT_TYPES.WEBHOOK_PROCESSING_FAILED, {
                originalEvent: message,
                error: err.message,
                attemptCount: message.retryCount,
                timestamp: Date.now(),
              });
            } else {
              await this.redis.rpush(key, JSON.stringify(message));
              this.emit('retryQueued', { queueName, id: message.id, retryCount: message.retryCount });
            }
          }
        }
      } catch (err) {
        this.emit('consumeError', err);
      }
      if (this.processing) {
        setTimeout(poll, raw ? 0 : pollInterval);
      }
    };

    poll();
    this.emit('consuming', { queueName });
  }

  async stopConsuming() {
    this.processing = false;
  }

  async getDLQMessages(queueName) {
    const dlqKey = `${this.channelPrefix}queue:${queueName}${DLQ_SUFFIX}`;
    const messages = await this.redis.lrange(dlqKey, 0, -1);
    return messages.map(m => JSON.parse(m));
  }

  async retryDLQMessage(queueName, messageId) {
    const dlqKey = `${this.channelPrefix}queue:${queueName}${DLQ_SUFFIX}`;
    const key = `${this.channelPrefix}queue:${queueName}`;
    const messages = await this.redis.lrange(dlqKey, 0, -1);
    for (const raw of messages) {
      const msg = JSON.parse(raw);
      if (msg.id === messageId) {
        await this.redis.lrem(dlqKey, 1, raw);
        msg.retryCount = 0;
        msg.retriedAt = Date.now();
        await this.redis.rpush(key, JSON.stringify(msg));
        await this.publish(EVENT_TYPES.DLQ_MESSAGE_RETRY, { originalEvent: msg, retryCount: 0, timestamp: Date.now() });
        this.emit('dlqRetried', { queueName, id: messageId });
        return true;
      }
    }
    return false;
  }

  async purgeDLQ(queueName) {
    const dlqKey = `${this.channelPrefix}queue:${queueName}${DLQ_SUFFIX}`;
    const count = await this.redis.llen(dlqKey);
    await this.redis.del(dlqKey);
    this.emit('dlqPurged', { queueName, count });
    return count;
  }

  _generateId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

module.exports = { QueueManager, EVENT_TYPES, EVENT_SCHEMA };