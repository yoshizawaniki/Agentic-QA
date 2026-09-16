# Agentic-QA 仕様書(外部評価用)

> この文書は単体で自己完結する。別AIによる設計・実装評価のために、現行仕様・実測値・既知の限界をまとめた。
> (作成時点: 2026-08-23 / version 0.1.0)

---

## 1. 何を作ったか

Agentic-QAは「AI coding agentが生成・変更した成果物を、独立した複数のAI役割と決定論的検証で審査する」汎用QAオーケストレーション基盤。任意のプロジェクトを対象に、監査(audit)・サンドボックス修復(repair)・反復キャンペーン(campaign)・再検証(verify)をCLIから実行できる。

**最重要原則: AI consensus ≠ correctness**
複数AIが「問題ない」と同意しても証拠にならない。findingやfixが`verified`になるのは、以下のような決定論的証拠が出たときのみ:
- 実行されたテスト(gate)の合否
- fail-first testが「修正前に失敗すること」を実行確認
- mutation testingでテスト網羅の欠落を機械検出
- 不変条件(invariant)スクリプトの実行結果
- sha256 baselineとの差分(drift検出)
- 静的secret scan / README主張とゲート結果の突合

## 2. 技術スタックと制約

| 項目 | 内容 |
|---|---|
| 実行環境 | Node.js >= 23.6(型stripで .ts を直接実行、ビルド不要) |
| 言語 | TypeScript(erasable syntax only / enum・namespace禁止) |
| ランタイム依存 | **ゼロ**(devDependenciesのみ: typescript, opencode-ai, @types/node) |
| AI呼び出し | OpenCode CLI(`opencode run --agent <role>` 非対話モード)。プロジェクトローカルインストール |
| テスト | node:test 組み込み(48 tests / 外部フレームワーク禁止) |
| 対象OS | Windows実測(cmd.exeクォート問題を修正済み)/ POSIX相当コードあり |

## 3. 3層QAモデル

### Layer 1: Deterministic Gates(AIより先に実行)
- **gates**: build / typecheck / lint / test / integration_test。対象の`qa.config.json`またはauto-detection(package.json scripts等)
- **invariants**: 対象が宣言する不変条件スクリプト(metamorphic testing)。非ゼロ終了=決定論的finding(category指定可)
- **mutation testing**: 比較・論理演算子(`===`↔`!==`, `<`↔`<=`, `&&`↔`||`等)を変異させテスト実行。survived mutant = 「test suiteがその振る舞いをpinできていない」ことの決定論的証拠
- **静的検査**: secret scan(typed patterns)、READMEの「tests passing」主張 vs ゲート実行結果の照合
- ゲート失敗自体も`gate-failure` findingとして台帳に記録

### Layer 2: Independent AI Review(read-only)
6つの独立役割が別角度でレビュー:

| role | 目的 |
|---|---|
| spec-analyst | rules文書(AGENTS.md/SPEC.md等)から守るべき契約を抽出(explicit/implied区別) |
| explorer | entry points / dangerous paths / state stores の事実マップ |
| test-auditor | 既存テスト自体を疑う(assertion不足・mock隠蔽・false positive・flaky) |
| adversarial-reviewer | 「この実装は壊れる」前提でboundary/race/partial failure等の反例を探す |
| security-reviewer | secret露出/injection/authz/unsafe command |
| perf-data-reviewer | N+1/unbounded collection/transaction境界/partial state |

- 全roleはOpenCode組み込み`plan`エージェント(headlessではedit/bash権限が自動拒否)= **構造的にread-only**
- promptには共通規則(CANNOT execute commands / README信用禁止 / severity guide)を結合
- 出力契約: 最終メッセージ末尾にschema準拠JSON fenced block。パーサが抽出→検証→不正ならschemaエラーのみ返して1回再試行(timeout/transport errorはretryしない)
- 弱いモデル向けtolerant parse: bare配列・単一finding objectも自動wrap

### Layer 3: Executed Verification(fixフロー)
repair実行時の1 findingあたりのシーケンス:

```text
1. Test Designer(qa-test-designer agent, sandbox書込可)がfail-first test作成
2. テストを実行 → 「修正前にFAIL」を機械確認(bug reproduced)
3. Implementer(qa-implementer agent)が最小修正
4. 全gate再実行(regression)
5. EVIDENCE GUARD: changedFiles==0 or diff空 → その場でfailed(verifier不召喚)
6. Independent Verifier(plan agent): spec+finding+diff+実行結果のみ与える。
   Implementerの思考は渡さない(context separation)。「diff空ならrefuted」hard rule付き
7. Adversarial retest(plan agent): 「このfixを壊せ」。新たなcritical/high出現でverified不成立
8. verified = gates PASS ∧ fail-first実行確認済 ∧ verifier=verified ∧ adversarial高重大0
   条件欠けは fixed_unverified(Implementerの自己申告だけでは絶対にverifiedにならない)
```

