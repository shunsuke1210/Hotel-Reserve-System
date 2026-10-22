# テストケース：会員・認証・権限・メール・多言語・個人情報

対象：要件 1.1〜1.13、2.1〜2.5、15.1〜15.8、16.1〜16.6、18.1〜18.3、19.1〜19.6、brief.md DR-02a・DT-M19・DT-M34・DT-M37、design.md Security Considerations（ADR-03・ADR-04）、design.md P-15 のメールのテンプレート、design.md 設計の補足 L-24・L-27・L-28・L-33・L-40・L-42・L-43
参照：requirements.md、design.md、design-screens.md、brief.md、context.md、traceability.md、research.md（ADR）

## 1. テスト観点

### 正常
- 会員登録（必須項目・カードの登録）、メールアドレスの確認、ログイン・ログアウト
- 会員情報の確認・変更、カードの差し替え、定期配信の同意の記録と取り消し（会員情報の画面・配信停止のリンク）、メールアドレスの変更（新しいアドレスの確認が終わってから反映する）
- パスワードの再設定（申込・再設定）
- 退会（今後の予約・未回収の額がない場合）と、退会の後に残すもの・消すもの。未回収の額を振込で払った後の退会
- スタッフのログインと役割の判別、役割ごとに使える画面と API、スタッフの停止（StaffService.suspend）でセッションを消すこと
- スタッフの操作の記録（予約・客室の状態・名簿・料金の設定・故障中・入金、チェックイン・チェックアウト、部屋の移動・入れ替え、ノーショーの延長・取り消し、時間外、故障中の延長・修理の完了、お知らせの解決、払い戻し、グループをまたぐ状態の変更、定時処理）と、操作履歴に個人情報の値を記録しないこと。行の数（1つの操作につき1行で、同時に変わる部屋の状態は detail に入る。定時処理は対象1件につき1行）
- P-15 の各テンプレートが、正しいきっかけ・宛先・言語で作られること。送信と再送
- 宿泊客向け画面の5言語の切り替え、固定の文言・日付・数字・時刻の表示、ホテル側の文章の翻訳文、宿泊客の入力を翻訳しないこと、スタッフ向けは日本語だけ
- 最終宿泊日・登録日から3年でのアカウントの自動削除と、削除する情報（メールの記録を含む）・残す情報（操作履歴を含む）

### 異常
- 必須項目の欠け、形式の誤り（会員登録・ログインの画面、ログインの API）、スタッフ番号・パスワードの欠け、メールアドレス・電話番号の重複、カードの拒否・決済サービスの障害
- 確認・再設定のトークンの期限切れ・使用済み・不正な値、配信停止の署名の改ざん
- パスワードの誤り、存在しない ID、ログインの回数制限、確認メールの再送の回数制限、セッション切れ
- 役割の権限がない操作（清掃員による FRONT 以上の社内用 API の呼び出し）、ログインしていない操作、他人の会員情報・予約の指定（決済待ちの予約の確定、変更の確定を含む）
- 今後の予約、または未回収の額がある会員の退会（パスワードの誤り・今後の予約・未回収が重なるときのエラーの順番を含む）。未回収の額がある会員の自動削除
- 公開用の待ち受け口・公開用 nginx からのスタッフ向け機能の呼び出し、会員とスタッフのセッションの取り違え、独自のヘッダーがない状態変更の要求
- 操作履歴の変更・削除
- メールの送信の失敗

### 境界
- 文字数・桁数：氏名（1／50／51文字）、郵便番号（6／7／8桁）、電話番号（9／10／15／16桁）、パスワード（9／10文字）、カード番号（12／13／19／20桁）、旅券番号（5／6／12／13文字）
- 日付：生年月日（今日／前日）、カードの有効期限（今月／先月）
- 時間：確認メールの24時間、未確認の申込の削除（24時間）、再設定の1時間、ログインの1分5回、確認メールの再送・再設定の申込の1分5回（直近60秒の要求の数。1回目の要求から59秒・60秒での解除）、会員のセッション7日、スタッフのセッション12時間、到着前の案内の前日10:00
- 削除：最終宿泊日・登録日から3年（ちょうど・1日前・1日後）、うるう日
- 未回収の額：振込の後に1円残る・0円になる
- メールの再送：4回目・5回目の失敗

### 連携
- 決済代行（模擬）：カードの登録・拒否・障害・カードの識別子の削除
- 予約の確定・変更・キャンセル・ノーショー・現地入金・部屋の移動・確保の時間切れと、メールの作成
- メールの作成（mail_outbox）と送信（MailSender）、警告の一覧
- 機械翻訳（模擬）と翻訳文（translations）
- チェックアウトと最終宿泊日の更新、自動削除
- キャンセル料・ノーショー料の請求の失敗（未回収）、振込の入金の記録と、退会・自動削除
- nginx（公開用・社内用）と2つの待ち受け口（ポート3001・3002）

### 状態遷移
- 会員：PENDING → ACTIVE → WITHDRAWN → 削除。PENDING のまま24時間で削除。期限切れの PENDING の申込は、同じメール・電話の登録の申込のときに削除
- 未回収の額：あり（退会・自動削除できない）→ 振込で0 → 退会できる・次の回で削除
- スタッフ：有効 → 停止（セッションを消す）
- 定期配信の同意：同意なし → 同意 → 取り消し → 再同意（履歴を追記し、最新の行が現在の状態）
- セッション：作成 → 操作で延長 → 失効／ログアウト／退会／削除で無効
- 予約の状態（PENDING_PAYMENT・CONFIRMED・CHECKED_IN・CANCELLED・NO_SHOW・EXPIRED）と、退会・自動削除の可否
- メール：PENDING → SENT、または失敗を重ねて FAILED

## 2. テストケース

**共通前提**（前提条件の欄に書かないかぎり、すべてのケースに当てはまる）
- 時刻はすべて日本時間。BusinessClock を固定する。前提条件に書かなければ 現在＝2026-11-10 10:00
- 公開用 API は `/api/guest`、社内用 API は `/api/staff` で始まる（以下では省略して書く）
- 会員A：ACTIVE、メール a@example.com、電話 09011112222、パスワード Passw0rd12、preferred_locale=ja、登録カードの末尾 4242、定期配信の同意なし、予約なし
- 会員B：ACTIVE、メール b@example.com、電話 09022223333、予約 R-B1（CONFIRMED、到着 2026-11-20）を持つ
- 退会済みの会員W：WITHDRAWN、メール w@example.com、電話 09055556666
- スタッフ：管理者 S001（ADMIN）、フロント S101（FRONT）、清掃員 S201（CLEANER）。パスワードはいずれも Staff0pass1
- 模擬の決済：カード番号の末尾が 0002 なら登録・決済を拒否（PAYMENT_DECLINED）、0119 なら登録・決済で障害（PAYMENT_GATEWAY_UNAVAILABLE）、0341 なら登録は成功し決済だけを拒否、0259 なら登録は成功し決済・返金で障害、それ以外は成功（design.md の PaymentGateway、設計の補足 L-16）
- **標準入力**（会員登録）：姓 山田、名 花子、国 日本、郵便番号 9200000（7桁）、住所 石川県金沢市広岡1-1、日本に住所がない外国人か＝いいえ、電話 09033334444（11桁）、メール new@example.com、生年月日 1990-05-01、パスワード Abcdef123456（12文字）と確認用に同じ値、カード 4111111111111111（16桁）・有効期限 2027/12・名義 HANAKO YAMADA、利用する言語 日本語、定期配信メールの受信 チェックなし

### 2.1 会員登録：正常と保存内容

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-001 | 会員登録 | 正常 | new@example.com・09033334444 の会員はいない | G04 に標準入力を入れて「登録」を押す | 202 が返り、G05 に移る | 1.1 / design.md 公開用 API POST /auth/register、design-screens.md G04・G05 |
| TC-MB-002 | 会員登録 | 正常 | TC-MB-001 と同じ | TC-MB-001 の後に members を確認する | new@example.com の行が1件でき、status=PENDING、email_verified_at が空である | 1.1, 1.4 / design.md Data Models members |
| TC-MB-003 | 会員登録（カード） | 正常 | TC-MB-001 と同じ | TC-MB-001 の後に member_cards と、データベースの全テーブルを確認する | 保存されているのはトークン・ブランド・下4桁（1111）・有効期限（12／2027）だけで、カード番号の全桁は member_cards のどの列にもなく、ほかのどのテーブルにも保存されていない | 1.1 / design.md Security Considerations（カード）、member_cards、ADR-05 |
| TC-MB-004 | 会員登録（カード） | 正常 | TC-MB-001 と同じ | TC-MB-001 の要求について API のログを確認する | ログにカード番号の全桁（4111111111111111）が出力されていない | 1.1 / design.md Security Considerations（カード）、Monitoring |
| TC-MB-005 | 会員登録（パスワード） | 正常 | TC-MB-001 と同じ | TC-MB-001 の後に members.password_hash を確認する | Argon2id のハッシュ（$argon2id$ で始まる値）が入り、平文の Abcdef123456 を含まない | 1.1 / design.md Security Considerations（パスワード）、ADR-04 |

### 2.2 会員登録：必須項目

期待結果の「VALIDATION_FAILED」は、HTTP 400 で、その項目の誤りとして返り（画面では項目の下に赤字で理由を表示）、members に行ができないことを指す（design.md Error Handling、design-screens.md 共通の約束）。

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-006 | 会員登録 | 異常 | — | 標準入力のうち姓を空にして登録 | 姓の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-007 | 会員登録 | 異常 | — | 標準入力のうち名を空にして登録 | 名の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-008 | 会員登録 | 異常 | — | 標準入力のうち国を選ばずに登録 | 国の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-009 | 会員登録 | 異常 | — | 標準入力のうち住所を空にして登録 | 住所の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-010 | 会員登録 | 異常 | — | 標準入力のうち電話番号を空にして登録 | 電話番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-011 | 会員登録 | 異常 | — | 標準入力のうちメールアドレスを空にして登録 | メールアドレスの VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-012 | 会員登録 | 異常 | — | 標準入力のうち生年月日を空にして登録 | 生年月日の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-013 | 会員登録 | 異常 | — | 標準入力のうちパスワードと確認用を空にして登録 | パスワードの VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-014 | 会員登録 | 異常 | — | 標準入力のうちカード番号を空にして登録 | カード番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-015 | 会員登録 | 異常 | — | 標準入力のうちカードの有効期限を空にして登録 | 有効期限の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-016 | 会員登録 | 異常 | — | 標準入力のうちカードの名義を空にして登録 | 名義の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-017 | 会員登録 | 異常 | — | 標準入力のうち「日本に住所がない外国人か」を選ばずに登録 | その項目の VALIDATION_FAILED で登録されない | 1.1, 1.2 / design-screens.md G04 |
| TC-MB-018 | 会員登録 | 異常 | — | POST /auth/register に、標準入力から「利用する言語」を除いた内容を送る | 言語の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（利用する言語は必須） |

### 2.3 会員登録：形式と境界値

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-019 | 会員登録（氏名） | 境界 | — | 標準入力のうち姓を「林」（1文字）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04（1〜50文字） |
| TC-MB-020 | 会員登録（氏名） | 境界 | — | 姓を50文字にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-021 | 会員登録（氏名） | 境界 | — | 姓を51文字にして登録 | 姓の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-022 | 会員登録（郵便番号） | 境界 | 国＝日本 | 郵便番号を 920000（6桁）にして登録 | 郵便番号の VALIDATION_FAILED で登録されない（7桁は TC-MB-001 で受け付けることを確認） | 1.1 / design-screens.md G04（日本は7桁） |
| TC-MB-023 | 会員登録（郵便番号） | 境界 | 国＝日本 | 郵便番号を 92000001（8桁）にして登録 | 郵便番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-024 | 会員登録（電話番号） | 境界 | — | 電話番号を 090333444（9桁）にして登録 | 電話番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（10〜15桁） |
| TC-MB-025 | 会員登録（電話番号） | 境界 | — | 電話番号を 0763334444（10桁）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-026 | 会員登録（電話番号） | 境界 | — | 電話番号を 819033344445555（15桁）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-027 | 会員登録（電話番号） | 境界 | — | 電話番号を 8190333444455556（16桁）にして登録 | 電話番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-028 | 会員登録（メール） | 異常 | — | メールアドレスを「new@」にして登録 | メールアドレスの VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（メールの形式） |
| TC-MB-029 | 会員登録（生年月日） | 境界 | — | 生年月日を 2026-11-10（今日）にして登録 | 生年月日の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（今日より前） |
| TC-MB-030 | 会員登録（生年月日） | 境界 | — | 生年月日を 2026-11-09（前日）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-031 | 会員登録（パスワード） | 境界 | — | パスワードと確認用を Abcdef123（9文字）にして登録 | パスワードの VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（10文字以上） |
| TC-MB-032 | 会員登録（パスワード） | 境界 | — | パスワードと確認用を Abcdef1234（10文字）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-033 | 会員登録（パスワード） | 異常 | — | パスワードと確認用を 1234567890（数字だけ10文字）にして登録 | パスワードの VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（英字と数字を含む） |
| TC-MB-034 | 会員登録（パスワード） | 異常 | — | パスワードと確認用を Abcdefghij（英字だけ10文字）にして登録 | パスワードの VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-035 | 会員登録（パスワード） | 異常 | — | パスワード Abcdef123456、確認用 Abcdef123457 で登録 | 確認用の不一致として VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（確認用と一致） |
| TC-MB-036 | 会員登録（カード番号） | 境界 | — | カード番号を 411111111111（12桁）にして登録 | カード番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04（13〜19桁） |
| TC-MB-037 | 会員登録（カード番号） | 境界 | — | カード番号を 4222222222222（13桁）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-038 | 会員登録（カード番号） | 境界 | — | カード番号を 4111111111111111111（19桁）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04 |
| TC-MB-039 | 会員登録（カード番号） | 境界 | — | カード番号を 41111111111111111111（20桁）にして登録 | カード番号の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-040 | 会員登録（有効期限） | 境界 | 現在＝2026-11-10 10:00 | 有効期限を 2026/11（今月）にして登録 | 受け付けられる（202） | 1.1 / design-screens.md G04（今月以降） |
| TC-MB-041 | 会員登録（有効期限） | 境界 | 現在＝2026-11-10 10:00 | 有効期限を 2026/10（先月）にして登録 | 有効期限の VALIDATION_FAILED で登録されない | 1.1 / design-screens.md G04 |
| TC-MB-042 | 会員登録（カード） | 連携 | — | カード番号を 4000000000000002（末尾0002）にして登録 | PAYMENT_DECLINED（402）となり「このカードは登録できません」と表示され、members に行ができない | 1.1 / design.md 公開用 API POST /auth/register、模擬の決済、design-screens.md G04 |
| TC-MB-043 | 会員登録（カード） | 連携 | — | カード番号を 4000000000000119（末尾0119）にして登録 | PAYMENT_GATEWAY_UNAVAILABLE（503）となり、members に行ができない | 1.1 / design.md PaymentGateway.registerCard、Error Handling |
| TC-MB-044 | 会員登録（言語） | 正常 | 未ログイン。画面の言語を English にしている | G04 を開く | 「利用する言語」の初期値が English になっている | 1.1, 16.1 / design-screens.md G04（初期値は画面の言語） |
| TC-MB-045 | 会員登録（配信の同意） | 正常 | 未ログイン | G04 を開く | 「定期配信メールの受信」のチェックボックスが未チェック（受け取らない）になっている | 1.5 / design-screens.md G04 |

### 2.4 会員登録：日本に住所がない外国人

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-046 | 会員登録（外国人） | 正常 | — | 標準入力のうち国＝アメリカ、外国人か＝はい、国籍＝アメリカ、旅券番号＝TR1234567（9文字）にして登録 | 受け付けられる（202） | 1.2 / design-screens.md G04 |
| TC-MB-047 | 会員登録（外国人） | 正常 | TC-MB-046 と同じ | TC-MB-046 の後に members を確認する | is_foreign_non_resident=true、nationality と passport_number に入力した値が保存されている | 1.2 / design.md Data Models members |
| TC-MB-048 | 会員登録（外国人） | 異常 | — | TC-MB-046 の入力から国籍を空にして登録 | 国籍の VALIDATION_FAILED で登録されない | 1.2 / design-screens.md G04（「はい」なら国籍・旅券番号が必須） |
| TC-MB-049 | 会員登録（外国人） | 異常 | — | TC-MB-046 の入力から旅券番号を空にして登録 | 旅券番号の VALIDATION_FAILED で登録されない | 1.2 / design-screens.md G04 |
| TC-MB-050 | 会員登録（旅券番号） | 境界 | 外国人か＝はい | 旅券番号を TR123（5文字）にして登録 | 旅券番号の VALIDATION_FAILED で登録されない | 1.2 / design-screens.md G04（英数字6〜12文字） |
| TC-MB-051 | 会員登録（旅券番号） | 境界 | 外国人か＝はい | 旅券番号を TR1234（6文字）にして登録 | 受け付けられる（202） | 1.2 / design-screens.md G04 |
| TC-MB-052 | 会員登録（旅券番号） | 境界 | 外国人か＝はい | 旅券番号を TR1234567890（12文字）にして登録 | 受け付けられる（202） | 1.2 / design-screens.md G04 |
| TC-MB-053 | 会員登録（旅券番号） | 境界 | 外国人か＝はい | 旅券番号を TR12345678901（13文字）にして登録 | 旅券番号の VALIDATION_FAILED で登録されない | 1.2 / design-screens.md G04 |
| TC-MB-054 | 会員登録（旅券番号） | 異常 | 外国人か＝はい | 旅券番号を TR-12345（記号を含む）にして登録 | 旅券番号の VALIDATION_FAILED で登録されない | 1.2 / design-screens.md G04（英数字） |

