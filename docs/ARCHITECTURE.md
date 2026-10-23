# 架構

玩法與 A–G 設定的說明見 `README.md`，這份只記錄程式結構與設計依據。

## 執行緒
- **Worker**（`worker/physicsWorker.ts`）：
  - 擁有 `ClawSimulation` 與 `Board`。
  - 物理每步 2 ms；`sim.step(dt, h => board.update(h, sim))` 讓中控板在每個物理步都讀感測器、驅動馬達。
  - 單次最多補算 50 ms。
- **主執行緒**（`main.ts`）：只負責繪圖與介面。
  - 收到 `model` 訊息就重建所有 mesh。
  - 收到 `frame` 訊息（geom 位置與姿態陣列、中控板快照、事件）就更新畫面。
- **回壓**：Worker 送出一格後，要等主執行緒回 `ack` 才送下一格；未送出的事件暫存到下一格一起送。慢的裝置不會累積訊息。

## 一局的資料流
1. 輸入（`ui/hud.ts`）→ `ToWorker` 訊息 → `Board`。
2. `Board` 透過 `MachineIO` 驅動機台：
   - `setGantryVelocity`：天車馬達
   - `setWinchVelocity`：絞盤
   - `setClawVoltage`：電磁閥
3. `ClawSimulation` 執行物理步進；落物電眼觸發 `onPrizeDrop` → `Board.prizeDropped()` 記帳。
4. 送出 frame → `MachineScene.updateFrame`，HUD 與面板同步更新。
5. 設定變更：
   - 中控設定（A–G）只更新 `Board`。
   - 爪子幾何、擋板高度、獎品擺放會重建 MJCF；`rebuild()` 會保留獎品位置。
   - 爪套摩擦直接改執行中的模型（`geom_friction`），不重建。

## 物理模型要點
- **鋼索**：spatial tendon，只能拉不能推；絞盤改的是 `tendon_range` 上限。
  - 爪子著地的判斷：鋼索鬆弛超過 8 mm。
- **到頂**：
  - 防甩片直接貼在天車底下，同時當上停擋塊：到 `ropeTop` 時頂蓋剛好碰到；上停上拉會拉到 `ropeMin`，頂進防甩片。
  - 防甩片的幾何是一段弧，弧上那一點的斜率決定側向推力的方向（`antiSwingProfile`）。
- **電磁閥**（`solenoid.ts`）：I=V/16 Ω，鐵芯飽和，拉力與 I² 成正比，爪子越閉合拉力越大；電壓切換有 30 ms 的 L/R 漸變。回位彈簧在爪臂關節上。
- **爪套摩擦**：MuJoCo 預設取兩個接觸面摩擦的最大值，所以爪子零件設 `priority="1"`，接觸時以爪套材質為準。
- **控制板常數**（`controller.ts`）：
  - `GANTRY_SPEED` 0.2 m/s
  - `WINCH_SPEED` 0.32 m/s
  - `B4_STEP` 每格 1.8 cm
  - 合爪後 0.08 s 開始上升，讓爪子一邊收一邊被提起，避免重量壓住爪尖。

## 校準基準（改物理要重跑比對）
- **爪力**：`TORQUE_48V` = 0.3 N·m，換算 48 V 時單爪尖約 2.3 N。
- **夾取成功率**：預設爪距 16 cm，在多種瞄準偏移下：

  | 電壓 | 成功率 |
  |---|---|
  | 48 V | 約 83% |
  | 32 V | 約 69% |
  | 22 V | 約 39% |
  | 14 V | 0% |

  掃描方法：小娃娃、中娃娃、餅乾盒 × 6 種偏移 × 2 種朝向，判斷「上升後高於 0.2 m」。
- 速度：瀏覽器 Worker 裡算 1 秒物理約 0.3 秒；Node 中比即時快約 3.5 倍。

## 測試策略
- 中控板：`tests/controller.test.ts` 用理想化的 `FakeMachine`，驗證時序與設定語意。
- 物理：`tests/physics.test.ts` 驗證可量化的物理行為（單擺週期、摩擦臨界角、側向推力方向等）。混沌的結果（甩出落點）用多組平均或放開瞬間的速度判斷。
- 整局：`tests/game.test.ts` 跑 `Board` 加物理，驗證保夾局會中獎、弱電壓 0 V 會中途掉落。
- 瀏覽器：用 Playwright 截圖（Chromium 在 `/opt/pw-browsers`），`window.claw` 提供 `send` / `board` / `frame` / `geomPos` 給腳本操作。

## Artifact 發布（claude.ai 測試網址）
1. `npm run build`。
2. 頁面檔案：把 `dist/index.html` 的 `<body>` 內容與 `<title>` 取出，CSS 內嵌成 `<style>`，script 改用相對路徑 `./assets/index-*.js`。不能自帶 `<html>`／`<head>`。
3. 用 Artifact 工具發布，`files` 帶上 `assets/index-*.js`、`assets/physicsWorker-*.js`、`assets/mujoco-*.wasm`（contentType `application/wasm`）。舊的 js 檔名用 `null` 移除。
4. 從新對話更新同一網址：傳入網址（見 HANDOFF），並先用 `read` 讀取現有頁面。
