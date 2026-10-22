# 要件と設計の対応表：hotel-reservation-system

requirements.md の受け入れ基準（238件）が、設計のどこで実現されているかを示す。各行の「テスト」は design.md の Testing Strategy のテストの区分を指す。

## 確認のしかた

- **網羅の確認**：ID の列に、要件 1.1〜22.2 のすべてが1行ずつある（下の「集計」を参照）
- **設計への反映の確認**：各行の「画面」は [design-screens.md](design-screens.md)、「API・処理」と「コンポーネント」と「テーブル」は [design.md](design.md) で、該当する箇所を探せる（P-xx は design.md の「処理仕様と業務ルール」の番号）
- **実装後の確認**：「テスト」の区分のテストが、その受け入れ基準を検証する。実装の段階では、テストの名前に受け入れ基準の ID（例：`[6.19]`）を入れ、テストの結果からこの表を照合できるようにする
- **要件が変わったとき**：該当する行を直し、design.md の Revalidation Triggers に当たるかを確認する

## 集計

| 要件 | 件数 | MVP | 後のフェーズ |
|---|---|---|---|
| 1〜19 | 221 | 221 | — |
| 20〜22 | 17 | 2（20.7・21.7 の仕組み） | 15（テーブルだけ MVP で用意） |
| 合計 | 238 | 223 | 15 |

## 対応表