### 2.5 メールアドレス・電話番号の重複

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-055 | 会員登録（重複） | 異常 | 会員A（ACTIVE） | 標準入力のうちメールを a@example.com にして登録 | EMAIL_ALREADY_REGISTERED（409）で登録されない | 1.3 / design.md 公開用 API POST /auth/register、Error Handling |
| TC-MB-056 | 会員登録（重複） | 異常 | 会員A（ACTIVE） | TC-MB-055 と同じ操作を G04 で行う | 「すでに登録されています。ログインまたはパスワードの再設定をご利用ください」と表示される | 1.3 / design-screens.md G04 |
| TC-MB-057 | 会員登録（重複） | 異常 | 会員A（ACTIVE） | メールを A@Example.COM（大文字・小文字だけが違う）にして登録 | EMAIL_ALREADY_REGISTERED（409）で登録されない | 1.3 / design.md members（lower(email) の部分一意インデックス） |
| TC-MB-058 | 会員登録（重複） | 異常 | 会員A（ACTIVE） | 標準入力のうち電話を 09011112222 にして登録 | PHONE_ALREADY_REGISTERED（409）で登録されない | 1.3 / design.md 公開用 API、Error Handling |
| TC-MB-059 | 会員登録（重複） | 正常 | 会員W（WITHDRAWN） | 標準入力のうちメールを w@example.com にして登録 | 受け付けられる（202） | 1.3 / brief.md DR-01b、design.md members（PENDING・ACTIVE の行の中で一意） |
| TC-MB-060 | 会員登録（重複） | 正常 | 会員W（WITHDRAWN） | 標準入力のうち電話を 09055556666 にして登録 | 受け付けられる（202） | 1.3 / brief.md DR-01b |
| TC-MB-061 | 会員登録（重複） | 状態遷移 | 会員M1（m1@example.com、09077778888）が自動削除（P-16）で削除済み | メール m1@example.com、電話 09077778888 で登録 | 受け付けられる（202） | 1.3, 19.4 / brief.md DR-01b、design.md Testing Strategy IT-RET |
| TC-MB-062 | 会員登録（重複） | 異常 | 会員P（p@example.com、PENDING、申込＝2026-11-10 09:00、確認の期限内） | 標準入力のうちメールを p@example.com にして登録 | EMAIL_ALREADY_REGISTERED（409）で登録されない | 1.3 / design.md members（PENDING を一意の対象に含む） |
| TC-MB-063 | 会員登録（重複） | 境界 | 会員P2（p2@example.com、PENDING、申込＝2026-11-09 08:00。確認の期限は切れているが、04:00 の pending-cleanup ではまだ24時間経っていなかったため残っている） | 現在＝2026-11-10 10:00、メールを p2@example.com にして登録 | 受け付けられる（202）。登録の申込のときに、同じメールアドレスの確認の期限が切れた PENDING の申込（P2 の members の行）と P2 の auth_tokens が同じトランザクションで削除され、p2@example.com の新しい PENDING の申込が作られる（P2 の行は残らない：L-24）。期限内の申込は重複になる（TC-MB-062） | 1.3, 1.4 / design.md members、定時処理 pending-cleanup、設計の補足 L-24、design-screens.md G06 |
| TC-MB-064 | 会員登録（重複） | 異常 | 会員A（電話 09011112222） | 電話を 090-1111-2222（ハイフンつき）にして登録 | PHONE_ALREADY_REGISTERED（409）で登録されない（ハイフンなどの記号を取り除いた 09011112222 で保存・比較する：L-10） | 1.3 / design.md members（phone は数字だけに正規化）、設計の補足 L-10、design-screens.md G04 |
| TC-MB-341 | 会員登録（重複） | 異常 | 会員A（電話 09011112222） | 国は日本のまま、電話を +81 90-1111-2222（国番号つき）にして登録 | PHONE_ALREADY_REGISTERED（409）で登録されない（記号を取り除いた 819011112222 の先頭の 81 を 0 に直し、09011112222 として比べる：L-10） | 1.3 / design.md members、設計の補足 L-10、design-screens.md G04 |
| TC-MB-065 | 会員情報の変更（重複） | 異常 | 会員Bでログイン | PATCH /me でメールを a@example.com に変える | EMAIL_ALREADY_REGISTERED（409）で、B のメールは b@example.com のまま | 1.3, 1.8 / design.md 公開用 API PATCH /me |
| TC-MB-066 | 会員情報の変更（重複） | 異常 | 会員Bでログイン | PATCH /me で電話を 09011112222 に変える | PHONE_ALREADY_REGISTERED（409）で、B の電話は変わらない | 1.3, 1.8 / design.md 公開用 API PATCH /me |
| TC-MB-067 | 会員情報の変更（重複） | 正常 | 会員Aでログイン | PATCH /me でメール a@example.com・電話 09011112222 はそのままにして、住所だけを変える | 200 で受け付けられる（自分自身との重複として断られない） | 1.3, 1.8 / requirements.md 1.3（ほかの会員と同じとき） |
| TC-MB-068 | 会員情報の変更（重複） | 正常 | 会員Bでログイン、会員W（WITHDRAWN） | PATCH /me でメールを w@example.com に変える | 200 で受け付けられる | 1.3, 1.8 / brief.md DR-01b |
| TC-MB-342 | 会員登録（重複） | 正常 | 会員P7（p7@example.com、電話 09088889999、PENDING、申込＝2026-11-09 08:00。確認の期限（2026-11-10 08:00）は切れているが、04:00 の pending-cleanup では20時間しか経っていなかったため残っている） | 現在＝2026-11-10 10:00、標準入力のうち電話を 09088889999 にして登録（メールは new@example.com のまま） | 受け付けられる（202）。同じ電話番号の確認の期限が切れた PENDING の申込（P7 の members の行と auth_tokens）が同じトランザクションで削除され、new@example.com・09088889999 の新しい PENDING の申込が作られる（L-24） | 1.3, 1.4 / design.md members、設計の補足 L-24 |

### 2.6 メールアドレスの確認（確認メール・24時間）

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-069 | 確認メール | 連携 | — | 現在＝2026-11-10 10:00、標準入力のうち利用する言語を 한국어 にして登録 | mail_outbox に template=VERIFY_EMAIL、to_address=new@example.com、locale=ko の行が1件できる | 1.4, 15.1 / design.md P-15、mail_outbox |
| TC-MB-070 | 登録の受付 | 正常 | — | TC-MB-001 の後の G05 を確認する | 「確認メールを送りました。24時間以内にリンクを開いてください」と表示される | 1.4 / design-screens.md G05 |
| TC-MB-071 | 確認前のログイン | 異常 | TC-MB-001 で登録し、まだ確認していない | 現在＝2026-11-10 10:05、POST /auth/login に new@example.com と Abcdef123456 を送る | EMAIL_NOT_VERIFIED（403）でログインできない | 1.4 / design.md 公開用 API POST /auth/login、Error Handling |
| TC-MB-072 | 確認前のログイン | 異常 | TC-MB-071 と同じ | G03 で TC-MB-071 と同じログインを行う | 確認メールの再送ボタンが表示される | 1.4 / design-screens.md G03 |
| TC-MB-073 | 確認メールの再送 | 正常 | TC-MB-072 の表示（2026-11-10 10:05） | 再送ボタンを押す | POST /auth/verify-email/resend（{ email: new@example.com }）が送られて 202 が返り、mail_outbox に new@example.com 宛ての VERIFY_EMAIL（新しいトークン）が1件増える（古いトークンは無効になる：L-8） | 1.4 / design-screens.md G03、design.md 公開用 API POST /auth/verify-email/resend、設計の補足 L-8 |
| TC-MB-338 | 確認メールの再送（古いトークン） | 異常 | TC-MB-073 で 2026-11-10 10:05 に再送した（最初のトークンは 10:00 に発行） | 現在＝2026-11-10 10:10、最初のトークン（10:00 発行）を POST /auth/verify-email に送る | TOKEN_INVALID で、members.status は PENDING のまま（再送で古いトークンを無効にする：L-8） | 1.4 / design.md 公開用 API、auth_tokens、設計の補足 L-8 |
| TC-MB-339 | 確認メールの再送（24時間の起点） | 境界 | TC-MB-073 で 2026-11-10 10:05 に再送した（申込は 10:00） | 現在＝2026-11-11 10:04（申込から24時間4分後、再送から23時間59分後）、再送で受け取ったトークンを送る | 200 で、members.status=ACTIVE になる（24時間は再送の時点から数える：L-8） | 1.4 / design.md auth_tokens、設計の補足 L-8 |
| TC-MB-074 | メールアドレスの確認 | 境界 | 2026-11-10 10:00 に登録し、確認のトークンを受け取った | 現在＝2026-11-11 09:59（23時間59分後）、POST /auth/verify-email にトークンを送る | 200 で、members.status=ACTIVE、email_verified_at=2026-11-11 09:59 になる | 1.4 / design.md auth_tokens（確認は24時間） |
| TC-MB-075 | メールアドレスの確認 | 正常 | TC-MB-074 と同じ | G06 をメールのリンクから開いて確認する | 「登録が完了しました」とログインへの案内が表示される | 1.4 / design-screens.md G06 |
| TC-MB-076 | 確認後のログイン | 状態遷移 | TC-MB-074 で確認済み | POST /auth/login に new@example.com と Abcdef123456 を送る | 200 で MemberSummary が返り、ログインできる | 1.4 / design.md 公開用 API POST /auth/login |
| TC-MB-077 | メールアドレスの確認 | 境界 | 2026-11-10 10:00 に登録 | 現在＝2026-11-11 10:00（ちょうど24時間後）、トークンを送る | TOKEN_INVALID で、members.status は PENDING のまま（確認メールの期限は、ちょうど24時間の時刻で無効：DT-M1） | 1.4 / design.md auth_tokens、設計の補足 DT-M1 |
| TC-MB-078 | メールアドレスの確認 | 境界 | 2026-11-10 10:00 に登録 | 現在＝2026-11-11 10:01（24時間1分後）、トークンを送る | TOKEN_INVALID で、members.status は PENDING のまま | 1.4 / design.md 公開用 API POST /auth/verify-email、auth_tokens |
| TC-MB-079 | メールアドレスの確認 | 異常 | TC-MB-078 と同じ | G06 をメールのリンクから開く | 再登録の案内が表示される | 1.4 / design-screens.md G06 |
| TC-MB-080 | メールアドレスの確認 | 異常 | TC-MB-074 で確認済み（トークンは used_at が入っている） | 同じトークンをもう一度送る | TOKEN_INVALID になる | 1.4 / design.md auth_tokens（used_at） |
| TC-MB-081 | メールアドレスの確認 | 異常 | — | 発行していないランダムな値をトークンとして送る | TOKEN_INVALID になる | 1.4 / design.md 公開用 API POST /auth/verify-email |
| TC-MB-082 | 未確認の申込の削除 | 境界 | 会員P3（PENDING、申込＝2026-11-09 03:59） | 現在＝2026-11-10 04:00、定時処理 pending-cleanup を実行する | P3 の members の行が削除される（24時間1分経過） | 1.4 / design.md 定時処理 pending-cleanup |
| TC-MB-083 | 未確認の申込の削除 | 境界 | 会員P4（PENDING、申込＝2026-11-09 04:01） | 現在＝2026-11-10 04:00、pending-cleanup を実行する | P4 は削除されず PENDING のまま残る（23時間59分経過） | 1.4 / design.md 定時処理 pending-cleanup |
| TC-MB-084 | 未確認の申込の削除 | 境界 | 会員P5（PENDING、申込＝2026-11-09 04:00） | 現在＝2026-11-10 04:00、pending-cleanup を実行する | P5 の members の行が削除される（ちょうど24時間で削除の対象：DT-M1） | 1.4 / design.md 定時処理 pending-cleanup、設計の補足 DT-M1 |
| TC-MB-340 | 未確認の申込の削除（再送あり） | 境界 | 会員P6（PENDING、申込＝2026-11-09 03:00、確認メールの再送＝2026-11-09 05:00） | 現在＝2026-11-10 04:00、pending-cleanup を実行する | P6 は削除されず PENDING のまま（申込からは25時間だが、最後の発行（再送）からは23時間。削除は最後の発行から24時間で判定する：L-8） | 1.4 / design.md 定時処理 pending-cleanup、設計の補足 L-8 |
| TC-MB-085 | 未確認の申込の削除 | 正常 | 会員A（申込 2026-11-01、確認済みの ACTIVE） | 現在＝2026-11-10 04:00、pending-cleanup を実行する | A は削除されない | 1.4 / design.md 定時処理 pending-cleanup（確認しなかった申込だけが対象） |
| TC-MB-086 | 未確認の申込の削除 | 状態遷移 | TC-MB-082 で P3（p3@example.com）が削除された | メールを p3@example.com にして登録 | 受け付けられる（202） | 1.3, 1.4 / design.md 定時処理 pending-cleanup、members |
| TC-MB-343 | 確認メールの再送 | 境界 | TC-MB-071 と同じ（new@example.com は PENDING）。同じ IP | 10:05:00・10:05:10・10:05:20・10:05:30・10:05:40・10:05:50 に、同じ IP から POST /auth/verify-email/resend（{ email: new@example.com }）を送る（6回目を確認） | 1〜5回目は 202、6回目は RATE_LIMITED（429）。再送による new@example.com 宛ての VERIFY_EMAIL は5件だけ作られる（確認メールの再送は同じ IP から1分5回まで：L-27） | 1.4 / design.md 公開用 API POST /auth/verify-email/resend（RATE_LIMITED）、設計の補足 L-27・L-40 |
| TC-MB-395 | 確認メールの再送（回数制限の解除） | 境界 | TC-MB-071 と同じ（new@example.com は PENDING）。同じ IP から 10:05:00・10:05:10・10:05:20・10:05:30・10:05:40 に POST /auth/verify-email/resend（{ email: new@example.com }）を送り、5回とも 202 だった（6回目は送っていない） | 10:05:59（1回目から59秒後）に、同じ IP から同じ再送を送る | RATE_LIMITED（429）。再送による new@example.com 宛ての VERIFY_EMAIL は5件のまま（直近60秒に 10:05:00〜10:05:40 の5回の要求があるため。回数制限は直近60秒の要求の数で判定する：L-40） | 1.4 / design.md 公開用 API POST /auth/verify-email/resend（RATE_LIMITED）、設計の補足 L-27・L-40 |
| TC-MB-396 | 確認メールの再送（回数制限の解除） | 境界 | TC-MB-395 の前提条件と同じ（10:05:59 の再送は送っていない） | 10:06:00（1回目からちょうど60秒後）に、同じ IP から同じ再送を送る | 202 で、再送による new@example.com 宛ての VERIFY_EMAIL が1件増えて6件になる（1回目の 10:05:00 の要求は60秒たったので数えず、直近60秒の要求は 10:05:10〜10:05:40 の4回になるため：L-40） | 1.4 / design.md 公開用 API POST /auth/verify-email/resend、設計の補足 L-27・L-40 |
| TC-MB-402 | 確認メールの再送（断った要求は数えない） | 境界 | TC-MB-395 の後（10:05:59 の6回目の再送は RATE_LIMITED で断られた） | 10:06:00（1回目からちょうど60秒後）に、同じ IP から同じ再送を送る | 202 で、再送による new@example.com 宛ての VERIFY_EMAIL が1件増えて6件になる（直近60秒に受け付けた要求は 10:05:10〜10:05:40 の4回。10:05:59 の断った要求は数えない：L-47。数えると5回で 429 になる） | 1.4 / design.md 公開用 API POST /auth/verify-email/resend、設計の補足 L-40・L-47 |

### 2.7 定期配信メールの同意（記録と取り消し）

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-087 | 配信の同意（登録時） | 正常 | — | 標準入力（配信のチェックなし）で登録し、確認を済ませる | marketing_consents に consented=true の行がなく、同意していない状態として扱われる | 1.5 / design.md marketing_consents（最新の行が現在の状態） |
| TC-MB-088 | 配信の同意（登録時） | 正常 | 現在＝2026-11-10 10:00 | 標準入力のうち「定期配信メールの受信」にチェックを入れて登録 | marketing_consents に consented=true、method=REGISTRATION、recorded_at=2026-11-10 10:00 の行ができる | 1.6 / design.md marketing_consents、design-screens.md G04 |
| TC-MB-089 | 配信の同意（会員情報） | 正常 | 会員Aでログイン（同意なし）。現在＝2026-11-12 15:00 | G18 で「定期配信メールの受信」をオンにして保存（PUT /me/marketing-consent { consented: true }） | consented=true、method=PROFILE、recorded_at=2026-11-12 15:00 の行が追加される | 1.6 / design.md 公開用 API PUT /me/marketing-consent、design-screens.md G18 |
| TC-MB-090 | 配信の同意の取り消し（会員情報） | 正常 | TC-MB-089 の後。現在＝2026-11-13 09:00 | G18 で受信をオフにして保存 | consented=false、method=PROFILE、recorded_at=2026-11-13 09:00 の行が追加される | 1.7 / design.md marketing_consents、design-screens.md G18 |
| TC-MB-091 | 配信の同意の履歴 | 状態遷移 | TC-MB-090 の後 | A の marketing_consents を確認する | TC-MB-089 と TC-MB-090 の2行がどちらも残り、最新の行（consented=false）が現在の状態になっている | 1.6, 1.7 / design.md marketing_consents（追記だけ） |
| TC-MB-092 | 配信停止（リンク） | 正常 | 会員C（同意が最新で true）に届いた定期配信メールの配信停止のリンク。ログインしていない。現在＝2026-11-14 08:00 | リンクから G20 を開き、配信停止を行う（POST /marketing/unsubscribe { token }） | 200 で、C に consented=false、method=UNSUBSCRIBE_LINK、recorded_at=2026-11-14 08:00 の行が追加される | 1.7, 15.7 / design.md 公開用 API POST /marketing/unsubscribe、design-screens.md G20 |
| TC-MB-093 | 配信停止（リンク） | 異常 | TC-MB-092 のリンクの token を1文字書き換えた値 | POST /marketing/unsubscribe に書き換えた token を送る | TOKEN_INVALID で、marketing_consents に行が追加されない | 1.7 / design.md 公開用 API POST /marketing/unsubscribe（署名つきの値） |

### 2.8 会員情報の確認・変更とカードの差し替え

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-094 | 会員情報の確認 | 正常 | 会員Aでログイン | GET /me | A 自身の会員情報（氏名・住所・電話・メール・生年月日・カードのブランドと末尾 4242・配信の同意・言語）が返る | 1.8 / design.md 公開用 API GET /me、design-screens.md G18 |
| TC-MB-095 | 会員情報の確認 | 異常 | ログインしていない | GET /me | UNAUTHENTICATED（401） | 1.8 / design.md 公開用 API GET /me、Error Handling |
| TC-MB-096 | 会員情報の変更 | 正常 | 会員Aでログイン | PATCH /me で住所を「石川県金沢市本町2-2」に変え、GET /me で確認する | 住所が「石川県金沢市本町2-2」になっている | 1.8 / design.md 公開用 API PATCH /me |
| TC-MB-097 | 会員情報の変更 | 異常 | 会員Aでログイン（国＝日本） | PATCH /me で郵便番号を 920000（6桁）にする | VALIDATION_FAILED で、郵便番号は変わらない | 1.8 / design-screens.md G18（G04 と同じ条件） |
| TC-MB-098 | パスワードの変更 | 正常 | 会員Aでログイン | G18 で現在のパスワード Passw0rd12、新しいパスワード Newpass1234 を入れて保存し、ログアウトして Newpass1234 でログインする | ログインできる | 1.8 / design-screens.md G18（現在のパスワードが必要） |
| TC-MB-099 | パスワードの変更 | 異常 | 会員Aでログイン | G18 で現在のパスワードを Wrongpass99、新しいパスワードを Newpass1234 にして保存 | VALIDATION_FAILED（400。項目「現在のパスワード」の誤りとして返る：L-3）で、パスワードは変わらない（Passw0rd12 のままログインできる） | 1.8 / design-screens.md G18、design.md 設計の補足 L-3 |
| TC-MB-100 | カードの差し替え | 正常 | 会員Aでログイン（カード末尾 4242） | PUT /me/card に 5555555555554444・2028/01・TARO A を送る | CardSummary の末尾が 4444 になり、A の member_cards は1件だけである | 1.8 / design.md 公開用 API PUT /me/card、member_cards（1会員1枚） |
| TC-MB-101 | カードの差し替え | 連携 | 会員Aでログイン（カード末尾 4242） | PUT /me/card に 4000000000000002（末尾0002）を送る | PAYMENT_DECLINED（402）で、登録カードは末尾 4242 のまま | 1.8 / design.md 公開用 API PUT /me/card、模擬の決済 |
| TC-MB-102 | カードの差し替え | 連携 | 会員Aでログイン（カード末尾 4242） | PUT /me/card に 4000000000000119（末尾0119）を送る | PAYMENT_GATEWAY_UNAVAILABLE（503）で、登録カードは末尾 4242 のまま | 1.8 / design.md PaymentGateway.registerCard、Error Handling |
| TC-MB-103 | カードの差し替え | 異常 | 会員Aでログイン（カード末尾 4242） | PUT /me/card にカード番号を空にして送る | VALIDATION_FAILED で、登録カードは末尾 4242 のまま（カードのない状態にならない） | 1.8 / brief.md MB-01a |
| TC-MB-104 | カードの削除の手段 | 正常 | 会員Aでログイン | G18 を開く | カードの欄には「カードを変更」だけがあり、削除のボタンがない | 1.8 / design-screens.md G18 |
| TC-MB-105 | カードの削除の手段 | 異常 | 会員Aでログイン | DELETE /me/card を送り、GET /me で確認する | カード（末尾 4242）が登録されたまま（カードを削除する API がない） | 1.8 / design.md 公開用 API（/me/card は PUT だけ）、brief.md MB-01a |
| TC-MB-106 | メールアドレスの変更 | 正常 | 会員Aでログイン。現在＝2026-11-10 10:00 | PATCH /me でメールを a2@example.com に変え、GET /me で確認する | PATCH は 200 で受け付けられ、mail_outbox に to_address=a2@example.com・locale=ja の VERIFY_EMAIL が1件できる。確認が終わるまで変更は反映されず、GET /me のメールは a@example.com のまま（DT-M4） | 1.8, 1.12 / design.md 公開用 API PATCH /me、設計の補足 DT-M4、design-screens.md G18 |
| TC-MB-332 | メールアドレスの変更（確認の後） | 状態遷移 | TC-MB-106 の後。現在＝2026-11-10 10:30 | a2@example.com に届いたトークンを POST /auth/verify-email に送り、GET /me で確認する | 200 で、A のメールが a2@example.com に変わる（members.status は ACTIVE のまま。確認が終わった時点で反映する：DT-M4） | 1.12 / design.md 設計の補足 DT-M4、公開用 API POST /auth/verify-email |
| TC-MB-333 | メールアドレスの変更（確認の前） | 異常 | TC-MB-106 の後（まだ確認していない） | POST /auth/login に a2@example.com と Passw0rd12 を送り、続けて a@example.com と Passw0rd12 を送る | a2@example.com では INVALID_CREDENTIALS（401）でログインできず、a@example.com ではログインできる（確認が終わるまで変更を反映しない：DT-M4） | 1.12 / design.md 設計の補足 DT-M4、公開用 API POST /auth/login |
| TC-MB-334 | メールアドレスの変更（確認の期限） | 境界 | TC-MB-106 で 2026-11-10 10:00 に確認メールを送った | 現在＝2026-11-11 10:00（ちょうど24時間後）、a2@example.com に届いたトークンを送る | TOKEN_INVALID で、A のメールは a@example.com のまま（確認メールの期限は、ちょうど24時間の時刻で無効：DT-M1・DT-M4） | 1.12 / design.md auth_tokens、設計の補足 DT-M1・DT-M4 |

