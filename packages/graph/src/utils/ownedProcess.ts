import { ChildProcess } from "node:child_process";
import path from "node:path";

const TERMINATION_GRACE_MS = 250;
const FORCED_EXIT_GRACE_MS = 2_000;

export namespace ownedProcess {
  export interface ICommand {
    command: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
  }

  /**
   * Spawn setting that gives one graph-owned command an addressable POSIX
   * process group. Windows commands run below a dedicated Job Object
   * supervisor that owns the complete descendant tree.
   */
  export function group(): boolean {
    return process.platform !== "win32";
  }

  /**
   * Put one Windows command below a dedicated Job Object owner.
   *
   * `taskkill /T` loses a tree after its root exits because Windows keeps no
   * queryable ancestry rooted at a dead PID. The supervisor creates a private
   * Job Object without breakaway and assigns a gated process before the real
   * command can start. The real command and every descendant therefore remain
   * owned even if their immediate parents exit.
   */
  export function command(
    command: string,
    args: readonly string[],
    windowsVerbatimArguments?: boolean,
  ): ICommand {
    /* c8 ignore start -- POSIX-only direct invocation; POSIX lifecycle
     * integration exercises this arm while Windows coverage uses the Job
     * Object supervisor below. */
    if (process.platform !== "win32") {
      return {
        command,
        args: [...args],
        windowsVerbatimArguments,
      };
    }
    /* c8 ignore stop */
    /* c8 ignore start -- Windows-only Job Object invocation; lifecycle
     * integration exercises the encoded supervisor on Windows CI. */
    const payload = Buffer.from(
      JSON.stringify({
        command,
        args,
        windowsVerbatimArguments: windowsVerbatimArguments === true,
      }),
      "utf8",
    ).toString("base64");
    const script = WINDOWS_JOB_SUPERVISOR.replace(
      "__NODE__",
      quotePowerShell(process.execPath),
    ).replace(
      "__GATE__",
      quotePowerShell(path.join(__dirname, "windowsProcessSupervisor.js")),
    ).replace("__PAYLOAD__", quotePowerShell(payload));
    return {
      command: path.join(
        process.env.SystemRoot ?? "C:\\Windows",
        "System32",
        "WindowsPowerShell",
        "v1.0",
        "powershell.exe",
      ),
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-EncodedCommand",
        Buffer.from(script, "utf16le").toString("base64"),
      ],
    };
    /* c8 ignore stop */
  }

  /** Wait for an exact child handle, without searching the PID table. */
  export function exit(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
      const settled = (): void => {
        child.off("error", settled);
        child.off("exit", settled);
        child.off("close", settled);
        resolve();
      };
      child.once("error", settled);
      child.once("exit", settled);
      child.once("close", settled);
    });
  }

  /**
   * Retire the exact process tree rooted at a child spawned with
   * {@link group}. Unrelated processes are never enumerated or signalled.
   */
  export async function terminate(
    child: ChildProcess,
    exit: Promise<void>,
    owner: string,
    options: { cooperativeStdin?: boolean } = {},
  ): Promise<void> {
    // Give a cooperative transport one bounded chance to observe EOF, flush
    // its final bookkeeping, and retire its own descendants. Destroying stdin
    // and signalling the process group in the same turn races readline's close
    // handler on POSIX and makes an orderly shutdown platform-dependent.
    if (
      options.cooperativeStdin === true &&
      child.stdin !== null &&
      !child.stdin.destroyed
    ) {
      child.stdin.end();
      if (await waitForOwnedTreeExit(child, exit, TERMINATION_GRACE_MS)) {
        return;
      }
    }
    if (
      !isRunning(child) &&
      /* c8 ignore next -- only one platform arm runs on a coverage host. */
      (process.platform === "win32" || !isOwnedProcessGroupRunning(child))
    ) {
      return;
    }
    /* c8 ignore start -- one OS lane runs on each coverage host; platform
     * lifecycle tests exercise both implementations. */
    if (process.platform === "win32") {
      // The exact child is the private Job Object supervisor created by
      // command(). Terminating that one process closes its sole Job handle;
      // KILL_ON_JOB_CLOSE retires every inherited descendant atomically.
      // taskkill /T is both slower and unable to recover descendants after a
      // command leader has already exited, which is why the Job exists.
      child.kill("SIGKILL");
      if (await waitForExit(exit, FORCED_EXIT_GRACE_MS)) return;
      throw new Error(
        `${owner}: owned process tree did not exit after forced termination`,
      );
    }
    signalOwnedProcessGroup(child, "SIGTERM");
    if (await waitForOwnedTreeExit(child, exit, TERMINATION_GRACE_MS)) return;
    signalOwnedProcessGroup(child, "SIGKILL");
    if (!(await waitForOwnedTreeExit(child, exit, FORCED_EXIT_GRACE_MS))) {
      throw new Error(
        `${owner}: owned process tree did not exit after forced termination`,
      );
    }
    /* c8 ignore stop */
  }
}

