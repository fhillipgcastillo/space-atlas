import { spawn, execFileSync } from 'node:child_process';
import os from 'node:os';

// SwiftShader rasterises 33M points on the CPU, so an unconstrained run makes
// the machine unusable. Cap the share and let the OS preempt us.
const TOTAL = os.cpus().length;
const CORES = Math.max(1, Math.min(TOTAL, Number(process.env['E2E_CORES'] ?? Math.floor(TOTAL / 2))));
const AFFINITY = (1n << BigInt(CORES)) - 1n;
const TARGETS = /^(chrome-headless-shell|chrome|node)$/i;

// npx.cmd directly rather than shell:true, which concatenates args unescaped.
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
});

const tamed = new Set();

function descendants(root) {
  if (process.platform !== 'win32') return [];
  const script = `Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name | ConvertTo-Json -Compress`;
  try {
    const all = JSON.parse(execFileSync('powershell', ['-NoProfile', '-Command', script], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    }));
    const byParent = new Map();
    for (const p of all) {
      const list = byParent.get(p.ParentProcessId) ?? [];
      list.push(p);
      byParent.set(p.ParentProcessId, list);
    }
    const out = [];
    const walk = (pid) => {
      for (const p of byParent.get(pid) ?? []) {
        out.push(p);
        walk(p.ProcessId);
      }
    };
    walk(root);
    // Playwright's browsers are not always our descendants; they are still ours.
    for (const p of all) if (/^chrome-headless-shell$/i.test(p.Name)) out.push(p);
    return out;
  } catch {
    return [];
  }
}

function tame() {
  for (const p of descendants(child.pid)) {
    if (tamed.has(p.ProcessId) || !TARGETS.test(p.Name)) continue;
    tamed.add(p.ProcessId);
    try {
      os.setPriority(p.ProcessId, os.constants.priority.PRIORITY_LOW);
    } catch {
      /* process may have exited between listing and setting */
    }
    if (process.platform === 'win32') {
      try {
        execFileSync(
          'powershell',
          ['-NoProfile', '-Command', `(Get-Process -Id ${p.ProcessId}).ProcessorAffinity=${AFFINITY}`],
          { stdio: 'ignore' },
        );
      } catch {
        /* same race */
      }
    }
  }
}

console.log(`[nice-e2e] limiting tests to ${CORES}/${TOTAL} logical processors at low priority`);
const timer = setInterval(tame, 2000);
tame();

child.on('exit', (code, signal) => {
  clearInterval(timer);
  process.exit(code ?? (signal ? 1 : 0));
});
