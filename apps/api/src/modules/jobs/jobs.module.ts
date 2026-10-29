// 定時処理（design.md File Structure Plan の jobs/）。社内用の待ち受け口（StaffAppModule）だけが読み込む（ADR-03）。
//
// 業務の定時処理（hold-expiry・no-show・morning-status・pre-arrival・retention・outbox・payment-reconcile・
// pending-cleanup）は、後のタスクで ScheduledJob を実装したクラスをこのディレクトリに作り、JOB_CLASSES に加える。
// 業務のモジュールの中に処理のクラスを置いた場合（outbox は modules/notifications の OutboxProcessor）も、ここで登録する。
// 処理のクラスは業務のモジュールのサービスを注入して使い、そのモジュールを imports に加える。
// 時刻は job-schedules.ts の JOB_SCHEDULES、多重起動の防止と job_runs への記録は JobRunner（shared/jobs）が受け持つ。
import { Module, type Type } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ConsoleJobLogSink, JobLogSink } from '../../shared/jobs/job-log.js';
import { JobRunner } from '../../shared/jobs/job-runner.js';
import type { ScheduledJob } from '../../shared/jobs/scheduled-job.js';
import { OutboxProcessor } from '../notifications/outbox.processor.js';
import { JobScheduler, SCHEDULED_JOBS } from './job-scheduler.js';

/** 定時に起動する業務の処理のクラス */
const JOB_CLASSES: Type<ScheduledJob>[] = [
  // 送信待ちのメールの送信（毎分。modules/notifications。tasks.md 3.4）
  OutboxProcessor,
];

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [
    ...JOB_CLASSES,
    {
      provide: SCHEDULED_JOBS,
      useFactory: (...jobs: ScheduledJob[]): readonly ScheduledJob[] => jobs,
      inject: JOB_CLASSES,
    },
    { provide: JobLogSink, useClass: ConsoleJobLogSink },
    JobRunner,
    JobScheduler,
  ],
  exports: [JobRunner, JobScheduler],
})
export class JobsModule {}
