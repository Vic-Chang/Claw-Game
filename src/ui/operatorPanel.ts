import type { AppConfig } from '../app/state';
import type { BoardSnapshot } from '../machine/controller';
import { MENU, type SettingDef, type Settings, clampSetting, defaultSettings, formatSetting } from '../machine/settings';
import {
  type ClawSize,
  type ClawTuning,
  SIZE_LABEL,
  SIZE_SCALE,
  SLEEVES,
  type SleeveMaterial,
  cloneClawTuning,
  sleeveSpec,
  spreadRange,
} from '../sim/clawConfig';
import { CABINET } from '../sim/cabinet';
import { ARM_ANGLES, armGeometry } from '../sim/mjcf';
import { PRIZE_KINDS, type PrizeCounts, type PrizeKind } from '../sim/prizes';
import { torqueAtVoltage } from '../sim/solenoid';
import type { DebugInfo } from '../worker/protocol';
import { drawLcd } from './lcd';

export interface OperatorCallbacks {
  onSettings(s: Settings): void;
  onClaw(c: ClawTuning): void;
  onPrizes(counts: PrizeCounts, seed: number): void;
  onGuard(heightCm: number): void;
  onTestPlay(): void;
  onClearAccounts(): void;
  onClearBank(): void;
  onResetError(): void;
}

type MenuLevel = { level: 'off' } | { level: 'root'; cursor: number } | { level: 'group'; group: number; cursor: number } | { level: 'item'; group: number; item: number; scroll: number };

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  if (html) e.innerHTML = html;
  return e;
};

/** Operator mode (台主模式): the in-cabinet control board and the physical claw adjustments. */
export class OperatorPanel {
  private root = document.getElementById('operator')!;
  private cfg: AppConfig;
  private menu: MenuLevel = { level: 'off' };
  private lcd!: HTMLCanvasElement;
  private board: BoardSnapshot | null = null;
  private tableInputs = new Map<string, HTMLInputElement | HTMLSelectElement>();
  private linked = true;
  private history: Array<{ t: number; v: number; c: number; slack: number; h: number }> = [];
  private chart!: HTMLCanvasElement;
  private monitorText!: HTMLElement;
  private open = false;
  private accountsText: HTMLElement | null = null;

  constructor(cfg: AppConfig, private cb: OperatorCallbacks) {
    this.cfg = cfg;
    this.root.querySelectorAll<HTMLButtonElement>('.tabs button').forEach((b) =>
      b.addEventListener('click', () => {
        this.root.querySelectorAll('.tabs button').forEach((x) => x.classList.toggle('active', x === b));
        this.root.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', (p as HTMLElement).dataset.panel === b.dataset.tab));
      }),
    );
    this.buildBoard();
    this.buildTable();
    this.buildClaw();
    this.buildLayout();
    this.buildMonitor();
    this.renderLcd();
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.hidden = !open;
    if (!open) this.menu = { level: 'off' };
    this.renderLcd();
  }

  private panel(name: string): HTMLElement {
    return this.root.querySelector<HTMLElement>(`[data-panel="${name}"]`)!;
  }

  // ---- Settings plumbing ---------------------------------------------------------------

  private setValue(code: string, value: number): void {
    const def = MENU.flatMap((g) => g.items).find((d) => d.code === code);
    if (!def) return;
    this.cfg.settings[code] = clampSetting(def, value);
    const input = this.tableInputs.get(code);
    if (input) input.value = String(this.cfg.settings[code]);
    this.cb.onSettings({ ...this.cfg.settings });
  }

  private runAction(code: string): void {
    if (code === 'C5') this.cb.onClearAccounts();
    if (code === 'E7') for (const c of ['E1', 'E2', 'E3', 'E4', 'E5', 'E6']) this.setValue(c, 100);
    if (code === 'G2') {
      this.cfg.settings = defaultSettings();
      for (const [c, input] of this.tableInputs) input.value = String(this.cfg.settings[c]);
      this.cb.onSettings({ ...this.cfg.settings });
    }
  }

  // ---- 中控面板 (LCD emulator) ---------------------------------------------------------------

