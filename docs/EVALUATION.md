# EVALUATION — fixture benchmark

## 目的

Agentic-QA自身の検出能力を、**意図的にbugを埋め込んだfixture**で測定する。AIの文章ではなく実行結果で評価する。

## Fixture一覧とgolden data

| fixture | 埋め込みbug | 決定論的検出経路 | AI層が必要な検出 |
|---|---|---|---|
| A | clamp上限でminを返すcopy-paste bug | invariant(spec properties) | logic finding(箇所特定) |
| B | testがbuggy実装に合わせてpercent契約を誤記 / threshold境界testが弱い | mutation testing(survived mutant) | spec-mismatch(README vs code)、test assertionの仕様乖離 |
| C | async read-modify-writeのlost update | invariant(並列increment) | race finding |
| D | 送金の部分state残留 + 失敗IDがretryを毒する | invariant(atomicity/idempotency) | data-integrity(箇所特定) |
| E | 実装はscore昇順、SPECは降順+tie-break | invariant(spec order) | spec-mismatch |
| F | Feb=29固定(leap境界) | invariant(month table) | boundary(箇所特定) |
| G | formatDateがoffset引数を無視 | invariant(offset boundary) | logic + regression trapの指摘 |
| H | suiteが実際FAILするのにREADME「All tests passing」 | gate失敗 + README照合(doc-integrity) | — |

golden data: `fixtures/expected/fixture-*.json`。**変更時は理由を報告すること**(AGENTS.md規則)。

## 評価方法

```powershell
node src/cli.ts eval        # 決定論的モード(--no-ai相当)
node src/cli.ts eval --ai   # AI層込み
```

- 各fixtureに対しauditを実行しfindingsをgoldenと照合
- match条件: (category一致 AND file一致) OR file anchor OR keyword anchor(`src/eval/evaluate.ts` の `matchesExpected`)
- 出力: fixture別 recall / false positive / macro recall
- 結果JSON: `runs/eval-<stamp>-<mode>/eval-summary.json`

## 実測値(2026-08-22, deterministic mode)

```text
macro recall: 52.9%   false positives: 0
fixture-a  50% (1/2)   b  33% (1/3)   c  50% (1/2)   d  50% (1/2)
fixture-e  50% (1/2)   f  50% (1/2)   g  50% (1/2)   h 100% (2/2)
```

- 決定論的のみで **FPゼロ** を維持している(過検出しない)
- 未検出分はすべて「AIの推論がないと見つけられないクラス」(spec/code乖離の箇所特定、race原因特定等)。AI層込みではrecall上昇を見込むが、モデルquota等により日々変動する
- AI層の動作実績: fixture-eでexplorerが「implementation incorrectly sorts by score ascending and ignores tie-breaking」をarchitecture summaryとして正しく特定(spec-analyst/explorerは成功、残りroleはOpenRouter無料枠の日次制限でskip→graceful degradation確認済み)

## 追加検証(2026-08-22 第2ラウンド)

AI-backed repair E2E(fixture-a, opencode/mimo-v2.5-free):
- invariant違反 → fail-first test設計 → **修正前実行でFAIL確認** → sandbox修正(`return min`→`return max`) → 全gate再PASS → 独立verifier=verified → adversarial retest → **status=verified**
- 元fixtureは無変更(patchはsandboxにのみ存在)

このE2Eで発見・修正したAgentic-QA自身の欠陥:
1. **cmd.exeクォートバグ**(重大): spawn時のquote二重包装で`git commit -m "..."`が全sandboxで静的失敗→diff/patchが空のまま「verified」が成立していた。exec.tsを/windowsVerbatimArguments+外側quote制御に修正し、snapshot失敗時はthrowするよう硬化
2. **evidence guard不在**: changedFiles=0でもverifierが呼ばれ得た。空diffでは必ずfailedになるガード+verifier promptに「diff空ならrefuted」のhard rule追加
3. **--competingで勝者workspaceが放置される**: 主workspace/patchに修正が反映されない。勝者sandboxを`workspace/`へpromoteするよう修正
4. verify失敗時のサイレント握りつぶし→warnログ追加

その他の追加検証:
- campaign実走(round cap停止、blocked候補の再試行なし)✅
- --competing 2実走(2 sandbox完全走査→最良採用→promotion→patch=1行fix)✅
- verify downgrade path: 保存済みfixed workspaceにbugを再注入→gates FAIL→verified→fixed_unverifiedへ自動降格、exit 1 ✅
- 並列audit×2(別対象): run dir分離・junction競合なし ✅
- 全evidenceファイルのsecret pattern grep: **CLEAN** ✅

