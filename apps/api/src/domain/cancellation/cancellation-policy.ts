// キャンセル料と宿泊税の返金のルール（CancellationPolicy。design.md Components and Interfaces、処理仕様 P-06・P-07 手順3、
// 設計の補足 DT-M21・DT-M23・DT-M25・DT-M42・DT-M44・DT-M51、brief.md PY-07〜PY-14・PY-17・PY-17a・CH-05・CH-06・CH-09・CH-11）。
//
// 取り消す明細・予約の情報・時刻から、キャンセル料（ノーショー料）・早期割で返金しない額・宿泊税の返金と付け替えを決める。
// 入力だけから結果が決まる純粋な関数で、データベースと現在時刻を使わない。金額は円の整数で計算する。
// 明細の取り消し・付け替え、カードへの返金・請求、未回収の記録は呼び出し側（6.x のサービス）が行う。
import type { PaymentMethod, Yen } from '@hotel/contracts';
import {
  addDays,
  atJapanTime,
  isWithinFreeCancellation,
  parseDate,
} from '../calendar/business-date.js';
import type { PricedLine, PriceInput } from '../pricing/types.js';
import type {
  CancellationContext,
  CancellationEvaluation,
  CancellationFee,
  CancellationFeeCategory,
  CancellationPolicy,
  GroupCancellationPercent,
  NoShowContext,
  RemovalScope,
  RemovedLines,
  RemovedLodgingTaxLine,
  RemovedStayLine,
  RemovedStayLineCategory,
} from './types.js';

/** 団体の段階：到着日の何日前の 0:00 から何%か（率の高い順。8.6、brief.md PY-08・PY-13） */
export const GROUP_CANCELLATION_STAGES: readonly {
  daysBeforeArrival: number;
  percent: Exclude<GroupCancellationPercent, 0>;
}[] = [
  { daysBeforeArrival: 1, percent: 100 },
  { daysBeforeArrival: 7, percent: 50 },
  { daysBeforeArrival: 30, percent: 20 },
];

const REMOVED_STAY_LINE_CATEGORIES: ReadonlySet<string> = new Set<RemovedStayLineCategory>([
  'ROOM',
  'UPGRADE',
  'DOWNGRADE_ADJUSTMENT',
]);

/**
 * 団体のキャンセル料の率。到着日の30日前の 0:00 より前は0%、30日前の 0:00 以降は20%、7日前の 0:00 以降は50%、
 * 前日の 0:00 以降は100%（境目のちょうどの時刻は高い率の側。例：11/30 到着なら 10/31 0:00 以降が20%）。
 */
export function groupCancellationPercent(at: Date, arrivalDate: string): GroupCancellationPercent {
  const atMs = instantMs(at);
  for (const stage of GROUP_CANCELLATION_STAGES) {
    const stageStart = atJapanTime(addDays(arrivalDate, -stage.daysBeforeArrival), 0);
    if (atMs >= stageStart.getTime()) {
      return stage.percent;
    }
  }
  return 0;
}

/**
 * キャンセル・減らす変更・早期チェックアウト・日程の変更で取り消すもとの夜のキャンセル料を決める（P-06）。
 * - 早期割を適用した明細は返金しない（NON_REFUNDABLE。その夜の宿泊税も返金しない。7.7, 8.9、DT-M25）
 * - それ以外の明細（早期割でない予約、早期割なしの料金で加えた夜・人）に、個人または団体の規定を当てる（PY-09a）
 *   - 団体：取り消した宿泊料金の合計 × 段階の率（8.6）。率が100%なら、その夜の宿泊税も返金しない
 *   - 個人：期限内（ちょうどを含む）は0円。期限後は1泊分：減らした部屋・人の組（removedUnit）ごとに、その組の
 *     減らした最初の夜の宿泊料金を足した額（8.3〜8.5、CH-09、DT-M53）。早期割の予約では、早期割なしの明細の中で
 *     最初の夜を決める（DT-M52）。宿泊料金を少しも返金しない夜の宿泊税は返金しない（一部でも返金する夜は全額返金）
 * - 客室タイプを移した夜は、UPGRADE・DOWNGRADE_ADJUSTMENT を含めた額を1泊分・団体の基準額にする（DT-M21）
 * - 取り消す宿泊料金の明細がなければ（人数を変えずに室数だけを減らす変更）0円（7.19、CH-11）
 */