## 4. CLI

```text
agentic-qa audit <target>       read-only総合監査(Layer1+2、元ツリー不変)
agentic-qa repair <target>      sandbox修復(--from-run <id> でaudit findings引継ぎ)
                                --competing N でN個のsandbox競合fix→最良採用
agentic-qa campaign <target>    複数round自律検証(停止条件はevidence-based)
agentic-qa verify <runId>       保存済みsandboxでゲート再実行+verifier再判定
                                regression検出時は verified→fixed_unverified 自動降格
agentic-qa init-config <target> qa.config.jsonテンプレート生成
agentic-qa eval [--ai]          fixture A-H ベンチマーク(recall/FP測定)

共通: --no-ai --model <prov/id> --review-timeout <sec> --max-mutants --no-mutation
      --from-run --max-fixes --competing --rounds --runs-dir
exit code: 0=pass / 1=gate失敗or未解決Critical/High / 2=tool error
```

campaign停止条件(round cap以外、すべてevidence-based):
- 未解決findingゼロ / 無進展かつ未解決Critical-Highゼロ / round cap
- **agent consensusでは停止しない**

## 5. Finding Ledger

JSONL台帳(`runs/<id>/findings.jsonl`)。状態遷移:

```text
suspected ──▶ reproduced ──▶ fixing? ──▶ fixed_unverified ──▶ verified
    │             │                                  │
    ├──▶ confirmed(judge/evidence承認)                ├──▶ rejected
    ├──▶ duplicate                                    └──▶ blocked
```

- `fixed`と`verified`は明確に分離。Implementer申告はfixed_unverified止まり
- フィールド: id/run_id/target/category/severity/title/claim/evidence/source_location/
  reproduction/expected/actual/confidence/deterministic_evidence/suggested_fix/
  implementer_status/verifier_status/final_status/regression_test/created_at/verified_at/status_history[]
- dedup: 同category+同file完全一致、または同category+同file+title類似≥0.35(camelCase対応token Jaccard)
- category: logic/test-quality/race/data-integrity/spec-mismatch/boundary/security/performance/
  regression/gate-failure/secret-exposure/doc-integrity/other
- severity: critical/high/medium/low(style大量計上を避けるガイドをpromptに内蔵)

## 6. Evidence Layout & Secret対策

```text
runs/<run-id>/
  manifest.json   runメタデータ(finished_at/finding_count/gates/outcomes)
  commands.jsonl  全コマンド記録(secretマスク済)
  gates.jsonl     gate結果
  findings.jsonl  台帳(status_history付き)
  logs/           各コマンドstdout/stderr(redact済)
  ai/             role出力(JSON+raw)+ 失敗時 *.failed.json/.txt(可観測性)
  verifier/       fix outcome記録
  patches/        fix差分(sandbox git diff、.opencode除外)
  workspace/      隔離sandboxコピー
  final-report.md / summary.json
```

secret対策(`src/util/redact.ts`):
- typed patterns(sk-/AKIA/ghp_/JWT/PRIVATE KEY等)、key=valueパターン(api_key=等)、
  config `secrets_env`指定env名の実値literal
- 全ログ/report/ledger出力に適用。`.env`ファイルは読まない・copyしない
- **実測**: 偽tokenをgate出力に流すprobeで全evidence CLEAN、かつ静的scanが正しく検出

## 7. 隔離モデル(Trust Boundary)

```text
original target ── read-only(hash baseline / 静的走査)
      │
      └─ copy(node_modules/.git/.env*/runs等exclude)──▶ runs/<id>/workspace/
              + ローカルgit snapshot(baseline commit SHA検証まで失敗しない)
              + node_modules はjunction link(再install不要)
```

- 元ツリーへの書き込み経路は実装上存在しない(patch適用UIすらない。ユーザー手動)
- 実行前後でsha256比較しdriftを報告(**実運用で他プロセスの外部書き込みを実際に検出した**)
- implementer/designerのbash allowlist: npm test/run, node, npx, 読み取り系のみ。
  git add/commit/push/remote、npm publish/token/login は明示deny(frontmatter permission)

## 8. モデル非依存

- 呼び出しは`AgentRunner`interface(OpencodeRunner / NoopRunner[--no-ai])
- model指定はconfig/flagでrole別交換可能(reviewer/verifier/implementer)
- AI層は任意のタイミングで欠落してよい: quota枯渇・model不在時はFAILED/skippedと記録され、決定論的レイヤーだけで完結(graceful degradationを実測確認)
- エラー分類: rate-limit / tool-use非対応モデル / 空応答(provider throttling) / timeout を区別報告

## 9. 実測結果

