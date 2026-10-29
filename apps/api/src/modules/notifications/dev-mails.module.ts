// 開発用のメールの一覧（GET /dev/mails）。社内用の待ち受け口に、開発環境（development・test）でだけ読み込む
// （listeners.ts の listenerRootModule。production では読み込まない：TC-MB-207）。
// PrismaService と MailRenderer は、全体に提供されているもの（PrismaModule・NotificationsModule）を使う。
import { Module } from '@nestjs/common';
import { DevMailsController } from './dev-mails.controller.js';

@Module({ controllers: [DevMailsController] })
export class DevMailsModule {}