export function evaluateCancellation<T extends RemovedLodgingTaxLine>(
  scope: RemovalScope<T>,
  ctx: CancellationContext,
): CancellationEvaluation<T> {
  parseDate(ctx.arrivalDate);
  instantMs(ctx.at);
  validateRemovedLines(scope, ctx.earlyBird);

  const earlyBirdLines = scope.removedRoomLines.filter((line) => line.earlyBirdApplied);
  const regularLines = scope.removedRoomLines.filter((line) => !line.earlyBirdApplied);

  const rules: CancellationFee[] = [];
  let feeAmount: Yen = 0;
  let retainsRegularTaxOn: (stayDate: string) => boolean = () => false;
  if (regularLines.length > 0 || earlyBirdLines.length === 0) {
    const regular = regularRule(regularLines, ctx);
    rules.push(regular.rule);
    feeAmount = regular.amount;
    retainsRegularTaxOn = regular.retainsTaxOn;
  }
  const nonRefundableAmount = sumAmounts(earlyBirdLines);
  if (earlyBirdLines.length > 0) {
    rules.push({ kind: 'NON_REFUNDABLE', amount: nonRefundableAmount });
  }

  return buildEvaluation({
    scope,
    paymentMethod: ctx.paymentMethod,
    feeCategory: 'CANCELLATION_FEE',
    rules,
    feeAmount,
    nonRefundableAmount,
    retainsTax: (line) => line.earlyBirdApplied || retainsRegularTaxOn(line.stayDate),
  });
}

/**
 * ノーショー料を決める（P-07 手順3）。scope には全泊の明細を渡す（1泊目の宿泊料金もノーショー料に置き換わる）。
 * - 個人：1泊目の宿泊料金の合計（早期割の夜でも1泊目はノーショー料。DT-M45）がノーショー料。
 *   2泊目以降は返金するが、早期割を適用した明細は返金しない（8.9, 8.16）。前の変更で確定したキャンセル料は scope に入れない（DT-M42）
 * - 団体：全泊の宿泊料金の100%がノーショー料で、2泊目以降も返金しない（8.25、DT-M23）
 * - 1泊目（団体は全泊）と早期割の明細の宿泊税は返金せず、NO_SHOW_FEE に付け替える（8.19, 20.7）
 * - 客室タイプを移した夜は差額を含めた額で計算する（DT-M21・DT-M51）
 */
export function evaluateNoShow<T extends RemovedLodgingTaxLine>(
  scope: RemovedLines<T>,
  ctx: NoShowContext,
): CancellationEvaluation<T> {
  validateRemovedLines(scope, ctx.earlyBird);
  const stayLines = scope.removedRoomLines;
  if (stayLines.length === 0) {
    throw new RangeError('ノーショーの宿泊料金の明細を1つ以上指定してください');
  }

  if (ctx.isGroup) {
    const amount = sumAmounts(stayLines);
    return buildEvaluation({
      scope,
      paymentMethod: ctx.paymentMethod,
      feeCategory: 'NO_SHOW_FEE',
      rules: [{ kind: 'GROUP_PERCENT', percent: 100, amount }],
      feeAmount: amount,
      nonRefundableAmount: 0,
      retainsTax: () => true,
    });
  }

  const firstNight = earliestStayDate(stayLines);
  const feeAmount = sumAmounts(stayLines.filter((line) => line.stayDate === firstNight));
  const nonRefundableLines = stayLines.filter(
    (line) => line.earlyBirdApplied && line.stayDate !== firstNight,
  );
  const nonRefundableAmount = sumAmounts(nonRefundableLines);
  const rules: CancellationFee[] = [{ kind: 'FIRST_REMOVED_NIGHT', amount: feeAmount }];
  if (nonRefundableLines.length > 0) {
    rules.push({ kind: 'NON_REFUNDABLE', amount: nonRefundableAmount });
  }
  return buildEvaluation({
    scope,
    paymentMethod: ctx.paymentMethod,
    feeCategory: 'NO_SHOW_FEE',
    rules,
    feeAmount,
    nonRefundableAmount,
    retainsTax: (line) => line.stayDate === firstNight || line.earlyBirdApplied,
  });
}

