import { describe, expect, it } from 'vitest';
import { DemoIssueGateway } from '../server/issueGateway.js';

describe('demo issue gateway', () => {
  it('creates one issue and can find the stable correlation marker', async () => {
    const gateway = new DemoIssueGateway();
    const draft = { correlationId: 'abc', title: 'A shaped bet', body: '<!-- pitch:abc -->\nBody' };
    const created = await gateway.createIssue(draft);
    const found = await gateway.findByCorrelationId('abc');

    expect(created.number).toBe(41);
    expect(found?.number).toBe(created.number);
    expect(gateway.mode).toBe('demo');
  });

  it('updates only the requested issue identity', async () => {
    const gateway = new DemoIssueGateway();
    const created = await gateway.createIssue({ correlationId: 'abc', title: 'First', body: '<!-- pitch:abc -->' });
    const updated = await gateway.updateIssue(created.number, { correlationId: 'abc', title: 'Revised', body: '<!-- pitch:abc -->\nRevised' });

    expect(updated.number).toBe(created.number);
    expect(updated.title).toBe('Revised');
    expect(updated.state).toBe('open');
  });
});