/* c8 ignore start -- Windows-only Job Object controller. The Windows
 * lifecycle lane executes this encoded script and proves descendant cleanup. */
function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

const WINDOWS_JOB_SUPERVISOR = String.raw`
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Threading;

public static class SamchonGraphJob {
  [StructLayout(LayoutKind.Sequential)]
  private struct BasicLimitInformation {
    public long PerProcessUserTimeLimit;
    public long PerJobUserTimeLimit;
    public uint LimitFlags;
    public UIntPtr MinimumWorkingSetSize;
    public UIntPtr MaximumWorkingSetSize;
    public uint ActiveProcessLimit;
    public UIntPtr Affinity;
    public uint PriorityClass;
    public uint SchedulingClass;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct IoCounters {
    public ulong ReadOperationCount;
    public ulong WriteOperationCount;
    public ulong OtherOperationCount;
    public ulong ReadTransferCount;
    public ulong WriteTransferCount;
    public ulong OtherTransferCount;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct ExtendedLimitInformation {
    public BasicLimitInformation BasicLimitInformation;
    public IoCounters IoInfo;
    public UIntPtr ProcessMemoryLimit;
    public UIntPtr JobMemoryLimit;
    public UIntPtr PeakProcessMemoryUsed;
    public UIntPtr PeakJobMemoryUsed;
  }

  [StructLayout(LayoutKind.Sequential)]
  private struct BasicAccountingInformation {
    public long TotalUserTime;
    public long TotalKernelTime;
    public long ThisPeriodTotalUserTime;
    public long ThisPeriodTotalKernelTime;
    public uint TotalPageFaultCount;
    public uint TotalProcesses;
    public uint ActiveProcesses;
    public uint TotalTerminatedProcesses;
  }

  [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
  private static extern IntPtr CreateJobObject(IntPtr attributes, string name);

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool SetInformationJobObject(
    IntPtr job,
    int informationClass,
    IntPtr information,
    uint length
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool AssignProcessToJobObject(
    IntPtr job,
    IntPtr process
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool QueryInformationJobObject(
    IntPtr job,
    int informationClass,
    out BasicAccountingInformation information,
    uint length,
    IntPtr returnedLength
  );

  [DllImport("kernel32.dll", SetLastError = true)]
  private static extern bool TerminateJobObject(IntPtr job, uint exitCode);

  [DllImport("kernel32.dll", SetLastError = true)]
  public static extern bool CloseHandle(IntPtr handle);

  public static IntPtr CreateOwned() {
    IntPtr job = CreateJobObject(IntPtr.Zero, null);
    if (job == IntPtr.Zero) ThrowLast("CreateJobObject");
    var limits = new ExtendedLimitInformation();
    limits.BasicLimitInformation.LimitFlags = 0x00002000;
    int length = Marshal.SizeOf(typeof(ExtendedLimitInformation));
    IntPtr buffer = Marshal.AllocHGlobal(length);
    try {
      Marshal.StructureToPtr(limits, buffer, false);
      if (!SetInformationJobObject(job, 9, buffer, (uint)length)) {
        int error = Marshal.GetLastWin32Error();
        CloseHandle(job);
        throw new Win32Exception(error, "SetInformationJobObject");
      }
    } finally {
      Marshal.FreeHGlobal(buffer);
    }
    return job;
  }

  public static void Assign(IntPtr job, IntPtr process) {
    if (!AssignProcessToJobObject(job, process)) {
      ThrowLast("AssignProcessToJobObject");
    }
  }

  public static void TerminateAndWait(IntPtr job) {
    BasicAccountingInformation accounting;
    if (!QueryInformationJobObject(
      job,
      1,
      out accounting,
      (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)),
      IntPtr.Zero
    )) {
      ThrowLast("QueryInformationJobObject");
    }
    if (accounting.ActiveProcesses != 0 && !TerminateJobObject(job, 1)) {
      ThrowLast("TerminateJobObject");
    }
    DateTime deadline = DateTime.UtcNow.AddSeconds(2);
    do {
      if (!QueryInformationJobObject(
        job,
        1,
        out accounting,
        (uint)Marshal.SizeOf(typeof(BasicAccountingInformation)),
        IntPtr.Zero
      )) {
        ThrowLast("QueryInformationJobObject");
      }
      if (accounting.ActiveProcesses == 0) return;
      Thread.Sleep(10);
    } while (DateTime.UtcNow < deadline);
    throw new TimeoutException("owned Windows Job Object did not retire");
  }

  private static void ThrowLast(string operation) {
    throw new Win32Exception(Marshal.GetLastWin32Error(), operation);
  }
}
'@

$job = [SamchonGraphJob]::CreateOwned()
$marker = [IO.Path]::Combine(
  [IO.Path]::GetTempPath(),
  'samchon-graph-job-' + [Guid]::NewGuid().ToString('N')
)
$exitCode = 1
try {
  $env:SAMCHON_GRAPH_OWNED_COMMAND = __PAYLOAD__
  $env:SAMCHON_GRAPH_OWNED_GATE = $marker
  $gateScript = __GATE__
  $gate = Start-Process -FilePath __NODE__ -ArgumentList ('"' + $gateScript + '"') -WorkingDirectory (Get-Location) -NoNewWindow -PassThru
  try {
    [SamchonGraphJob]::Assign($job, $gate.Handle)
  } catch {
    Stop-Process -Id $gate.Id -Force -ErrorAction SilentlyContinue
    throw
  }
  [IO.File]::WriteAllText($marker, 'go')
  $gate.WaitForExit()
  $exitCode = $gate.ExitCode
} catch {
  [Console]::Error.WriteLine('@samchon/graph: Windows Job Object supervisor failed: ' + $_.Exception.Message)
} finally {
  try {
    [SamchonGraphJob]::TerminateAndWait($job)
  } catch {
    [Console]::Error.WriteLine('@samchon/graph: Windows Job Object cleanup failed: ' + $_.Exception.Message)
    $exitCode = 1
  }
  [SamchonGraphJob]::CloseHandle($job) | Out-Null
  Remove-Item -LiteralPath $marker -Force -ErrorAction SilentlyContinue
}
exit $exitCode
`;
/* c8 ignore stop */