### 2.9 パスワードの再設定（1時間）

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-107 | 再設定の申込 | 連携 | 会員A（preferred_locale=ja）。現在＝2026-11-10 10:00 | G07 で a@example.com を入れて申し込む（POST /auth/password-reset/request） | 202 が返り、mail_outbox に template=PASSWORD_RESET、to_address=a@example.com、locale=ja の行が1件できる | 1.9, 15.1 / design.md 公開用 API、P-15 |
| TC-MB-108 | 再設定の申込 | 異常 | unknown@example.com の会員はいない | POST /auth/password-reset/request に unknown@example.com を送る | TC-MB-107 と同じ 202 と同じ応答本文が返り、mail_outbox に行ができない | 1.9 / design.md 公開用 API（登録の有無にかかわらず同じ応答） |
| TC-MB-109 | 再設定の申込 | 異常 | TC-MB-108 と同じ | G07 で unknown@example.com を入れて申し込む | 「メールを送りました」と表示される | 1.9 / design-screens.md G07 |
| TC-MB-110 | パスワードの再設定 | 境界 | TC-MB-107 で 10:00 にトークンを発行 | 現在＝2026-11-10 10:59、G08 で新しいパスワード Resetpass12 を2回入れて送る | 200 で再設定される | 1.9 / design.md auth_tokens（再設定は1時間） |
| TC-MB-111 | パスワードの再設定 | 状態遷移 | TC-MB-110 の後 | a@example.com と Resetpass12 でログインする | ログインできる | 1.9 / design.md 公開用 API POST /auth/login |
| TC-MB-112 | パスワードの再設定 | 状態遷移 | TC-MB-110 の後 | a@example.com と古いパスワード Passw0rd12 でログインする | INVALID_CREDENTIALS でログインできない | 1.9 / tasks.md 4.3 の完了状態、design.md Error Handling |
| TC-MB-113 | パスワードの再設定 | 境界 | TC-MB-107 で 10:00 にトークンを発行 | 現在＝2026-11-10 11:00（ちょうど1時間後）、トークンで再設定する | TOKEN_INVALID で、パスワードは Passw0rd12 のまま（再設定の期限は、ちょうど1時間の時刻で無効：DT-M1） | 1.9 / design.md auth_tokens、設計の補足 DT-M1 |
| TC-MB-114 | パスワードの再設定 | 境界 | TC-MB-107 で 10:00 にトークンを発行 | 現在＝2026-11-10 11:01（1時間1分後）、トークンで再設定する | TOKEN_INVALID で、パスワードは Passw0rd12 のまま | 1.9 / design.md 公開用 API POST /auth/password-reset/confirm |
| TC-MB-115 | パスワードの再設定 | 異常 | TC-MB-114 と同じ | G08 をメールのリンクから開いて送る | G07（再設定の申込）への案内が表示される | 1.9 / design-screens.md G08 |
| TC-MB-116 | パスワードの再設定 | 異常 | TC-MB-110 で使用済みのトークン | 同じトークンで、もう一度 Another1234 に再設定する | TOKEN_INVALID で、パスワードは Resetpass12 のまま | 1.9 / design.md auth_tokens（used_at） |
| TC-MB-117 | パスワードの再設定 | 境界 | 有効なトークン | 新しいパスワードを Abcdef123（9文字）にして送る | VALIDATION_FAILED で再設定されない | 1.9 / design-screens.md G08（G04 と同じ条件） |
| TC-MB-118 | パスワードの再設定 | 異常 | 有効なトークン | G08 で新しいパスワードを Resetpass12、確認用を Resetpass13 にして送る | VALIDATION_FAILED で再設定されない | 1.9 / design-screens.md G08（2回入力） |
| TC-MB-119 | 再設定の申込 | 境界 | 同じ IP | 10:00:00・10:00:10・10:00:20・10:00:30・10:00:40・10:00:50 に、同じ IP から a@example.com で申込を送る（6回目を確認） | 1〜5回目は 202、6回目は RATE_LIMITED（429）。PASSWORD_RESET のメールは5件だけ作られる（再設定の申込は同じ IP につき1分5回まで：L-7） | 1.9 / design.md 公開用 API（RATE_LIMITED）、設計の補足 L-7・L-40 |
| TC-MB-120 | 再設定の申込 | 異常 | 会員W（WITHDRAWN） | POST /auth/password-reset/request に w@example.com を送る | TC-MB-108 と同じ 202 と同じ応答本文が返り、PASSWORD_RESET のメールは作られない（退会した会員はログインできる状態に戻らない） | 1.9, 1.11 / brief.md DR-02 |
| TC-MB-397 | 再設定の申込（回数制限の解除） | 境界 | 同じ IP から 10:00:00・10:00:10・10:00:20・10:00:30・10:00:40 に a@example.com で申込（POST /auth/password-reset/request）を送り、5回とも 202 だった（6回目は送っていない） | 10:00:59（1回目から59秒後）に、同じ IP から a@example.com で申込を送る | RATE_LIMITED（429）。PASSWORD_RESET のメールは5件のまま（直近60秒に 10:00:00〜10:00:40 の5回の要求があるため。回数制限は直近60秒の要求の数で判定する：L-40） | 1.9 / design.md 公開用 API（RATE_LIMITED）、設計の補足 L-7・L-40 |
| TC-MB-398 | 再設定の申込（回数制限の解除） | 境界 | TC-MB-397 の前提条件と同じ（10:00:59 の申込は送っていない） | 10:01:00（1回目からちょうど60秒後）に、同じ IP から a@example.com で申込を送る | 202 で、a@example.com 宛ての PASSWORD_RESET のメールが1件増えて6件になる（1回目の 10:00:00 の要求は60秒たったので数えず、直近60秒の要求は 10:00:10〜10:00:40 の4回になるため：L-40） | 1.9 / design.md 公開用 API POST /auth/password-reset/request、設計の補足 L-7・L-40 |

### 2.10 会員のログインとセッション

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-121 | 会員のログイン | 正常 | 会員A | POST /auth/login に a@example.com と Passw0rd12 を送る | 200 で MemberSummary が返り、セッションの Cookie が設定される | 1.4 / design.md 公開用 API POST /auth/login、ADR-04 |
| TC-MB-122 | 会員のセッション（Cookie） | 正常 | TC-MB-121 と同じ | 応答の Set-Cookie を確認する | HttpOnly・Secure・SameSite=Lax が付いている | セキュリティ / design.md Security Considerations（会員は Lax） |
| TC-MB-123 | 会員のセッション（ID の作り直し） | 正常 | 会員Aがログイン済みで、セッション ID＝X の Cookie を持つ | Cookie X を付けたまま、もう一度ログインする | 応答で設定されるセッション ID が X と異なる | セキュリティ / design.md Security Considerations（ログインの成功時にセッション ID を作り直す） |
| TC-MB-124 | 会員のログイン | 異常 | 会員A | G03 で a@example.com と Wrongpass99 でログイン | INVALID_CREDENTIALS（401）で「メールアドレスまたはパスワードが違います」と表示される | 1.4 / design.md Error Handling、design-screens.md G03 |
| TC-MB-125 | 会員のログイン | 異常 | unknown@example.com の会員はいない | G03 で unknown@example.com と Passw0rd12 でログイン | TC-MB-124 と同じ INVALID_CREDENTIALS と同じ文言になる（どちらが誤りかを示さない） | 1.4 / design.md Error Handling |
| TC-MB-126 | ログインの回数制限 | 境界 | 会員A、IP＝IP1 | 10:00:00・10:00:10・10:00:20・10:00:30・10:00:40 に、IP1 から a@example.com と誤ったパスワードでログインする（5回目を確認） | 5回目は INVALID_CREDENTIALS が返る（RATE_LIMITED ではない） | セキュリティ / design.md Security Considerations（同じ IP と ID につき1分5回まで） |
| TC-MB-127 | ログインの回数制限 | 境界 | TC-MB-126 の後 | 10:00:50 に IP1 から a@example.com と誤ったパスワードで6回目のログイン | RATE_LIMITED（429） | セキュリティ / design.md Security Considerations、Error Handling |
| TC-MB-128 | ログインの回数制限 | 境界 | TC-MB-126 の後 | 10:00:50 に IP1 から a@example.com と正しいパスワード Passw0rd12 で6回目のログイン | RATE_LIMITED（429）で、セッションが作られない | セキュリティ / design.md Security Considerations |
| TC-MB-129 | ログインの回数制限 | 境界 | 会員A、IP1 | 10:00:00〜10:00:40 に正しいパスワードで5回ログインに成功し、10:00:50 に6回目を正しいパスワードで送る | 200 でログインできる（成功したログインは回数に数えない：L-7） | セキュリティ / design.md Security Considerations、設計の補足 L-7 |
| TC-MB-130 | ログインの回数制限 | 異常 | TC-MB-126 の後 | 10:00:50 に IP1 から b@example.com（別の ID）と正しいパスワードでログイン | 制限されずに 200 でログインできる | セキュリティ / design.md Security Considerations（IP と ID の組ごと） |
| TC-MB-131 | ログインの回数制限 | 異常 | TC-MB-126 の後 | 10:00:50 に IP2（別の IP）から a@example.com と正しいパスワードでログイン | 制限されずに 200 でログインできる | セキュリティ / design.md Security Considerations |
| TC-MB-132 | ログインの回数制限 | 境界 | TC-MB-126 の後（6回目は送っていない。最後の失敗は 10:00:40） | 10:01:01（1回目から61秒後）に IP1 から a@example.com と正しいパスワードでログイン | RATE_LIMITED（429）。制限は最後の失敗（10:00:40）から60秒の 10:01:40 まで続き、1回目から60秒を過ぎても解除されない（L-7） | セキュリティ / design.md Security Considerations、設計の補足 L-7 |
| TC-MB-337 | ログインの回数制限 | 境界 | TC-MB-126 の後（6回目は送っていない。最後の失敗は 10:00:40） | 10:01:41（最後の失敗から61秒後）に IP1 から a@example.com と正しいパスワードでログイン | 制限が解除されていて、200 でログインできる（最後の失敗から60秒で解除する：L-7） | セキュリティ / design.md Security Considerations、設計の補足 L-7 |
| TC-MB-133 | 会員のログアウト | 状態遷移 | 会員Aがログイン済み（Cookie X） | POST /auth/logout の後に、Cookie X を付けて GET /me | ログアウトは 204、その後の GET /me は UNAUTHENTICATED（401） | セキュリティ / design.md 公開用 API POST /auth/logout、ADR-04 |
| TC-MB-134 | 会員のセッションの期限 | 境界 | 会員Aの最後の操作＝2026-11-03 10:00 | 現在＝2026-11-10 09:59（6日23時間59分後）、同じ Cookie で GET /me | 200 で A の会員情報が返る | セキュリティ / design.md Security Considerations（会員は最後の操作から7日） |
| TC-MB-135 | 会員のセッションの期限 | 境界 | 会員Aの最後の操作＝2026-11-03 10:00 | 現在＝2026-11-10 10:00（ちょうど7日後）、GET /me | UNAUTHENTICATED（401）（会員のセッションは、ちょうど7日の時刻で無効：DT-M1） | セキュリティ / design.md Security Considerations、sessions、設計の補足 DT-M1 |
| TC-MB-136 | 会員のセッションの期限 | 境界 | 会員Aの最後の操作＝2026-11-03 10:00 | 現在＝2026-11-10 10:01（7日1分後）、GET /me | UNAUTHENTICATED（401） | セキュリティ / design.md Security Considerations、Error Handling |
| TC-MB-137 | 会員のセッションの延長 | 状態遷移 | 会員Aが 2026-11-03 10:00 と 2026-11-08 10:00 に操作した | 現在＝2026-11-14 10:00（最後の操作から6日後、最初の操作から11日後）、GET /me | 200 で A の会員情報が返る（最後の操作から数える） | セキュリティ / design.md Security Considerations、sessions.last_seen_at |
| TC-MB-138 | セッション切れの画面 | 状態遷移 | 会員Aのセッションが失効している | G13 を開き、G03 でログインする | G03 に移り、ログインの後に G13 に戻る | セキュリティ / design.md Error Handling（UNAUTHENTICATED）、design-screens.md 共通の約束 |
| TC-MB-139 | 他サイトからの要求の拒否 | 異常 | 会員Aがログイン済み（同意なし） | 有効な Cookie を付け、独自のヘッダーを付けずに PUT /me/marketing-consent { consented: true } を送る | FORBIDDEN（403）で拒否され、marketing_consents に行が追加されない（独自のヘッダー X-Requested-With: XMLHttpRequest がない：L-3） | 1.6 / design.md Security Considerations（状態を変える要求には独自のヘッダーを必須）、設計の補足 L-3 |
| TC-MB-344 | 会員のログイン（画面） | 異常 | 未ログイン | G03 でメールアドレスを「a@」、パスワードを Passw0rd12 にしてログインを押す | メールアドレスの項目の下に赤字で理由が表示され（項目の誤り）、ログインできない（セッションが作られない） | 1.4 / design-screens.md G03（メールの形式）、共通の約束（入力の誤り） |
| TC-MB-399 | 会員のログイン（API） | 異常 | 未ログイン | 画面を通さずに、POST /auth/login に { email: "a@", password: "Passw0rd12" } を送る | VALIDATION_FAILED（400。メールアドレスの項目の誤りとして返る）で、INVALID_CREDENTIALS ではない。セッションは作られない（応答でセッションの Cookie が設定されず、sessions に行ができない）（ログインでメールアドレスの形式が誤っていれば VALIDATION_FAILED：L-43。ログインの失敗の回数（L-7）には数えない：L-48） | 1.4 / design.md 公開用 API POST /auth/login（VALIDATION_FAILED）、Error Handling、設計の補足 L-43・L-48 |

### 2.11 退会

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-140 | 退会の画面 | 正常 | 会員Aでログイン | G19 を開く | 退会で削除される情報（カード・パスワード・配信の同意）と、名簿は法令のため最終宿泊日から3年保存されることが表示される | 1.11 / design-screens.md G19 |
| TC-MB-141 | 退会 | 正常 | 会員A：予約は R-A0（CHECKED_OUT、名簿2名）だけ、配信の同意あり | G19 で Passw0rd12 を入れて退会（POST /me/withdraw） | 204 で、members.status=WITHDRAWN、withdrawn_at=2026-11-10 10:00 になる | 1.11 / design.md 公開用 API POST /me/withdraw |
| TC-MB-142 | 退会（セッション） | 状態遷移 | TC-MB-141 の後 | 退会の前から持っていた Cookie で GET /me | UNAUTHENTICATED（401） | 1.11 / research.md ADR-04、traceability.md 1.11（sessions） |
| TC-MB-143 | 退会（ログイン） | 状態遷移 | TC-MB-141 の後 | a@example.com と Passw0rd12 でログインする | ログインできず、セッションが作られない | 1.11 / brief.md DR-02 |
| TC-MB-144 | 退会（カード） | 連携 | TC-MB-141 の後 | member_cards と模擬の決済の呼び出しを確認する | A の member_cards の行が削除され、PaymentGateway.deleteCard が A のトークンで呼ばれている | 1.11 / design.md PaymentGateway.deleteCard、traceability.md 1.11 |
| TC-MB-145 | 退会（パスワード） | 正常 | TC-MB-141 の後 | members.password_hash を確認する | パスワードのハッシュが削除されている | 1.11 / brief.md DR-02 |
| TC-MB-146 | 退会（配信の同意） | 正常 | TC-MB-141 の後 | marketing_consents を確認する | A の定期配信の同意が削除されている | 1.11 / brief.md DR-02、traceability.md 1.11（marketing_consents） |
| TC-MB-147 | 退会（残す情報） | 正常 | TC-MB-141 の後 | reservations と roster_entries を確認する | R-A0 の予約と名簿2名分が残っている | 1.11, 19.6 / brief.md DR-02、design.md P-16 手順3 |
| TC-MB-149 | 退会の制限 | 異常 | 会員A：R-A1（CONFIRMED、到着 2026-11-20） | POST /me/withdraw に Passw0rd12 を送る | HAS_ACTIVE_RESERVATION（422）で、status は ACTIVE のまま | 1.11, 1.13 / brief.md DR-02a、design.md Error Handling |
| TC-MB-150 | 退会の制限 | 異常 | TC-MB-149 と同じ | G19 で退会する | 「今後の予約があるため退会できません。先にキャンセルしてください」と表示される | 1.11, 1.13 / design-screens.md G19 |
| TC-MB-151 | 退会の制限 | 異常 | 会員A：R-A2（CHECKED_IN、滞在中） | POST /me/withdraw に Passw0rd12 を送る | HAS_ACTIVE_RESERVATION（422）で退会されない | 1.11, 1.13 / brief.md DR-02a（滞在中） |
| TC-MB-152 | 退会の制限 | 異常 | 会員A：R-A3（PENDING_PAYMENT、hold_expires_at=2026-11-10 10:10） | 現在＝2026-11-10 10:00、POST /me/withdraw | HAS_ACTIVE_RESERVATION（422）で退会されない | 1.11, 1.13 / brief.md DR-02a（決済待ち） |
| TC-MB-153 | 退会の制限 | 境界 | 会員A：R-A4（PENDING_PAYMENT、hold_expires_at=2026-11-10 09:55。hold-expiry がまだ処理していない） | 現在＝2026-11-10 10:00、POST /me/withdraw | 204 で退会できる。期限を過ぎた R-A4 は、退会の判定の前に時間切れの処理と同じ手順で解除され（EXPIRED になる）、決済待ちに数えない（L-6） | 1.11, 1.13 / brief.md DR-02a、research.md ADR-09、design.md 設計の補足 L-6 |
| TC-MB-154 | 退会の制限 | 状態遷移 | TC-MB-149 の状態から、A が R-A1 をキャンセルして CANCELLED にした（2026-11-10 09:50 のキャンセル。キャンセル料の請求の失敗はなく、未回収の額はない） | POST /me/withdraw に Passw0rd12 を送る | 204 で退会できる | 1.11, 1.13 / brief.md DR-02a（キャンセルするまで退会できない） |
| TC-MB-155 | 退会の制限 | 正常 | 会員A：予約は R-A5（NO_SHOW。ノーショー料の請求は成功していて、未回収の額はない）だけ | POST /me/withdraw に Passw0rd12 を送る | 204 で退会できる | 1.11, 1.13 / brief.md DR-02a（対象は確定済み・滞在中・決済待ち） |
| TC-MB-156 | 退会の制限 | 正常 | 会員A：予約は R-A6（EXPIRED）だけ | POST /me/withdraw に Passw0rd12 を送る | 204 で退会できる | 1.11, 1.13 / brief.md DR-02a |
| TC-MB-157 | 退会 | 異常 | 会員A：予約なし | POST /me/withdraw に Wrongpass99 を送る | VALIDATION_FAILED（400。パスワードの項目の誤りとして返る：L-3）で退会されず、status は ACTIVE のまま | 1.11 / design.md 公開用 API POST /me/withdraw（{ password }）、設計の補足 L-3、design-screens.md G19 |
| TC-MB-345 | 退会の制限（未回収） | 異常 | 会員A：予約は R-A7 だけ。R-A7 は 04-change-cancel.md の予約A-現地 と同じ内容（スタンダード キング1室・大人2名・3泊（夜 11/16 月・11/17 火・11/18 水）・現地払い・2026-10-01 確定）。A の登録カードは末尾 0341 のカード（登録は成功し決済だけを断る：L-16）に差し替え済み。2026-11-15 10:00（無料の期限 11/14 15:00 の後）に全体をキャンセルして CANCELLED。キャンセル料は1泊目 11/16 の ROOM：合算の率 −500（人数割5%）−1000（連泊割10%）＝−1500bp、単価 ⌊15,000×8,500×11÷10,000,000⌋×100＝⌊140.25⌋×100＝14,000円、14,000×2名＝28,000円。その FEE_CHARGE 28,000円が FAILED で、未回収 28,000円（TC-CH-116 と同じ）。現在＝2026-11-20 10:00 | POST /me/withdraw に Passw0rd12 を送る | HAS_UNPAID_BALANCE（422）で退会されず、members.status は ACTIVE のまま（カード・パスワードも削除されない） | 1.13 / design.md 公開用 API POST /me/withdraw、Error Handling（HAS_UNPAID_BALANCE）、payments（未回収）、設計の補足 DT-M19 |
| TC-MB-346 | 退会の制限（未回収） | 異常 | TC-MB-345 と同じ | G19 で Passw0rd12 を入れて退会する | 未回収の額 28,000円と振込先（hotel_settings の銀行名・支店・口座種別・口座番号・名義）が表示され、支払いが案内される。退会されない | 1.13 / design-screens.md G19、design.md Error Handling（HAS_UNPAID_BALANCE）、hotel_settings、設計の補足 DT-M19 |
| TC-MB-347 | 退会の制限（未回収） | 異常 | 会員A：予約は R-A8 だけ。R-A8 は TC-CH-183 と同じ（予約A-現地 と同じ内容、A の登録カードは末尾 0341。11/16 にチェックインせず 2026-11-17 1:00 に NO_SHOW。ノーショー料は1泊目 11/16 の ROOM 14,000×2名＝28,000円（単価の計算は TC-MB-345）で、その FEE_CHARGE が FAILED、未回収 28,000円）。現在＝2026-11-20 10:00 | POST /me/withdraw に Passw0rd12 を送る | HAS_UNPAID_BALANCE（422）で退会されず、members.status は ACTIVE のまま（ノーショーの予約でも、未回収の額があれば退会できない。未回収がないノーショーは TC-MB-155） | 1.13 / design.md payments（取消・ノーショー後に残高が正なら未回収）、Error Handling、設計の補足 DT-M19 |
| TC-MB-348 | 退会の制限（未回収） | 境界 | TC-MB-345 の状態から、2026-11-20 11:00 に S101 が F09 で R-A7 に 27,999円・振込（BANK_TRANSFER）の入金を記録した（残高 28,000−27,999＝1円） | 現在＝2026-11-20 12:00、POST /me/withdraw に Passw0rd12 を送る | HAS_UNPAID_BALANCE（422）で退会されず、members.status は ACTIVE のまま（未回収の額 1円が残っている） | 1.13 / design.md P-06「請求が断られた場合」、payments（未回収）、設計の補足 DT-M19 |
| TC-MB-349 | 退会の制限（未回収） | 状態遷移 | TC-MB-345 の状態から、2026-11-20 11:00 に S101 が F09 で R-A7 に 28,000円・振込（BANK_TRANSFER）の入金を記録した（残高 28,000−28,000＝0円。未回収の一覧から消える：8.24） | 現在＝2026-11-20 12:00、POST /me/withdraw に Passw0rd12 を送る | 204 で、members.status=WITHDRAWN、withdrawn_at=2026-11-20 12:00 になる | 1.13, 1.11, 8.24 / design.md P-06「請求が断られた場合」、公開用 API POST /me/withdraw、設計の補足 DT-M19 |
| TC-MB-392 | 退会のエラーの順番（パスワードの誤りと今後の予約） | 異常 | 会員A：R-A1（CONFIRMED、到着 2026-11-20）。未回収の額はない | POST /me/withdraw に Wrongpass99 を送る | VALIDATION_FAILED（400。パスワードの項目の誤りとして返る：L-3）で、HAS_ACTIVE_RESERVATION ではない。退会されず、members.status は ACTIVE のまま（判定の順番は、パスワードの誤り → 今後の予約 → 未回収：DT-M37） | 1.11, 1.13 / design.md 公開用 API POST /me/withdraw、Error Handling（判定の順番）、設計の補足 DT-M37・L-3 |
| TC-MB-393 | 退会のエラーの順番（今後の予約と未回収） | 異常 | 会員A：TC-MB-345 と同じ R-A7（CANCELLED、キャンセル料 28,000円（11/16 の ROOM：単価 ⌊15,000×8,500×11÷10,000,000⌋×100＝14,000円 × 2名）の FEE_CHARGE が FAILED で、未回収 28,000円。登録カードは末尾 0341）に加えて、R-A11（CONFIRMED、現地払い、到着 2026-11-25、未回収の額はない）を持つ。現在＝2026-11-20 10:00 | POST /me/withdraw に Passw0rd12 を送る | HAS_ACTIVE_RESERVATION（422）で、HAS_UNPAID_BALANCE ではない。退会されず、members.status は ACTIVE のまま（カード・パスワードも削除されない）（今後の予約の判定を未回収の判定より先に行う：DT-M37） | 1.11, 1.13 / design.md 公開用 API POST /me/withdraw、Error Handling（判定の順番）、設計の補足 DT-M37 |
| TC-MB-394 | 退会のエラーの順番（確定済みの予約の未回収） | 異常 | 会員A：予約は R-A10 だけ。R-A10 は 04-change-cancel.md の予約C-現地 と同じ内容（スタンダード キング1室・大人2名・4泊（夜 11/15 日・11/16 月・11/17 火・11/18 水）・現地払い・2026-10-01 確定）。A の登録カードは末尾 0341 のカード（登録は成功し決済だけを断る：L-16）に差し替え済み。2026-11-14 10:00（無料の期限 11/13 15:00 の後）に A が G15 で泊数を2泊に減らす変更を確定し（TC-CH-248 と同じ）、キャンセル料（減らした最初の夜 11/17 の ROOM：合算の率 −500（人数割5%）−1000（連泊割10%）＝−1500bp、単価 ⌊15,000×8,500×11÷10,000,000⌋×100＝⌊140.25⌋×100＝14,000円、14,000×2名＝28,000円）の FEE_CHARGE 28,000円が FAILED で、未回収 28,000円。R-A10 は CONFIRMED のまま（到着 11/15）。現在＝2026-11-14 11:00 | POST /me/withdraw に Passw0rd12 を送る | HAS_ACTIVE_RESERVATION（422）で、HAS_UNPAID_BALANCE ではない。退会されず、members.status は ACTIVE のまま（カード・パスワードも削除されない）（現地払いの変更による未回収がある確定済みの予約は「今後の予約」として扱う：DT-M37、DT-M17） | 1.11, 1.13 / design.md 公開用 API POST /me/withdraw、Error Handling（判定の順番）、payments（未回収）、設計の補足 DT-M37・DT-M17 |