  private buildBoard(): void {
    const p = this.panel('board');
    p.innerHTML = `<p class="note">仿飛絡力標準台中控：按「設定」進入功能選單，▲▼ 選擇／加減，◎（取物鍵）確認・儲存・離開。修改立即生效並保存。</p>`;
    const box = el('div', { class: 'board-box' });
    this.lcd = el('canvas', { width: '320', height: '160' });
    box.append(this.lcd);
    const keys = el('div', { class: 'board-keys' });
    const key = (label: string, sub: string, fn: () => void, cls = '') => {
      const b = el('button', cls ? { class: cls } : {}, `${label}<small>${sub}</small>`);
      b.addEventListener('click', fn);
      keys.append(b);
    };
    key('設定', 'SET', () => this.keySet());
    key('▲', '加', () => this.keyUpDown(1));
    key('▼', '減', () => this.keyUpDown(-1));
    key('◎', '取物', () => this.keyOk());
    key('試玩', 'TEST', () => this.cb.onTestPlay(), 'test');
    box.append(keys);
    p.append(box);
    this.accountsText = el('div', { class: 'note' });
    p.append(this.accountsText);
    const reset = el('button', {}, '排除故障（重置爪子）');
    reset.addEventListener('click', () => this.cb.onResetError());
    p.append(el('div', { class: 'btn-row' }), reset);
  }

  private keySet(): void {
    const m = this.menu;
    if (m.level === 'off') this.menu = { level: 'root', cursor: 0 };
    else if (m.level === 'root') this.menu = { level: 'off' };
    else if (m.level === 'group') this.menu = { level: 'root', cursor: m.group };
    else this.menu = { level: 'group', group: m.group, cursor: m.item };
    this.renderLcd();
  }

  private keyUpDown(dir: number): void {
    const m = this.menu;
    if (m.level === 'root') m.cursor = (m.cursor - dir + MENU.length) % MENU.length;
    else if (m.level === 'group') {
      const n = MENU[m.group].items.length;
      m.cursor = (m.cursor - dir + n) % n;
    } else if (m.level === 'item') {
      const def = MENU[m.group].items[m.item];
      if (def.kind === 'number') this.setValue(def.code, (this.cfg.settings[def.code] ?? 0) + dir * (def.step ?? 1));
      else if (def.kind === 'choice') {
        const n = def.choices!.length;
        this.setValue(def.code, ((this.cfg.settings[def.code] ?? 0) + dir + n) % n);
      } else if (def.code === 'C4') m.scroll = Math.max(0, Math.min(7, m.scroll - dir));
    }
    this.renderLcd();
  }

  private keyOk(): void {
    const m = this.menu;
    if (m.level === 'root') this.menu = { level: 'group', group: m.cursor, cursor: 0 };
    else if (m.level === 'group') this.menu = { level: 'item', group: m.group, item: m.cursor, scroll: 0 };
    else if (m.level === 'item') {
      const def = MENU[m.group].items[m.item];
      if (def.kind === 'action') this.runAction(def.code);
      if (def.code === 'C1') this.cb.onClearBank();
      this.menu = { level: 'group', group: m.group, cursor: m.item };
    }
    this.renderLcd();
  }

  private renderLcd(): void {
    const m = this.menu;
    const b = this.board;
    let lines: string[];
    let hl = -1;
    const windowed = (title: string, items: string[], cursor: number) => {
      const start = Math.max(0, Math.min(cursor - 1, items.length - 3));
      hl = cursor - start + 1;
      return [title, ...items.slice(start, start + 3).map((s) => `》${s}`)];
    };
    if (m.level === 'off') {
      lines = b
        ? [`投幣 ${b.credit}   時間 ${b.state === 'play' ? Math.ceil(b.timeLeft) : this.cfg.settings.A2}`, b.showAccumulated ? `累保 ${b.accumulated} 元` : '', b.state === 'idle' ? '◇ 待機中 ◇' : '◇遊戲開始◇', b.errorCode ?? '★祝您中獎★']
        : ['', '', '', ''];
    } else if (m.level === 'root') {
      lines = windowed('功能設定:', MENU.map((g) => g.title), m.cursor);
    } else if (m.level === 'group') {
      lines = windowed(MENU[m.group].title, MENU[m.group].items.map((d) => d.label), m.cursor);
    } else {
      lines = this.itemLines(MENU[m.group].items[m.item], m.scroll);
    }
    drawLcd(this.lcd, lines, hl);
  }

