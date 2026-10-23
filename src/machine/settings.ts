/**
 * Feiluoli (飛絡力) standard cabinet control-board settings, menu A–G, as shown on the
 * operator LCD in 小雞女蛋蛋〈我買了一台娃娃機！娃娃機設定大公開！〉.
 *
 * Ranges the video did not show are marked `guessedRange` and documented in the README.
 */

export type SettingKind = 'number' | 'choice' | 'action' | 'readonly';

export interface SettingDef {
  code: string;
  /** Exact LCD label. */
  label: string;
  /** Explanation shown in the Chinese parameter table. */
  help: string;
  kind: SettingKind;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  choices?: string[];
  default?: number;
  /** Range/behaviour not confirmed by the video. */
  guessedRange?: boolean;
}

export interface MenuGroup {
  key: string;
  title: string;
  items: SettingDef[];
}

export const MENU: MenuGroup[] = [
  {
    key: 'A',
    title: 'A:基本設定',
    items: [
      { code: 'A1a', label: 'A1投幣器1 一投', help: '投一枚硬幣算多少元', kind: 'number', min: 1, max: 50, step: 1, unit: '元', default: 10 },
      { code: 'A1b', label: 'A1投幣器1 每局', help: '每玩一局要扣多少元（每局 5 元＝投 10 元可玩兩次）', kind: 'number', min: 1, max: 100, step: 1, unit: '元', default: 10 },
      { code: 'A2', label: 'A2遊戲時間', help: '每局操作天車的倒數秒數，時間到自動下爪（喇台常見 7 或 15 秒）', kind: 'number', min: 5, max: 60, step: 1, unit: '秒', default: 15 },
      { code: 'A3', label: 'A3禮品售價', help: '商品的保夾金額：累加金額達到此值時，下一局使用 B5 保夾的強電壓', kind: 'number', min: 10, max: 1990, step: 10, unit: '元', default: 300 },
      { code: 'A4a', label: 'A4選物累加 顯示', help: '是否在待機畫面顯示目前累保金額', kind: 'choice', choices: ['無', '有'], default: 1 },
      { code: 'A4b', label: 'A4選物累加 累加保留', help: '無人遊玩多久後累加金額歸零（0＝永久保留）', kind: 'number', min: 0, max: 30, step: 1, unit: '分鐘', default: 0 },
      { code: 'A5', label: 'A5展示音樂', help: '待機時每幾分鐘播放一次娃娃機音樂（0＝關閉）', kind: 'number', min: 0, max: 30, step: 1, unit: '分鐘一次', default: 1, guessedRange: true },
      { code: 'A6a', label: 'A6空中取物', help: '下爪途中能否再按取物鍵提前合爪（二收）', kind: 'choice', choices: ['無', '有'], default: 1 },
      { code: 'A6b', label: 'A6延遲收爪', help: '二收時按下後延遲多久才合爪，單位 0.1 秒', kind: 'number', min: 0, max: 2, step: 0.1, unit: '秒', default: 0, guessedRange: true },
      { code: 'A7', label: 'A7投幣儲存', help: '剩餘投幣是否保存；選「歸零」時待機長按取物鍵 2 秒消除剩餘投幣與累保', kind: 'choice', choices: ['儲存', '歸零'], default: 0 },
      { code: 'A8a', label: 'A8下爪延遲', help: '按下取物鍵後幾秒才開始下爪', kind: 'number', min: 0, max: 1, step: 0.1, unit: '秒', default: 0 },
      { code: 'A8b', label: 'A8段亂數', help: '開啟後每局下爪延遲在 0～A8 之間隨機', kind: 'choice', choices: ['固定', '亂數'], default: 0 },
      { code: 'A9', label: 'A9上停延遲', help: '爪子到頂後停住幾秒才回原點', kind: 'number', min: 0, max: 5, step: 0.1, unit: '秒', default: 0, guessedRange: true },
      { code: 'A10a', label: 'A10下爪亂數', help: '下爪速度隨機變慢的幅度', kind: 'number', min: 0, max: 50, step: 5, unit: '%', default: 0, guessedRange: true },
      { code: 'A10b', label: 'A10夾亂數', help: '二收是否加入隨機延遲', kind: 'choice', choices: ['固定', '亂數'], default: 0 },
      { code: 'A11', label: 'A11下停上拉延遲', help: '抓到商品（合爪）之後還要停多久才上來', kind: 'number', min: 0, max: 3, step: 0.1, unit: '秒', default: 0, guessedRange: true },
      { code: 'A12a', label: 'A12上停上拉', help: '頂到管子後爪子還要往上拉多久（單位 0.1 秒），越多越好甩', kind: 'number', min: 0, max: 20, step: 1, unit: '×0.1秒', default: 5, guessedRange: true },
      { code: 'A12b', label: 'A12回停下降', help: '回到原點後爪子往下降多久再開爪，之後停在該高度不收回，讓爪子與防水片保持間隙（單位 0.1 秒）', kind: 'number', min: 0, max: 20, step: 1, unit: '×0.1秒', default: 0, guessedRange: true },
      { code: 'A13', label: 'A13促銷功能', help: '影片作者也不清楚用途；本模擬實作為「每 N 局送一局」（0＝關）', kind: 'number', min: 0, max: 20, step: 1, unit: '局送一局', default: 0, guessedRange: true },
      { code: 'A14', label: 'A14下爪長度時間', help: '線長：下爪最多放線幾秒；太短爪子會停在半空', kind: 'number', min: 0.5, max: 4, step: 0.1, unit: '秒', default: 2.0, guessedRange: true },
    ],
  },
  {
    key: 'B',
    title: 'B:抓力電壓設定',
    items: [
      { code: 'B1', label: 'B1強電壓', help: '第一段爪力：下爪到底合爪時的電壓', kind: 'number', min: 0, max: 48, step: 0.5, unit: 'V', default: 30 },
      { code: 'B2', label: 'B2中電壓', help: '上升到距頂點 B4 時轉換的電壓', kind: 'number', min: 0, max: 48, step: 0.5, unit: 'V', default: 18 },
      { code: 'B3', label: 'B3弱電壓', help: '到頂後回原點途中的抓力電壓', kind: 'number', min: 0, max: 48, step: 0.5, unit: 'V', default: 12 },
      { code: 'B4', label: 'B4中壓距離頂點', help: '強爪轉中爪的位置：數字越大越早轉（離頂點越遠）', kind: 'number', min: 1, max: 30, step: 1, default: 21 },
      { code: 'B5', label: 'B5保夾的強電壓', help: '保夾局全程使用的電壓', kind: 'number', min: 0, max: 48, step: 0.5, unit: 'V', default: 48 },
    ],
  },
  {
    key: 'C',
    title: 'C:查帳',
    items: [
      { code: 'C1', label: 'C1中獎率銀行', help: '自上次出貨後投入的金額，出貨後歸零（長按取物鍵歸零）', kind: 'readonly' },
      { code: 'C2', label: 'C2投幣遊戲次數', help: '累計遊玩局數（試玩不計）', kind: 'readonly' },
      { code: 'C3', label: 'C3禮品出獎次數', help: '累計出貨次數', kind: 'readonly' },
      { code: 'C4', label: 'C4累加金額查詢', help: '最近 10 筆出貨各花了多少錢', kind: 'readonly' },
      { code: 'C5', label: 'C5全部歸零', help: '清除所有帳目', kind: 'action' },
    ],
  },
  {
    key: 'D',
    title: 'D:自動模式',
    items: [
      { code: 'D', label: 'D自動模式', help: '免費：5 秒後自動開始，之後每 10 秒可玩一局；機台耐久測試：每 15 秒自動跑一次', kind: 'choice', choices: ['關閉', '免費', '機台耐久測試'], default: 0 },
    ],
  },
  {
    key: 'E',
    title: 'E:馬達速度調整',
    items: [
      { code: 'E1', label: 'E1往前馬達速度', help: '天車往前速度', kind: 'number', min: 10, max: 100, step: 5, unit: '%', default: 100 },
      { code: 'E2', label: 'E2往後馬達速度', help: '天車往後速度', kind: 'number', min: 10, max: 100, step: 5, unit: '%', default: 100 },
      { code: 'E3', label: 'E3往左馬達速度', help: '天車往左速度', kind: 'number', min: 10, max: 100, step: 5, unit: '%', default: 100 },
      { code: 'E4', label: 'E4往右馬達速度', help: '天車往右速度', kind: 'number', min: 10, max: 100, step: 5, unit: '%', default: 100 },
      { code: 'E5', label: 'E5往下馬達速度', help: '下爪速度', kind: 'number', min: 10, max: 100, step: 5, unit: '%', default: 100 },
      { code: 'E6', label: 'E6往上馬達速度', help: '上升速度，會影響「丟」的幅度', kind: 'number', min: 10, max: 100, step: 5, unit: '%', default: 90 },
      { code: 'E7', label: 'E7馬達全部100%', help: '一次把 E1～E6 設為 100%', kind: 'action' },
      { code: 'E8', label: 'E8前後左右轉速', help: '天車整體轉速，加快會有打滑、甩起來怪怪的感覺', kind: 'choice', choices: ['正常', '加快 120%', '加快 140%'], default: 0 },
    ],
  },
  {
    key: 'F',
    title: 'F:測試',
    items: [
      { code: 'F1', label: 'F1落物電眼測試', help: '遮住出獎口電眼顯示 NG、移開顯示 OK', kind: 'readonly' },
      { code: 'F2', label: 'F2投幣器測試', help: '投幣後計數，確認投幣器正常', kind: 'readonly' },
    ],
  },
  {
    key: 'G',
    title: 'G:進階設定',
    items: [
      { code: 'G1', label: 'G1防電擊警告', help: '開/關（影片未說明用途，僅保留選項）', kind: 'choice', choices: ['關', '開'], default: 1 },
      { code: 'G2', label: 'G2回復原廠設定', help: '所有設定還原為出廠值', kind: 'action' },
      { code: 'G3', label: 'G3上停異常理線', help: '爪子卡住無法到頂時自動重新下爪三次，選擇重試時開爪或閉爪；3 次異常需叫店員', kind: 'choice', choices: ['開爪', '閉爪'], default: 0 },
    ],
  },
];

