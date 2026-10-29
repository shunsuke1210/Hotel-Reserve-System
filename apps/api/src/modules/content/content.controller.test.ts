// 公開用 API の GET /room-types・GET /terms/current の言語の決め方と入力の検証を、データベースなしで確かめる
// （ContentService をテスト用のものに差し替える）。翻訳文の取得そのものは content.integration.test.ts で確かめる。
import type { Locale, RoomTypeListResponse, TermsDocumentResponse } from '@hotel/contracts';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { errorMessage } from '../../shared/errors/error-messages.js';
import { createTestListenerApp } from '../../test/listener-app.js';
import { ContentService } from './content.service.js';

/** 受け取った言語を記録して、その言語を応答に入れるだけの ContentService */
class RecordingContentService {
  readonly locales: Locale[] = [];

  async listRoomTypes(locale: Locale): Promise<RoomTypeListResponse> {
    this.locales.push(locale);
    return { locale, roomTypes: [], options: [] };
  }

  async currentTerms(locale: Locale): Promise<TermsDocumentResponse> {
    this.locales.push(locale);
    return { locale, version: 1, publishedAt: '2025-12-31T15:00:00.000Z', body: `${locale}:本文` };
  }
}

describe('GET /api/guest/room-types・/api/guest/terms/current（言語の決め方）', () => {
  let guest: INestApplication;
  let staff: INestApplication;
  let content: RecordingContentService;

  beforeAll(async () => {
    content = new RecordingContentService();
    guest = await createTestListenerApp('guest', {
      overrides: [{ provide: ContentService, useValue: content }],
    });
    staff = await createTestListenerApp('staff');
  });

  afterAll(async () => {
    await guest?.close();
    await staff?.close();
  });

  beforeEach(() => {
    content.locales.length = 0;
  });

  it.each(['ja', 'en', 'ko', 'zh-Hans', 'zh-Hant'] as const)(
    '[16.4] lang=%s を指定すると、その言語の内容を返す（ログインせずに使える）',
    async (lang) => {
      const roomTypes = await request(guest.getHttpServer())
        .get('/api/guest/room-types')
        .query({ lang })
        .expect(200);
      expect(roomTypes.body).toEqual({ locale: lang, roomTypes: [], options: [] });

      const terms = await request(guest.getHttpServer())
        .get('/api/guest/terms/current')
        .query({ lang })
        .expect(200);
      expect(terms.body).toMatchObject({ locale: lang, body: `${lang}:本文` });
      expect(content.locales).toEqual([lang, lang]);
    },
  );

  it('[16.4] lang を指定すると、Accept-Language より lang を優先する', async () => {
    await request(guest.getHttpServer())
      .get('/api/guest/room-types?lang=zh-Hant')
      .set('Accept-Language', 'ko')
      .expect(200);
    expect(content.locales).toEqual(['zh-Hant']);
  });

  it('[16.4] lang がなければ、要求の言語（ログインしていなければ Accept-Language。L-11）にする', async () => {
    await request(guest.getHttpServer())
      .get('/api/guest/terms/current')
      .set('Accept-Language', 'ko-KR,ko;q=0.9,en;q=0.8')
      .expect(200);
    await request(guest.getHttpServer()).get('/api/guest/room-types').expect(200);
    expect(content.locales).toEqual(['ko', 'ja']);
  });

  it.each(['fr', 'EN', 'zh-CN', ''])(
    '[16.1] 対応しない言語（lang=%s）は VALIDATION_FAILED（400。文言は要求の言語）',
    async (lang) => {
      const response = await request(guest.getHttpServer())
        .get('/api/guest/room-types')
        .query({ lang })
        .set('Accept-Language', 'en')
        .expect(400);
      expect(response.body).toEqual({
        code: 'VALIDATION_FAILED',
        message: errorMessage('VALIDATION_FAILED', 'en'),
      });
      expect(content.locales).toEqual([]);
    },
  );

  it('lang を2つ以上指定すると VALIDATION_FAILED', async () => {
    const response = await request(guest.getHttpServer())
      .get('/api/guest/terms/current?lang=en&lang=ko')
      .expect(400);
    expect(response.body.code).toBe('VALIDATION_FAILED');
    expect(content.locales).toEqual([]);
  });

  it('[16.6] 社内用の待ち受け口には、客室タイプ・約款の翻訳文の URL がない（NOT_FOUND）', async () => {
    for (const path of ['/api/staff/room-types?lang=en', '/api/staff/terms/current?lang=en']) {
      const response = await request(staff.getHttpServer()).get(path).expect(404);
      expect(response.body.code).toBe('NOT_FOUND');
    }
  });
});
