# 交接（覆寫成最新狀態，歷史看 git log）

更新：2026-10-24

## 目前狀態
- **分支**：`ccr-ca7e14bc-sjrc21`（從先前 `claude/claw-machine-game-physics-lftkbq` 的進度接續）。尚未開 PR（使用者要求時再開）。
- **測試網址**（Artifact，私人）：https://claude.ai/artifact/2gJB3MEdhskE36CRUWA2nD
  - 最新內容到 Version 8：包含檯面高度功能。程式改動後要重新建置並發布，步驟見 ARCHITECTURE「Artifact 發布」。
  - 頁面 `<title>` 維持「飛絡力夾娃娃機」；`mujoco-*.wasm` 檔名沒變時不必重傳（沒列在 `files` 的檔案會保留）。
- **測試**：40 項全部通過。

## 最近完成
- 檯面高度可調（台主模式 → 機台佈置，0～30 cm，0＝最低）：整個檯面、獎品、出貨口、擋板一起升降，天車不動。存在 `AppConfig.bedCm`，Worker 訊息 `bed`。
- 先前：防甩片在天車下、真實 JS 爪外型、16 cm 爪距、出貨口擋板高度可調。

## 下一步
- 等使用者試玩後回饋。

## 需要留意的決策
- 夾取手感依「校準基準」（見 ARCHITECTURE），改爪子幾何後要重新掃描比對。
- 拋擲的結果本來就混沌，測試只驗證趨勢；不要承諾「一定丟到某處」。
- `layoutPrizes` 產生的 z 是相對檯面；直接傳世界座標給 `ClawSimulation` 會被多加一次 `bedH`。
