# ARCHITECTURE

## 概要

Agentic-QAは「AIの主張をAIの多数決で検証する」のではない。**複数の独立したAIが再現可能な証拠を探し、最終的に実行結果・テスト・実データで正しさを判定する**QA基盤である。

```text
┌────────────────────────────────────────────────────────────┐
│ CLI (src/cli.ts)  audit / repair / campaign / verify / eval │
└──────────────┬─────────────────────────────────────────────┘
               │
        ┌──────▼───────┐
        │  Pipelines   │ audit.ts / repair.ts / campaign.ts / verifyRun.ts
        └──┬───────┬───┘
           │       │
   Layer1  │       │ Layer2/3
   決定論的  │       │ AI roles (opencode run --agent)
           ▼       ▼
┌──────────────────────────────────────────────────────────────┐
│ gates/(index static mutation)      ai/(runner invoke prompts) │
│ core/(exec evidence findings sandbox baseline workspace)      │
│ config/(detect load)   util/(schema redact jsonl ids)         │
└──────────────────────────────────────────────────────────────┘
               │
        runs/<run-id>/  (evidence ledger)
```

## 3層QAモデル

### Layer 1: Deterministic Gates（AI判断より先に実行）
- build / typecheck / lint / test / integration test — 対象の`qa.config.json`またはauto-detect
- **invariant gates** — 対象が宣言する不変条件スクリプト(metamorphic testing, §15)。fixture C/D/E/F/Gはこれで決定論的に検出される
- **mutation testing** — 比較・論理演算子を変異させテストが検出できるか検査。survived mutant = test-suite gap の決定論的証拠(fixture B)
- secret scan / README主張とゲート結果の照合(fixture H)
- ゲート失敗自体も `gate-failure` findingとして台帳に記録

### Layer 2: Independent AI Review（別角度のread-onlyレビュー）
| role | agent | 目的 |
|---|---|---|
| spec-analyst | plan | rules文書から守るべき契約を抽出(推測と明文化を分離) |
| explorer | plan | entry points / dangerous paths / state stores |
| test-auditor | plan | 既存test自体を疑う(assertion不足・mock隠蔽・false positive) |
| adversarial-reviewer | plan | 「このコードは壊れる」前提で反例を探す |
| security-reviewer | plan | secret/injection/authz/unsafe command |
| perf-data-reviewer | plan | N+1/unbounded collection/partial failure |

- 全roleはOpenCode組み込み`plan`agent(headlessではedit/bash権限が自動拒否)で動作 → **構造的にread-only**
- 出力契約: 最終メッセージ末尾にschema準拠JSON。パーサが抽出・検証し、不正なら1回のみschemaエラーだけを返して再試行(context分離を壊さない)

### Layer 3: Executed Verification
- fail-first test を実際に実行し「修正前にFAILすること」を機械的に確認
- 修正後、全gate再実行(regression)
- 独立Verifier(plan agent)が diff + 実行結果のみで判定。**Implementerの自己正当化は渡さない**
- adversarial retest: 「このfixを壊せ」という役割で再試験
- `verified` は「gates PASS + fail-first確認済み + verifier=verified + adversarial高重大0」の全条件が揃ったときだけ

## Trust Boundary

```text
original target ──(read-only: hash baseline / 静的走査)──▶ Agentic-QA
       │
       └─ copy(exclude node_modules/.git/.env*) ──▶ runs/<id>/workspace/
                node_modules:
                fast(default) = junction share
                strict        = physical copy (--strict-isolation)
                     │
              gates / mutation / AI work はすべてここで実行
```

- 元ツリーへの書き込み経路は**実装上存在しない**(patch適用はユーザー手動)
- 実行前後でsha256 baseline比較し、外部要因によるdriftを検出・報告
- sandbox内にはローカルgitリポジトリを作りdiff生成。元repoの`.git`は触らない
- strict isolationはdependency treeを物理copyしてnode_modules cache書込の共有を避ける。代償はdisk/copy costであり、OSレベルsandboxを意味しない

## Context Separation

- Verifierへの入力: specification + finding + diff + 実行evidenceのみ。Implementerの思考は意図的に遮断
- 同一モデルでもroleごとに独立プロセス(opencode run)なのでsession contextは分離
- adversarial retestは「承認せよ」ではなく「壊せ」の役割プロンプト
- Judgeはevidence表とverifier結果のみでaccept/reject。deterministic_evidence付きfindingはrejectしない設計

## モデル非依存

- 呼び出しは `AgentRunner` interface越し。実装: `OpencodeRunner`(CLI) / `NoopRunner`(--no-ai)
- model指定はconfig/CLIフラグ(`--model`, `--verifier-model`, `--implementer-model`)でrole別に交換可能
- OpenCode未導入・クォータ枯渇時はAI層がFAILED/skippedになり、決定論的層だけで完結(graceful degradation)

## データフロー(evidence ledger)

全ての主張は`runs/<run-id>/`以下のファイルで追跡可能:
`findings.jsonl`(状態遷移履歴つき) / `commands.jsonl`(redact済み全コマンド) / `logs/` / `ai/*.json+raw.txt` / `verifier/*.json` / `patches/`

secretは`src/util/redact.ts`が全ログ・レポート出力に対してマスク(typed patterns + env値literal + key=valueパターン)。`.env`実ファイルは読まない・sandboxへコピーしない。
