// メールの設定（リンクの基点の URL と、配信停止のリンクの署名の鍵。tasks.md 3.4）。
// 設定は loadMailLinkConfig（shared/config）でプロセスに1回だけ読み、2つの待ち受け口で同じものを使う
// （公開用で作ったメールの配信停止のリンクを、どちらの待ち受け口でも確かめられるように）。
// テストでは overrideProvider(MailSettings) で差し替える（src/test/listener-app.ts は既定で TEST_MAIL_SETTINGS にする）。
import { randomBytes } from 'node:crypto';
import { loadMailLinkConfig } from '../../shared/config/app-config.js';

export interface MailSettingsValues {
  /** 宿泊客アプリの URL（末尾の「/」なし） */
  guestWebBaseUrl: string;
  /** 配信停止のリンクの署名の鍵 */
  unsubscribeTokenSecret: string;
}

/** メールの設定（DI のトークンを兼ねる） */
export class MailSettings implements MailSettingsValues {
  readonly guestWebBaseUrl: string;
  readonly unsubscribeTokenSecret: string;

  constructor(values: MailSettingsValues) {
    this.guestWebBaseUrl = values.guestWebBaseUrl.replace(/\/+$/, '');
    this.unsubscribeTokenSecret = values.unsubscribeTokenSecret;
  }
}

let processSettings: MailSettings | undefined;

/**
 * プロセスで1つのメールの設定。最初に呼ばれたときに設定を読む（誤りは ConfigError で起動を止める）。
 * development・test で署名の鍵を省略したときは、プロセスごとの乱数を鍵にする（再起動の前のリンクは無効になる）。
 * production では鍵が必須（loadMailLinkConfig が確かめる）。
 */
export function processMailSettings(): MailSettings {
  if (processSettings === undefined) {
    const config = loadMailLinkConfig();
    processSettings = new MailSettings({
      guestWebBaseUrl: config.guestWebBaseUrl,
      unsubscribeTokenSecret:
        config.unsubscribeTokenSecret ?? randomBytes(32).toString('base64url'),
    });
  }
  return processSettings;
}