  private itemLines(def: SettingDef, scroll: number): string[] {
    const b = this.board;
    const a = b?.accounts;
    switch (def.code) {
      case 'C1':
        return [def.label, '◎歸零；設定=出', `= + ${a?.bank ?? 0}`, ''];
      case 'C2':
        return [def.label, '設定=出', `= ${a?.games ?? 0} 次`, ''];
      case 'C3':
        return [def.label, '設定=出', `= ${a?.wins ?? 0} 次`, ''];
      case 'C4': {
        const h = a?.history ?? [];
        return [def.label, ...[0, 1, 2].map((i) => `${scroll + i + 1}: ${h[scroll + i] ?? '-'}`)];
      }
      case 'F1':
        return [def.label, '遮住電眼測試', b?.eyeBlocked ? '狀態 = NG' : '狀態 = OK', ''];
      case 'F2':
        return [def.label, '》請投幣', `投幣次數 = ${a?.coins ?? 0}`, ''];
    }
    if (def.kind === 'action') return [def.label, '◎確認；設定=取消', '', ''];
    const v = this.cfg.settings[def.code];
    const hint = def.kind === 'choice' ? '↑↓變更；◎出' : '↑加；↓減；◎出';
    const range = def.kind === 'number' ? `${def.min}~${def.max}${def.unit && !def.unit.includes('×') ? def.unit : ''}` : '';
    return [def.label, hint, `目前=${formatSetting(def, v)}`, range];
  }

  // ---- 參數表 -------------------------------------------------------------------------------

  private buildTable(): void {
    const p = this.panel('table');
    p.append(el('p', { class: 'note' }, '所有中控設定的中文說明表，和中控面板同步。<span class="guess">橘色＝影片未顯示確切範圍，為合理推測。</span>'));
    for (const g of MENU) {
      p.append(el('h3', {}, g.title));
      const table = el('table', { class: 'params' });
      for (const d of g.items) {
        const tr = el('tr');
        tr.append(el('td', { class: 'code' }, d.code.replace(/[ab]$/, '')));
        const name = el('td', {}, `${d.label.replace(/^[A-G]\d*/, '')}${d.guessedRange ? ' <span class="guess">推測</span>' : ''}`);
        tr.append(name);
        const cell = el('td');
        if (d.kind === 'number') {
          const input = el('input', { type: 'number', min: String(d.min), max: String(d.max), step: String(d.step ?? 1) });
          input.value = String(this.cfg.settings[d.code]);
          input.addEventListener('change', () => this.setValue(d.code, Number(input.value)));
          this.tableInputs.set(d.code, input);
          cell.append(input);
          if (d.unit) cell.append(` ${d.unit}`);
        } else if (d.kind === 'choice') {
          const sel = el('select');
          d.choices!.forEach((c, i) => sel.append(el('option', { value: String(i) }, c)));
          sel.value = String(this.cfg.settings[d.code]);
          sel.addEventListener('change', () => this.setValue(d.code, Number(sel.value)));
          this.tableInputs.set(d.code, sel);
          cell.append(sel);
        } else if (d.kind === 'action') {
          // Two-step confirm in the page itself (browser dialogs are not available everywhere).
          const btn = el('button', {}, '執行');
          let armed = 0;
          btn.addEventListener('click', () => {
            if (armed) {
              window.clearTimeout(armed);
              armed = 0;
              btn.textContent = '已執行';
              this.runAction(d.code);
              window.setTimeout(() => (btn.textContent = '執行'), 1500);
              return;
            }
            btn.textContent = '再按一次確認';
            armed = window.setTimeout(() => {
              armed = 0;
              btn.textContent = '執行';
            }, 3000);
          });
          cell.append(btn);
        } else {
          cell.append(el('span', { 'data-readonly': d.code }, '-'));
        }
        tr.append(cell);
        tr.append(el('td', { class: 'help' }, d.help));
        table.append(tr);
      }
      p.append(table);
    }
  }

