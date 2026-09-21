# SAFETY

## 絶対禁止(このプロジェクト自身も従う)

- `git push` / `git remote` 操作
- `npm publish` / `npm token` / `npm login`
- production deploy / production DB書き込み / 外部公開 / 課金
- 対象projectの元ツリーへの書き込み(audit/repairとも)
- secretのログ・レポート・コミットへの出力

## 権限マトリクス

| role | read | write | bash | 実装による強制 |
|---|---|---|---|---|
| spec-analyst | ○(対象) | ✕ | ✕ | opencode `plan` agent(headlessでedit/bash自動拒否) |
| explorer | ○ | ✕ | ✕ | 同上 |
| test-auditor / adversarial / security / perf | ○ | ✕ | ✕ | 同上 |
| verifier / judge | ○ | ✕ | ✕ | 同上 |
| test-designer | ○ | sandboxのみ | 限定allowlist | `.opencode/agent/qa-test-designer.md` のpermission |
| implementer | ○ | sandboxのみ | 限定allowlist | `.opencode/agent/qa-implementer.md` のpermission |

- implementer/designerのbash allowlist: `npm test/run`, `node`, `npx`, `git status/diff/log/show`(sandbox内), 読み取り系コマンド。`*`はdeny。**`git add`/`git commit`(作業tree差分を壊すため)**、`git push`/`remote`/`worktree`、`npm publish/token/login/install`(designer)は明示deny
- agent frontmatterは`mode: all`(headlessの`--agent`でprimaryとしてロードさせ、permissionを効かせる。subagentモードだとbuildへフォールバックしallowlistが無効になる——2026-08-23に実測・修正)
- **多層防御の正本**: ①sandbox cwd(書き込み先を物理的に分離)②external_directory拒否(opencode既定)③allowlist(agent permission)。②③はOpenCode側仕様に依存するため、baseline hash比較によるdrift検出を最終裏付けとして運用する
- 書き込み先は常に`runs/<run-id>/workspace/`配下のコピー

## 隔離の設計

1. audit開始時に対象をexclude付きコピー(node_modules/.git/.env*/_trash等を除く)し、sandboxにローカルgitスナップショットを作成
2. gates・mutation・AI作業はすべてsandbox内で実行
3. node_modulesは既定のfast modeではjunction linkで共有(再install不要)。**注意**: node_modules内部cacheへの書き込みは元ツリー側の依存treeに影響しうる。より強い隔離が必要なら `--strict-isolation` または `sandbox.node_modules_mode: "copy"` を使い、依存treeをsandboxへ物理copyする
   - strict modeはnetwork/install不要だが、大規模node_modulesではdisk使用量とcopy時間が増える
   - copy時はsymlinkをdereferenceする。通常npm treeでは元依存treeへの書込共有を避けられるが、OS/containerレベルのsecurity sandboxではない
4. 実行前後でsha256 baselineを比較し、driftがあればfindingとして報告
5. 元への反映は`patches/all-fixes.patch`をユーザーが目視確認して自分で適用する(Agentic-QAに適用コマンドは存在しない)

## Secret取り扱い

- `src/util/redact.ts`: typed secretパターン(sk-/AKIA/ghp_/JWT/PRIVATE KEY等)、key=valueパターン(api_key=, password: 等)、config `secrets_env` で指定した環境変数の実値literalを全出力に対してマスク
- `.env`ファイルは走査・コピー・読込のいずれもしない
- fixture/テストにもダミーsecret以外を置かない
- マスク対象を減らす変更は禁止

## 停止条件(ユーザー承認が必要になるケース)

- 上記絶対禁止に触れる要求が来たとき
- 対象projectの元ツリー変更が必要になったとき(patch適用手順の提示のみ行う)
