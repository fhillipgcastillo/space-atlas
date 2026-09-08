export class HoverCard {
  private readonly element: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.element = document.createElement('div');
    this.element.hidden = true;
    this.element.dataset['hoverCard'] = '';
    this.element.style.cssText = [
      'position:fixed',
      'pointer-events:none',
      'padding:6px 9px',
      'font:11px/1.5 ui-monospace,monospace',
      'color:#e8f1ff',
      'background:rgba(8,12,22,0.88)',
      'border:1px solid rgba(120,160,220,0.35)',
      'border-radius:4px',
      'white-space:pre',
      'z-index:20',
    ].join(';');
    parent.appendChild(this.element);
  }

  show(text: string, x: number, y: number): void {
    this.element.textContent = text;
    this.element.hidden = false;
    const rect = this.element.getBoundingClientRect();
    this.element.style.left = `${Math.max(Math.min(x + 14, window.innerWidth - rect.width - 8), 8)}px`;
    this.element.style.top = `${Math.max(Math.min(y + 14, window.innerHeight - rect.height - 8), 8)}px`;
  }

  hide(): void {
    this.element.hidden = true;
  }

  dispose(): void {
    this.element.remove();
  }
}
