import { describe, expect, it } from 'vitest';
import { JOB_LOCK_NAMESPACE, jobLockKey } from './job-lock.js';
import { summarizeError } from './job-log.js';

describe('定時処理のロックの鍵', () => {
  it('名前空間は定時処理だけのもの（"JOBS" の ASCII）で、ほかの用途のアドバイザリーロックと重ならない', () => {
    expect(JOB_LOCK_NAMESPACE).toBe(0x4a4f4253);
  });

  it('鍵は処理の名前だけで決まる、PostgreSQL の int4 の範囲の整数', () => {
    const key = jobLockKey('hold-expiry');
    expect(Number.isInteger(key)).toBe(true);
    expect(key).toBeGreaterThanOrEqual(-(2 ** 31));
    expect(key).toBeLessThan(2 ** 31);
    expect(jobLockKey('hold-expiry')).toBe(key);
    expect(jobLockKey('no-show')).not.toBe(key);
  });

  it('名前が空なら RangeError', () => {
    expect(() => jobLockKey('')).toThrow(RangeError);
  });
});

describe('ログと job_runs に書く例外の要約', () => {
  it('例外の種類とコードだけを残し、文言（個人情報が入りうる）は残さない', () => {
    const error = Object.assign(new TypeError('山田 太郎 taro@example.com'), { code: 'P2002' });
    const summary = summarizeError(error);
    expect(summary).toEqual({ name: 'TypeError', code: 'P2002' });
    expect(JSON.stringify(summary)).not.toContain('taro');
  });

  it('PostgreSQL の SQLSTATE（数字と英大文字）もコードとして残す。形の違うコードは残さない', () => {
    expect(summarizeError(Object.assign(new Error('x'), { code: '23505' }))).toEqual({
      name: 'Error',
      code: '23505',
    });
    expect(summarizeError(Object.assign(new Error('x'), { code: 'taro@example.com' }))).toEqual({
      name: 'Error',
    });
  });

  it('Error でない値は、その型の名前だけを残す', () => {
    expect(summarizeError('山田')).toEqual({ name: 'string' });
    expect(summarizeError(undefined)).toEqual({ name: 'undefined' });
    expect(summarizeError({ code: 'P2025' })).toEqual({ name: 'object', code: 'P2025' });
  });
});