## 反復検証ラウンド記録(2026-08-22〜23、停止条件: 新規再現可能問題3連続ゼロ)

| Round | 内容 | 新規問題 |
|---|---|---|
| R1 | AI呼び出し信頼性(timeout時retry廃止/--review-timeout flag/失敗時raw保存)→fixture-e全role成功確認 | (修正済み問題の再発なし) |
| R2 | eval --ai開始。a/b完済。**tool非対応デフォルトモデル問題**(gemini-imageが選ばれ全滅→エラー分類+警告実装)、**近似重複finding問題**(title類似dedup実装)。c/dはZen無応答ハングで環境ブロック | 2件(修正済) |
| R3 | 回帰スイープ(typecheck/test/eval-det 52.9%/FP0/dogfood/YT-lab隔離) | **0件** |
| R4 | 堅牢性(壊れたconfig/BOM+CRLF/gate無し素dir/unicode名/中断復帰) | 1件: config parse errorにファイルパス欠落→修正 |
| R5 | 安全性(.env非copy/forbidden_paths排除/log redaction/secret scan発動) | **0件** |
| R6 | evidence整合性(report照合/campaign-summary/CLI UX) | 1件: repair manifest未完finalize→修正 |
| R7-R9 | report深検証・同一対象並列audit・gate timeout強制・mutation timeout・init-config二重防止・CLI error paths | **0件×3連続 → 停止条件達成** |

AI eval残り(fixture-c〜hのAI層測定とゴールデン較正判定)はフリープール回復後の継続項目。

## 正本KPI(2026-08-23 外部評価で確定)

Agentic-QAの評価は以下の4指標を正本とする。recall単独より**False Verification Rate**を重視:

| KPI | 定義 |
|---|---|
| Finding Recall | 植え込み問題のうち検出された割合(Layer1単独/Layer2追加後の2段で報告) |
| Finding Precision | 報告findingのうち実問題である割合 |
| Repair Success | 修正試行のうち全条件を満たした割合 |
| **False Verification Rate** | `verified`になったfixのうち、実際には誤っていた割合(究極KPI) |

`verified`の規範定義(src/types.ts冒頭にも記載):
> 正しさの証明ではない。「本システムが利用可能な全検証ステップ(決定論的ゲート+fail-first実行確認+独立verifier+adversarial retest)を通過した」状態。既存テスト/不変条件が覆盖しない仕様側面は壊れたままの可能性がある。

fixture層分離方針: 改良用(DEV)/回帰確認(VALIDATION)/較正禁止(HOLDOUT)に分割し、
golden凍結方針と合わせて運用する(現行8fixtureは全てVALIDATION扱い、DEV/HOLDOUTは拡張時に導入)。

## S優先項目の実施結果(2026-08-23)

### S1: AI fixture eval 完走 ✅
全8fixtureをzen free model(mimo-v2.5-free)で実施:
**AI-mode macro recall = 100%(17/17)、真のFP = 0。**
副次finding(test gap指摘・invariant未接続指摘等)16件は`expected_adjacent`として
分計上し、recall/precision会計から分離(golden較正は測定完走後に実施——方針通り)。

### S3: False Verification benchmark ✅ 準備完了
`fixtures/fixture-i`(false-verification trap): case-insensitive dedup契約の修正が、
naive fixだとclause 2(order)/clause 3(non-array)を破る設計。probe protocolはgolden内
`_probe_protocol`に記載。repair実行時にverifier/adversarialが誤fixをrefuteできるかで
False Verification Rateを直接測定する。

### 本ラウンドで発見・修正した追加欠陥
1. **agent mode fallback(安全モデル修正)**: `mode: subagent`のagentはheadless `--agent`で
   buildへフォールバックしallowlistが無効だった→`mode: all`に修正+SAFETY.mdを実態に合わせ更新
   (多層防御の正本はcwd分離+external_directory拒否+drift検出)
2. PowerShell UTF-8 BOM入りJSON→読込側でBOM耐性
3. rescore時「最新run」選定ロジックの比較バグ→修正
4. `--from-run`のネストruns dir非対応→解決

## 解釈の注意

- recall 100%を目標にしない。決定論的層の役割は**FPゼロでの機械的検出**、AI層はrecall向上、Verifier/Judgeが精度を守る三段構成
- goldenを検出器に合わせて調整してはいけない(goldenは仕様側の期待値)
- モデル・プロンプト・workflow変更後は必ずこのbenchmarkを再実行して比較する(self-improvement導入前の固定holdout)
