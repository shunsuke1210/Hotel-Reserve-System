// お知らせのモジュールの読み込み（データベースは使わない）。
// 社内用の待ち受け口に載せること（お知らせの一覧・解決の API は 7.6）と、公開用の待ち受け口のモジュール
// （Web の確定 5.7・会員の変更 6.2 が清掃時間の判定を呼ぶ）も、このモジュールを読み込めば使えること。
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { listenerRootModule } from '../../listeners.js';
import { RequestLogSink } from '../../shared/logging/request-log.js';
import { PrismaService } from '../../shared/prisma/prisma.service.js';
import {
  createNoDatabasePrisma,
  createTestListenerApp,
  MemoryRequestLogSink,
} from '../../test/listener-app.js';
import { TEST_MAIL_SETTINGS } from '../../test/mail.js';
import { MailSettings } from '../notifications/mail-settings.js';
import { NoticeService } from './notice.service.js';
import { NoticesModule } from './notices.module.js';

describe('NoticesModule', () => {
  it('[10.11] 社内用の待ち受け口で NoticeService を使える（URL は増やさない）', async () => {
    const app = await createTestListenerApp('staff');
    try {
      expect(app.get(NoticeService)).toBeInstanceOf(NoticeService);
    } finally {
      await app.close();
    }
  });

  it('[10.11] 公開用の待ち受け口のモジュールも、NoticesModule を読み込めば NoticeService を使える', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [listenerRootModule('guest', 'test'), NoticesModule],
    })
      .overrideProvider(PrismaService)
      .useValue(createNoDatabasePrisma())
      .overrideProvider(RequestLogSink)
      .useValue(new MemoryRequestLogSink())
      .overrideProvider(MailSettings)
      .useValue(TEST_MAIL_SETTINGS)
      .compile();
    try {
      expect(moduleRef.get(NoticeService)).toBeInstanceOf(NoticeService);
    } finally {
      await moduleRef.close();
    }
  });
});
