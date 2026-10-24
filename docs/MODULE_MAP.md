# 模組索引

路徑都在 `src/` 下。箭頭（→）表示依賴哪些模組。

| 模組 | 目錄 | 關鍵檔案 | 負責 | 依賴 |
|---|---|---|---|---|
| 物理 | `sim/` | `simulation.ts`（`ClawSimulation`）、`mjcf.ts`（`buildMjcf`） | MuJoCo 模型產生與步進、絞盤、電磁閥、落物電眼、改變幾何時重建模型 | 無 |
| 機台參數 | `sim/` | `cabinet.ts`（`CABINET`）、`clawConfig.ts`、`prizes.ts`、`solenoid.ts` | 機台尺寸與鋼索常數、爪子機構調整、獎品種類與擺放、電壓→爪力 | 無 |
| 中控板 | `machine/` | `controller.ts`（`Board`、`MachineIO`）、`settings.ts`（`MENU`） | 一局的狀態機、電壓分段、保夾、帳目、自動模式；A–G 設定定義 | → sim/cabinet |
| Worker | `worker/` | `physicsWorker.ts`、`protocol.ts` | 在 Worker 內以 500 Hz 跑物理＋中控板；主執行緒與 Worker 之間的訊息型別 | → sim、machine |
| 繪圖 | `render/` | `scene.ts`（`MachineScene`）、`textures.ts` | Three.js 場景；依 geom 名稱上材質；機台外殼裝飾；視角 | → worker/protocol |
| 介面 | `ui/` | `hud.ts`、`operatorPanel.ts`、`lcd.ts` | 玩家操作；台主模式五個分頁（中控面板／參數表／爪子調整／機台佈置／物理監看） | → machine、sim、app |
| 設定保存 | `app/` | `state.ts`（`AppConfig`） | localStorage 存取、舊存檔相容 | → machine、sim |
| 音效 | `audio/` | `sfx.ts` | WebAudio 合成音效 | → machine |
| 進入點 | `src/` | `main.ts` | 組裝以上模組、處理 Worker 訊息、`window.claw` 測試掛鉤 | 全部 |
| 測試 | `tests/` | `controller` / `physics` / `game` / `compile` `.test.ts`、`helpers.ts` | 中控板邏輯（假機台）、物理驗證、整局遊戲、建模冒煙測試 | sim、machine |

## 常見需求 → 先看哪裡

| 需求 | 位置 |
|---|---|
| 爪子外型、爪頭、爪臂 | `sim/mjcf.ts`：`HEAD`、`ARM_SHAPE`、`armGeometry`、`clawXml` |
| 爪力、電壓手感 | `sim/solenoid.ts` 的 `TORQUE_48V`；`sim/mjcf.ts` 的 `ARM_SPRING*` |
| 防甩片 | `sim/mjcf.ts` 的 `antiSwingProfile` / `antiSwingXml`；預設值在 `sim/clawConfig.ts` |
| 天車、鋼索、到頂高度 | `sim/cabinet.ts` 的 `CABINET`（`pulleyZ`、`ropeTop`、`ropeMin`） |
| 中控設定項（A–G） | `machine/settings.ts` 的 `MENU`；行為在 `machine/controller.ts` 的 `Board.update` |
| 獎品種類與擺放 | `sim/prizes.ts`；形狀在 `sim/mjcf.ts` 的 `prizeXml` |
| 出貨口、擋板、電眼 | `sim/mjcf.ts` 的 `cabinetXml`；`ClawSimulation.checkElectricEye` |
| 台主面板介面 | `ui/operatorPanel.ts`（每個分頁對應一個 `build*` 方法） |
| 新增 Worker 訊息 | `worker/protocol.ts` → `physicsWorker.ts` 的 `handle` → `main.ts` |
| 材質與外觀 | `render/scene.ts` 的 `setModel` |