### fixture benchmark(8個の埋め込みbugプロジェクト+golden期待値)

| fixture | 埋め込み問題 | 決定論的検出経路 |
|---|---|---|
| A | clamp上限でminを返すcopy-paste bug | invariant(spec properties) |
| B | testがbuggy実装に合わせpercent契約を誤記+threshold境界test弱い | mutation(survived mutant) |
| C | async read-modify-write lost update | invariant(並列increment) |
| D | 送金部分state残留+失敗IDがretryを毒す | invariant(atomicity/idempotency) |
| E | 実装score昇順 vs SPEC降順+tie-break | invariant(spec order) |
| F | Feb=29固定(leap境界無視) | invariant(month table) |
| G | formatDateがoffset引数無視(regression trap併設) | invariant(offset boundary) |
| H | suiteが実際FAILなのにREADME「All tests passing」 | gate失敗+doc-integrity |

- **deterministic mode: macro recall 52.9% / FP = 0**(未検出分はAI推論が必要なクラス)
- AI mode(部分実施): fixture-eでspec-mismatch@src/ranking.js(critical)+tie-break欠落(logic)を検出、
  fixture-bで3/3全検出。fixture-aではtest gap特定止まり(model能力差がそのまま出る)
- AI-backed repair E2E実績(fixture-a, zen free model): invariant違反→fail-first test→修正前FAIL確認→
  修正→regression PASS→verifier verified→adversarial retest→**status=verified**。元fixtureは無変更

### 反復検証ラウンド(停止条件: 新規再現可能問題3連続ゼロ)

R1-R9実施。発見・修正した自己欠陥:
1. **cmd.exeクォートバグ(重大)**: spawnのquote二重包装でgit commit -m "..."が全sandboxで静的失敗→空diffのままverified成立しかけた。windowsVerbatimArguments+外側quote制御+snapshot失敗throw で修正
2. evidence guard不在(changedFiles=0でもverifier召喚)→ hard guard追加
3. --competingで勝者sandboxが放置→workspace promote実装
4. repair manifest未finalize → 修正
5. tool非対応デフォルトモデルで全role死 → エラー分類+警告
6. 近似重複finding → title類似dedup
7. config parse errorにパス欠落 → 修正
8. timeout後retryでwall time倍増 → retry政策修正
9. 失敗AI応答の消失 → saveAiFailure(raw保存)

R7-R9で新規ゼロ → 停止。

## 10. 既知の限界・未検証(正直な開示)

1. **AI eval残り**: fixture-c〜hのAI層測定は無料モデルquota(Zen無応答ハング/OpenRouter日次制限)により未完。ゴールデン較正判断(例: fixture-aで「test gap特定」をgoldenに含めるか)も測定完了後に系統実施予定
2. **AI repairの大規模実証**: 小fixtureでのみ実証。実プロジェクトへのrepair適用はユーザー承認事項として未実施
3. **node_modules junctionの共有書き込み**: sandbox内テストがnode_modules内部キャッシュへ書くと物理的には元ツリーのnode_modulesに影響しうる(documented tradeoff)。完全分離が必要ならcopy+installモードが要実装
4. **mutation engine範囲**: JS/TSの演算子変異のみ。定数変異・文削除・戻り値変異は未実装。他言語未対応
5. **property-based自動抽出**: invariantは手動宣言のみ。対象コードからの自動提案は未実装
6. **同一モデル相関誤差**: context separationはprompt/processレベルだが、モデル多様化(役割別provider分散)は未実施
7. **self-improvement**: 意図的に未実装(固定benchmark holdout先行)
8. **Windows前提の実測**: POSIX側コードはあるが実測はWindowsのみ

## 11. レビュアーへの評価依頼事項

1. **原則適合性**: 「AI多数決ではなく実行可能証拠で判定」という設計は本仕様の各所で一貫しているか。抜け穴(例: verifier/judgeのAI判断が事実上の最終決定になっていないか)はどこか
2. **Layer構成の妥当性**: mutation/invariant/static scanの組み合わせで決定論的に捕まえられる問題クラスの網羅率と、過剰検出リスクのトレードオフ評価
3. **context separation の実効性**: verifierへの入力制限(diff+実行結果のみ)は十分か。adversarial retest「壊せ」方式の効果と限界
4. **隔離モデルの穴**: junction node_modules共有、plan agentのheadless権限自動拒否への依存、cmd.exeクォート類の他プラットフォーム罠など
5. **ステータス遷移の健全性**: fixed≠verified分離、evidence guard、verify downgradeの設計に欠落はないか
6. **ベンチマークの正当性**: golden較正を測定完了まで凍結する方針、FP定義(重複-but-valid扱い)の妥当性
7. **優先度の助言**: 未実装リスト(§10)のうち、実用性向上に対する推奨順位
