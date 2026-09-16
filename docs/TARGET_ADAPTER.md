# TARGET_ADAPTER — 新しい対象projectの追加方法

## 原則

- 対象project固有のhardcodeはAgentic-QA本体に書かない。すべてconfig(`qa.config.json`) + auto-detectionで扱う
- auto-detectできるもの(package.json scripts等)をユーザーに設定させない

## 最小手順(設定ゼロ)

Node.js系projectなら多くの場合、設定なしで動く:

```powershell
node src/cli.ts audit D:\path\to\project --no-ai
```

auto-detectionが行うこと:
- `package.json` の `scripts.test/typecheck/lint/build` を各gateに対応付け
- `tsconfig.json` + ローカルtsc がある場合 `typecheck` gateを推定
- `qa.config.json` / `agentic-qa.config.json` があれば読み込んで上書きmerge
- sandbox除外(node_modules/.git/.env*/dist/coverage等)はdefault適用

## qa.config.json

```jsonc
{
  "target": { "root": ".", "name": "optional-name" },
  "rules": ["AGENTS.md", "SPEC.md", "docs"],        // spec-analystが読む正本文書
  "gates": {
    "typecheck": { "cmd": "npm run typecheck", "timeout_sec": 180 },
    "lint":      { "cmd": "npm run lint" },
    "build":     { "cmd": "npm run build" },
    "test":      { "cmd": "npm test", "timeout_sec": 300 },
    "integration_test": { "cmd": "npm run test:integration" }
  },
  "invariants": [
    // 不変条件(metamorphic checks)。非zero終了 = 決定論的finding
    { "name": "pagination-no-dup-or-loss", "cmd": "node scripts/invariants/pagination.js", "category": "data-integrity" }
  ],
  "forbidden_paths": [".env", "*.db"],              // sandbox copyから除外
  "sandbox": { "exclude_globs": ["big-data/**"] },  // default除外に追加
  "environment": {},                                 // gateコマンドへ渡すenv(実値secret禁止)
  "secrets_env": ["EXAMPLE_API_KEY"],                   // このenv名の値をログからマスク
  "ai": {
    "enabled": true,
    "reviewer_model": null,     // nullならopencodeの既定モデル
    "verifier_model": null,
    "implementer_model": null,
    "concurrency": 1,
    "review_timeout_sec": 600
  },
  "mutation": { "enabled": true, "max_mutants": 8, "timeout_sec": 120, "include": [] },
  "limits": { "max_fix_rounds": 2, "campaign_max_rounds": 3 }
}
```

生成: `node src/cli.ts init-config <target>`

## 不変条件スクリプトの書き方(推奨)

明示的なexpected valueを作りづらい対象でも「成立すべき不変条件」は宣言できる:

- 同じ入力→同じ結果(determinism)
- paginationで欠落・重複なし
- retryしても二重writeしない
- transaction失敗後にpartial stateを残さない
- 過去データが未来情報で変化しない

要件: `process.exit(0)` 成功 / 非0+stderrで違反内容。Agentic-QAはこれを実行し、違反を決定論的evidenceとして記録する。

## 非Node project(Python等)

現時点のauto-detectはNode中心。Python等は `qa.config.json` でgateコマンドを明示すれば動作する:

```jsonc
{
  "gates": {
    "lint":   { "cmd": "python -m ruff check ." },
    "typecheck": { "cmd": "python -m mypy ." },
    "test":   { "cmd": "python -m pytest -q" }
  },
  "mutation": { "enabled": false }
}
```

mutation testerの変異エンジンはJS/TS向け(.js/.mjs/.ts)。他言語は無効化するか将来adapter拡張で対応。

## 大きなリポジトリのコツ

- `rules` に正本文書(SPEC.md等)を限定指定する(spec-analystのcontext爆発防止)
- 重いbuild/integration gateは`timeout_sec`を明示、または最初のauditでは外す
- `secrets_env` に対象のAPIキーenv名を列挙する
- scheduler/外部APIを起動しうるstartコマンドはMVPでは使わない(gateのみ)
