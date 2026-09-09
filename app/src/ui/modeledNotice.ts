export function modeledNoticeText(fraction: number): string {
  const clamped = Math.min(Math.max(fraction, 0), 1);
  // Rounding 0.9994 up to 100% would deny the 2,013 measured objects that share
  // the layer, so only a fraction of exactly 1 may report 100%.
  const percent = clamped === 1 ? 100 : Math.min(Math.round(clamped * 100), 99);
  return `${percent}% of this layer is a modeled stellar population, not measured objects. It cannot be hovered or searched.`;
}

export class ModeledNotice {
  readonly element: HTMLDivElement;
  private fraction = -1;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.hidden = true;
    this.element.setAttribute('data-testid', 'modeled-notice');
    this.element.style.cssText = [
      'position:fixed',
      'left:50%',
      'bottom:18px',
      'transform:translateX(-50%)',
      'max-width:min(680px,92vw)',
      'pointer-events:none',
      'padding:7px 12px',
      'font:12px/1.5 ui-monospace,monospace',
      'text-align:center',
      'color:#ffd9a8',
      'background:rgba(30,16,6,0.9)',
      'border:1px solid rgba(255,180,90,0.45)',
      'border-radius:4px',
      'z-index:30',
    ].join(';');
    parent.appendChild(this.element);
  }

  setFraction(fraction: number): void {
    if (fraction === this.fraction) return;
    this.fraction = fraction;
    this.element.textContent = modeledNoticeText(fraction);
  }

  setVisible(visible: boolean): void {
    this.element.hidden = !visible;
  }

  dispose(): void {
    this.element.remove();
  }
}