/** design.md の CancellationPolicy のインターフェース */
export const cancellationPolicy: CancellationPolicy = {
  evaluate: evaluateCancellation,
  evaluateNoShow,
};

/** removedLinesFromPriced が作る宿泊税の明細（もとの PricedLine を持つ） */
export type PricedRemovedLodgingTaxLine = RemovedLodgingTaxLine & { priced: PricedLine };

/**
 * PriceCalculator の明細（取り消す分）から、取り消す宿泊料金（ROOM）と宿泊税の明細を作る。
 * 朝食・時間外はキャンセル料に含めないので除く（8.5。朝食は早期割の予約でも返金する：DT-M25）。
 * 早期割をかけたかは、その明細を計算した料金の入力で決める：もとからの人は夜の控えの earlyBirdEligible、
 * 後から加えた人は AddedGuest.earlyBirdEligible（7.7, 7.8）。人を減らす変更では、減らした人数に分けた明細を渡す。
 * removedUnit を指定すると、宿泊料金の明細をその組にする（人数と泊数などを同時に減らすとき。DT-M53）。
 */
export function removedLinesFromPriced(
  lines: readonly PricedLine[],
  priceInput: Pick<PriceInput, 'nights' | 'addedLater'>,
  removedUnit?: string,
): RemovedLines<PricedRemovedLodgingTaxLine> {
  const eligibleByNight = new Map(
    priceInput.nights.map((night) => [night.stayDate, night.earlyBirdEligible]),
  );
  const earlyBirdAppliedTo = (line: PricedLine, stayDate: string): boolean => {
    if (line.addedLaterIndex !== undefined) {
      const added = priceInput.addedLater?.[line.addedLaterIndex];
      if (added?.kind !== 'GUEST' || added.stayDate !== stayDate) {
        throw new RangeError(
          `明細の後から加えた人（${line.addedLaterIndex}）が、料金の入力にありません（${stayDate}）`,
        );
      }
      return added.earlyBirdEligible;
    }
    const eligible = eligibleByNight.get(stayDate);
    if (eligible === undefined) {
      throw new RangeError(`明細の夜が、料金の入力の夜の控えにありません: ${stayDate}`);
    }
    return eligible;
  };

  const removedRoomLines: RemovedStayLine[] = [];
  const removedLodgingTaxLines: PricedRemovedLodgingTaxLine[] = [];
  for (const line of lines) {
    if (line.category !== 'ROOM' && line.category !== 'LODGING_TAX') {
      continue;
    }
    const stayDate = line.stayDate;
    if (stayDate === undefined) {
      throw new RangeError(`${line.category} の明細に宿泊日がありません`);
    }
    const earlyBirdApplied = earlyBirdAppliedTo(line, stayDate);
    if (line.category === 'ROOM') {
      removedRoomLines.push({
        category: 'ROOM',
        stayDate,
        amountInclTax: line.amountInclTax,
        earlyBirdApplied,
        ...(removedUnit === undefined ? {} : { removedUnit }),
      });
    } else {
      removedLodgingTaxLines.push({
        category: 'LODGING_TAX',
        stayDate,
        amountInclTax: line.amountInclTax,
        earlyBirdApplied,
        priced: line,
      });
    }
  }
  return { removedRoomLines, removedLodgingTaxLines };
}