### 2.12 他人の会員情報・予約を表示しない

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-158 | 予約詳細 | 異常 | 会員Aでログイン、会員Bの予約 R-B1 | GET /reservations/{R-B1 の id} | NOT_FOUND（404）で、R-B1 の内容が返らない | 1.10 / design.md 公開用 API、Security Considerations（他人のデータ） |
| TC-MB-159 | 予約詳細 | 異常 | 会員Aでログイン | GET /reservations/{存在しない id} | TC-MB-158 と同じ NOT_FOUND（404）になる（他人の予約と区別できない） | 1.10 / design.md Error Handling（存在しない、または他人の予約） |
| TC-MB-160 | 予約一覧 | 異常 | 会員Aでログイン、A は R-A1、B は R-B1 を持つ | GET /reservations | R-A1 だけが返り、R-B1 は含まれない | 1.10 / design.md Security Considerations（会員 ID で絞り込む） |
| TC-MB-161 | 予約の変更 | 異常 | 会員Aでログイン | POST /reservations/{R-B1}/changes/quote | NOT_FOUND（404） | 1.10 / design.md Security Considerations |
| TC-MB-162 | キャンセル | 異常 | 会員Aでログイン | POST /reservations/{R-B1}/cancel/quote | NOT_FOUND（404） | 1.10 / design.md Security Considerations |
| TC-MB-163 | キャンセル | 異常 | 会員Aでログイン | POST /reservations/{R-B1}/cancel を任意の quoteToken で送る | NOT_FOUND（404）で、R-B1 は CONFIRMED のまま | 1.10 / design.md Security Considerations |
| TC-MB-164 | 名簿の入力 | 異常 | 会員Aでログイン | PUT /reservations/{R-B1}/roster に名簿2名分を送る | NOT_FOUND（404）で、R-B1 の名簿は変わらない | 1.10 / design.md Security Considerations |
| TC-MB-165 | 会員情報 | 異常 | 会員Aでログイン | GET /me?memberId={B の id} | A の会員情報が返る（B の情報は返らない） | 1.10 / design.md Security Considerations（必ずセッションの会員 ID で絞り込む） |
| TC-MB-166 | 予約詳細の画面 | 異常 | 会員Aでログイン | G14 の URL に R-B1 の id を入れて開く | R-B1 の内容は表示されず、一覧へ戻る案内が表示される | 1.10 / design.md Error Handling（NOT_FOUND） |
| TC-MB-350 | 予約の確定 | 異常 | 会員Aでログイン。会員B が決済待ちの予約 R-B2（PENDING_PAYMENT、事前決済、hold_expires_at=2026-11-10 10:10）を持つ | 現在＝2026-11-10 10:00、POST /reservations/{R-B2 の id}/confirm に新しい idempotencyKey を付けて送る | NOT_FOUND（404）。R-B2 は PENDING_PAYMENT のまま、payments に行ができず（A の登録カードでも B のカードでも決済されない）、RESERVATION_CONFIRMED・PAYMENT_COMPLETED は作られない | 1.10 / design.md 公開用 API POST /reservations/{id}/confirm、Security Considerations（会員の API はセッションの会員 ID で絞り込み、他人の予約は NOT_FOUND） |
| TC-MB-351 | 予約の変更 | 異常 | 会員Aでログイン、会員Bの予約 R-B1（CONFIRMED） | POST /reservations/{R-B1 の id}/changes に、泊数を1泊増やす ChangeRequest と任意の quoteToken を送る | NOT_FOUND（404）。R-B1 は変わらない（明細・room_nights・version が同じ）。RESERVATION_CHANGED は作られない | 1.10 / design.md 公開用 API POST /reservations/{id}/changes、Security Considerations |

### 2.13 スタッフのログイン

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-167 | スタッフのログイン | 正常 | S101（FRONT） | POST /auth/login（社内用）に S101 と Staff0pass1 を送る | 成功し、役割として FRONT が返る | 2.1 / design.md 社内用 API POST /auth/login、staff |
| TC-MB-168 | スタッフのログイン | 正常 | S201（CLEANER） | S201 と Staff0pass1 でログイン | 成功し、役割として CLEANER が返る | 2.1 / design.md 社内用 API POST /auth/login |
| TC-MB-169 | スタッフのログイン | 正常 | S001（ADMIN） | S001 と Staff0pass1 でログイン | 成功し、役割として ADMIN が返る | 2.1 / design.md 社内用 API POST /auth/login |
| TC-MB-170 | スタッフのログイン（画面） | 正常 | S101 | フロントアプリの F01 でログイン | F02（予約状況チャート）に移る | 2.1, 2.2 / design-screens.md F01 |
| TC-MB-171 | スタッフのログイン（画面） | 正常 | S201 | 清掃アプリの C01 でログイン | C02（清掃状況一覧）に移る | 2.1, 2.2 / design-screens.md C01 |
| TC-MB-172 | スタッフのログイン（画面） | 異常 | S201 | フロントアプリの F01 でログイン | 「この画面を使う権限がありません」と表示され、F02 は表示されない | 2.2, 2.4 / design-screens.md F01・C01 |
| TC-MB-173 | スタッフのログイン（画面） | 正常 | S101 | 清掃アプリの C01 でログイン | C02 に移る（フロントは清掃状況画面も使える） | 2.2 / design-screens.md C01、brief.md RL-01 |
| TC-MB-174 | スタッフのログイン | 異常 | S101 | S101 と Wrongpass99 でログイン | INVALID_CREDENTIALS（401）でセッションが作られない | 2.1 / design.md 社内用 API、Error Handling |
| TC-MB-175 | スタッフのログイン | 異常 | S999 は存在しない | S999 と Staff0pass1 でログイン | TC-MB-174 と同じ INVALID_CREDENTIALS と同じ文言になる | 2.1 / design.md Error Handling（どちらが誤りかは示さない） |
| TC-MB-176 | スタッフのログインの回数制限 | 境界 | 同じ IP から S101 に誤ったパスワードで 10:00:00〜10:00:40 に5回送った | 10:00:50 に6回目を送る | RATE_LIMITED（429） | 2.1 / design.md Security Considerations（1分5回まで） |
| TC-MB-177 | スタッフのセッション（Cookie） | 正常 | TC-MB-167 と同じ | 応答の Set-Cookie を確認する | HttpOnly・Secure・SameSite=Strict が付いている | 2.1 / design.md Security Considerations（スタッフは Strict） |
| TC-MB-178 | スタッフのセッションの期限 | 境界 | S101 の最後の操作＝2026-11-09 22:01 | 現在＝2026-11-10 10:00（11時間59分後）、GET /chart | 200 が返る | 2.1 / design.md Security Considerations（スタッフは12時間） |
| TC-MB-179 | スタッフのセッションの期限 | 境界 | S101 の最後の操作＝2026-11-09 22:00 | 現在＝2026-11-10 10:00（ちょうど12時間後）、GET /chart | UNAUTHENTICATED（401）（スタッフのセッションは、ちょうど12時間の時刻で無効：DT-M1） | 2.1 / design.md Security Considerations、sessions、設計の補足 DT-M1 |
| TC-MB-180 | スタッフのセッションの期限 | 境界 | S101 の最後の操作＝2026-11-09 21:59 | 現在＝2026-11-10 10:00（12時間1分後）、GET /chart | UNAUTHENTICATED（401） | 2.1 / design.md Security Considerations、Error Handling |
| TC-MB-181 | 停止中のスタッフ | 異常 | S102（FRONT、staff.is_active=false） | S102 と正しいパスワードでログイン | INVALID_CREDENTIALS（401）で、存在しない ID（TC-MB-175）と同じ応答・同じ文言になり、セッションが作られない（L-9） | 2.1 / design.md staff（is_active）、設計の補足 L-9・L-28 |
| TC-MB-352 | スタッフの停止 | 状態遷移 | S101 がログイン済み（Cookie Y）、S001 もログイン済み（Cookie Z） | 結合テストから StaffService.suspend を S101 に対して呼び、続けて Cookie Y を付けて GET /chart、Cookie Z を付けて GET /chart を送る | S101 の staff.is_active が false になり、同じトランザクションで sessions から S101 の行が消える。Cookie Y の GET /chart は UNAUTHENTICATED（401）。Cookie Z の GET /chart は 200（停止したスタッフ以外のセッションは消えない）。停止の後のログインは TC-MB-181 のとおり INVALID_CREDENTIALS | 2.1 / design.md 設計の補足 L-9・L-28（StaffService.suspend）、sessions |
| TC-MB-353 | スタッフのログイン（画面） | 異常 | — | フロントアプリの F01 で、スタッフ番号を空、パスワードを Staff0pass1 にしてログインを押す | スタッフ番号の項目の下に赤字で理由が表示され（項目の誤り）、セッションが作られず、F02 に移らない | 2.1 / design-screens.md F01・C01（スタッフ番号は必須）、共通の約束（入力の誤り） |
| TC-MB-354 | スタッフのログイン（画面） | 異常 | — | フロントアプリの F01 で、スタッフ番号を S101、パスワードを空にしてログインを押す | パスワードの項目の下に赤字で理由が表示され、セッションが作られず、F02 に移らない | 2.1 / design-screens.md F01・C01（パスワードは必須） |
| TC-MB-355 | スタッフのログイン（画面） | 異常 | — | 清掃アプリの C01 で、スタッフ番号を空、パスワードを Staff0pass1 にしてログインを押す | スタッフ番号の項目の下に赤字で理由が表示され、セッションが作られず、C02 に移らない | 2.1 / design-screens.md F01・C01 |
| TC-MB-356 | スタッフのログイン（画面） | 異常 | — | 清掃アプリの C01 で、スタッフ番号を S201、パスワードを空にしてログインを押す | パスワードの項目の下に赤字で理由が表示され、セッションが作られず、C02 に移らない | 2.1 / design-screens.md F01・C01 |

### 2.14 役割ごとに使える画面と操作

