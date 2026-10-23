# 飛絡力三爪娃娃機（網頁遊戲）

瀏覽器 3D 娃娃機：MuJoCo（WASM）即時物理，加上飛絡力標準台中控板 A–G 設定模擬。
技術：Vite 7、TypeScript、three.js、`@mujoco/mujoco` 3.15、vitest。

## 指令
- `npm run dev`：開發伺服器
- `npx tsc --noEmit`、`npx vitest run`、`npm run build`：改動後三項都要通過

## 專案文件（按需讀取，不要一開始全部讀）
| 文件 | 什麼時候讀 |
|---|---|
| `docs/MODULE_MAP.md` | 要找相關程式碼時 |
| `docs/ARCHITECTURE.md` | 改動跨模組、物理模型或校準時 |
| `docs/HANDOFF.md` | 接續先前工作時 |
| `README.md` | 需要玩法或 A–G 設定的說明時（給使用者看的文件） |

## 工作流程
1. 收到需求後，先判斷是否需要 MODULE_MAP 來定位模組。
2. 只在相關目錄用 Grep／Glob 搜尋，必要時才擴大範圍；排除 `node_modules`、`dist`。
3. 文件可能過期：修改前一定核對實際程式碼，以程式碼為準，發現不一致就順手修正文件。
4. 完成後只更新受影響的文件：
   - 模組職責變了才改 MODULE_MAP。
   - 架構或常數依據變了才改 ARCHITECTURE。
   - 收工時覆寫 HANDOFF。
   - 不為了更新文件而重新掃描專案。

## 規則
- 用繁體中文回覆；較大的改動先提計畫再實作。
- 物理改動要附上可重現的測試或掃描數據，不能憑感覺調參數。
- 測試只能調整情境，不能降低要求。
- 在指定分支開發並推送；使用者沒要求就不開 PR。
- `README.md` 只在功能有變更時同步更新。