/** 早期割を適用していない明細に当てる個人・団体の規定と、その夜の宿泊税を返金しないか */
function regularRule(
  lines: readonly RemovedStayLine[],
  ctx: CancellationContext,
): { rule: CancellationFee; amount: Yen; retainsTaxOn: (stayDate: string) => boolean } {
  const free = { rule: { kind: 'FREE' }, amount: 0, retainsTaxOn: () => false } as const;
  if (lines.length === 0) {
    return free;
  }
  if (ctx.isGroup) {
    const percent = groupCancellationPercent(ctx.at, ctx.arrivalDate);
    if (percent === 0) {
      return free;
    }
    const amount = percentOf(sumAmounts(lines), percent);
    // 20%・50% は宿泊料金の一部が返金されるので、宿泊税は全額返金する（8.19、PY-17）
    return {
      rule: { kind: 'GROUP_PERCENT', percent, amount },
      amount,
      retainsTaxOn: () => percent === 100,
    };
  }
  if (isWithinFreeCancellation(ctx.at, ctx.arrivalDate)) {
    return free;
  }
  const feeLines = new Set(firstRemovedNightLines(lines));
  const amount = sumAmounts([...feeLines]);
  // 夜ごとの返金する額（1泊分に入らない明細の合計）。1泊分の明細がある夜で、返金する額がなければ宿泊税も返金しない（8.19）
  const feeNights = new Set([...feeLines].map((line) => line.stayDate));
  const releasedByNight = new Map<string, Yen>();
  for (const line of lines) {
    if (!feeLines.has(line)) {
      releasedByNight.set(
        line.stayDate,
        (releasedByNight.get(line.stayDate) ?? 0) + line.amountInclTax,
      );
    }
  }
  return {
    rule: { kind: 'FIRST_REMOVED_NIGHT', amount },
    amount,
    retainsTaxOn: (stayDate) =>
      feeNights.has(stayDate) && (releasedByNight.get(stayDate) ?? 0) <= 0,
  };
}

/**
 * 1泊分の明細：減らした部屋・人の組（removedUnit。省略はまとめて1つの組）ごとに、その組の最も早い夜の明細（DT-M53）。
 * 組が1つなら、取り消した最初の夜の明細（予約全体のキャンセルなら全室・全員の1泊目。8.5）。
 */
function firstRemovedNightLines(lines: readonly RemovedStayLine[]): RemovedStayLine[] {
  const firstNightByUnit = new Map<string | undefined, string>();
  for (const line of lines) {
    const current = firstNightByUnit.get(line.removedUnit);
    if (current === undefined || line.stayDate < current) {
      firstNightByUnit.set(line.removedUnit, line.stayDate);
    }
  }
  return lines.filter((line) => line.stayDate === firstNightByUnit.get(line.removedUnit));
}

/**
 * 宿泊税を返金しない（付け替える）明細と、返金する明細に分けて結果を作る。
 * 現地払いの予約は宿泊税を前払いしていないので、取り消した夜の宿泊税はすべて請求しない（付け替えない。P-06）。
 */
function buildEvaluation<T extends RemovedLodgingTaxLine>(params: {
  scope: RemovedLines<T>;
  paymentMethod: PaymentMethod;
  feeCategory: CancellationFeeCategory;
  rules: CancellationFee[];
  feeAmount: Yen;
  nonRefundableAmount: Yen;
  retainsTax: (line: T) => boolean;
}): CancellationEvaluation<T> {
  const retainedLodgingTaxLines: T[] = [];
  const releasedLodgingTaxLines: T[] = [];
  for (const line of params.scope.removedLodgingTaxLines) {
    if (params.paymentMethod === 'PREPAID' && params.retainsTax(line)) {
      retainedLodgingTaxLines.push(line);
    } else {
      releasedLodgingTaxLines.push(line);
    }
  }
  return {
    feeCategory: params.feeCategory,
    rules: params.rules,
    feeAmount: params.feeAmount,
    nonRefundableAmount: params.nonRefundableAmount,
    releasedStayAmount:
      sumAmounts(params.scope.removedRoomLines) - params.feeAmount - params.nonRefundableAmount,
    retainedLodgingTaxLines,
    retainedLodgingTaxAmount: sumAmounts(retainedLodgingTaxLines),
    releasedLodgingTaxLines,
    releasedLodgingTaxAmount: sumAmounts(releasedLodgingTaxLines),
  };
}

