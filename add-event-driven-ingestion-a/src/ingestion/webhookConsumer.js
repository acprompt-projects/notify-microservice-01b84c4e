===
const { QueueManager, EVENT_TYPES } = require('../queue/queueManager');

const WEBHOOK_QUEUE = 'webhook-ingestion';

class WebhookConsumer {
  constructor(queueManager, notificationService) {
    this.qm = queueManager;
    this.notificationService = notificationService;
    this.running = false;
  }

  async start() {
    this.running = true;
    this.qm.subscribe(EVENT_TYPES.WEBHOOK_RECEIVED, async (message) => {
      await this._handleWebhook(message.data);
    });

    this.qm.subscribe(EVENT_TYPES.WEBHOOK_PROCESSING_FAILED, async (message) => {
      console.error(`[DLQ] Webhook processing failed after ${message.data.attemptCount} attempts: ${message.data.error}`);
    });

    this.qm.subscribe(EVENT_TYPES.DLQ_MESSAGE_RETRY, async (message) => {
      console.info(`[DLQ] Retrying message ${message.data.originalEvent.id}, retry #${message.data.retryCount}`);
    });

    await this.qm.startSubscription();
    await this.qm.consumeQueue(WEBHOOK_QUEUE, async (msg) => {
      await this._handleWebhook(msg.data);
    }, { pollInterval: 50 });
    console.info('[WebhookConsumer] Started subscription and queue consumption');
  }

  async stop() {
    this.running = false;
    await this.qm.stopSubscription();
    await this.qm.stopConsuming();
    console.info('[WebhookConsumer] Stopped');
  }

  async ingestWebhook(source, payload, options = {}) {
    const data = {
      source,
      payload,
      timestamp: Date.now(),
      signature: options.signature || null,
      headers: options.headers || null,
    };
    const eventId = await this.qm.enqueue(WEBHOOK_QUEUE, EVENT_TYPES.WEBHOOK_RECEIVED, data);
    return { eventId, status: 'queued' };
  }

  async _handleWebhook(data) {
    const { source, payload } = data;
    const mapping = this._sourceMapping(source);
    if (!mapping) {
      throw new Error(`No mapping configured for webhook source: "${source}"`);
    }
    const notification = {
      userId: mapping.userIdExtractor(payload),
      type: mapping.notificationType,
      payload: mapping.payloadTransformer(payload),
      priority: mapping.priority || 'normal',
      source,
      timestamp: data.timestamp,
    };
    const result = await this.notificationService.createNotification(notification);
    await this.qm.publish(EVENT_TYPES.NOTIFICATION_CREATED, notification);
    return result;
  }

  _sourceMapping(source) {
    const mappings = WebhookConsumer.SOURCE_MAPPINGS;
    return mappings[source] || null;
  }

  static SOURCE_MAPPINGS = {};
}

WebhookConsumer.registerSource = (source, config) => {
  WebhookConsumer.SOURCE_MAPPINGS[source] = {
    notificationType: config.notificationType || 'info',
    userIdExtractor: config.userIdExtractor || (p) => p.user_id || p.userId,
    payloadTransformer: config.payloadTransformer || (p) => p,
    priority: config.priority || 'normal',
  };
};

WebhookConsumer.registerSource('stripe', {
  notificationType: 'payment',
  userIdExtractor: (p) => p.customer_id,
  payloadTransformer: (p) => ({ amount: p.amount, currency: p.currency, status: p.status }),
  priority: 'high',
});

WebhookConsumer.registerSource('github', {
  notificationType: 'code',
  userIdExtractor: (p) => p.assignee?.login || p.sender?.login,
  payloadTransformer: (p) => ({ action: p.action, repo: p.repository?.full_name, issue: p.issue?.number }),
  priority: 'normal',
});

module.exports = { WebhookConsumer, WEBHOOK_QUEUE };