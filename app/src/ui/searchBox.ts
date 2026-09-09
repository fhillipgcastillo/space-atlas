import { search, type SearchEntry } from '../interaction/search.js';

const MAX_RESULTS = 8;

export class SearchBox {
  private readonly root: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly list: HTMLDivElement;
  private entries: SearchEntry[] = [];
  private results: SearchEntry[] = [];

  constructor(
    parent: HTMLElement,
    private readonly onPick: (entry: SearchEntry) => void,
  ) {
    this.root = document.createElement('div');
    this.root.setAttribute('data-testid', 'search-box');
    this.root.style.cssText = [
      'position:fixed',
      'left:12px',
      'top:12px',
      'width:min(320px,60vw)',
      'font:12px/1.5 ui-monospace,monospace',
      'color:#e8f1ff',
      'z-index:40',
    ].join(';');

    this.input = document.createElement('input');
    this.input.type = 'search';
    this.input.placeholder = 'Search names (indexing…)';
    this.input.setAttribute('data-testid', 'search-input');
    this.input.style.cssText = [
      'width:100%',
      'box-sizing:border-box',
      'padding:6px 9px',
      'font:inherit',
      'color:inherit',
      'background:rgba(8,12,22,0.82)',
      'border:1px solid rgba(120,160,220,0.35)',
      'border-radius:4px',
      'outline:none',
    ].join(';');

    this.list = document.createElement('div');
    this.list.setAttribute('data-testid', 'search-results');
    this.list.style.cssText = ['margin-top:4px', 'display:flex', 'flex-direction:column'].join(';');

    this.root.append(this.input, this.list);
    parent.appendChild(this.root);

    this.input.addEventListener('input', this.onInput);
    // FlyControls listens on window, so WASDQE typed into the box would fly the
    // camera. Stopping both edges keeps a key from sticking down.
    this.input.addEventListener('keydown', this.onKeyDown);
    this.input.addEventListener('keyup', stopEvent);
  }

  setEntries(entries: SearchEntry[]): void {
    this.entries = entries;
    this.input.placeholder = `Search ${entries.length} names`;
    this.render();
  }

  dispose(): void {
    this.input.removeEventListener('input', this.onInput);
    this.input.removeEventListener('keydown', this.onKeyDown);
    this.input.removeEventListener('keyup', stopEvent);
    this.root.remove();
  }

  private readonly onInput = (): void => {
    this.render();
  };

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    event.stopPropagation();
    if (event.key === 'Enter' && this.results[0]) this.pick(this.results[0]);
    if (event.key === 'Escape') {
      this.input.value = '';
      this.render();
    }
  };

  private pick(entry: SearchEntry): void {
    this.input.blur();
    this.onPick(entry);
  }

  private render(): void {
    this.results = search(this.entries, this.input.value, MAX_RESULTS);
    this.list.replaceChildren(
      ...this.results.map((entry) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.setAttribute('data-testid', 'search-result');
        row.textContent = `${entry.name} · ${entry.layerKey}`;
        row.style.cssText = [
          'text-align:left',
          'padding:4px 9px',
          'font:inherit',
          'color:inherit',
          'background:rgba(8,12,22,0.9)',
          'border:1px solid rgba(120,160,220,0.25)',
          'border-top:none',
          'cursor:pointer',
        ].join(';');
        row.addEventListener('click', () => this.pick(entry));
        return row;
      }),
    );
  }
}

const stopEvent = (event: Event): void => event.stopPropagation();
