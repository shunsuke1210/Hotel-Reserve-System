// API の起動：公開用（GuestApp、ポート3001）と社内用（StaffApp、ポート3002）を1つのプロセスで立てる。
import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { LISTENERS, startApis } from './listeners.js';

async function main(): Promise<void> {
  const apis = await startApis();
  const logger = new Logger('Main');
  logger.log(
    `公開用 API（GuestApp）をポート ${LISTENERS.guest.port} の /${LISTENERS.guest.prefix} で起動しました`,
  );
  logger.log(
    `社内用 API（StaffApp）をポート ${LISTENERS.staff.port} の /${LISTENERS.staff.prefix} で起動しました`,
  );

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      void apis.close().finally(() => process.exit(0));
    });
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