TC-MB-357〜372 は、design.md 社内用 API の表で役割が FRONT の API のうち、ほかのケース（TC-MB-183・188〜191、TC-RS-221、TC-CH-066・146、TC-OP-021・132・264、TC-IT-057）で清掃員の FORBIDDEN を確かめていないものを、1つの API につき1件ずつ確かめる。清掃員 S201 でログインし、状態を変える要求には独自のヘッダー X-Requested-With: XMLHttpRequest を付ける（ヘッダーがないことによる FORBIDDEN（L-3）と区別するため）。役割の確認（RolesGuard）は要求の内容の検証より先に行うので、要求の内容が正しいかどうかに関係なく FORBIDDEN になる。「操作履歴も増えない」は、audit_logs の行数が要求の前と変わらないことを指す（失敗した操作は記録しない：TC-MB-219）。

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-182 | 権限（清掃員） | 正常 | S201 でログイン | GET /rooms/status-board?date=2026-11-10 | 200 が返る | 2.2 / design.md 社内用 API（CLEANER） |
| TC-MB-183 | 権限（清掃員） | 異常 | S201 でログイン | GET /chart?from=2026-11-10&to=2026-11-16 | FORBIDDEN（403） | 2.2, 2.4 / design.md 社内用 API（FRONT）、RolesGuard |
| TC-MB-184 | 権限（フロント） | 正常 | S101 でログイン | GET /chart?from=2026-11-10&to=2026-11-16 | 200 が返る | 2.2 / design.md 社内用 API |
| TC-MB-185 | 権限（フロント） | 正常 | S101 でログイン | GET /rooms/status-board?date=2026-11-10 | 200 が返る（その役割以上） | 2.2 / design.md 社内用 API（役割の欄は「その役割以上」） |
| TC-MB-186 | 権限（管理者） | 正常 | S001 でログイン | GET /chart?from=2026-11-10&to=2026-11-16 | 200 が返る | 2.2 / design.md 社内用 API |
| TC-MB-187 | 権限（管理者） | 正常 | S001 でログイン | GET /rooms/status-board?date=2026-11-10 | 200 が返る | 2.2 / design.md 社内用 API |
| TC-MB-188 | 権限（清掃員） | 異常 | S201 でログイン、601号室 | POST /rooms/{601}/out-of-order { startDate: 2026-11-10, endDate: 2026-11-12 } | FORBIDDEN（403）で、out_of_order_periods に行ができない | 2.4 / design.md 社内用 API、RolesGuard |
| TC-MB-189 | 権限（清掃員） | 異常 | S201 でログイン | POST /special-surcharges { startDate: 2026-12-29, endDate: 2027-01-03, rateBp: 3000 } | FORBIDDEN（403）で、special_surcharge_periods に行ができない | 2.4 / design.md 社内用 API |
| TC-MB-190 | 権限（清掃員） | 異常 | S201 でログイン、R-B1（CONFIRMED） | POST /reservations/{R-B1}/check-in | FORBIDDEN（403）で、R-B1 は CONFIRMED のまま | 2.4 / design.md 社内用 API |
| TC-MB-191 | 権限（清掃員） | 異常 | S201 でログイン | GET /members?query=山田 | FORBIDDEN（403）で、会員の情報が返らない | 2.3, 2.4 / design.md 社内用 API（FRONT） |
| TC-MB-192 | 権限（画面） | 異常 | S201 がフロントアプリにログインしている状態 | F02 の URL を直接開く | 「権限がありません」と表示され、チャートが表示されない | 2.4 / design.md Error Handling（FORBIDDEN） |
| TC-MB-193 | 未ログイン | 異常 | ログインしていない | GET /chart | UNAUTHENTICATED（401）（FORBIDDEN ではない） | 2.4 / design.md Error Handling |
| TC-MB-194 | 管理者だけの操作 | 正常 | S101 でログイン、R-B1 | F06 と F09 を開く | 返金・キャンセル料の免除・料金の手動変更の操作が表示されない（F09 の種類「払い戻し」は、払い過ぎのときに現地での払い戻しを記録するもの（11.12）で、この返金ではない。R-B1 は払い過ぎではないので「払い戻し」も選べない） | 2.5 / design-screens.md F06・F09・A06 |
| TC-MB-195 | 管理者だけの操作 | 異常 | S101 でログイン | 返金・キャンセル料の免除・料金の手動変更の API を呼ぶ | 該当する API がなく 404 になる（MVP には返金・キャンセル料の免除・料金の手動変更の操作がない。TC-MB-194 と合わせて 2.5 を確かめる） | 2.5 / traceability.md 2.5（RolesGuard） |
| TC-MB-196 | 管理者だけの操作 | 正常 | S001 でログイン | 返金・キャンセル料の免除・料金の手動変更の API を呼ぶ | MVP では確かめない（管理者に許可することは、後のフェーズの管理者メニューのテストで確かめる） | 2.5 / traceability.md 2.5 |
| TC-MB-357 | 権限（清掃員：入金・払い戻し） | 異常 | S201 でログイン、現地払いの予約 R-C1（残高 20,000円。TC-MB-217 と同じ） | 社内用 API の POST /reservations/{R-C1 の id}/payments に { direction: RECEIPT, amount: 20000, method: CASH } を送る | FORBIDDEN（403）。payments に行ができず、R-C1 の残高は 20,000円のまま。PAYMENT_COMPLETED は作られず、操作履歴も増えない | 2.4 / design.md 社内用 API（/payments は FRONT）、RolesGuard |
| TC-MB-358 | 権限（清掃員：ノーショーの取り消し） | 異常 | S201 でログイン、会員B の予約 R-N1（NO_SHOW、現地払い、ノーショー料を登録カードに請求済み（FEE_CHARGE が SUCCEEDED）、出発日のチェックアウト時刻より前） | 社内用 API の POST /reservations/{R-N1 の id}/no-show/revert を送る | FORBIDDEN（403）。R-N1 は NO_SHOW のまま、NO_SHOW_FEE の明細は有効のまま、payments に REFUND の行ができず、room_nights も変わらない。操作履歴も増えない | 2.4 / design.md 社内用 API（no-show/revert は FRONT） |
| TC-MB-359 | 権限（清掃員：チェックアウト） | 異常 | S201 でログイン、会員B の予約 R-K2（CHECKED_IN、出発日＝今日 2026-11-10、残高 0円、502号室は DEPARTURE_PENDING） | 社内用 API の POST /reservations/{R-K2 の id}/check-out を送る | FORBIDDEN（403）。R-K2 は CHECKED_IN のまま、502号室は DEPARTURE_PENDING のまま、会員B の last_stay_date は変わらない。操作履歴も増えない | 2.4 / design.md 社内用 API（check-out は FRONT） |
| TC-MB-360 | 権限（清掃員：キャンセルの確定） | 異常 | S201 でログイン、R-B1（CONFIRMED） | 社内用 API の POST /reservations/{R-B1 の id}/cancel に、予約全体の scope と任意の quoteToken を送る | FORBIDDEN（403）。R-B1 は CONFIRMED のまま、明細・room_nights・payments が変わらず、RESERVATION_CANCELLED は作られない。操作履歴も増えない | 2.4 / design.md 社内用 API（changes・cancel は FRONT） |
| TC-MB-361 | 権限（清掃員：変更の確定） | 異常 | S201 でログイン、R-B1（CONFIRMED） | 社内用 API の POST /reservations/{R-B1 の id}/changes に、泊数を1泊増やす ChangeRequest と任意の quoteToken を送る | FORBIDDEN（403）。R-B1 は変わらない（明細・room_nights・version が同じ）。RESERVATION_CHANGED は作られず、操作履歴も増えない | 2.4 / design.md 社内用 API（changes・cancel は FRONT） |
| TC-MB-362 | 権限（清掃員：部屋の入れ替え） | 異常 | S201 でログイン、R-B1 と、会員A の予約 R-S2（CONFIRMED。R-B1 と同じ客室タイプ・同じ日程で、別の部屋） | 社内用 API の POST /room-swaps に、R-B1 の部屋と R-S2 の部屋、confirmUnderCapacity: false を送る | FORBIDDEN（403）。R-B1・R-S2 とも部屋が変わらない。操作履歴も増えない | 2.4 / design.md 社内用 API（/room-swaps は FRONT） |
| TC-MB-363 | 権限（清掃員：時間外） | 異常 | S201 でログイン、R-B1（CONFIRMED、時間外なし） | 社内用 API の PUT /reservation-rooms/{R-B1 の部屋の id}/off-hours に { lateCheckoutHour: 14 } を送る | FORBIDDEN（403）。R-B1 の部屋の late_checkout_hour は空のまま、LATE_CHECKOUT の明細ができない。操作履歴も増えない | 2.4 / design.md 社内用 API（off-hours は FRONT） |
| TC-MB-364 | 権限（清掃員：名簿） | 異常 | S201 でログイン、R-B1（大人2名、名簿は未入力） | 社内用 API の PUT /reservations/{R-B1 の id}/roster に名簿2名分を送る | FORBIDDEN（403）。R-B1 の roster_entries に行ができない。操作履歴も増えない | 2.3, 2.4 / design.md 社内用 API（roster は FRONT） |
| TC-MB-365 | 権限（清掃員：お知らせの解決） | 異常 | S201 でログイン、未解決のお知らせ N1（TURNOVER_GAP） | 社内用 API の POST /notices/{N1 の id}/resolve を送る | FORBIDDEN（403）。N1 の resolved_at・resolved_by は空のまま（未解決のまま）。操作履歴も増えない | 2.4 / design.md 社内用 API（notices は FRONT） |
| TC-MB-366 | 権限（清掃員：警告の一覧） | 異常 | S201 でログイン、未回収の予約が1件ある（TC-CH-179 と同じ状態） | 社内用 API の GET /warnings を送る | FORBIDDEN（403）で、警告の一覧（未回収の予約と額など）が返らない | 2.4 / design.md 社内用 API（/warnings は FRONT） |
| TC-MB-367 | 権限（清掃員：残高） | 異常 | S201 でログイン、R-C1（残高 20,000円） | 社内用 API の GET /reservations/{R-C1 の id}/balance を送る | FORBIDDEN（403）で、残高と明細が返らない | 2.4 / design.md 社内用 API（balance は FRONT） |
| TC-MB-368 | 権限（清掃員：故障中の変更） | 異常 | S201 でログイン、604号室の故障中の期間 OP2（2026-11-10〜2026-11-12） | 社内用 API の PATCH /out-of-order/{OP2 の id} で、終了予定日を 2026-11-14 に変える要求を送る | FORBIDDEN（403）。OP2 の end_date は 2026-11-12 のまま。操作履歴も増えない | 2.4 / design.md 社内用 API（out-of-order は FRONT） |
| TC-MB-369 | 権限（清掃員：特定期間の一覧） | 異常 | S201 でログイン、特定期間 SP1（2026-12-29〜2027-01-03、3000bp）が登録済み | 社内用 API の GET /special-surcharges を送る | FORBIDDEN（403）で、特定期間の一覧が返らない | 2.4 / design.md 社内用 API（/special-surcharges は FRONT） |
| TC-MB-370 | 権限（清掃員：特定期間の変更） | 異常 | S201 でログイン、SP1（同上） | 社内用 API の PATCH /special-surcharges で、SP1 の割増率を 2500bp に変える要求を送る | FORBIDDEN（403）。SP1 の rate_bp は 3000 のまま。操作履歴も増えない | 2.4 / design.md 社内用 API（/special-surcharges は FRONT） |
| TC-MB-371 | 権限（清掃員：特定期間の削除） | 異常 | S201 でログイン、SP1（同上） | 社内用 API の DELETE /special-surcharges で、SP1 を削除する要求を送る | FORBIDDEN（403）。SP1 の deleted_at は空のまま。操作履歴も増えない | 2.4 / design.md 社内用 API（/special-surcharges は FRONT） |
| TC-MB-372 | 権限（清掃員：変更の見積もり） | 異常 | S201 でログイン、R-B1（CONFIRMED） | 社内用 API の POST /reservations/{R-B1 の id}/changes/quote に、泊数を1泊増やす ChangeRequest を送る | FORBIDDEN（403）で、見積もり（ChangeQuote・quoteToken）が返らない。R-B1 は変わらない | 2.4 / design.md 社内用 API（changes の quote は FRONT） |

### 2.15 清掃員に表示する情報

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-197 | 清掃状況一覧（API） | 正常 | 601号室：今日チェックインの予約（代表者 山田花子、電話 09033334444、アーリー 13:00）。602号室：今日チェックアウトの予約（代表者 佐藤一郎、レイト 14:00）。S201 でログイン | GET /rooms/status-board?date=2026-11-10 | 各部屋の項目が、部屋番号・状態・今日のチェックイン予定（アーリーの時刻）・今日のチェックアウト予定（レイトの時刻）だけである | 2.3 / design.md P-12（清掃状況一覧）、Security Considerations |
| TC-MB-198 | 清掃状況一覧（API） | 異常 | TC-MB-197 と同じ | TC-MB-197 の応答の全文から「山田」「花子」「佐藤」「09033334444」と住所・メールを検索する | どれも含まれていない | 2.3 / design.md Security Considerations（清掃員の画面） |
| TC-MB-199 | 清掃状況一覧（画面） | 正常 | TC-MB-197 と同じ | C02 を開く | 宿泊者の氏名は表示されない（アーリー・レイトの時刻の表示は TC-OP-215・216 で確かめる） | 2.3 / design-screens.md C02 |