export type Settings = Record<string, number>;

export const ALL_SETTINGS: SettingDef[] = MENU.flatMap((g) => g.items);

export function defaultSettings(): Settings {
  const s: Settings = {};
  for (const d of ALL_SETTINGS) if (d.default !== undefined) s[d.code] = d.default;
  return s;
}

export function findSetting(code: string): SettingDef | undefined {
  return ALL_SETTINGS.find((d) => d.code === code);
}

export function clampSetting(def: SettingDef, value: number): number {
  if (def.kind === 'choice') return Math.max(0, Math.min((def.choices?.length ?? 1) - 1, Math.round(value)));
  const step = def.step ?? 1;
  const v = Math.round(value / step) * step;
  return Math.max(def.min ?? -Infinity, Math.min(def.max ?? Infinity, Number(v.toFixed(4))));
}

export function formatSetting(def: SettingDef, value: number | undefined): string {
  if (value === undefined) return '';
  if (def.kind === 'choice') return def.choices?.[value] ?? String(value);
  const step = def.step ?? 1;
  const digits = step < 1 ? 1 : 0;
  return `${value.toFixed(digits)}${def.unit ? ' ' + def.unit : ''}`;
}

const STORAGE_KEY = 'feiluoli-settings-v1';

export function loadSettings(): Settings {
  const s = defaultSettings();
  try {
    const raw = globalThis.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Settings;
      for (const d of ALL_SETTINGS) {
        if (typeof saved[d.code] === 'number' && d.default !== undefined) s[d.code] = clampSetting(d, saved[d.code]);
      }
    }
  } catch {
    // Storage unavailable (private mode etc.) — run on defaults.
  }
  return s;
}

export function saveSettings(s: Settings): void {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(s));
  } catch {
    // Ignore — settings just won't persist.
  }
}