### 要件1 会員登録と会員情報
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 1.1 | 登録の必須項目（カードを含む） | G04 | POST /auth/register | MemberService, PaymentGateway | members, member_cards | IT-MEM, E2E-G1 |
| 1.2 | 外国人の国籍・旅券番号 | G04 | 同上 | MemberService | members | IT-MEM |
| 1.3 | メール・電話の重複は不可（有効な会員の間） | G04, G18 | 同上（EMAIL/PHONE_ALREADY_REGISTERED） | MemberService | members（部分一意インデックス） | IT-MEM, IT-RET |
| 1.4 | 確認メール、確認まで利用不可 | G05, G06 | POST /auth/register, /auth/verify-email | MemberAuthService, MailService | auth_tokens, mail_outbox | IT-AUTH, E2E-G1 |
| 1.5 | 配信の同意の選択、初期は「同意しない」 | G04 | POST /auth/register | MemberService | marketing_consents | IT-MEM |
| 1.6 | 同意の日時と方法を記録 | G04, G18 | PUT /me/marketing-consent | MemberService | marketing_consents | IT-MEM |
| 1.7 | 同意の取り消し | G18, G20 | PUT /me/marketing-consent, POST /marketing/unsubscribe | MemberService | marketing_consents | IT-MEM |
| 1.8 | 会員情報の確認・変更、カードは差し替えだけ | G18 | GET・PATCH /me, PUT /me/card | MemberService | members, member_cards | IT-MEM |
| 1.9 | パスワード再設定のメール | G07, G08 | /auth/password-reset/* | MemberAuthService, MailService | auth_tokens, mail_outbox | IT-AUTH |
| 1.10 | 他人の会員情報・予約を表示しない | G13, G14 | 会員 ID で絞り込み（NOT_FOUND） | ReservationService | reservations | IT-SEC |
| 1.11 | 退会でログイン不可、カード等を削除 | G19 | POST /me/withdraw | MemberService, PaymentGateway | members, member_cards, sessions, marketing_consents | IT-MEM |
| 1.12 | メールアドレスの変更は確認の後に反映 | G18 | PATCH /me（DT-M4） | MemberService, MailService | members, auth_tokens | IT-MEM |
| 1.13 | 今後の予約・未回収がある会員は退会できない | G19 | POST /me/withdraw（HAS_ACTIVE_RESERVATION, HAS_UNPAID_BALANCE） | MemberService, WarningService | reservations, payments | IT-MEM |

### 要件2 スタッフのログインと権限
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 2.1 | スタッフ番号とパスワードで役割を判別 | F01, C01 | POST /api/staff/auth/login | StaffAuthService | staff, sessions | IT-AUTH |
| 2.2 | 役割ごとに使える画面 | F01, C01 | RolesGuard | StaffAuthService | staff | IT-AUTH, E2E-C1 |
| 2.3 | 清掃員には限られた項目だけを表示 | C02 | GET /rooms/status-board（P-12） | RoomStatusService | rooms, reservation_rooms | IT-SEC, E2E-C1 |
| 2.4 | 権限のない操作を拒否 | スタッフ向けの全画面 | RolesGuard（FORBIDDEN） | RolesGuard | — | IT-AUTH |
| 2.5 | 返金・免除・手動変更は管理者だけ | A06（後のフェーズ） | RolesGuard | RolesGuard | — | IT-AUTH |

### 要件3 空室検索
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 3.1 | ログインなしで検索 | G01, G02 | GET /availability | AvailabilityService | — | E2E-G1 |
| 3.2 | 全日程同じ部屋が空いているタイプだけ空室あり | G02 | P-02 手順3〜4 | AvailabilityService | room_nights, out_of_order_periods | IT-INV |
| 3.3 | 1室は定員 ≧ 大人 | G02 | P-02 手順2 | AvailabilityService | room_types | IT-INV |
| 3.4 | 定員の判定は大人だけ | G02 | P-02 手順2 | AvailabilityService | — | IT-INV |
| 3.5 | 365日より先は不可 | G01 | P-02 手順1（OUT_OF_BOOKING_WINDOW） | BusinessCalendar | — | UT-BC |
| 3.6 | 当日の25:00以降は不可 | G01 | P-02 手順1（SAME_DAY_CUTOFF_PASSED） | BusinessCalendar | — | UT-BC |
| 3.7 | 税込み料金と別枠の宿泊税 | G02 | P-01 | PriceCalculator | rate_versions | UT-PR, E2E-G1 |

### 要件4 Web 予約の作成と確定
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 4.1 | 未ログインはログインを求める | G02→G03 | MemberAuthGuard | MemberAuthService | — | E2E-G1 |
| 4.2 | 同じタイプの複数室、混在は不可 | G09 | POST /reservations/quote（MIXED_ROOM_TYPES_NOT_ALLOWED） | ReservationService | reservations, reservation_rooms | IT-RSV |
| 4.3 | 人数は予約全体・区分ごと | G09 | BookingRequest.counts | ReservationService | reservations | IT-RSV |
| 4.4 | 大人 ＞ 定員の合計は不可 | G09 | CAPACITY_EXCEEDED | ReservationService | room_types | IT-RSV |
| 4.5 | 室数 ＞ 大人は不可 | G09 | ROOMS_EXCEED_ADULTS | ReservationService | — | IT-RSV |
| 4.6 | 泊数・室数の上限なし | G01, G09 | 上限の検証を設けない | ReservationService | — | IT-RSV |
| 4.7 | 会員情報の自動入力 | G09 | GET /me | MemberService | members | E2E-G1 |
| 4.8 | 同行者・到着予定時刻・宿泊者の入力 | G09, G17 | BookingRequest, P-14 | RosterService | roster_entries, reservations | IT-ROS |
| 4.9 | 「現地で入力」 | G09 | companions = 'ENTER_ON_SITE' | RosterService | reservations.companions_on_site | IT-ROS |
| 4.10 | 朝食（区分ごとの人数・全泊）、時間外（部屋ごと） | G09 | BookingRequest.breakfastCounts・offHours | PriceCalculator | reservations（breakfast_*）, reservation_rooms | UT-PR, IT-RSV |
| 4.11 | 支払い方法の選択 | G09 | paymentMethod | ReservationService | reservations | IT-RSV |
| 4.12 | 早期割で現地払いは不可 | G09 | EARLY_BIRD_REQUIRES_PREPAID | ReservationService | — | IT-RSV |
| 4.13 | 現地払いは登録カードを保証に | G09, G11 | P-04 手順3 | ReservationService | member_cards | IT-RSV |
| 4.14 | 最終確認の画面で約款を表示 | G10 | GET /terms/current | ContentService | terms_documents, translations | E2E-G1 |
| 4.15 | 同意がなければ確定しない | G10 | POST /reservations/holds（TERMS_NOT_AGREED） | ReservationService | reservations.terms_agreed_at | IT-RSV |
| 4.16 | 支払いへ進むと15分確保 | G10→G11 | POST /reservations/holds, P-03 | RoomAllocationService | room_nights（HOLD）, reservations.hold_expires_at | IT-INV |
| 4.17 | 15分で確保を解除、時間切れのメール | G11 | 定時処理 hold-expiry | RoomAllocationService, MailService | room_nights, mail_outbox | IT-INV |
| 4.18 | 決済待ちは1会員1件 | G10 | HOLD_ALREADY_EXISTS | RoomAllocationService | reservations（部分一意インデックス） | IT-INV |
| 4.19 | 事前決済は全額を決済（時間外を除く） | G11 | POST /reservations/{id}/confirm, P-04 | PaymentService, PaymentGateway | payments, charge_lines | IT-RSV |
| 4.20 | 現地払いの確定 | G11 | 同上 | ReservationService | reservations | IT-RSV |
| 4.21 | 決済の失敗は確定しない | G11 | PAYMENT_DECLINED | PaymentService | payments（FAILED） | IT-RSV |
| 4.22 | 予約番号と予約完了のメール | G12 | P-04 手順4 | ReservationService, MailService | reservations, mail_outbox | IT-MAIL, E2E-G1 |
| 4.23 | 事前決済はメールを2通 | G12 | P-04 手順4, P-15 | MailService | mail_outbox | IT-MAIL |
| 4.24 | 確保の後に料金・条件が変われば確定せず確認を求める | G11 | P-04 手順1a（PRICE_CHANGED） | ReservationService, PriceCalculator | stay_night_prices | IT-RSV |
| 4.25 | 締め切り後の当日予約は確定しない | G11 | P-04 手順1a（SAME_DAY_CUTOFF_PASSED） | ReservationService, BusinessCalendar | — | IT-RSV |

### 要件5 フロントによる予約登録
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 5.1 | 会員を検索して予約者に指定 | F04, F05 | GET /members, POST /api/staff/reservations | ReservationService | members | IT-FRT |
| 5.2 | 会員でなければ登録不可 | F04 | MEMBER_REQUIRED | ReservationService | — | IT-FRT |
| 5.3 | 来館客は会員登録の後に登録 | G04（客の端末）, F05 | ADR-11 | MemberService | members | IT-FRT |
| 5.4 | Web と同じ条件を適用 | F04 | ReservationService の同じ処理 | ReservationService | — | IT-FRT |
| 5.5 | 事前決済は登録カードで決済 | F04 | P-04 | PaymentService | payments | IT-FRT |
| 5.6 | フロントが時間外を追加・変更（日付で制限しない） | F06 | PUT /reservation-rooms/{id}/off-hours（L-46） | FrontDeskService | reservation_rooms, charge_lines | IT-FRT |

### 要件6 料金の計算
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 6.1 | 1人1泊単価、タイプごとの基本料金 | G02, G10 | P-01 | PriceCalculator | room_type_prices | UT-PR |
| 6.2 | 子どもは半額、幼児は0円 | G10 | P-01 手順2 | PriceCalculator | — | UT-PR |
| 6.3 | 会員本人は生年月日で区分 | G09 | P-14 | RosterService, PriceCalculator | members.birth_date | UT-PR, IT-ROS |
| 6.4 | 割増・割引の率を合算 | — | P-01 手順1 | PriceCalculator | stay_night_prices | UT-PR |
| 6.5 | 下限 −50% | — | P-01 手順1 | PriceCalculator | rate_versions | UT-PR |
| 6.6 | 金・土・祝前日 +20% | — | P-01 手順1 | BusinessCalendar | holidays, rate_versions | UT-BC, UT-PR |
| 6.7 | 特定期間割増 | — | P-01 手順1 | BusinessCalendar, SpecialPeriodService | special_surcharge_periods | UT-PR, IT-SUR |
| 6.8 | 重なる割増は高いほうを1つ | — | P-01 手順1 | BusinessCalendar | — | UT-BC |
| 6.9 | 人数割の段階 | — | P-01 手順1 | PriceCalculator | rate_versions | UT-PR |
| 6.10 | 判定人数 | — | PriceCalculator.judgedHeadcount | PriceCalculator | room_types.standard_occupancy | UT-PR |
| 6.11 | 連泊割の段階 | — | P-01 手順1 | PriceCalculator | rate_versions | UT-PR |
| 6.12 | 早期割（暦の3か月前、月末） | G09 | BusinessCalendar.earlyBirdDeadline | BusinessCalendar | stay_night_prices.early_bird_eligible | UT-BC |
| 6.13 | 税込み単価の100円未満を切り捨て | — | P-01 手順3 | PriceCalculator | — | UT-PR |
| 6.14 | 朝食の料金 | — | P-01 手順5 | PriceCalculator | rate_versions | UT-PR |
| 6.15 | 時間外は1室1時間1,000円 | — | P-01 手順6 | PriceCalculator | rate_versions | UT-PR |
| 6.16 | 宿泊税 | G02, G10 | P-01 手順7 | PriceCalculator | rate_versions.lodging_tax_brackets | UT-PR |
| 6.17 | 日本円の税込み額で表示 | G02, G10, G14 | — | — | — | E2E-G1 |
| 6.18 | 確定時の料金を固定 | — | ADR-07 | LedgerService | stay_night_prices, charge_lines | IT-CHG |
| 6.19 | 計算例（61,900円・宿泊税600円） | — | P-01 手順8 | PriceCalculator | — | UT-PR |

### 要件7 予約の変更
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 7.1 | 予約の一覧と詳細 | G13, G14 | GET /reservations, /reservations/{id} | ReservationService | reservations, charge_lines, payments | E2E-G2 |
| 7.2 | Web で日程・人数・室数・オプションを変更 | G15 | POST /reservations/{id}/changes | ReservationChangeEngine | — | E2E-G2 |
| 7.3 | フロントも同じルールで変更 | F07 | /api/staff/reservations/{id}/changes | ReservationChangeEngine | — | IT-CHG |
| 7.4 | もとの部分は予約時、追加は変更時の料金 | G15, F07 | P-05 手順3 | ReservationChangeEngine | stay_night_prices | IT-CHG |
| 7.5 | 人数割・連泊割を最終の値で全体に | G15 | P-05 手順4 | PriceCalculator | stay_night_prices | IT-CHG |
| 7.6 | 減らした分は部分キャンセル | G15 | P-05 手順5, P-06 | CancellationPolicy | charge_lines | UT-CN, IT-CHG |
| 7.7 | 早期割を適用した夜は減らしても返金しない（通常料金の夜は通常の規定） | G15 | P-06 | CancellationPolicy | stay_night_prices.early_bird_eligible | UT-CN |
| 7.8 | 早期割の予約の追加分 | G15 | P-05 手順3（ADR-15） | BusinessCalendar | stay_night_prices | UT-BC, IT-CHG |
| 7.9 | 早期割の予約の日程変更 | G15 | P-05 手順3 | ReservationChangeEngine | stay_night_prices | IT-CHG |
| 7.10 | 延ばした夜に同じ部屋がなければ不可 | G15 | EXTENSION_ROOM_UNAVAILABLE | RoomAllocationService | room_nights | IT-CHG |
| 7.11 | 定員の条件を満たさなければ不可 | G15 | P-05 手順1 | ReservationChangeEngine | — | IT-CHG |
| 7.12 | 事前決済の増額はその場で決済 | G15 | P-05 手順6 | PaymentService | payments | IT-CHG |
| 7.13 | 追加の決済が失敗したら確定しない | G15 | PAYMENT_DECLINED | PaymentService | — | IT-CHG |
| 7.14 | 事前決済の減額はその場で返金 | G15 | P-05 手順6 | PaymentService | payments | IT-CHG |
| 7.15 | 現地払いは精算額に反映 | G15, F09 | P-05 手順6 | LedgerService | charge_lines | IT-CHG |
| 7.16 | 変更完了のメール | — | P-15 | MailService | mail_outbox | IT-MAIL |
| 7.17 | 到着日の前に夜を足す変更は夜の追加として扱う | G15 | P-05 手順3 | ReservationChangeEngine, BusinessCalendar | stay_night_prices | IT-CHG |
| 7.18 | 早期割でない日程変更は取消＋追加（もとの夜にキャンセル規定、新しい夜は割り当て直し。今の部屋が空いていればそのまま。到着日の前に夜を足すだけの変更を除く） | G15, F07 | P-05 手順3a（NO_AVAILABILITY）, P-06 | ReservationChangeEngine, RoomAllocationService | room_nights, charge_lines | IT-CHG |
| 7.19 | 室数だけを減らすとキャンセル料0円、人数割が変われば再計算 | G15, F07 | P-06 | CancellationPolicy, PriceCalculator | charge_lines | UT-CN, IT-CHG |
| 7.20 | マイページに決済待ちを表示し、期限切れは出さない | G13 | GET /reservations（DT-M9） | ReservationService | reservations | E2E-G2 |
| 7.21 | 早期割でない予約で到着日の前に夜を足す変更は延長（今の部屋、キャンセル料なし） | G15, F07 | P-05 手順2（EXTENSION_ROOM_UNAVAILABLE） | ReservationChangeEngine, RoomAllocationService | room_nights | IT-CHG |
| 7.22 | 会員は決済待ち・滞在中などの予約を Web で変更できない | G14, G15 | P-05 手順1（NOT_MODIFIABLE） | ReservationChangeEngine | reservations | IT-CHG, IT-SEC |

### 要件8 キャンセルとノーショー
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 8.1 | 会員とフロントがキャンセル | G16, F06 | POST /reservations/{id}/cancel | ReservationChangeEngine | reservations | E2E-G2 |
| 8.2 | 確定前にキャンセル料と返金額を表示 | G16 | POST /reservations/{id}/cancel/quote | CancellationPolicy | — | E2E-G2 |
| 8.3 | 個人：48時間前まで無料 | G16 | P-06 | CancellationPolicy, BusinessCalendar | — | UT-CN |
| 8.4 | 個人：過ぎたら1泊分 | G16 | P-06 | CancellationPolicy | — | UT-CN |
| 8.5 | 「1泊分」の定義（タイプを移した夜は移した後の料金） | — | P-06 | CancellationPolicy | charge_lines（ROOM, UPGRADE, DOWNGRADE_ADJUSTMENT） | UT-CN, IT-MOV |
| 8.6 | 団体の段階（タイプを移した夜は移した後の料金） | — | P-06 | CancellationPolicy | charge_lines | UT-CN |
| 8.7 | 団体は最大室数で判定、戻さない | — | P-08 | GroupEvaluator | reservations.is_group, max_room_count | UT-GR |
| 8.8 | 同じ会員の夜ごとの合算（対象は確定済み・滞在中・完了・ノーショー） | — | P-08 | GroupEvaluator | reservations | UT-GR, IT-CHG |
| 8.9 | 早期割を適用した夜はどの場合も返金しない（宿泊料金と宿泊税だけ。朝食は返金） | — | P-06, P-07 | CancellationPolicy | stay_night_prices.early_bird_eligible | UT-CN, IT-NS |
| 8.10 | 早期チェックアウトも同じルール | F07, F12 | P-06 | CancellationPolicy | — | UT-CN |
| 8.11 | 事前決済は差し引いて返金 | G16 | P-06 | PaymentService | payments（REFUND） | IT-CHG |
| 8.12 | 現地払い：チェックイン前はカードに請求、チェックイン後は現地精算 | G16, F07 | P-06 | PaymentService, LedgerService | payments（FEE_CHARGE）, charge_lines（ONSITE） | IT-CHG |
| 8.13 | キャンセル完了のメール | — | P-15 | MailService | mail_outbox | IT-MAIL |
| 8.14 | 25:00 にノーショーを判定 | — | 定時処理 no-show, P-07 | NoShowService | reservations | IT-NS |
| 8.15 | フロントが判定を延ばせる | F06 | POST /reservations/{id}/no-show/defer | NoShowService | reservations.no_show_deferred_until | IT-NS |
| 8.16 | 1泊分を請求し、2泊目以降を取消・返金（早期割・団体を除く） | — | P-07 手順2〜3 | NoShowService, PaymentService | room_nights, charge_lines, payments | IT-NS |
| 8.17 | ノーショーを取り消してチェックイン | F06, F11 | POST /reservations/{id}/no-show/revert | NoShowService | charge_lines | IT-NS |
| 8.18 | 2泊目以降の復元 | F06 | P-07 手順4 | NoShowService, RoomAllocationService | room_nights | IT-NS |
| 8.19 | 返金される夜の宿泊税は返金、返金されない夜は返金しない | G16, F06 | P-06「宿泊税の返金」, P-07 手順3 | CancellationPolicy, PaymentService | charge_lines（LODGING_TAX）, payments | UT-CN, IT-NS |
| 8.20 | ノーショーの取り消しで短くなったら連泊割を計算し直す | F06 | P-07 手順4 | NoShowService, PriceCalculator | charge_lines | IT-NS |
| 8.21 | 複数室のノーショーの取り消しは予約全体でそろえる | F06 | P-07 手順4 | NoShowService, RoomAllocationService | room_nights | IT-NS |
| 8.22 | カードへの請求が断られても処理（キャンセル・ノーショー・現地払いの変更）は確定し、未回収を記録 | — | P-06「請求が断られた場合」, P-05 手順6 | PaymentService | payments（FEE_CHARGE・FAILED） | IT-CHG, IT-NS |
| 8.23 | 未回収を一覧に表示し、支払いのお願いのメールを送る | F02 | GET /warnings, P-15 PAYMENT_REQUEST | WarningService, MailService | mail_outbox, hotel_settings | IT-BIL, IT-MAIL |
| 8.24 | 振込の入金で未回収を減らす | F09 | POST /reservations/{id}/payments（BANK_TRANSFER） | PaymentService | payments | IT-BIL |
| 8.25 | 団体のノーショーは全泊の100%、返金しない | — | P-07 手順3 | NoShowService, CancellationPolicy | charge_lines（NO_SHOW_FEE, LODGING_TAX） | UT-CN, IT-NS |
| 8.26 | ノーショーの返金が障害なら判定は確定し、返金を再試行・「返金待ち」を表示 | F02 | P-07 手順3a, no-show（15分ごと）, GET /warnings | NoShowService, PaymentService, WarningService | payments（REFUND・FAILED） | IT-NS, IT-JOB |
| 8.27 | 早期割のノーショー取消で戻せない夜は返金 | F06, F11 | POST /reservations/{id}/no-show/revert, P-07 手順4 | NoShowService, PaymentService | charge_lines, payments | IT-NS |
| 8.28 | ノーショーの延長は判定の前だけ、期限は到着日の25:00より後〜翌日12:00 | F06 | POST /reservations/{id}/no-show/defer, P-07 手順1a | NoShowService | reservations.no_show_deferred_until | IT-NS |
| 8.29 | ノーショーの取り消しは出発日のチェックアウト時刻より前まで | F06 | POST /reservations/{id}/no-show/revert, P-07 手順4 | NoShowService | reservations | IT-NS |
| 8.30 | ノーショーの取り消しで、故障中の期間の夜も戻して警告 | F06, F02 | P-07 手順4, GET /warnings | NoShowService, WarningService | room_nights, out_of_order_periods | IT-NS, IT-OOO |

### 要件9 客室の割り当て
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 9.1 | 全日程空いている部屋を自動で割り当て | — | P-03 | RoomAllocationService | room_nights | IT-INV |
| 9.2 | 1室の選び方 | — | P-03 手順2 | RoomSelector | rooms | UT-AS |
| 9.3 | 2室以上は同じ階 | — | P-03 手順2 | RoomSelector | rooms | UT-AS |
| 9.4 | 同じ階に収まらなければお知らせ（配置上不可は除く） | F02 | P-03 手順4 | RoomSelector, NoticeService | notices | UT-AS, IT-NT |
| 9.5 | 在庫なし、自動の組み替えはしない | G02 | P-02, P-03 | RoomAllocationService | room_nights | IT-INV |
| 9.6 | 別の部屋（別タイプを含む）へ変更 | F02, F10 | POST /reservation-rooms/{id}/move | RoomMoveService | reservation_rooms, room_nights | IT-MOV, E2E-F1 |
| 9.7 | 2つの予約の部屋を入れ替え | F10 | POST /room-swaps | RoomMoveService | room_nights | IT-MOV |
| 9.8 | 重なる予約・故障中へは移せない | F10 | ROOM_OCCUPIED, ROOM_OUT_OF_ORDER | RoomMoveService | room_nights, out_of_order_periods | IT-MOV |
| 9.9 | 定員が足りないときのダイアログ | F10 | UNDER_CAPACITY_CONFIRMATION_REQUIRED | RoomMoveService | — | E2E-F1 |
| 9.10 | 下位タイプは差額を返金（宿泊税の区分が下がれば宿泊税の差額も） | F10 | P-09 手順5 | RoomMoveService, PaymentService | charge_lines（DOWNGRADE_ADJUSTMENT, LODGING_TAX） | IT-MOV |
| 9.11 | 上位タイプは無償・有償を選ぶ | F10 | UPGRADE_KIND_REQUIRED | RoomMoveService | reservation_rooms.upgrade_kind | E2E-F1 |
| 9.12 | 無償は料金を変えない | F10 | P-09 手順4 | RoomMoveService | — | IT-MOV |
| 9.13 | 有償は差額を現地精算に（宿泊税の区分が上がれば宿泊税の差額も） | F10 | P-09 手順4 | RoomMoveService, LedgerService | charge_lines（UPGRADE, LODGING_TAX） | IT-MOV |
| 9.14 | チェックイン後は故障のときだけ | F10 | CHECKED_IN_ROOM_CHANGE_NOT_ALLOWED | RoomMoveService | rooms.status | IT-MOV |
| 9.15 | 宿泊客の画面に部屋の変更の手段なし | G14 | 該当する API を公開しない | — | — | E2E-G2 |
| 9.16 | 故障中の部屋への割り当てを警告 | F02 | GET /warnings | WarningService | out_of_order_periods, room_nights | IT-OOO |

### 要件10 予約状況チャートとお知らせ
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 10.1 | 日付×部屋番号、タイプごと | F02 | GET /chart | （chart の読み取り） | rooms, room_nights | E2E-F1 |
| 10.2 | 夜の範囲の帯、チェックアウト日は塗らない | F02 | GET /chart | — | room_nights | E2E-F1 |
| 10.3 | 予約のないマスを見分ける | F02 | — | — | — | E2E-F1 |
| 10.4 | 故障中の期間を表示 | F02 | GET /chart | — | out_of_order_periods | E2E-F1 |
| 10.5 | 予約番号で検索 | F02 | GET /reservations?number= | — | reservations | E2E-F1 |
| 10.6 | 表示期間の切り替え | F02 | GET /chart（from, to） | — | — | E2E-F1 |
| 10.7 | チャートから登録・変更・入れ替え | F02→F04, F10 | — | — | — | E2E-F1 |
| 10.8 | 連泊できない在庫なしのお知らせ | F03 | P-02 手順5 | AvailabilityService, NoticeService | notices | IT-NT |
| 10.9 | 同じお知らせは1件にまとめる | F03 | dedupe_key | NoticeService | notices（部分一意インデックス） | IT-NT |
| 10.10 | 手動の移動で離れたらお知らせ | F10, F03 | P-09 手順8, P-11 | RoomMoveService, NoticeService | notices | IT-NT |
| 10.11 | 清掃時間が2時間未満のお知らせ | F03 | P-11 | NoticeService | notices | IT-NT |
| 10.12 | 2時間の判定の例 | — | P-11 | NoticeService | — | IT-NT |
| 10.13 | 未解決の件数を赤丸のバッジ | F02 | GET /notices?status=open | NoticeService | notices | E2E-F1 |
| 10.14 | メッセージをダイアログで表示 | F03 | — | — | notices | E2E-F1 |
| 10.15 | 「解決」で件数から除く | F03 | POST /notices/{id}/resolve | NoticeService | notices.resolved_at | E2E-F1, IT-NT |

### 要件11 チェックイン・チェックアウトと現地精算
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 11.1 | 名簿がそろわなければチェックイン不可 | F11 | ROSTER_INCOMPLETE, P-10 手順1 | FrontDeskService, RosterService | roster_entries | E2E-F2 |
| 11.2 | 清掃完了でなければチェックイン不可 | F11 | ROOM_NOT_CLEAN | FrontDeskService | rooms.status | E2E-F2 |
| 11.3 | チェックインで部屋をチェックイン済み | F11 | POST /reservations/{id}/check-in | FrontDeskService, RoomStatusService | rooms | E2E-F2 |
| 11.4 | 現地払いはチェックアウト時に精算 | F09, F12 | P-10 手順2〜3 | LedgerService | charge_lines, payments | E2E-F2 |
| 11.5 | 時間外は常に現地精算 | F09 | P-01 手順6 | PriceCalculator, LedgerService | charge_lines.settlement | UT-PR, E2E-F2 |
| 11.6 | 7泊ごとの要精算を示す | F02, F09 | GET /warnings, P-10 手順2 | WarningService | charge_lines, payments | IT-BIL |
| 11.7 | 未精算ならチェックアウト不可 | F12 | UNSETTLED_BALANCE | FrontDeskService | — | E2E-F2 |
| 11.8 | チェックアウトで清掃可 | F12 | POST /reservations/{id}/check-out | FrontDeskService, RoomStatusService | rooms | E2E-F2 |
| 11.9 | 入金（現地・振込）の記録で入金完了のメール | F09 | POST /reservations/{id}/payments | PaymentService, MailService | payments, mail_outbox | IT-MAIL |
| 11.10 | チェックインで朝食券の枚数（日付・区分ごと）を表示 | F11 | P-10 手順1 | FrontDeskService | reservations（breakfast_*） | E2E-F2 |
| 11.11 | 払い過ぎならチェックアウトせず払い戻しを求める | F12 | P-10 手順4（UNSETTLED_BALANCE） | FrontDeskService | payments | IT-BIL |
| 11.12 | 現地での払い戻しを記録できる | F09 | POST /reservations/{id}/payments（REFUND） | PaymentService | payments（ONSITE_REFUND） | IT-BIL |
| 11.13 | チェックインは到着日の9:00以降・出発日のチェックアウト時刻より前だけ | F11 | P-10 手順1（RESERVATION_STATUS_INVALID、DT-M16） | FrontDeskService | reservations | IT-BIL |
| 11.14 | 出発日より前のチェックアウトの操作は、早期チェックアウトの後でなければ断る | F12 | POST /reservations/{id}/check-out（EARLY_CHECKOUT_REQUIRED）, P-10 手順4 | FrontDeskService | reservations | IT-FRT |

### 要件12 客室の状態（清掃状況）
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 12.1 | 12の状態と3つのグループ | C02 | RoomStatus | RoomStatusRules | rooms.status | UT-ST |
| 12.2 | 清掃員は空室の清掃・連泊のグループの中だけ変更できる | C03 | POST /rooms/{id}/status, P-12 | RoomStatusService | rooms | UT-ST, E2E-C1 |
| 12.3 | 清掃員のグループまたぎは不可（来客なし→清掃完了は可） | C03 | STATUS_TRANSITION_NOT_ALLOWED | RoomStatusRules | — | UT-ST, E2E-C1 |
| 12.4 | フロント以上はグループをまたげる | C03 | P-12 | RoomStatusRules | — | UT-ST |
| 12.5 | 9:00 の切り替え | — | 定時処理 morning-status | RoomStatusService | rooms | IT-JOB |
| 12.6 | 9:00 に来客なし | — | 定時処理 morning-status | RoomStatusService, NoShowService | rooms | IT-NS, IT-JOB |
| 12.7 | 来客なし → 清掃完了 | C03 | P-12 | RoomStatusRules | rooms | UT-ST |
| 12.8 | アーリー・レイトの時刻を表示 | C02 | GET /rooms/status-board | RoomStatusService | reservation_rooms | E2E-C1 |
| 12.9 | 9:00 より後のノーショーは来客なしにしない | — | P-12 | RoomStatusService, NoShowService | rooms | IT-NS, IT-JOB |

### 要件13 故障中の管理
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 13.1 | 終了予定日は必須、在庫から外す | F13 | POST /rooms/{id}/out-of-order, P-13 | OutOfOrderService | out_of_order_periods | IT-OOO |
| 13.2 | 翌日から在庫に戻る | — | P-02 手順3 | AvailabilityService | out_of_order_periods | IT-OOO |
| 13.3 | 期限を過ぎたら警告 | F02, F13 | GET /warnings | WarningService | out_of_order_periods | IT-OOO |
| 13.4 | 修理後に清掃完了へ | F13 | POST /out-of-order/{id}/end | OutOfOrderService | out_of_order_periods, rooms | IT-OOO |
| 13.5 | 早く直ったらその日の夜から在庫に戻す | F13 | P-13 | OutOfOrderService | out_of_order_periods | IT-OOO |
| 13.6 | 開始日に今日チェックアウトする客がいる部屋は、チェックアウトのときに故障中にする | F13, F12 | P-10 手順4, P-12, P-13 | OutOfOrderService, FrontDeskService, RoomStatusService | rooms, out_of_order_periods | IT-OOO |
| 13.7 | 開始日の夜も泊まる客がいる部屋は故障中にして移動を促す | F13, F02 | P-12（morning-status）, P-13, GET /warnings | OutOfOrderService, RoomStatusService, WarningService | rooms, out_of_order_periods | IT-OOO, IT-JOB |
| 13.8 | 重なる期間（設定・延長）・過去の開始日の故障中は登録できない | F13 | POST /rooms/{id}/out-of-order、PATCH /out-of-order/{id}（OVERLAPPING_PERIOD, VALIDATION_FAILED） | OutOfOrderService | out_of_order_periods | IT-OOO |

### 要件14 宿泊者名簿
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 14.1 | 氏名・住所・連絡先、外国人は国籍・旅券番号 | G17, F08 | PUT /reservations/{id}/roster, P-14 | RosterService | roster_entries | IT-ROS |
| 14.2 | 子ども・幼児も記録 | G17, F08 | P-14 | RosterService | roster_entries.age_category | IT-ROS |
| 14.3 | 予約者が事前に入力・送信 | G17 | PUT /api/guest/reservations/{id}/roster | RosterService | roster_entries | IT-ROS |
| 14.4 | フロントが入力 | F08 | PUT /api/staff/reservations/{id}/roster | RosterService | roster_entries | IT-ROS |
| 14.5 | 項目を後から追加 | （A03 後のフェーズ） | roster_fields | RosterService | roster_fields, roster_entries.extra | IT-ROS |
| 14.6 | 宿泊した予約の名簿は3年以上保存、宿泊しなかった名簿は会員と一緒に削除 | — | P-16 手順4 | RetentionService | roster_entries | IT-RET |
| 14.7 | 予約の画面で入れた同行者の連絡先に、予約者の連絡先を自動で入れる | G09, G17, F08 | P-14 | RosterService | roster_entries | IT-ROS |

### 要件15 通知メール
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 15.1 | 会員が選んだ言語で送る | — | P-15 | MailService | members.preferred_locale, mail_outbox | IT-MAIL |
| 15.2 | 前日10:00 に到着前の案内 | — | 定時処理 pre-arrival | MailService | mail_outbox | IT-JOB |
| 15.3 | 前日10:00 より後の確定には送らない | — | 定時処理 pre-arrival | MailService | reservations.confirmed_at | IT-JOB |
| 15.4 | キャンセル料・ノーショー料の請求メール | — | P-06, P-07, P-15 | MailService | mail_outbox | IT-MAIL |
| 15.5 | 返金の完了（カード・現地の払い戻し）のメール | — | P-15 | MailService | mail_outbox | IT-MAIL |
| 15.6 | 同意している会員にだけ配信 | — | P-15 | MailService | marketing_consents | IT-MAIL |
| 15.7 | 送信者名と受信拒否の方法を表示 | G20 | P-15, POST /marketing/unsubscribe | MailService | mail_outbox | IT-MAIL |
| 15.8 | 支払いのお願いのメール（振込先と金額） | — | P-15 PAYMENT_REQUEST | MailService | mail_outbox, hotel_settings | IT-MAIL |

### 要件16 宿泊客向け画面の多言語表示
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 16.1 | 5言語の切り替え | guest-web 全体 | react-i18next | — | members.preferred_locale | E2E-G3 |
| 16.2 | 固定の文言を選んだ言語で | guest-web 全体 | i18n/locales, メールのテンプレート | MailService | — | E2E-G3 |
| 16.3 | 日付・数字の書き方、時刻は日本時間 | guest-web 全体 | Intl API | — | — | E2E-G3 |
| 16.4 | ホテル側の文章は機械翻訳（編集後の文） | G02, G10 | GET /room-types, /terms/current | ContentService, Translator | translations | E2E-G3 |
| 16.5 | 宿泊客の入力は翻訳しない | G14, G17 | — | — | — | E2E-G3 |
| 16.6 | スタッフ向けは日本語だけ | front-web, cleaning-web | — | — | — | E2E-F1 |

### 要件17 特定期間割増の設定
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 17.1 | 期間と割増率の登録・変更・削除 | F14 | /special-surcharges | SpecialPeriodService | special_surcharge_periods | IT-SUR |
| 17.2 | 確定済みの予約の料金は変えない | F14 | ADR-07 | SpecialPeriodService | stay_night_prices | IT-SUR |

### 要件18 操作履歴の記録
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 18.1 | スタッフ番号・日時・内容を記録 | — | 社内用 API の更新系すべて | AuditLogService | audit_logs | IT-AUD |
| 18.2 | 変更・削除できない | — | トリガーと権限 | AuditLogService | audit_logs | IT-AUD |
| 18.3 | 操作履歴に個人情報の値を記録しない | — | AuditLogService | AuditLogService | audit_logs.detail | IT-AUD |

### 要件19 個人情報の保存と削除
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 19.1 | 最終宿泊日から3年で削除 | — | 定時処理 retention, P-16 | RetentionService | members.last_stay_date | IT-RET |
| 19.2 | 宿泊なしは登録日から3年 | — | P-16 | RetentionService | members | IT-RET |
| 19.3 | 今後の予約・未回収があれば削除しない | — | P-16 手順1 | RetentionService | reservations, payments | IT-RET |
| 19.4 | 削除の対象と、個人が分からない形で残すもの | — | P-16 手順2 | RetentionService, PaymentGateway | members, member_cards, roster_entries, reservations, mail_outbox | IT-RET |
| 19.5 | 予告のメールは送らない | — | P-16 手順3 | RetentionService | — | IT-RET |
| 19.6 | 退会者は削除まで保存 | — | P-16 手順3 | RetentionService | members（WITHDRAWN） | IT-RET |

### 要件20 売上・稼働率の集計（後のフェーズ）
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 20.1 | 管理者だけに表示 | A08 | 後のフェーズ | RolesGuard | — | 後のフェーズ |
| 20.2 | 税抜・宿泊した夜ごとに計上 | A08 | 後のフェーズ | — | charge_lines（stay_date, amount_incl） | 後のフェーズ |
| 20.3 | キャンセル料は別の項目 | A08 | 後のフェーズ | — | charge_lines（CANCELLATION_FEE, NO_SHOW_FEE） | 後のフェーズ |
| 20.4 | 稼働率 | A08 | 後のフェーズ | — | room_nights, out_of_order_periods | 後のフェーズ |
| 20.5 | ADR・RevPAR | A08 | 後のフェーズ | — | charge_lines（ROOM） | 後のフェーズ |
| 20.6 | 日・週・月・年で比較 | A08 | 後のフェーズ | — | — | 後のフェーズ |
| 20.7 | 返金しなかった宿泊税はキャンセル料・ノーショー料と同じ項目 | A08 | P-06「宿泊税の返金」（明細の付け替えは MVP で行う） | CancellationPolicy, LedgerService | charge_lines | UT-CN（付け替え）、集計は後のフェーズ |

### 要件21 管理者による設定（後のフェーズ）
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 21.1 | 料金・率・オプション・宿泊税の変更 | A01 | 後のフェーズ（新しい料金の版を作る） | — | rate_versions, room_type_prices | 後のフェーズ |
| 21.2 | 客室タイプ・定員・基準人数・部屋 | A02 | 後のフェーズ | — | room_types, rooms | 後のフェーズ |
| 21.3 | 名簿の項目の追加 | A03 | 後のフェーズ | — | roster_fields | 後のフェーズ |
| 21.4 | スタッフのアカウントの作成・停止 | A04 | 後のフェーズ | — | staff, sessions | 後のフェーズ |
| 21.5 | 機械翻訳の編集 | A05 | 後のフェーズ | — | translations.is_edited | 後のフェーズ |
| 21.6 | 原文の変更で上書きの警告 | A05 | 後のフェーズ | — | translations.source_hash | 後のフェーズ |
| 21.7 | 設定の変更で確定済みの料金を変えない | A01 | ADR-07（版と控え） | — | stay_night_prices | 後のフェーズ（構造は IT-SUR で確認） |
| 21.8 | 定期配信の作成（件名・本文・配信日時・繰り返し） | （A 後のフェーズ） | 後のフェーズ | — | mail_campaigns, translations | 後のフェーズ |

### 要件22 管理者による例外対応と履歴の閲覧（後のフェーズ）
| ID | 要約 | 画面 | API・処理 | コンポーネント | テーブル | テスト |
|---|---|---|---|---|---|---|
| 22.1 | 返金・免除・料金の手動変更 | A06 | 後のフェーズ | — | charge_lines, payments | 後のフェーズ |
| 22.2 | 操作履歴の閲覧 | A07 | 後のフェーズ | — | audit_logs | 後のフェーズ |
