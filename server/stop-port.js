const { execSync } = require('child_process');

const port = String(process.env.PORT || 8081);

function getListeningPids(targetPort) {
  try {
    const output = execSync(`netstat -ano | findstr :${targetPort}`, { encoding: 'utf8' });
    const pids = new Set();

    for (const line of output.split(/\r?\n/)) {
      if (!line.includes('LISTENING')) continue;
      const parts = line.trim().split(/\s+/);
      const pid = parts[parts.length - 1];
      if (pid && /^\d+$/.test(pid) && pid !== '0') {
        pids.add(pid);
      }
    }

    return [...pids];
  } catch {
    return [];
  }
}

const pids = getListeningPids(port);
if (!pids.length) {
  console.log(`Port ${port} is free`);
  process.exit(0);
}

for (const pid of pids) {
  try {
    execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
    console.log(`Stopped process ${pid} on port ${port}`);
  } catch {
    console.warn(`Could not stop process ${pid}`);
  }
}