function isRunning(child: ChildProcess): boolean {
  return (
    child.pid !== undefined &&
    child.exitCode === null &&
    child.signalCode === null
  );
}

/* c8 ignore start -- POSIX-only process-group liveness probe. */
function isOwnedProcessGroupRunning(child: ChildProcess): boolean {
  if (process.platform === "win32" || child.pid === undefined) return false;
  try {
    process.kill(-child.pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}
/* c8 ignore stop */

/* c8 ignore start -- POSIX-only fixed-signal process-group helper. */
function signalOwnedProcessGroup(
  child: ChildProcess,
  signal: NodeJS.Signals,
): void {
  try {
    process.kill(-child.pid!, signal);
  } catch {
    try {
      child.kill(signal);
    } catch {
      return;
    }
  }
}
/* c8 ignore stop */

/* c8 ignore start -- Windows-only exact child wait. POSIX waits for both the
 * child and its process group in waitForOwnedTreeExit below. */
function waitForExit(exit: Promise<void>, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (value: boolean): void => {
      /* c8 ignore next -- child exit and its deadline may race. */
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(value);
    };
    const timer = setTimeout(() => finish(false), timeoutMs);
    timer.unref();
    void exit.then(() => finish(true));
  });
}
/* c8 ignore stop */

/**
 * A POSIX process group can outlive its leader. Waiting for the child handle
 * alone would report success as soon as the leader exits even when a descendant
 * ignored SIGTERM, so forced termination must wait for both facts.
 */
/* c8 ignore start -- POSIX-only process-group polling; lifecycle integration
 * exercises it on Linux and macOS while Windows uses taskkill above. */
async function waitForOwnedTreeExit(
  child: ChildProcess,
  exit: Promise<void>,
  timeoutMs: number,
): Promise<boolean> {
  if (process.platform === "win32") return waitForExit(exit, timeoutMs);
  let rootExited = false;
  void exit.then(() => {
    rootExited = true;
  });
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (rootExited && !isOwnedProcessGroupRunning(child)) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    // Keep this bounded cleanup alive after the group leader has exited. An
    // unref'd timer plus an orphaned detached descendant could let Node quit
    // before the promised process-tree cleanup finishes.
    await new Promise<undefined>((resolve) => {
      setTimeout(() => resolve(undefined), Math.min(25, remaining));
    });
  }
}
/* c8 ignore stop */