  // ---- 爪子調整 -------------------------------------------------------------------------------

  private buildClaw(): void {
    const p = this.panel('claw');
    p.innerHTML = '';
    const c = this.cfg.claw;
    p.append(
      el(
        'p',
        { class: 'note' },
        '機構上的實體調整（不在中控選單內）：換爪子大小、拗爪距、換爪套、彎防甩片。改變幾何會重建物理模型，獎品位置保持不變；爪套摩擦即時生效。',
      ),
    );
    const preview = el('div', { class: 'preview' });
    p.append(preview);
    const info = el('div', { class: 'note' });
    p.append(info);

    const field = (label: string, input: HTMLElement, out?: HTMLElement) => {
      const f = el('div', { class: 'field' });
      f.append(el('span', {}, label), input, out ?? el('span'));
      return f;
    };

    p.append(el('h3', {}, '爪子與爪套'));
    const size = el('select');
    (Object.keys(SIZE_LABEL) as ClawSize[]).forEach((k) => size.append(el('option', { value: k }, SIZE_LABEL[k])));
    size.value = c.size;
    size.addEventListener('change', () => {
      c.size = size.value as ClawSize;
      const [lo, hi] = spreadRange(c.size);
      c.arms.forEach((a) => (a.spreadCm = Math.max(lo, Math.min(hi, a.spreadCm))));
      this.applyClaw(true);
    });
    p.append(field('爪子大小', size));

    const sleeve = el('select');
    (Object.keys(SLEEVES) as Array<keyof typeof SLEEVES>).forEach((k) => sleeve.append(el('option', { value: k }, `${SLEEVES[k].label}（μ≈${SLEEVES[k].friction[0]}）`)));
    sleeve.append(el('option', { value: 'custom' }, '自訂摩擦係數'));
    sleeve.value = c.sleeve;
    const mu = el('input', { type: 'range', min: '0.1', max: '1.6', step: '0.05' });
    mu.value = String(c.customFriction);
    const muOut = el('output', {}, c.customFriction.toFixed(2));
    const muField = field('自訂 μ', mu, muOut);
    muField.style.display = c.sleeve === 'custom' ? '' : 'none';
    sleeve.addEventListener('change', () => {
      c.sleeve = sleeve.value as SleeveMaterial;
      muField.style.display = c.sleeve === 'custom' ? '' : 'none';
      this.applyClaw(false);
    });
    mu.addEventListener('input', () => (muOut.textContent = Number(mu.value).toFixed(2)));
    mu.addEventListener('change', () => {
      c.customFriction = Number(mu.value);
      this.applyClaw(false);
    });
    p.append(field('爪套材質', sleeve), muField);

    p.append(el('h3', {}, '爪距與防甩片'));
    const linkBox = el('input', { type: 'checkbox' });
    linkBox.checked = this.linked;
    const linkLabel = el('label', {}, '');
    linkLabel.append(linkBox, ' 三爪連動（取消可個別調整每支爪）');
    p.append(linkLabel);
    const armsWrap = el('div');
    p.append(armsWrap);

    const renderArms = () => {
      armsWrap.innerHTML = '';
      const [lo, hi] = spreadRange(c.size);
      const arms = this.linked ? [0] : [0, 1, 2];
      for (const i of arms) {
        const card = el('div', { class: 'arm-card' });
        card.append(el('h4', {}, this.linked ? '三支爪' : `第 ${i + 1} 爪（${['後', '左前', '右前'][i]}）`));
        const slider = (label: string, key: 'spreadCm' | 'finConcavityDeg' | 'finDirectionDeg', min: number, max: number, step: number, unit: string) => {
          const input = el('input', { type: 'range', min: String(min), max: String(max), step: String(step) });
          input.value = String(c.arms[i][key]);
          const out = el('output', {}, `${c.arms[i][key]}${unit}`);
          input.addEventListener('input', () => {
            out.textContent = `${input.value}${unit}`;
            const targets = this.linked ? [0, 1, 2] : [i];
            targets.forEach((t) => (c.arms[t][key] = Number(input.value)));
            drawPreview();
          });
          input.addEventListener('change', () => this.applyClaw(true));
          card.append(field(label, input, out));
        };
        slider('爪距（開度）', 'spreadCm', lo, hi, 0.5, ' cm');
        slider('防甩片凹度', 'finConcavityDeg', 0, 45, 1, '°');
        slider('防甩片方向', 'finDirectionDeg', -30, 30, 1, '°');
        armsWrap.append(card);
      }
    };
    linkBox.addEventListener('change', () => {
      this.linked = linkBox.checked;
      if (this.linked) {
        c.arms[1] = { ...c.arms[0] };
        c.arms[2] = { ...c.arms[0] };
        this.applyClaw(true);
      }
      renderArms();
    });

    const drawPreview = () => {
      const s = SIZE_SCALE[c.size];
      const sc = 850;
      // Top view: tip circle and fin directions.
      let top = `<svg width="200" height="200" viewBox="-100 -100 200 200"><circle r="${(spreadRange(c.size)[1] / 200) * sc}" fill="none" stroke="#3a2f55" stroke-dasharray="3 4"/><circle r="${0.022 * s * sc}" fill="#e0338c"/>`;
      c.arms.forEach((a, i) => {
        const g = armGeometry(s, a.spreadCm);
        const r = (a.spreadCm / 200) * sc;
        const ang = ARM_ANGLES[i];
        const x = Math.cos(ang) * r;
        const y = -Math.sin(ang) * r;
        const hx = Math.cos(ang) * g.hingeR * sc;
        const hy = -Math.sin(ang) * g.hingeR * sc;
        const fd = ang + Math.PI + (a.finDirectionDeg * Math.PI) / 180;
        const fl = 0.0165 * s * sc * Math.cos((a.finConcavityDeg * Math.PI) / 360);
        top += `<line x1="${hx}" y1="${hy}" x2="${x}" y2="${y}" stroke="#e8e8ee" stroke-width="5" stroke-linecap="round"/>`;
        top += `<line x1="${x}" y1="${y}" x2="${x + Math.cos(fd) * fl}" y2="${y - Math.sin(fd) * fl}" stroke="#7fd3ff" stroke-width="6" stroke-linecap="round"/>`;
        top += `<circle cx="${x}" cy="${y}" r="5" fill="#111"/>`;
      });
      top += `<text x="0" y="94" fill="#b9acd3" font-size="12" text-anchor="middle">俯視（藍＝防甩片）</text></svg>`;
      // Side view of arm 0 open, with the fin curve.
      const a0 = c.arms[0];
      const g = armGeometry(s, a0.spreadCm);
      const q = g.openAngle;
      const rot = ([x, z]: number[]) => [x * Math.cos(q) - z * Math.sin(q), x * Math.sin(q) + z * Math.cos(q)];
      const pts = [[0, 0], g.elbow, g.tip].map(rot).map(([x, z]) => [g.hingeR + x, z]);
      let side = `<svg width="200" height="200" viewBox="-40 -30 200 200"><rect x="${-0.03 * s * sc}" y="${-0.035 * s * sc}" width="${0.06 * s * sc}" height="${0.07 * s * sc}" fill="#e0338c" transform="translate(0,${0.035 * s * sc - 20})"/>`;
      const P = (pt: number[]) => `${pt[0] * sc},${-pt[1] * sc}`;
      side += `<polyline points="${pts.map(P).join(' ')}" fill="none" stroke="#ddd" stroke-width="5"/>`;
      let fx = pts[2][0];
      let fz = pts[2][1];
      let finPath = `M${fx * sc},${-fz * sc}`;
      for (let k = 0; k < 3; k++) {
        const ang = ((a0.finConcavityDeg * Math.PI) / 180) * ((k + 1) / 3);
        fx += -Math.cos(ang) * 0.0055 * s;
        fz += Math.sin(ang) * 0.0055 * s;
        finPath += ` L${fx * sc},${-fz * sc}`;
      }
      side += `<path d="${finPath}" stroke="#7fd3ff" stroke-width="5" fill="none" stroke-linecap="round"/>`;
      side += `<text x="60" y="164" fill="#b9acd3" font-size="12" text-anchor="middle">側視（張開）</text></svg>`;
      preview.innerHTML = top + side;
      const lever = g.lever;
      const force = torqueAtVoltage(48) / lever;
      info.innerHTML = `爪臂長 ${(lever * 100).toFixed(1)} cm · 48V 時單爪尖夾力約 ${force.toFixed(2)} N · 爪套 ${sleeveSpec(c).label} · 爪頭重 ${(0.3 * s ** 3 * 1000).toFixed(0)} g`;
    };
    renderArms();
    drawPreview();
    const reset = el('button', {}, '恢復標準 JS 爪');
    reset.addEventListener('click', () => {
      Object.assign(c, { size: 'medium', sleeve: 'rubber', customFriction: 0.8 });
      c.arms.forEach((a) => Object.assign(a, { spreadCm: 12, finConcavityDeg: 10, finDirectionDeg: 0 }));
      this.applyClaw(true);
      this.buildClaw();
    });
    p.append(el('div', { class: 'btn-row' }), reset);
  }

