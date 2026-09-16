共通ルールはユーザーのグローバル設定にある。読めない環境ならユーザーに確認してから作業する。

# Agentic-QA

## 目的
AIがAIの成果物を独立検証する汎用QA基盤。リポジトリ非依存・モデル交換可能。
原則: **AI consensus ≠ correctness**。finding/fixは決定論的証拠(実行結果・テスト・diff・静的検査)でのみverifiedにする。

## 構成
- 実装: Node.js 24 + TypeScript(erasable構文のみ・ビルドなしでnodeが直接実行)
- 依存は最小限。ランタイム依存ゼロを維持する
- 対象projectは隔離workspace(`runs/<run-id>/workspace`)でのみ変更する。元projectへの書き戻しはdefault OFF

## 開発ルール
- 型チェック: `npm run typecheck`
- テスト: `npm test`(node:test・外部フレームワーク禁止)
- fixture A-Hのgolden data(`fixtures/expected/`)を変えるときは理由を報告すること
- secret(APIキー・トークン・.env実値)をログ・report・コミットへ出さない。`src/util/redact.ts`のマスク対象を減らさない

## 禁止(このプロジェクト自身もSAFETY.mdに従う)
- `git push` / 外部公開 / 課金 / production操作
- audit時の対象project書き込み

## エージェント構成(opencode)
- `foreman`(primary / Ox Alpha Free / effort high): 常駐司令塔。default_agent。
- `sol`(GPT-5.6 Sol / effort high): Principal Architect / Final Auditor。INTAKE計画と監査のみ。編集権限なし。
- `ox-worker`(Ox Alpha Free / effort max): 限定タスクの実装・調査・テスト。

### フロー
新規依頼 → TRIVIAL/自明NORMAL以外は Sol INTAKE(`USER_REQUEST`/`CONTEXT`/`QUESTION` → `PLAN`/`DELEGATION`/`DONE_WHEN`)→ Foreman+Workerで実装・検証 → 完成時に必ず Sol COMPLETION監査(圧縮Checkpointのみ)→ ACCEPTで完成報告 / IMPROVE|CORRECT|REDESIGNは修正して再提出。未完成でも前回監査から3時間以上+意味のある作業境界でPERIODIC。CRITICALは即時エスカレーション。
グローバル設定のarchitect/auditor指定は、本プロジェクトではこのSol構成で置き換える。

## 詳細ドキュメント(必要時のみ読む)
- `docs/ARCHITECTURE.md` agent構成・trust boundary・data flow
- `docs/SAFETY.md` 禁止事項と権限
- `docs/TARGET_ADAPTER.md` 新しい対象projectの追加方法
- `docs/EVALUATION.md` fixture benchmarkの評価方法