### 2.16 公開範囲とセッションの種類

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-200 | 公開用の待ち受け口 | 異常 | GuestApp（ポート3001）が起動している | ポート3001 に GET /api/staff/chart と POST /api/staff/auth/login を送る | どちらも存在しない（404） | セキュリティ / design.md Security Considerations、ADR-03、Testing Strategy IT-SEC |
| TC-MB-201 | 公開用 nginx | 異常 | 公開用 nginx（external.conf） | 公開用 nginx に /api/staff/auth/login を送る | 社内用 API に中継されない | セキュリティ / design.md File Structure Plan（external.conf）、ADR-03 |
| TC-MB-202 | 公開用 nginx | 異常 | 公開用 nginx | 公開用 nginx から front-web・cleaning-web の画面を開こうとする | 配信されない（guest-web と /api/guest/* だけを中継） | セキュリティ / design.md File Structure Plan（external.conf） |
| TC-MB-203 | 社内用 nginx | 異常 | 社内用 nginx（internal.conf） | 社内のネットワークの外の IP から社内用 nginx に接続する | 接続を受け付けない | セキュリティ / design.md Security Considerations（公開範囲） |
| TC-MB-204 | セッションの種類 | 異常 | S001 がログイン済み（スタッフのセッションの Cookie） | その Cookie を付けて公開用 API の GET /me を送る | UNAUTHENTICATED（401） | セキュリティ / research.md ADR-04（公開用 API はスタッフのセッションを受け付けない） |
| TC-MB-205 | セッションの種類 | 異常 | 会員Aがログイン済み（会員のセッションの Cookie） | その Cookie を付けて社内用 API の GET /chart を送る | UNAUTHENTICATED（401） | セキュリティ / research.md ADR-04（会員とスタッフは別の種類のセッション）、design.md sessions（realm） |
| TC-MB-206 | 他サイトからの要求の拒否 | 異常 | S101 がログイン済み | 有効な Cookie を付け、独自のヘッダーを付けずに POST /special-surcharges を送る | FORBIDDEN（403）で拒否され、special_surcharge_periods に行ができない（独自のヘッダー X-Requested-With: XMLHttpRequest がない：L-3） | セキュリティ / design.md Security Considerations、設計の補足 L-3 |
| TC-MB-207 | 開発用のメール一覧 | 異常 | 開発環境以外の設定で StaffApp を起動 | 社内用 API の GET /dev/mails | 存在しない（404） | セキュリティ / design.md PaymentGateway・Translator・MailSender（開発環境だけ /dev/mails） |

### 2.17 操作履歴の記録

期待結果の「操作履歴が1件増える」は、audit_logs に、操作したスタッフ（staff_id から分かるスタッフ番号）・日時（at）・操作の内容（action・target_type・target_id・detail）を持つ行が追加されることを指す。「…の操作履歴が記録される」も、その操作について同じ内容の行が追加されることを指す。行の数は、1つの操作（API の1回の要求）につき1行で、action は操作の名前、同時に変わる部屋の状態はその行の detail に入る。定時処理は対象1件につき1行（L-42）。期待結果に「1行だけ」と書いたケースで、行の数を確かめる。

TC-MB-373〜385 の前提（各ケースのデータは独立している。部屋番号は説明用の値で、501〜503 は 5F のスタンダード キングの部屋とする）
- 予約 R-K1：会員B の予約。スタンダード キング・1室・大人2名・1泊（夜 2026-11-10 火、出発 11/11）・501号室・現地払い・CONFIRMED（チェックイン前）・時間外なし。名簿は2名分そろっている。501 は CLEAN
- 予約 R-K2：会員B の予約。スタンダード キング・1室・大人2名・1泊（夜 2026-11-09 月、出発 11/10）・502号室・事前決済・CHECKED_IN。ONSITE の明細はなく、残高 0円。502 は DEPARTURE_PENDING
- 予約 R-K3：会員A の予約。スタンダード キング・1室・大人2名・1泊（夜 2026-11-10）・502号室・事前決済・CONFIRMED（チェックイン前）
- 故障中の期間 OP1：503号室、2026-11-10〜2026-11-12。503 は OUT_OF_ORDER で、503 に割り当てられた予約はない
- お知らせ N1：TURNOVER_GAP（501号室、2026-11-10）、未解決

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-208 | 操作履歴（予約の登録） | 正常 | S101 でログイン、会員A | 現在＝2026-11-10 10:00、F04 で A を予約者にして予約を登録する | スタッフ番号 S101・日時 2026-11-10 10:00・予約の登録と予約 ID の操作履歴が1件増える | 18.1 / design.md shared/audit AuditLogService、処理仕様の前書き、audit_logs |
| TC-MB-209 | 操作履歴（予約の変更） | 正常 | S101 でログイン、R-B1 | F07 で R-B1 の泊数を1泊増やして確定する | S101 による R-B1 の変更の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-210 | 操作履歴（予約のキャンセル） | 正常 | S101 でログイン、R-B1 | F06 で R-B1 をキャンセルする | S101 による R-B1 のキャンセルの操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-212 | 操作履歴（名簿） | 正常 | S101 でログイン、R-B1（大人2名、名簿は未入力） | F08 で R-B1 の名簿を2名分入力して保存する | S101 による R-B1 の名簿の入力の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-213 | 操作履歴（料金の設定の登録） | 正常 | S101 でログイン | F14 で 2026-12-29〜2027-01-03・30% の特定期間割増を登録する | S101 による特定期間割増の登録の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-214 | 操作履歴（料金の設定の変更） | 正常 | TC-MB-213 の期間がある | F14 で割増率を 25% に変更する | S101 による特定期間割増の変更の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-215 | 操作履歴（料金の設定の削除） | 正常 | TC-MB-214 の期間がある | F14 でその期間を削除する | S101 による特定期間割増の削除の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-216 | 操作履歴（故障中） | 正常 | S101 でログイン | F13 で 604号室を 2026-11-10〜2026-11-12 の故障中にする | S101 による 604号室の故障中の設定の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-217 | 操作履歴（入金） | 正常 | S101 でログイン、現地払いの予約 R-C1（残高 20,000円） | F09 で 20,000円・現金の入金を記録する | S101 による R-C1 の入金の記録の操作履歴が1件増える | 18.1 / design.md audit_logs |
| TC-MB-218 | 操作履歴（定時処理） | 正常 | 605号室＝チェックイン済み、今日チェックアウト予定 | 現在＝2026-11-10 09:00、morning-status を実行する | 605号室の状態の変更の操作履歴が、staff_id が空（定時処理）で、605号室について1行だけ記録される（定時処理は対象1件につき1行：L-42） | 18.1 / design.md audit_logs（定時処理は null）、設計の補足 L-42 |
| TC-MB-219 | 操作履歴（失敗した操作） | 異常 | S201 でログイン | POST /special-surcharges を送り FORBIDDEN になる | 操作履歴は記録されない（権限がない・入力の誤り・業務エラーで失敗した操作は記録しない） | 18.1 / design.md audit_logs |
| TC-MB-220 | 操作履歴の保護 | 異常 | TC-MB-208 の操作履歴がある | アプリのデータベース利用者で、その行を UPDATE する | 権限がなく拒否され、行の内容は変わらない | 18.2 / design.md audit_logs（アプリのデータベース利用者から UPDATE・DELETE の権限を外す） |
| TC-MB-221 | 操作履歴の保護 | 異常 | TC-MB-208 の操作履歴がある | アプリのデータベース利用者で、その行を DELETE する | 権限がなく拒否され、行が残る | 18.2 / design.md audit_logs |
| TC-MB-222 | 操作履歴の保護 | 異常 | TC-MB-208 の操作履歴がある | テーブルの所有者など UPDATE の権限を持つ利用者で、その行を UPDATE する | トリガーで拒否され、行の内容は変わらない | 18.2 / design.md audit_logs（UPDATE・DELETE を拒否するトリガー） |
| TC-MB-223 | 操作履歴の保護 | 異常 | TC-MB-208 の操作履歴がある | DELETE の権限を持つ利用者で、その行を DELETE する | トリガーで拒否され、行が残る | 18.2 / design.md audit_logs |
| TC-MB-224 | 操作履歴の保護 | 異常 | S001 でログイン | 社内用 API に PATCH /audit-logs/{id} と DELETE /audit-logs/{id} を送る | 該当する API が存在せず（404）、行は変わらない | 18.2 / design.md 社内用 API（操作履歴を変更・削除する API がない）、Security Considerations |
| TC-MB-373 | 操作履歴（チェックイン） | 正常 | S101 でログイン、R-K1。現在＝2026-11-10 15:00 | F11 で R-K1 をチェックインする | チェックインが完了し（R-K1 は CHECKED_IN、501 は CHECKED_IN）、スタッフ番号 S101・日時 2026-11-10 15:00・R-K1 のチェックインの操作履歴が記録される。操作履歴は1行だけ増え（action はチェックインの操作の名前。例：CHECK_IN）、501 の状態の変更（CLEAN → CHECKED_IN）はその行の detail に入る（部屋の状態の変更の行を別に作らない：L-42） | 18.1 / design.md 処理仕様の前書き（スタッフの操作は AuditLogService で記録）、P-10 手順1、audit_logs、設計の補足 L-42 |
| TC-MB-374 | 操作履歴（チェックアウト） | 正常 | S101 でログイン、R-K2。現在＝2026-11-10 10:00 | F12 で R-K2 をチェックアウトする | チェックアウトが完了し（R-K2 は CHECKED_OUT、502 は CLEANING_READY）、S101・2026-11-10 10:00・R-K2 のチェックアウトの操作履歴が記録される。操作履歴は1行だけ増え、502 の状態の変更（DEPARTURE_PENDING → CLEANING_READY）はその行の detail に入る（部屋の状態の変更の行を別に作らない：L-42） | 18.1 / design.md 処理仕様の前書き、P-10 手順4、audit_logs、設計の補足 L-42 |
| TC-MB-375 | 操作履歴（部屋の移動） | 正常 | S101 でログイン、R-K1。502 は 11/10 の夜に予約がなく、故障中でない。現在＝2026-11-10 10:00 | F10 で R-K1 を 502 へ移す（同じ客室タイプ） | R-K1 が 502 になり、S101・2026-11-10 10:00・R-K1 の部屋の移動の操作履歴が記録される。操作履歴は1行だけ増える（1回の要求につき1行：L-42） | 18.1 / design.md 処理仕様の前書き、P-09、audit_logs、設計の補足 L-42 |
| TC-MB-376 | 操作履歴（部屋の入れ替え） | 正常 | S101 でログイン、R-K1（501）と R-K3（502）。現在＝2026-11-10 10:00 | F10 で R-K1 の部屋から入れ替えを始め（reservationRoomIdA＝R-K1 の部屋）、R-K3 の部屋と入れ替える | R-K1 が 502、R-K3 が 501 になり、S101・2026-11-10 10:00・R-K1 と R-K3 の部屋の入れ替えの操作履歴が記録される。操作履歴は2つの予約をまとめて1行だけ増える（予約ごとに分けない。1回の要求につき1行：L-42）。その行の target_type は予約、target_id は R-K1（操作した側）で、R-K3 の予約 ID は detail に入る（L-49） | 18.1 / design.md 処理仕様の前書き、P-09 手順7、audit_logs、設計の補足 L-42・L-49 |
| TC-MB-377 | 操作履歴（ノーショーの延長） | 正常 | S101 でログイン、R-K1。現在＝2026-11-10 23:00 | F06 で R-K1 のノーショーの判定を 2026-11-11 03:00 まで延ばす（到着日の25:00＝11/11 01:00 より後、翌日 12:00 以前） | R-K1 の no_show_deferred_until が 2026-11-11 03:00 になり、S101・2026-11-10 23:00・R-K1 のノーショーの判定の延長の操作履歴が記録される | 18.1 / design.md 処理仕様の前書き、P-07 手順1a、audit_logs |
| TC-MB-378 | 操作履歴（ノーショーの取り消し） | 正常 | S101 でログイン、R-K1 が 2026-11-11 01:00 の no-show で NO_SHOW になった（ノーショー料は会員B の登録カードへの請求が成功）。現在＝2026-11-11 02:00（出発日 11/11 のチェックアウト時刻 12:00 より前） | F06 で R-K1 のノーショーを取り消す | R-K1 が CONFIRMED に戻り、S101・2026-11-11 02:00・R-K1 のノーショーの取り消しの操作履歴が記録される | 18.1 / design.md 処理仕様の前書き、P-07 手順4、audit_logs |
| TC-MB-379 | 操作履歴（ノーショーの判定） | 正常 | R-K1 が 2026-11-10 にチェックインせず、判定の延長はない | 現在＝2026-11-11 01:00、定時処理 no-show を実行する | R-K1 が NO_SHOW になり、R-K1 のノーショーの判定の操作履歴が、staff_id が空（定時処理）で、R-K1 について1行だけ記録される（定時処理は対象1件につき1行：L-42） | 18.1 / design.md audit_logs（定時処理は staff_id が null）、P-07 手順1、設計の補足 L-42 |
| TC-MB-380 | 操作履歴（時間外の追加） | 正常 | S101 でログイン、R-K1。現在＝2026-11-10 10:00 | F06 で R-K1 の 501 にレイトチェックアウト 14:00 を追加する（PUT /reservation-rooms/{id}/off-hours） | 501 の late_checkout_hour が 14 になり、S101・2026-11-10 10:00・R-K1 の時間外の追加の操作履歴が記録される | 18.1 / design.md 処理仕様の前書き、社内用 API（off-hours）、audit_logs |
| TC-MB-381 | 操作履歴（故障中の延長） | 正常 | S101 でログイン、OP1。現在＝2026-11-10 10:00 | F13 で OP1 の終了予定日を 2026-11-14 に延ばす | OP1 の end_date が 2026-11-14 になり、S101・2026-11-10 10:00・503号室の故障中の期間の変更の操作履歴が記録される | 18.1 / design.md 処理仕様の前書き、社内用 API（PATCH /out-of-order/{id}）、audit_logs |
| TC-MB-382 | 操作履歴（修理の完了） | 正常 | S101 でログイン、OP1。現在＝2026-11-10 10:00 | F13 で 503号室の修理の完了を行う | 503 が CLEAN になり OP1 の ended_at が記録され、S101・2026-11-10 10:00・503号室の修理の完了の操作履歴が記録される。操作履歴は1行だけ増える（503 の状態の変更の行を別に作らない。1回の要求につき1行：L-42） | 18.1 / design.md 処理仕様の前書き、P-13（終了）、audit_logs、設計の補足 L-42 |
| TC-MB-383 | 操作履歴（お知らせの解決） | 正常 | S101 でログイン、N1。現在＝2026-11-10 10:00 | F03 で N1 の「解決」を押す | N1 の resolved_at・resolved_by が記録され、S101・2026-11-10 10:00・N1 の解決の操作履歴が記録される | 18.1 / design.md 処理仕様の前書き、P-11（解決）、audit_logs |
| TC-MB-384 | 操作履歴（払い戻しの記録） | 正常 | S101 でログイン。05-operations.md TC-OP-171 の状態（予約 B'、残高 −6,400円の払い過ぎ。下位タイプへの移動で (18,800−15,600)×2名＝6,400円を精算額から差し引いた）。現在＝2026-11-11 10:00 | F09 で種類「払い戻し」・6,400円・現金を記録する（TC-OP-267 と同じ操作） | payments に ONSITE_REFUND の行ができ（残高 −6,400＋6,400＝0円）、S101・2026-11-11 10:00・予約 B' の払い戻しの記録の操作履歴が記録される | 18.1 / design.md 処理仕様の前書き、P-10 手順3・4、audit_logs |
| TC-MB-385 | 操作履歴（グループをまたぐ状態の変更） | 正常 | S101 でログイン。502 が DEPARTURE_PENDING（チェックアウト待ち）。現在＝2026-11-10 10:00 | C03 で 502 を CLEANING_READY（清掃可）に変える（POST /rooms/{id}/status） | 502 が CLEANING_READY になり（フロント以上はグループをまたいで変えられる）、S101・2026-11-10 10:00・502号室の状態の変更の操作履歴が記録される | 18.1, 12.4 / brief.md ST-01a（変更は操作履歴に残る）、design.md P-12、audit_logs |
| TC-MB-386 | 操作履歴（個人情報の値） | 正常 | S101 でログイン、R-B1（大人2名、名簿は未入力）。現在＝2026-11-10 10:00 | F08 で R-B1 の名簿を2名分入力して保存する：1人目 佐藤 一郎・住所 石川県金沢市広岡1-1・連絡先 09022223333、2人目 李 明・日本に住所がない外国人・国籍 中国・旅券番号 E12345678・住所 Beijing 100000・連絡先 8613800000000 | 保存が成功し、S101 による R-B1 の名簿の入力の操作履歴が記録される。その行の detail に、入力した氏名（佐藤 一郎・李 明）・住所・連絡先・旅券番号 E12345678 のどの値も含まれず、操作した項目の名前と対象の ID（予約 ID など）だけが記録されている | 18.3 / design.md 設計の補足 DT-M34（AuditLogService）、audit_logs |
| TC-MB-387 | 操作履歴（個人情報の値） | 正常 | S101 でログイン、会員A（姓 山田、名 花子、住所 石川県金沢市本町2-2、電話 09011112222、メール a@example.com）。現在＝2026-11-10 10:00 | F04 で A を予約者（宿泊者は予約者本人）にして予約を登録する | 予約の登録の操作履歴（TC-MB-208）が記録され、その行の detail に、A の氏名（山田・花子）・住所・電話番号・メールアドレスのどの値も含まれず、操作した項目の名前と対象の ID（予約 ID など）だけが記録されている | 18.3 / design.md 設計の補足 DT-M34、audit_logs |
| TC-MB-400 | 操作履歴（2室のチェックイン） | 正常 | S101 でログイン。予約 R-K5：会員B の予約。スタンダード キング・2室・大人4名・1泊（夜 2026-11-10 火、出発 11/11）・501号室と502号室・現地払い・CONFIRMED（チェックイン前）・時間外なし。名簿は4名分そろっている。501・502 とも CLEAN（このケースでは R-K1〜R-K3・OP1 は使わない）。現在＝2026-11-10 15:00 | F11 で R-K5 をチェックインする | チェックインが完了し（R-K5 は CHECKED_IN、501・502 とも CHECKED_IN）、S101・2026-11-10 15:00・R-K5 のチェックインの操作履歴が1行だけ増える（部屋ごとの行を作らない）。501 と 502 の状態の変更（どちらも CLEAN → CHECKED_IN）は、その1行の detail に入る（1つの操作（API の1回の要求）につき1行、同時に変わる部屋の状態は detail に入れる：L-42） | 18.1 / design.md 処理仕様の前書き、P-10 手順1（チェックインは予約単位）、audit_logs、設計の補足 L-42 |
| TC-MB-401 | 操作履歴（定時処理の行の数） | 正常 | R-K1 と R-K3 がどちらも 2026-11-10 にチェックインせず、判定の延長はない。ほかにノーショーの判定の対象の予約はない | 現在＝2026-11-11 01:00、定時処理 no-show を実行する | R-K1 と R-K3 が NO_SHOW になり、ノーショーの判定の操作履歴が、staff_id が空（定時処理）で、R-K1 と R-K3 のそれぞれについて1行ずつ（計2行）記録される（1回の実行をまとめて1行にしない。定時処理は対象1件につき1行：L-42） | 18.1 / design.md audit_logs（定時処理は staff_id が null）、P-07 手順1、設計の補足 L-42 |

### 2.18 メールの言語

予約・変更・キャンセル・ノーショーの業務処理そのもの（金額の正しさなど）は別の担当が確認する。ここでは mail_outbox に作られる行の template・to_address・locale と、記載すべき項目が入っていることだけを確認する（design.md P-15）。

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-225 | メールの言語 | 正常 | 会員A（preferred_locale=en）が現地払いの予約を決済待ちにしている（期限内） | 予約を確定する | RESERVATION_CONFIRMED の行が locale=en で作られ、定型文が英語である | 15.1, 16.2 / design.md P-15（言語は会員の preferred_locale） |
| TC-MB-226 | メールの言語 | 正常 | TC-MB-225 と同じで preferred_locale=ko | 予約を確定する | RESERVATION_CONFIRMED が locale=ko で、定型文が韓国語である | 15.1, 16.2 / design.md P-15 |
| TC-MB-227 | メールの言語 | 正常 | TC-MB-225 と同じで preferred_locale=zh-Hans | 予約を確定する | RESERVATION_CONFIRMED が locale=zh-Hans で、定型文が中国語（簡体字）である | 15.1, 16.2 / design.md P-15 |
| TC-MB-228 | メールの言語 | 正常 | TC-MB-225 と同じで preferred_locale=zh-Hant | 予約を確定する | RESERVATION_CONFIRMED が locale=zh-Hant で、定型文が中国語（繁体字）である | 15.1, 16.2 / design.md P-15 |
| TC-MB-229 | メールの言語 | 正常 | TC-MB-225 と同じで preferred_locale=ja | 予約を確定する | RESERVATION_CONFIRMED が locale=ja で、定型文が日本語である | 15.1, 16.2 / design.md P-15 |
| TC-MB-230 | メールの言語（フロントの登録） | 連携 | 会員A（preferred_locale=en）、S101 でログイン | F04 で A を予約者にして現地払いの予約を登録する | A 宛ての RESERVATION_CONFIRMED が locale=en で作られる（スタッフの画面の言語に関係しない） | 15.1, 16.6 / design.md P-15、F04 |
| TC-MB-231 | メールの言語（言語の変更） | 状態遷移 | 会員A（preferred_locale=ja）が R-A1（現地払い、到着 2026-11-20）を持ち、ログイン中 | 画面の言語を 한국어 に切り替えた後、R-A1 をキャンセルする | RESERVATION_CANCELLED が locale=ko で作られる（作成した時点の会員の言語） | 15.1, 16.1 / design.md P-15、design-screens.md 共通の約束（ログイン中は会員の言語として保存） |
| TC-MB-232 | メールのテンプレート | 正常 | — | テンプレートの一覧を確認する | P-15 の12のテンプレート（支払いのお願いの PAYMENT_REQUEST を含む）のそれぞれに、ja・en・ko・zh-Hans・zh-Hant の5言語の文面がある | 15.1, 16.2 / design.md P-15（テンプレートは5言語分）、modules/notifications |

### 2.19 メールのきっかけとテンプレート（P-15）

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-239 | 変更完了のメール | 異常 | 会員A の予約 R-A1（現地払い、到着 2026-11-20、1泊） | 泊数を2泊に変える変更の見積もり（changes/quote）だけを行い、確定しない | RESERVATION_CHANGED は作られない | 7.16 / design.md P-15（変更の確定） |
| TC-MB-242 | キャンセル完了のメール | 異常 | 会員A の R-A1（現地払い、到着 2026-11-20） | キャンセルの見積もり（cancel/quote）だけを行い、確定しない | RESERVATION_CANCELLED は作られない | 8.13 / design.md P-15（キャンセルの確定） |
| TC-MB-243 | キャンセル完了のメール（フロント） | 連携 | S101 でログイン、会員A の R-A1 | F06 で R-A1 をキャンセルする | A 宛て（a@example.com、A の言語）の RESERVATION_CANCELLED が作られる | 8.1, 8.13, 15.1 / design.md P-15 |
| TC-MB-244 | 請求のメール（キャンセル料） | 連携 | 会員A の個人の現地払いの予約（到着 2026-11-11。無料の期限＝2026-11-09 15:00） | 現在＝2026-11-10 10:00、キャンセルを確定する | FEE_CHARGED が1件作られ、内容に請求額が記載されている | 15.4 / design.md P-06（現地払いはキャンセル料を登録カードに請求）、P-15 |
| TC-MB-245 | 請求のメール（キャンセル料） | 異常 | 会員A の個人の現地払いの予約（到着 2026-11-20、期限内） | 現在＝2026-11-10 10:00、キャンセルを確定する | キャンセル料が0円で請求がないため、FEE_CHARGED は作られない | 15.4 / design.md P-06、P-15 |
| TC-MB-330 | 支払いのお願いのメール（言語） | 正常 | 会員A（preferred_locale=en）の個人の現地払いの予約（到着 2026-11-11。無料の期限＝2026-11-09 15:00）。A の登録カードを末尾 0341 のカード（模擬の決済で、登録は成功し決済だけを断る：L-16）に差し替え済み | 現在＝2026-11-10 10:00、キャンセルを確定する（キャンセル料の請求が断られる） | A 宛て（a@example.com）の PAYMENT_REQUEST が locale=en で1件作られ、定型文が英語で、未回収の額と振込先が記載されている | 15.8, 15.1 / design.md P-15（PAYMENT_REQUEST）、P-06「請求が断られた場合」、hotel_settings |
| TC-MB-247 | 請求のメール（事前決済のキャンセル料） | 連携 | 会員A の個人の事前決済の予約（早期割なし、到着 2026-11-11） | 現在＝2026-11-10 10:00、キャンセルを確定する（キャンセル料を差し引いて返金） | FEE_CHARGED は作られない（事前決済でキャンセル料を返金から差し引いた場合は請求のメールを送らない）。キャンセル料は RESERVATION_CANCELLED に記載される（DT-M6） | 15.4 / design.md P-06、P-15、設計の補足 DT-M6 |
| TC-MB-248 | 請求のメール（事前決済のノーショー） | 連携 | 会員A の事前決済の予約（早期割なし、到着 2026-11-10、2泊、チェックインしていない） | 現在＝2026-11-11 01:00、no-show を実行する | FEE_CHARGED が1件作られ、ノーショー料（1泊目の宿泊料金）が記載される（事前決済でノーショー料を返金から差し引いた場合も請求のメールを送る：DT-M6） | 15.4 / design.md P-07 手順3、P-15、設計の補足 DT-M6 |
| TC-MB-249 | 返金のメール | 連携 | 会員A の個人の事前決済の予約（早期割なし、到着 2026-11-20、期限内） | 現在＝2026-11-10 10:00、キャンセルを確定し、返金が終わる | REFUND_COMPLETED が1件作られ、内容に返金額が記載されている | 15.5 / design.md P-15 |
| TC-MB-250 | 返金のメール | 異常 | 会員A の事前決済の早期割の予約（到着 2027-03-01） | キャンセルを確定する（返金なし） | REFUND_COMPLETED は作られない | 15.5 / design.md P-06（早期割は返金しない）、P-15 |
| TC-MB-251 | 返金のメール（変更） | 連携 | 会員A の個人の事前決済の予約（早期割なし、到着 2026-11-20、3泊） | 現在＝2026-11-10 10:00、2泊に減らす変更を確定し、返金が終わる | REFUND_COMPLETED が1件作られる | 7.14, 15.5 / design.md P-05 手順6、P-15 |

### 2.20 到着前の案内（前日10:00）

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-253 | 到着前の案内 | 境界 | 会員A の予約（到着 2026-11-11、confirmed_at=2026-11-10 09:59） | 現在＝2026-11-10 10:00、pre-arrival を実行する | A 宛ての PRE_ARRIVAL が1件作られる | 15.2 / design.md 定時処理 pre-arrival、P-15 |
| TC-MB-254 | 到着前の案内 | 正常 | TC-MB-253 と同じ | TC-MB-253 で作られたメールの内容を確認する | チェックイン時刻とアクセスが記載されている | 15.2 / brief.md NT-09 |
| TC-MB-255 | 到着前の案内 | 境界 | 会員A の予約（到着 2026-11-11、confirmed_at=2026-11-10 10:00:00） | 現在＝2026-11-10 10:00 の pre-arrival の後に、作られたかを確認する | この予約の PRE_ARRIVAL は作られない（最後に確定した時刻がちょうど 10:00:00 で、前日10:00 より前ではない。処理中の確定も送らない：DT-M2） | 15.2, 15.3 / design.md 定時処理 pre-arrival、P-15、設計の補足 DT-M2 |
| TC-MB-335 | 到着前の案内（日程の変更） | 正常 | 会員A の予約（confirmed_at=2026-11-01 12:00、到着 2026-11-13）を、2026-11-09 15:00 に到着 2026-11-11 へ変える変更を確定した | 現在＝2026-11-10 10:00、pre-arrival を実行する | A 宛ての PRE_ARRIVAL が1件作られる（confirmed_at はもとのままだが、最後に確定・変更した時刻 2026-11-09 15:00 が前日10:00 より前：DT-M2） | 15.2 / design.md 定時処理 pre-arrival、設計の補足 DT-M2 |
| TC-MB-336 | 到着前の案内（日程の変更） | 境界 | 会員A の予約（confirmed_at=2026-11-01 12:00、到着 2026-11-13）を、2026-11-10 10:00:00 ちょうどに到着 2026-11-11 へ変える変更を確定した | 2026-11-10 10:00 の pre-arrival の後、2026-11-11 10:00 の実行まで待つ | この予約の PRE_ARRIVAL は作られない（最後に変更した時刻が前日10:00 より前ではない。11/11 の実行では到着日の当日になり対象外：DT-M2） | 15.2, 15.3 / design.md 定時処理 pre-arrival、設計の補足 DT-M2 |
| TC-MB-256 | 到着前の案内 | 境界 | 会員A の予約（到着 2026-11-11、confirmed_at=2026-11-10 10:01） | 2026-11-10 10:00 の pre-arrival の後、2026-11-11 10:00 の実行まで待つ | この予約の PRE_ARRIVAL は作られない | 15.3 / design.md 定時処理 pre-arrival |
| TC-MB-257 | 到着前の案内 | 異常 | 会員A の予約（到着 2026-11-12、confirmed_at=2026-11-01 12:00） | 現在＝2026-11-10 10:00、pre-arrival を実行する | この予約の PRE_ARRIVAL は作られない（翌日に到着する予約ではない） | 15.2 / design.md 定時処理 pre-arrival |
| TC-MB-258 | 到着前の案内（宛先） | 正常 | 会員A の予約（到着 2026-11-11、confirmed_at=2026-11-05 12:00、予約者は泊まらず宿泊者は佐藤一郎） | 現在＝2026-11-10 10:00、pre-arrival を実行する | PRE_ARRIVAL の to_address が予約者 A のアドレス（a@example.com）である | 15.2 / requirements.md 15.2（予約の予約者に） |
| TC-MB-259 | 到着前の案内（再実行） | 正常 | TC-MB-253 の実行が終わっている | 同じ日の pre-arrival をもう一度実行する（失敗後の再実行） | TC-MB-253 の予約の PRE_ARRIVAL は1件のまま（重ねて作られない） | 15.2 / design.md 定時処理の失敗（冪等） |
| TC-MB-260 | 到着前の案内 | 状態遷移 | 会員A の予約（到着 2026-11-11、confirmed_at=2026-11-01 12:00、2026-11-09 にキャンセル済み） | 現在＝2026-11-10 10:00、pre-arrival を実行する | この予約の PRE_ARRIVAL は作られない（前日10:00 より前にキャンセルされた予約には送らない） | 15.2 / design.md 定時処理 pre-arrival |

### 2.21 定期配信のメール

前提：会員C（同意が最新で true）、会員D（一度も同意していない）、会員E（同意 → 取り消し）、会員F（同意 → 取り消し → 再同意）、会員W2（同意した後に退会）。定期配信を作る画面は後のフェーズの管理者画面で（21.8）、MVP では配信を行わない（brief.md NT-03b）。MVP で用意する配信の仕組み（MailService の MARKETING の送信）を、テストから直接呼んで確かめる。これを「配信の仕組みを呼ぶ」と書く（件名・本文はテスト用の値）。

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-261 | 定期配信 | 正常 | 会員C | 配信の仕組みを呼ぶ | C 宛ての MARKETING が作られる | 15.6 / design.md P-15（同意が最新で true の会員だけ）、brief.md NT-03b |
| TC-MB-262 | 定期配信 | 異常 | 会員D | 配信の仕組みを呼ぶ | D 宛ての MARKETING は作られない | 15.6 / design.md P-15、brief.md NT-03 |
| TC-MB-263 | 定期配信 | 状態遷移 | 会員E | 配信の仕組みを呼ぶ | E 宛ての MARKETING は作られない | 1.7, 15.6 / brief.md NT-03a（取り消した後は送らない） |
| TC-MB-264 | 定期配信 | 状態遷移 | 会員F | 配信の仕組みを呼ぶ | F 宛ての MARKETING が作られる | 15.6 / design.md marketing_consents（最新の行が現在の状態） |
| TC-MB-265 | 定期配信 | 状態遷移 | 会員W2 | 配信の仕組みを呼ぶ | W2 宛ての MARKETING は作られない | 1.11, 15.6 / brief.md DR-02（退会で同意を削除） |
| TC-MB-266 | 定期配信の表示 | 正常 | TC-MB-261 の MARKETING | メールの本文を確認する | 送信者の名称が記載されている | 15.7 / design.md P-15（送信者名を必ず入れる） |
| TC-MB-267 | 定期配信の表示 | 正常 | TC-MB-261 の MARKETING | メールの本文を確認する | 受信を拒否する URL（署名つきの値を含む G20 へのリンク）が記載されている | 15.7 / design.md P-15、POST /marketing/unsubscribe、design-screens.md G20 |

### 2.22 メールの送信と再送

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-268 | メールの送信 | 連携 | mail_outbox に status=PENDING、attempts=0 の行がある | outbox を実行する | MailSender.send が呼ばれ、status=SENT、sent_at に実行の日時が入る | 15.1 / design.md 定時処理 outbox、mail_outbox |
| TC-MB-269 | メールの再送 | 異常 | TC-MB-268 と同じ。MailSender が失敗を返すようにテスト用に差し替える | outbox を1回実行する | attempts=1、status=PENDING のまま（次の回に再送する） | 15.1 / design.md 定時処理の失敗 |
| TC-MB-270 | メールの再送 | 境界 | TC-MB-269 の状態から、失敗が続く | outbox を続けて実行し、4回目の失敗の後に確認する | attempts=4、status=PENDING のまま | 15.1 / design.md 定時処理の失敗（最大5回） |
| TC-MB-271 | メールの再送 | 境界 | TC-MB-270 の後 | outbox を実行し、5回目も失敗する | status=FAILED になる | 15.1 / design.md 定時処理の失敗 |
| TC-MB-272 | 送れなかったメールの警告 | 連携 | TC-MB-271 の後、S101 でログイン | F02 を開く | 対応が必要な一覧に、送信できなかったメールとして表示される | 15.1 / design.md 定時処理の失敗、design-screens.md F02、context.md 警告 |
| TC-MB-273 | メールの再送 | 状態遷移 | TC-MB-271 の後 | outbox をもう一度実行する | MailSender.send は呼ばれず、attempts=5・status=FAILED のまま | 15.1 / design.md 定時処理の失敗 |

### 2.23 宿泊客向け画面の多言語表示

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-274 | 言語の切り替え | 正常 | 未ログイン | G01 を開き、右上の言語の切り替えを開く | 日本語・English・한국어・简体中文・繁體中文 の5つが選べる | 16.1 / design-screens.md 共通の約束（言語） |
| TC-MB-275 | 言語の切り替え | 正常 | 未ログイン、日本語で表示中 | G01 で English を選ぶ | ボタン・項目名などの固定の文言が英語で表示される | 16.1, 16.2 / design-screens.md 共通の約束、design.md 技術スタック（react-i18next） |
| TC-MB-276 | 言語の切り替え | 正常 | 未ログイン | G01 で 한국어 を選ぶ | 固定の文言が韓国語で表示される | 16.1, 16.2 / design-screens.md 共通の約束 |
| TC-MB-277 | 言語の切り替え | 正常 | 未ログイン | G01 で 简体中文 を選ぶ | 固定の文言が中国語（簡体字）で表示される | 16.1, 16.2 / design-screens.md 共通の約束 |
| TC-MB-278 | 言語の切り替え | 正常 | 未ログイン | G01 で 繁體中文 を選ぶ | 固定の文言が中国語（繁体字）で表示される | 16.1, 16.2 / design-screens.md 共通の約束 |
| TC-MB-279 | 言語の切り替え | 状態遷移 | TC-MB-278 の後 | 日本語 を選び直す | 固定の文言が日本語に戻る | 16.1 / design-screens.md 共通の約束 |
| TC-MB-280 | 言語の保存 | 状態遷移 | 会員A（preferred_locale=ja）でログイン | 画面の言語を English に切り替え、members を確認する | A の preferred_locale が en になっている | 16.1, 15.1 / design-screens.md 共通の約束（ログイン中は会員の言語として保存） |
| TC-MB-281 | エラーメッセージの言語 | 正常 | 未ログイン、English で表示中 | G04 でパスワードを Abcdef123（9文字）にして登録 | パスワードの項目の下に、英語で理由が表示される | 16.2 / design-screens.md G04、共通の約束（入力の誤り） |
| TC-MB-282 | エラーメッセージの言語 | 正常 | 会員A（preferred_locale=en）でログイン、R-A1（CONFIRMED）を持つ | G19 で退会する | HAS_ACTIVE_RESERVATION の文言が英語で表示される | 16.2 / design.md ApiError（宿泊客向けは選んだ言語） |
| TC-MB-283 | エラーメッセージの言語 | 正常 | 未ログイン、한국어 で表示中。現在＝2026-11-10 10:00 | G01 で到着日 2027-11-12（365日より先）を入れて検索する | OUT_OF_BOOKING_WINDOW の文言が韓国語で表示される | 16.2 / design-screens.md G01 |
| TC-MB-284 | エラーメッセージの言語（API） | 正常 | 未ログイン、한국어 で表示中 | TC-MB-283 の GET /availability の要求と応答を確認する | 要求に Accept-Language: ko が付き、応答の ApiError.message（OUT_OF_BOOKING_WINDOW）が韓国語の文言である（ログインしていない宿泊客は、画面が選んだ言語を Accept-Language で送る：L-11） | 16.2 / design.md 共通の型 ApiError、設計の補足 L-11 |
| TC-MB-285 | 文言ファイル | 正常 | — | i18n/locales の ja・en・ko・zh-Hans・zh-Hant の文言ファイルの項目を比べる | どの言語にも、ほかの言語にある項目の抜けがない | 16.2 / design.md File Structure Plan（i18n/locales）、tasks.md 8.6 の完了状態 |
| TC-MB-286 | 日付の書き方 | 正常 | 会員A でログイン、English で表示中、R-A1（到着 2026-11-20） | G14 を開く | 到着日が英語の書き方（Intl API の en の書式）で表示される | 16.3 / design.md 技術スタック（Intl API） |
| TC-MB-287 | 日付の書き方 | 正常 | TC-MB-286 と同じで 한국어 で表示中 | G14 を開く | 到着日が韓国語の書き方（Intl API の ko の書式）で表示される | 16.3 / design.md 技術スタック（Intl API） |
| TC-MB-288 | 数字の書き方 | 正常 | English で表示中、合計 61,900円の見積もり | G10 を開く | 金額が英語の数字の書き方（Intl API の en の書式）で表示される | 16.3 / design.md 技術スタック（Intl API） |
| TC-MB-289 | 時刻の表示 | 境界 | ブラウザのタイムゾーン＝America/New_York、English で表示中、無料で取り消せる期限＝2026-11-18 15:00（日本時間） | G10 を開く | 期限の時刻が 15:00 と表示される（ブラウザのタイムゾーンに換算しない） | 16.3 / design-screens.md 共通の約束（時刻） |
| TC-MB-290 | 時刻の表示 | 正常 | TC-MB-289 と同じ | G10 の期限の時刻の横を確認する | 「日本時間」の表記が英語で付いている | 16.3 / design-screens.md 共通の約束（時刻の横に「日本時間」） |
| TC-MB-291 | 翻訳文の表示 | 連携 | スタンダード キングの description_ja、translations に en の翻訳文（模擬の翻訳「[en] 原文」、is_edited=false） | English で G02 を開く（GET /room-types?lang=en） | 客室の説明に en の翻訳文が表示される | 16.4 / design.md GET /room-types、translations、模擬の翻訳 |
| TC-MB-292 | 翻訳文の表示 | 連携 | スタンダード キングの en の翻訳文を開発者が直した（is_edited=true、text＝"Edited description"） | English で G02 を開く | 客室の説明に "Edited description" が表示される | 16.4 / design.md translations（is_edited）、brief.md UI-07a |
| TC-MB-293 | 翻訳文の表示 | 正常 | TC-MB-291 と同じ | 日本語で G02 を開く | 客室の説明に日本語の原文（description_ja）が表示される | 16.4 / design.md room_types |
| TC-MB-294 | 翻訳文の表示 | 連携 | 宿泊約款の ko の翻訳文がある | 한국어 で G10 を開く（GET /terms/current?lang=ko） | 宿泊約款が ko の翻訳文で表示される | 16.4 / design.md GET /terms/current、design-screens.md G10 |
| TC-MB-295 | 翻訳文の表示 | 連携 | 朝食の名称の zh-Hans の翻訳文がある | 简体中文 で G09 を開く | オプションの朝食の名称が zh-Hans の翻訳文で表示される | 16.4 / design.md translations、seed（朝食などの名称の翻訳文） |
| TC-MB-296 | 宿泊客の入力 | 正常 | 会員A（姓 山田、名 花子）でログイン、English で表示中 | G18 を開く | 氏名が「山田」「花子」のまま表示される | 16.5 / brief.md UI-08 |
| TC-MB-297 | 宿泊客の入力 | 正常 | 会員A でログイン、English で表示中。R-A1 の名簿に同行者「李 明」・住所「石川県金沢市広岡1-1」 | G17 を開く | 同行者の氏名と住所が入力したまま表示される | 16.5 / design-screens.md G17、brief.md UI-08 |
| TC-MB-298 | 宿泊客の入力 | 連携 | TC-MB-297 と同じ | TC-MB-296・297 の表示のときの模擬の翻訳の呼び出しを確認する | 会員・名簿の入力について Translator.translate が呼ばれていない | 16.5 / design.md Translator |
| TC-MB-299 | スタッフ向けの画面 | 正常 | S101 でログイン | フロントアプリの各画面を開く | 言語の切り替えがなく、日本語で表示される | 16.6 / design-screens.md 共通の約束（スタッフ向けは日本語のみ） |
| TC-MB-300 | スタッフ向けの画面 | 正常 | ブラウザの言語＝English、S101 でログイン | F02 を開く | 日本語で表示される | 16.6 / brief.md UI-02 |
| TC-MB-301 | スタッフ向けの画面 | 正常 | ブラウザの言語＝한국어、S201 でログイン | C02 を開く | 日本語で表示される | 16.6 / brief.md UI-02 |
| TC-MB-302 | スタッフ向けのエラー | 正常 | S201 でログイン、要求に Accept-Language: en を付ける | GET /chart | FORBIDDEN の ApiError.message が日本語（「権限がありません」）である | 16.6, 2.4 / design.md 共通の型 ApiError（スタッフ向けは日本語）、Error Handling、設計の補足 L-33 |

### 2.24 個人情報の保存と削除（3年）

前提：retention は毎日 3:00 に実行する。前提条件に書かなければ 現在＝2026-11-10 03:00 に retention を実行し、対象の会員には CONFIRMED・CHECKED_IN・PENDING_PAYMENT の予約がなく、未回収の額（CANCELLED・NO_SHOW の予約で残高が正）もない（未回収がある会員は TC-MB-388・389 で確かめる）。「登録日」は申込と確認が同じ日の会員を使う（違う日の会員は TC-MB-310 で確かめる。登録日はメールの確認が終わった日：DT-M5）。

| ID | 対象機能 | 観点 | 前提条件 | 入力値・操作手順 | 期待結果 | 対応 |
|---|---|---|---|---|---|---|
| TC-MB-303 | 自動削除（最終宿泊日） | 境界 | 会員M1：last_stay_date=2023-11-10（ちょうど3年） | retention を実行する | M1 が削除される | 19.1 / design.md P-16 手順1（last_stay_date ＋ 3年 ≦ 今日） |
| TC-MB-304 | 自動削除（最終宿泊日） | 境界 | 会員M2：last_stay_date=2023-11-11（2年364日） | retention を実行する | M2 は削除されない | 19.1 / design.md P-16 手順1 |
| TC-MB-305 | 自動削除（最終宿泊日） | 境界 | 会員M3：last_stay_date=2023-11-09（3年1日。前日までの処理で削除されていない） | retention を実行する | M3 が削除される | 19.1 / design.md P-16 手順1 |
| TC-MB-306 | 自動削除（登録日） | 境界 | 会員M4：宿泊なし（last_stay_date が空）、登録日 2023-11-10 | retention を実行する | M4 が削除される | 19.2 / design.md P-16 手順1（登録日 ＋ 3年 ≦ 今日） |
| TC-MB-307 | 自動削除（登録日） | 境界 | 会員M5：宿泊なし、登録日 2023-11-11 | retention を実行する | M5 は削除されない | 19.2 / design.md P-16 手順1 |
| TC-MB-308 | 自動削除（登録日） | 境界 | 会員M6：宿泊なし、登録日 2023-11-09（前日までの処理で削除されていない） | retention を実行する | M6 が削除される | 19.2 / design.md P-16 手順1 |
| TC-MB-309 | 自動削除（起点の選び方） | 正常 | 会員M7：登録日 2020-04-01、last_stay_date=2024-05-01 | retention を実行する | M7 は削除されない（宿泊したことがあれば最終宿泊日から数える） | 19.1, 19.2 / design.md P-16 手順1 |
| TC-MB-310 | 自動削除（登録日） | 境界 | 会員M8：宿泊なし、申込 2023-11-09、メールの確認 2023-11-11 | retention を実行する | M8 は削除されない（登録日はメールの確認が終わった日 2023-11-11。2023-11-11 ＋ 3年 ＝ 2026-11-11 ＞ 今日 2026-11-10。申込の日からは数えない：DT-M5） | 19.2 / design.md P-16 手順1、members（email_verified_at）、設計の補足 DT-M5 |
| TC-MB-311 | 自動削除（うるう日） | 境界 | 会員M9：last_stay_date=2024-02-29 | 現在＝2027-02-28 03:00、retention を実行する | M9 が削除される（2/29 の3年後は 2/28。2024-02-29 ＋ 3年 ＝ 2027-02-28 ≦ 今日：DT-M5） | 19.1 / design.md P-16 手順1、設計の補足 DT-M5 |
| TC-MB-312 | 自動削除（今後の予約） | 異常 | 会員M10：last_stay_date=2023-11-01、予約 R-M10（CONFIRMED、到着 2026-12-01） | retention を実行する | M10 は削除されない | 19.3 / design.md P-16 手順1 ② |
| TC-MB-313 | 自動削除（今後の予約） | 異常 | 会員M11：last_stay_date=2023-11-01、予約が CHECKED_IN（滞在中） | retention を実行する | M11 は削除されない | 19.3 / design.md P-16 手順1 ② |
| TC-MB-314 | 自動削除（今後の予約） | 異常 | 会員M12：last_stay_date=2023-11-01、予約が PENDING_PAYMENT（hold_expires_at=2026-11-10 03:10） | retention を実行する | M12 は削除されない | 19.3 / design.md P-16 手順1 ② |
| TC-MB-315 | 自動削除（今後の予約） | 境界 | 会員M13：last_stay_date=2023-11-01、予約が PENDING_PAYMENT（hold_expires_at=2026-11-10 02:55。hold-expiry がまだ処理していない） | retention を実行する | M13 が削除される。期限を過ぎた予約は、削除の判定の前に時間切れの処理と同じ手順で解除され（EXPIRED になる）、決済待ちに数えない（L-6） | 19.3 / design.md P-16 手順1 ②、research.md ADR-09、設計の補足 L-6 |
| TC-MB-316 | 自動削除（今後の予約） | 正常 | 会員M14：last_stay_date=2023-11-01、予約は CANCELLED と NO_SHOW だけ（どちらも残高 0円で、未回収の額はない） | retention を実行する | M14 が削除される | 19.3 / design.md P-16 手順1 ②（対象の状態は CONFIRMED・CHECKED_IN・PENDING_PAYMENT） |
| TC-MB-317 | 自動削除（今後の予約） | 状態遷移 | TC-MB-312 の後、M10 が 2026-11-10 12:00 に R-M10 をキャンセルした（キャンセル料の請求の失敗はなく、未回収の額はない） | 現在＝2026-11-11 03:00、retention を実行する | M10 が削除される | 19.1, 19.3 / design.md P-16 手順1 |
| TC-MB-318 | 削除の内容（会員） | 正常 | 会員M1（TC-MB-303）：予約 R-M1（CHECKED_OUT、名簿2名、明細3行、入金1件）、カード、セッション、確認・再設定のトークン、配信の同意の履歴を持つ | retention を実行し、members を確認する | M1 の members の行が削除されている | 19.4 / design.md P-16 手順2 |
| TC-MB-319 | 削除の内容（カード） | 連携 | TC-MB-318 と同じ | retention を実行し、member_cards と模擬の決済の呼び出しを確認する | M1 の member_cards が削除され、PaymentGateway.deleteCard が M1 のトークンで呼ばれている | 19.4 / design.md P-16 手順2 |
| TC-MB-320 | 削除の内容（セッション） | 状態遷移 | TC-MB-318 と同じ | retention の後に、M1 の Cookie で GET /me | UNAUTHENTICATED（401）で、sessions に M1 の行がない | 19.4 / design.md P-16 手順2、research.md ADR-04 |
| TC-MB-321 | 削除の内容（トークン） | 正常 | TC-MB-318 と同じ | retention を実行し、auth_tokens を確認する | M1 の auth_tokens の行が削除されている | 19.4 / design.md P-16 手順2 |
| TC-MB-322 | 削除の内容（配信の同意） | 正常 | TC-MB-318 と同じ | retention を実行し、marketing_consents を確認する | M1 の marketing_consents の行が削除されている | 19.4 / design.md P-16 手順2 |
| TC-MB-323 | 削除の内容（名簿） | 正常 | TC-MB-318 と同じ | retention を実行し、roster_entries を確認する | R-M1 の名簿2名分が削除されている | 19.4 / design.md P-16 手順2、brief.md DR-01a |
| TC-MB-324 | 残す内容（予約） | 正常 | TC-MB-318 と同じ | retention を実行し、reservations を確認する | R-M1 の行が残り、member_id が空になっている | 19.4 / design.md P-16 手順2 |
| TC-MB-325 | 残す内容（金額） | 正常 | TC-MB-318 と同じ | retention を実行し、charge_lines と payments を確認する | R-M1 の明細3行と入金1件が、件数・金額とも変わらずに残っている | 19.4 / design.md P-16 手順2、brief.md DR-01a |
| TC-MB-326 | 予告のメール | 正常 | TC-MB-318 と同じ | 2026-10-01 から retention の実行の直前（2026-11-10 02:59）までに mail_outbox に作られた行と、retention の実行で mail_outbox に追加された行を確認する | M1 宛ての削除の予告のメールが1件も作られていない（retention は M1 の mail_outbox の行を削除するので、実行の後の mail_outbox ではなく、実行の前の行と実行で追加された行で確かめる：DT-M34） | 19.5 / design.md P-16 手順2・3、設計の補足 DT-M34 |
| TC-MB-327 | 退会者の保存 | 正常 | 会員W3：2026-01-10 に退会、last_stay_date=2025-12-01、予約 R-W3（CHECKED_OUT、名簿1名） | retention を実行する | W3 は削除されず、R-W3 の予約と名簿1名分が残っている | 19.6 / design.md P-16 手順3、brief.md DR-02 |
| TC-MB-328 | 退会者の削除 | 状態遷移 | 会員W4：退会済み、last_stay_date=2023-11-10、予約 R-W4（CHECKED_OUT、名簿1名） | retention を実行する | W4 が削除され、R-W4 の名簿も削除される | 19.1, 19.6 / design.md P-16 手順2・3 |
| TC-MB-329 | 最終宿泊日の更新 | 連携 | 会員A の予約（2026-11-08・2026-11-09 の2泊、チェックイン済み、残高0円）。S101 でログイン。現在＝2026-11-10 11:00 | F12 でチェックアウトする | A の last_stay_date が 2026-11-09（最後に泊まった夜の日付）になる | 19.1 / design.md P-10 手順4、context.md 最終宿泊日 |
| TC-MB-388 | 自動削除（未回収） | 異常 | 会員M15：last_stay_date=2023-11-01（2023-11-01 ＋ 3年 ＝ 2026-11-01 ≦ 今日）。予約は R-M15 だけで、R-M15 は 04-change-cancel.md の予約A-現地 と同じ内容（スタンダード キング1室・大人2名・3泊（夜 11/16〜11/18）・現地払い）、登録カードは末尾 0341（登録は成功し決済だけを断る：L-16）。2026-11-15 10:00（無料の期限 11/14 15:00 の後）に全体をキャンセルして CANCELLED。キャンセル料は1泊目 11/16 の ROOM：単価 ⌊15,000×8,500×11÷10,000,000⌋×100＝14,000円 × 2名＝28,000円で、その FEE_CHARGE が FAILED、未回収 28,000円 | 現在＝2026-11-20 03:00、retention を実行する | M15 は削除されない（M15 の members の行と member_cards の行が残り、PaymentGateway.deleteCard は呼ばれず、R-M15 の member_id も空にならない。年数の条件を満たしていても、未回収の額があれば削除を延ばす） | 19.3 / design.md P-16 手順1 ③、payments（未回収）、設計の補足 DT-M19 |
| TC-MB-389 | 自動削除（未回収） | 状態遷移 | TC-MB-388 の後、2026-11-20 10:00 に S101 が F09 で R-M15 に 28,000円・振込（BANK_TRANSFER）の入金を記録した（残高 28,000−28,000＝0円、未回収の額がなくなった） | 現在＝2026-11-21 03:00、retention を実行する | M15 が削除される（members の行が削除され、R-M15 の member_id が空になる。未回収の額がなくなった後の回で削除する） | 19.3, 19.1 / design.md P-16 手順1 ③、設計の補足 DT-M19 |
| TC-MB-390 | 削除の内容（メールの記録） | 正常 | TC-MB-318 と同じ。加えて mail_outbox に、M1 宛て（member_id＝M1）の行が2件（RESERVATION_CONFIRMED と PRE_ARRIVAL。status=SENT）と、削除の対象でない会員C 宛ての行が1件（status=SENT）ある | retention を実行し、mail_outbox を確認する | M1 宛ての2件の行（宛先・本文を含む）が削除され、会員C 宛ての1件は宛先・本文とも変わらずに残る | 19.4 / design.md P-16 手順2（その会員の mail_outbox の行）、設計の補足 DT-M34 |
| TC-MB-391 | 削除の内容（操作履歴） | 正常 | TC-MB-318 と同じ。加えて audit_logs に、S101 が R-M1 のチェックアウトを行ったときの行（target_id＝R-M1 の id）がある | retention を実行し、audit_logs を確認する | その行は削除されず、内容も変わらずに残っている（操作履歴には初めから個人情報の値を記録しないので、削除しない） | 19.4, 18.3 / design.md P-16 手順2、設計の補足 DT-M34 |

## 3. 網羅表

重複のため削除したケースの代わりに、重複先として残した別のファイルのケース（TC-RS・TC-CH・TC-OP）も載せる。2.4 には、ほかのファイルで清掃員の FORBIDDEN を確かめているケース（TC-RS・TC-CH・TC-OP・TC-IT）も載せる。

| 受け入れ基準 | ケースID |
|---|---|
| 1.1 | TC-MB-001〜044 |
| 1.2 | TC-MB-017, TC-MB-046〜054 |
| 1.3 | TC-MB-055〜068, TC-MB-086, TC-MB-341, TC-MB-342 |
| 1.4 | TC-MB-002, TC-MB-063, TC-MB-069〜086, TC-MB-338〜340, TC-MB-342〜344, TC-MB-395, TC-MB-396, TC-MB-399, TC-MB-402 |
| 1.5 | TC-MB-045, TC-MB-087 |
| 1.6 | TC-MB-088, TC-MB-089, TC-MB-091, TC-MB-139 |
| 1.7 | TC-MB-090〜093, TC-MB-263 |
| 1.8 | TC-MB-065〜068, TC-MB-094〜106 |
| 1.9 | TC-MB-107〜120, TC-MB-397, TC-MB-398 |
| 1.10 | TC-MB-158〜166, TC-MB-350, TC-MB-351 |
| 1.11 | TC-MB-140〜147, TC-MB-149〜157, TC-MB-265, TC-MB-349, TC-MB-392〜394, TC-RS-196 |
| 1.12 | TC-MB-106, TC-MB-332〜334 |
| 1.13 | 今後の予約：TC-MB-149〜156。未回収の額：TC-MB-345〜349。エラーの順番（パスワードの誤り → 今後の予約 → 未回収。確定済みの予約の未回収は今後の予約として扱う：DT-M37）：TC-MB-392〜394 |
| 2.1 | TC-MB-167〜181, TC-MB-352〜356 |
| 2.2 | TC-MB-170〜173, TC-MB-182〜187 |
| 2.3 | TC-MB-191, TC-MB-197〜199, TC-MB-364 |
| 2.4 | TC-MB-172, TC-MB-183, TC-MB-188〜193, TC-MB-302, TC-MB-357〜372, TC-RS-221, TC-CH-066, TC-CH-146, TC-OP-021, TC-OP-132, TC-OP-264, TC-IT-057（社内用 API の役割が FRONT の28の API すべてで、清掃員の FORBIDDEN を確かめる） |
| 2.5 | TC-MB-194, TC-MB-195（確かめているのはこの2件だけ。TC-MB-196 は期待結果が「MVP では確かめない」なので載せない） |
| 15.1 | TC-MB-069, TC-MB-107, TC-MB-225〜232, TC-MB-243, TC-MB-268〜273 |
| 15.2 | TC-MB-253〜255, TC-MB-257〜260, TC-MB-335, TC-MB-336 |
| 15.3 | TC-MB-255, TC-MB-256, TC-MB-336 |
| 15.4 | TC-MB-244, TC-MB-245, TC-MB-247, TC-MB-248, TC-CH-151 |
| 15.5 | TC-MB-249〜251, TC-OP-066, TC-OP-314（現地での払い戻しの記録による REFUND_COMPLETED。DT-M33） |
| 15.6 | TC-MB-261〜265 |
| 15.7 | TC-MB-092, TC-MB-266, TC-MB-267 |
| 15.8 | TC-MB-330, TC-CH-180, TC-CH-183, TC-CH-184 |
| 16.1 | TC-MB-044, TC-MB-231, TC-MB-274〜280 |
| 16.2 | TC-MB-225〜229, TC-MB-232, TC-MB-275〜278, TC-MB-281〜285 |
| 16.3 | TC-MB-286〜290 |
| 16.4 | TC-MB-291〜295 |
| 16.5 | TC-MB-296〜298 |
| 16.6 | TC-MB-230, TC-MB-299〜302 |
| 18.1 | TC-MB-208〜210, TC-MB-212〜219, TC-MB-373〜385, TC-MB-400, TC-MB-401, TC-OP-214（1つの操作につき1行・定時処理は対象1件につき1行（L-42）：TC-MB-218, TC-MB-373〜376, TC-MB-379, TC-MB-382, TC-MB-400, TC-MB-401） |
| 18.2 | TC-MB-220〜224 |
| 18.3 | TC-MB-386, TC-MB-387, TC-MB-391 |
| 19.1 | TC-MB-303〜305, TC-MB-309, TC-MB-311, TC-MB-317, TC-MB-328, TC-MB-329, TC-MB-389 |
| 19.2 | TC-MB-306〜310 |
| 19.3 | 今後の予約：TC-MB-312〜317。未回収の額：TC-MB-388, TC-MB-389 |
| 19.4 | TC-MB-061, TC-MB-318〜325, TC-MB-390, TC-MB-391 |
| 19.5 | TC-MB-326 |
| 19.6 | TC-MB-147, TC-MB-327, TC-MB-328 |
| （追加）brief.md DR-02a：今後の予約がある会員は退会できない（2026-10-21 に要件 1.13 として加わった。1.13 の行も参照） | TC-MB-149〜157, TC-MB-392〜394 |
| （追加）design.md Security Considerations・ADR-03・ADR-04：セッション・Cookie・回数制限・公開範囲・セッションの種類 | TC-MB-003〜005, TC-MB-121〜139, TC-MB-337, TC-MB-177〜180, TC-MB-200〜207 |
| （追加）design.md P-15 のうちほかの要件のメール（4.17, 4.22, 4.23, 7.16, 8.13, 11.9）のきっかけ | TC-MB-239, TC-MB-242, TC-MB-243, TC-RS-138, TC-RS-146, TC-RS-147, TC-RS-157, TC-CH-053, TC-CH-059, TC-CH-073, TC-OP-152 |

ケースの総数：389件（TC-MB-001〜TC-MB-402 のうち、重複のため13件を削除した。5章）。期待結果が「要確認」のケースはない（2026-10-20 の中・低の論点の決定で、要確認の24件をすべて解除した。2026-10-21 の実装前のレビューの反映でも、要確認のケースは作っていない）。

## 4. 判断できない点

| Q-ID | 箇所 | 内容 | 影響するケース |
|---|---|---|---|
| Q-MB-1 | design.md auth_tokens（確認は24時間、再設定は1時間で期限切れ）、sessions、Security Considerations（会員は7日、スタッフは12時間）、定時処理 pending-cleanup | 【解決：2026-10-20 ユーザー決定（M-1）】期限ちょうどの時刻（発行または最後の操作から、ちょうど24時間・1時間・7日・12時間）で、トークンとセッションが有効か無効かが書かれていない（expires_at と現在が等しいときの扱い）。pending-cleanup がちょうど24時間前の申込を削除するかも同じ | TC-MB-077, 084, 113, 135, 179 |
| Q-MB-2 | requirements.md 1.3、design.md members（PENDING・ACTIVE の行の中で一意）、定時処理 pending-cleanup（毎日4:00）、design-screens.md G06（期限切れなら再登録の案内） | 【解決：2026-10-21 ユーザー決定（U-21、L-24）】【解決：仕様書の design-screens.md G06、requirements.md 1.4、brief.md DR-01b による】確認の期限が切れてから翌朝4:00 の削除までの間（最大で約28時間）、PENDING の行が一意の対象に残る。G06 で再登録を案内しても、同じメール・電話では EMAIL/PHONE_ALREADY_REGISTERED になる。期限切れの PENDING を重複の判定から外すのか、登録時にその行を消すのか、削除まで待たせるのかが決まっていない | TC-MB-063, 342 |
| Q-MB-3 | design-screens.md G03（EMAIL_NOT_VERIFIED で確認メールの再送ボタン）、design.md Error Handling、公開用 API の表 | 【解決：2026-10-20 ユーザー決定（L-8）】確認メールの再送を案内しているが、公開用 API の表に再送の API がない。再送できるか、再送で新しいトークンを出すときに古いトークンを無効にするか、24時間の起点が変わるかが書かれていない | TC-MB-073 |
| Q-MB-4 | design.md Security Considerations（ログインは同じ IP と ID につき1分5回まで） | 【解決：2026-10-20 ユーザー決定（L-7）】① 成功したログインも回数に数えるのか、失敗だけか ② 「1分」が固定の区切りか、直近60秒か ③ 制限がいつ解除されるか、が書かれていない | TC-MB-129, 132 |
| Q-MB-5 | design.md 公開用 API POST /auth/password-reset/request（主なエラー RATE_LIMITED） | 【解決：2026-10-20 ユーザー決定（L-7）】再設定の申込を制限する回数・時間・単位（IP かメールアドレスか）が書かれていない | TC-MB-119 |
| Q-MB-6 | design.md Security Considerations（状態を変える要求には独自のヘッダーを必須） | 【解決：2026-10-20 ユーザー決定（L-3）】ヘッダーの名前と値、欠けているときのエラーコードと HTTP ステータスが、Error Handling の表にない | TC-MB-139, 206 |
| Q-MB-7 | design.md 公開用 API POST /me/withdraw（{ password }）、design-screens.md G18（パスワードの変更は現在のパスワードが必要） | 【解決：2026-10-20 ユーザー決定（L-3）】入力したパスワード（現在のパスワード）が違うときのエラーコードが、API の表と Error Handling にない（INVALID_CREDENTIALS か VALIDATION_FAILED か） | TC-MB-099, 157 |
| Q-MB-8 | design.md 公開用 API PATCH /me、design-screens.md G18、requirements.md 1.4 | 【解決：2026-10-20 ユーザー決定（M-4）】会員情報の変更でメールアドレスを変えたとき、新しいアドレスの確認（確認メールを送り、確認が終わるまで切り替えない）が要るのかが書かれていない。1.4 は登録の時だけを定めている | TC-MB-106 |
| Q-MB-9 | design.md 公開用 API /auth/password-reset/*、brief.md DR-02 | 【解決：仕様書の brief.md DR-02、requirements.md 1.11・1.4、design.md 公開用 API による】退会済み（パスワードを削除済み）や確認前（PENDING）の会員のメールアドレスで再設定を申し込んだとき、PASSWORD_RESET を作るのか、再設定でログインできる状態に戻るのかが書かれていない（退会者がログインできるようになると DR-02 に反する） | TC-MB-120 |
| Q-MB-10 | design.md staff（is_active） | 【解決：2026-10-21 ユーザー決定（U-25、L-28）】【解決：2026-10-20 ユーザー決定（L-9）】停止中（is_active=false）のスタッフのログインの扱いとエラーコード、停止したときに既存のセッションを無効にするかが書かれていない（アカウントの停止 21.4 は後のフェーズだが、列は MVP にある） | TC-MB-181, 352 |
| Q-MB-11 | requirements.md 2.5、traceability.md 2.5（A06 後のフェーズ、RolesGuard、IT-AUTH）、design.md 社内用 API の表 | 【解決：仕様書の brief.md BG-04・RL-07、requirements.md Boundary Context・22.1、design-screens.md A06 による】社内用 API の表に、管理者だけの操作（返金・キャンセル料の免除・料金の手動変更）がない。MVP でどの API を使って「フロントは拒否・管理者は許可」を確認するのか、2.5 の確認を後のフェーズに回すのかが決まっていない | TC-MB-195, 196 |
| Q-MB-12 | brief.md DR-02a、design.md Error Handling（HAS_ACTIVE_RESERVATION） | 【解決：2026-10-21 ユーザー決定（U-03、DT-M19）。要件 1.13 に、退会できない予約の状態（確定済み・滞在中・決済待ち）と未回収の額が明記された】【解決：仕様書の brief.md DR-02a、design.md Error Handling の表の注記・P-16 手順1② による】DR-02a は退会できない予約を「確定済み・滞在中・決済待ち」とするが、Error Handling は「確定済みの予約がある会員の退会」とだけ書く。本書は DR-02a に従って期待結果を決めた。実装が CONFIRMED だけを判定するおそれがあるため、設計書の記述をそろえるか確認したい | TC-MB-149, 151, 152 |
| Q-MB-13 | brief.md DR-02a、design.md P-16 手順1 ②、research.md ADR-09 | 【解決：2026-10-20 ユーザー決定（L-6）】期限（hold_expires_at）を過ぎたが、hold-expiry（毎分）がまだ EXPIRED にしていない PENDING_PAYMENT の予約を、退会と自動削除の判定で「決済待ち」に数えるかが書かれていない（ADR-09 が読み取り時に時間切れを判定すると定めるのは在庫だけ） | TC-MB-153, 315 |
| Q-MB-14 | requirements.md 19.2、design.md P-16 手順1（登録日 ＋ 3年）、members（created_at・email_verified_at） | 【解決：2026-10-20 ユーザー決定（M-5）】「会員登録日」が申込の日（created_at）か、メールの確認が終わった日（email_verified_at）かが書かれていない | TC-MB-310 |
| Q-MB-15 | design.md P-16 手順1 | 【解決：2026-10-20 ユーザー決定（M-5）】最終宿泊日（または登録日）が 2/29 のときの「＋3年」が 2/28 か 3/1 かが書かれていない（早期割の期限には月末の規則があるが、P-16 にはない） | TC-MB-311 |
| Q-MB-16 | requirements.md 15.3（前日の10:00より後に確定したら送らない）、design.md P-15・定時処理 pre-arrival（前日10:00より前に確定したものに送る） | 【解決：2026-10-20 ユーザー決定（M-2）】ちょうど 10:00:00 に確定した予約は、どちらの記述にも当たらない。10:00 の処理の実行中に確定した予約の扱いも書かれていない | TC-MB-255 |
| Q-MB-17 | design.md 定時処理 pre-arrival、P-15 | 【解決：2026-10-20 ユーザー決定（M-2）】【解決：仕様書の requirements.md 15.2、design.md 予約の状態 による（一部。残りは 日程を変えた予約の扱いは M-2）】到着前の案内の対象の条件が「翌日に到着する」「前日10:00より前に確定した」だけで、予約の状態の条件がない。前日10:00より前にキャンセルされた予約や、日程の変更で到着日が変わった予約（confirmed_at はもとのまま）に送るかが書かれていない | TC-MB-260 |
| Q-MB-18 | requirements.md 15.4、design.md P-15（FEE_CHARGED：キャンセル料・ノーショー料の請求）、P-06、P-07 手順3 | 【解決：2026-10-20 ユーザー決定（M-6）】事前決済の予約では、キャンセル料・ノーショー料をカードに請求せず、支払い済みの額から差し引いて返金する（P-06）。このときにも FEE_CHARGED を作るのか（REFUND_COMPLETED だけか）が書かれていない。P-07 手順3 の「請求のメールを作る」が事前決済を含むかも読み取れない | TC-MB-247, 248 |
| Q-MB-19 | design.md P-15（MARKETING）、公開用・社内用 API の表、定時処理の表 | 【解決：2026-10-20 ユーザー決定（H-14）】定期配信のメールを作るきっかけ（誰が、どの画面・API・定時処理で配信するか）と配信の内容が、どこにも書かれていない。15.6・15.7 の確認の手順を決められないため、本書では「配信の作成」と書いた | TC-MB-261〜267 |
| Q-MB-20 | design.md 共通の型 ApiError（message は宿泊客向けは選んだ言語）、公開用 API の表 | 【解決：2026-10-20 ユーザー決定（L-11）】ログインしていない宿泊客が選んだ言語を API に伝える方法が、/room-types・/terms/current の lang 以外に定義されていない（Accept-Language を使うのか、画面がエラーコードから文言を出すのか） | TC-MB-284 |
| Q-MB-21 | design-screens.md G04（電話番号は数字10〜15桁、国番号を含めてよい）、design.md members（phone は数字だけに正規化） | 【解決：2026-10-20 ユーザー決定（L-10）】ハイフン・空白・「+」を入力で受け付けて取り除くのか、誤りにするのか。国番号つき（819011112222）と国内の形式（09011112222）を同じ番号として重複を判定するのかが書かれていない | TC-MB-064 |
| Q-MB-22 | requirements.md 18.1（登録・変更・削除したとき）、design.md 処理仕様の前書き・audit_logs | 【解決：仕様書の requirements.md 18.1、design.md 処理仕様の前書き・Error Strategy による】権限がない・入力の誤り・業務エラーで失敗したスタッフの操作を、操作履歴に記録するか（記録しないのか、失敗として記録するのか）が書かれていない | TC-MB-219 |

## 5. 削除したケース

重複の指摘（review-questions.md の1章、review-pre-implementation.md の R-46）により削除・統合したケース。ID は欠番にし、番号は詰めていない。

| ID | 理由（重複先のケースID） |
|---|---|
| TC-MB-148 | 重複（TC-RS-196）。F05 に退会した会員が出ないこと（5.1・5.2 の担当）（重複 No.16） |
| TC-MB-211 | 重複（TC-OP-214）。清掃員の状態の変更の操作履歴（status_changed_at なども確かめる）（重複 No.24） |
| TC-MB-233 | 重複（TC-RS-146）。現地払いの確定で予約完了のメールが1通だけ（重複 No.9） |
| TC-MB-234 | 重複（TC-RS-147）。事前決済の確定で予約完了と入金完了の2通（重複 No.10） |
| TC-MB-235 | 重複（TC-RS-138）。決済が断られたときにメールを作らない。前提の「末尾 0002 に差し替え済み」は作れない（正しさの指摘 No.3）（重複 No.11） |
| TC-MB-236 | 重複（TC-OP-152）。現地の入金で入金完了のメール（11.9 の担当）（重複 No.26） |
| TC-MB-237 | 重複（TC-RS-157）。時間切れのメール（4.17 の担当）（重複 No.12） |
| TC-MB-238 | 重複（TC-CH-059）。変更完了のメールと差額（7.16 の担当）（重複 No.17） |
| TC-MB-240 | 重複（TC-CH-053）。追加の決済が断られたら変更完了のメールを作らない。前提の「末尾 0002 に差し替え済み」は作れない（正しさの指摘 No.3）（重複 No.18） |
| TC-MB-241 | 重複（TC-CH-073）。キャンセル完了のメールと金額（8.13 の担当）（重複 No.19） |
| TC-MB-246 | 重複（TC-CH-151）。現地払いのノーショー料の請求のメール（請求額 28,000円）（重複 No.20） |
| TC-MB-252 | 重複（TC-OP-066）。下位タイプへの移動の返金完了のメール（返金額 6,400円）（重複 No.27） |
| TC-MB-331 | 重複（TC-CH-184）。現地払いの個人の予約を期限後にキャンセルし、登録カードへの請求が成功したときに PAYMENT_REQUEST を作らない（TC-CH-184 は FEE_CHARGE が SUCCEEDED・残高 0円・未回収の一覧に出ないことまで確かめる）（実装前のレビュー R-46） |