  private applyClaw(_geometry: boolean): void {
    this.cb.onClaw(cloneClawTuning(this.cfg.claw));
  }

  // ---- 機台佈置 ---------------------------------------------------------------------------------

  private buildLayout(): void {
    const p = this.panel('layout');
    p.append(el('h3', {}, '出貨口擋板'));
    p.append(el('p', { class: 'note' }, '出獎口內側的透明壓克力擋板高度。越高越難把獎品推（喇）進洞、夾起來也要舉得更高；0 cm＝拆掉擋板。調整後立即重建，獎品位置不變。'));
    const [gLo, gHi] = CABINET.guardRange;
    const guard = el('input', { type: 'range', min: String(gLo * 100), max: String(gHi * 100), step: '0.5' });
    guard.value = String(this.cfg.guardCm);
    const guardOut = el('output', {}, `${this.cfg.guardCm.toFixed(1)} cm`);
    guard.addEventListener('input', () => (guardOut.textContent = `${Number(guard.value).toFixed(1)} cm`));
    guard.addEventListener('change', () => {
      this.cfg.guardCm = Number(guard.value);
      this.cb.onGuard(this.cfg.guardCm);
    });
    const gf = el('div', { class: 'field' });
    gf.append(el('span', {}, '擋板高度'), guard, guardOut);
    p.append(gf);
    p.append(el('h3', {}, '獎品'));
    p.append(el('p', { class: 'note' }, '擺放獎品（台主補貨）。套用後會重新擺放並讓獎品自然落定。'));
    const counts = { ...this.cfg.counts };
    for (const k of Object.keys(PRIZE_KINDS) as PrizeKind[]) {
      const f = el('div', { class: 'field' });
      const input = el('input', { type: 'number', min: '0', max: '16', step: '1' });
      input.value = String(counts[k]);
      input.addEventListener('change', () => (counts[k] = Math.max(0, Math.min(16, Math.round(Number(input.value))))));
      f.append(el('span', {}, PRIZE_KINDS[k].label), input, el('span', {}, `${Math.round(PRIZE_KINDS[k].mass * 1000)} g`));
      p.append(f);
    }
    const row = el('div', { class: 'btn-row' });
    const apply = el('button', { class: 'primary' }, '套用（補貨）');
    apply.addEventListener('click', () => this.cb.onPrizes({ ...counts }, this.cfg.seed));
    const shuffle = el('button', {}, '換個擺法');
    shuffle.addEventListener('click', () => {
      this.cfg.seed = Math.floor(Math.random() * 100000);
      this.cb.onPrizes({ ...counts }, this.cfg.seed);
    });
    row.append(apply, shuffle);
    p.append(row);
  }

