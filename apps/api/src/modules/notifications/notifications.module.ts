// メールの作成と送信（design.md File Structure Plan の notifications/、P-15）を、読み込んだ待ち受け口の全モジュールに提供する。
// 公開用（会員登録・確定など）と社内用（フロントの登録・定時処理など）の両方の待ち受け口が読み込む。
// 送信の定時処理（OutboxProcessor）は、社内用の待ち受け口の JobsModule が JOB_CLASSES に載せる。
// 開発用のメールの一覧（DevMailsModule）は、開発環境の社内用の待ち受け口だけが読み込む（listeners.ts）。
import { Global, Module } from '@nestjs/common';
import { MailRenderer } from './mail-renderer.js';
import { MailSettings, processMailSettings } from './mail-settings.js';
import { MailService } from './mail.service.js';
import { DEFAULT_OUTBOX_SEND_TIMEOUT_MS, OUTBOX_SEND_TIMEOUT_MS } from './outbox.processor.js';
import { UnsubscribeTokens } from './unsubscribe-token.js';

@Global()
@Module({
  providers: [
    { provide: MailSettings, useFactory: processMailSettings },
    { provide: OUTBOX_SEND_TIMEOUT_MS, useValue: DEFAULT_OUTBOX_SEND_TIMEOUT_MS },
    MailRenderer,
    UnsubscribeTokens,
    MailService,
  ],
  exports: [MailSettings, OUTBOX_SEND_TIMEOUT_MS, MailRenderer, UnsubscribeTokens, MailService],
})
export class NotificationsModule {}
