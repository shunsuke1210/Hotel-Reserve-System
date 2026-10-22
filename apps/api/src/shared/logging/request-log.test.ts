import { Logger } from '@nestjs/common';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConsoleRequestLogSink, type RequestLogEntry } from './request-log.js';

describe('ConsoleRequestLogSink（要求のログの既定の出力先）', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('1つの要求のログを、Request の文脈でアプリのロガーに1回書く', () => {
    const log = vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const entry: RequestLogEntry = {
      requestId: '8f14e45fceea167a5a36dedd4bea2543',
      listener: 'staff',
      userType: 'ANONYMOUS',
      method: 'GET',
      path: '/api/staff/health',
      status: 200,
      result: 'OK',
      durationMs: 3,
    };

    new ConsoleRequestLogSink().write(entry);

    expect(log).toHaveBeenCalledTimes(1);
    expect(log).toHaveBeenCalledWith(entry);
    expect((log.mock.contexts[0] as { context?: string }).context).toBe('Request');
  });
});