  // ---- 物理監看 ---------------------------------------------------------------------------------

  private buildMonitor(): void {
    const p = this.panel('monitor');
    p.append(el('p', { class: 'note' }, '即時曲線（最近 10 秒）：黃＝爪子電壓、粉＝爪子閉合度、藍＝爪頭高度、白＝鋼索鬆弛。用來觀察強爪轉中爪的位置與脫爪瞬間。'));
    this.chart = el('canvas', { class: 'chart', width: '520', height: '180' });
    p.append(this.chart);
    this.monitorText = el('div', { class: 'kv' });
    p.append(el('h3', {}, '數值'), this.monitorText);
  }

  update(b: BoardSnapshot, d: DebugInfo): void {
    this.board = b;
    if (!this.open) return;
    this.renderLcd();
    for (const span of this.root.querySelectorAll<HTMLElement>('[data-readonly]')) {
      const code = span.dataset.readonly!;
      const a = b.accounts;
      span.textContent =
        code === 'C1' ? `${a.bank} 元` : code === 'C2' ? `${a.games} 次` : code === 'C3' ? `${a.wins} 次` : code === 'C4' ? a.history.join(', ') || '-' : code === 'F1' ? (b.eyeBlocked ? 'NG' : 'OK') : code === 'F2' ? `${a.coins} 次` : '-';
    }
    if (this.accountsText) {
      this.accountsText.textContent = `狀態：${b.state} · 電壓 ${b.volts.toFixed(1)} V（${{ strong: '強', medium: '中', weak: '弱', off: '斷電', guaranteed: '保夾' }[b.voltStage]}） · 投幣 ${b.accounts.games} 局 · 出貨 ${b.accounts.wins} 次`;
    }
    const avg = d.closure.reduce((x, y) => x + y, 0) / d.closure.length;
    this.history.push({ t: d.time, v: d.volts, c: avg, slack: d.cableSlack, h: d.head[2] });
    while (this.history.length && d.time - this.history[0].t > 10) this.history.shift();
    this.drawChart();
    const tipForce = torqueAtVoltage(d.volts, avg) / armGeometry(SIZE_SCALE[this.cfg.claw.size], this.cfg.claw.arms[0].spreadCm).lever;
    this.monitorText.innerHTML = [
      ['線圈電壓', `${d.volts.toFixed(1)} V`],
      ['線圈電流', `${d.current.toFixed(2)} A`],
      ['單爪尖夾力（估）', `${tipForce.toFixed(2)} N`],
      ['爪子閉合度', d.closure.map((c) => `${Math.round(c * 100)}%`).join(' / ')],
      ['放線長度', `${(d.cableLimit * 100).toFixed(1)} cm`],
      ['鋼索鬆弛', `${(d.cableSlack * 100).toFixed(1)} cm`],
      ['爪頭位置', d.head.map((v) => (v * 100).toFixed(1)).join(', ') + ' cm'],
      ['天車位置', d.gantry.map((v) => (v * 100).toFixed(1)).join(', ') + ' cm'],
      ['物理耗時', `${d.cost.toFixed(0)} ms / 模擬秒`],
    ]
      .map(([k, v]) => `<span>${k}</span><span>${v}</span>`)
      .join('');
  }

  private drawChart(): void {
    const c = this.chart;
    const g = c.getContext('2d');
    if (!g || this.history.length < 2) return;
    const w = c.width;
    const h = c.height;
    g.clearRect(0, 0, w, h);
    const t1 = this.history[this.history.length - 1].t;
    const x = (t: number) => w - ((t1 - t) / 10) * w;
    const line = (color: string, f: (p: (typeof this.history)[number]) => number) => {
      g.strokeStyle = color;
      g.lineWidth = 2;
      g.beginPath();
      this.history.forEach((p, i) => {
        const y = h - 6 - f(p) * (h - 12);
        if (i === 0) g.moveTo(x(p.t), y);
        else g.lineTo(x(p.t), y);
      });
      g.stroke();
    };
    line('#ffcf1a', (p) => p.v / 48);
    line('#ff4fa3', (p) => p.c);
    line('#4fc3ff', (p) => Math.max(0, p.h) / 0.6);
    line('#ffffff', (p) => Math.min(1, Math.max(0, p.slack) / 0.05));
  }
}