/**
 * 明細を検証する。宿泊日の形、額が整数で符号が区分に合うこと（DOWNGRADE_ADJUSTMENT は0以下、ROOM・UPGRADE は0以上）、
 * 夜・早期割の有無ごとの宿泊料金の合計が0以上であること、早期割でない予約に早期割の明細がないこと、
 * 宿泊税の明細の夜（と早期割の有無）に取り消す宿泊料金の明細があること。
 */
function validateRemovedLines(scope: RemovedLines, reservationIsEarlyBird: boolean): void {
  const stayTotals = new Map<string, number>();
  for (const line of scope.removedRoomLines) {
    if (!REMOVED_STAY_LINE_CATEGORIES.has(line.category)) {
      throw new RangeError(`宿泊料金の明細の区分ではありません: ${line.category}`);
    }
    validateLineCommon(line, reservationIsEarlyBird);
    const isDowngrade = line.category === 'DOWNGRADE_ADJUSTMENT';
    if (isDowngrade ? line.amountInclTax > 0 : line.amountInclTax < 0) {
      throw new RangeError(
        `${line.category} の額は${isDowngrade ? '0以下' : '0以上'}で指定してください: ${line.amountInclTax}`,
      );
    }
    const key = bucketKey(line);
    stayTotals.set(key, (stayTotals.get(key) ?? 0) + line.amountInclTax);
  }
  for (const [key, total] of stayTotals) {
    if (total < 0) {
      throw new RangeError(`夜の宿泊料金の合計が負になっています（${key}）: ${total}`);
    }
  }
  for (const line of scope.removedLodgingTaxLines) {
    if (line.category !== 'LODGING_TAX') {
      throw new RangeError(`宿泊税の明細の区分ではありません: ${String(line.category)}`);
    }
    validateLineCommon(line, reservationIsEarlyBird);
    if (!stayTotals.has(bucketKey(line))) {
      throw new RangeError(
        `宿泊税の明細の夜に、取り消す宿泊料金の明細がありません（${bucketKey(line)}）`,
      );
    }
  }
}

function validateLineCommon(
  line: { stayDate: string; amountInclTax: Yen; earlyBirdApplied: boolean },
  reservationIsEarlyBird: boolean,
): void {
  parseDate(line.stayDate);
  if (!Number.isSafeInteger(line.amountInclTax)) {
    throw new RangeError(`明細の額は整数で指定してください: ${line.amountInclTax}`);
  }
  if (line.earlyBirdApplied && !reservationIsEarlyBird) {
    throw new RangeError(`早期割でない予約に、早期割をかけた明細があります: ${line.stayDate}`);
  }
}

/** 夜と早期割の有無の組（宿泊税の明細を、同じ組の宿泊料金の明細に対応させる） */
function bucketKey(line: { stayDate: string; earlyBirdApplied: boolean }): string {
  return `${line.stayDate}:${line.earlyBirdApplied ? '早期割' : '早期割なし'}`;
}

/** 最も早い宿泊日（YYYY-MM-DD は文字列の順が日付の順） */
function earliestStayDate(lines: readonly { stayDate: string }[]): string {
  let earliest: string | undefined;
  for (const line of lines) {
    if (earliest === undefined || line.stayDate < earliest) {
      earliest = line.stayDate;
    }
  }
  if (earliest === undefined) {
    throw new RangeError('明細が1つもありません');
  }
  return earliest;
}

function sumAmounts(lines: readonly { amountInclTax: Yen }[]): Yen {
  return lines.reduce((total, line) => total + line.amountInclTax, 0);
}

/** 額 × 率（%）。1円未満は切り捨てる（宿泊料金は100円単位なので、20%・50%・100% では端数は出ない） */
function percentOf(amount: Yen, percent: number): Yen {
  const scaled = amount * percent;
  if (!Number.isSafeInteger(scaled) || scaled < 0) {
    throw new RangeError(`団体のキャンセル料の基準額が範囲外です: ${amount}`);
  }
  return (scaled - (scaled % 100)) / 100;
}

function instantMs(instant: Date): number {
  const ms = instant.getTime();
  if (Number.isNaN(ms)) {
    throw new RangeError('時刻として無効な Date です');
  }
  return ms;
}
