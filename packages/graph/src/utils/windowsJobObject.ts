/* c8 ignore start -- Windows-only native process ownership. Windows lifecycle
 * integration executes this module; POSIX coverage cannot call kernel32. */
const JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x00002000;
const JOB_OBJECT_EXTENDED_LIMIT_INFORMATION = 9;
const JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION = 1;
const PROCESS_TERMINATE = 0x0001;
const PROCESS_SET_QUOTA = 0x0100;
const CLEANUP_TIMEOUT_MS = 2_000;

export namespace windowsJobObject {
  export interface IJob {
    handle: bigint;
    closed: boolean;
  }

  /** Load and bind kernel32 before a child process enters the assignment path. */
  export function prepare(): void {
    windowsApi();
  }

  export function create(pid: number): IJob {
    const api = windowsApi();
    const handle = api.createJobObject(null, null) as bigint | null;
    if (handle === null || handle === 0n) fail(api, "CreateJobObjectW");
    const job: IJob = { handle, closed: false };
    try {
      const limits = Buffer.alloc(api.extendedLimitSize);
      limits.writeUInt32LE(
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE,
        api.limitFlagsOffset,
      );
      if (
        api.setInformationJobObject(
          handle,
          JOB_OBJECT_EXTENDED_LIMIT_INFORMATION,
          limits,
          limits.length,
        ) !== true
      ) {
        fail(api, "SetInformationJobObject");
      }
      const processHandle = api.openProcess(
        PROCESS_TERMINATE | PROCESS_SET_QUOTA,
        false,
        pid,
      ) as bigint | null;
      if (processHandle === null || processHandle === 0n) {
        fail(api, "OpenProcess");
      }
      try {
        if (api.assignProcessToJobObject(handle, processHandle) !== true) {
          fail(api, "AssignProcessToJobObject");
        }
      } finally {
        api.closeHandle(processHandle);
      }
      return job;
    } catch (error) {
      close(job);
      throw error;
    }
  }

  export function terminate(job: IJob): void {
    if (job.closed || activeProcesses(job) === 0) return;
    const api = windowsApi();
    if (api.terminateJobObject(job.handle, 1) !== true) {
      fail(api, "TerminateJobObject");
    }
  }

  export async function retire(job: IJob): Promise<void> {
    try {
      terminate(job);
      const deadline = Date.now() + CLEANUP_TIMEOUT_MS;
      while (activeProcesses(job) !== 0) {
        if (Date.now() >= deadline) {
          throw new Error(
            "@samchon/graph: owned Windows Job Object did not retire",
          );
        }
        await new Promise<undefined>((resolve) => {
          setTimeout(() => resolve(undefined), 10);
        });
      }
    } finally {
      close(job);
    }
  }

  export function close(job: IJob): void {
    if (job.closed) return;
    job.closed = true;
    const api = windowsApi();
    if (api.closeHandle(job.handle) !== true) {
      fail(api, "CloseHandle");
    }
  }
}

interface IWindowsApi {
  createJobObject: (...args: unknown[]) => unknown;
  setInformationJobObject: (...args: unknown[]) => unknown;
  openProcess: (...args: unknown[]) => unknown;
  assignProcessToJobObject: (...args: unknown[]) => unknown;
  queryInformationJobObject: (...args: unknown[]) => unknown;
  terminateJobObject: (...args: unknown[]) => unknown;
  closeHandle: (...args: unknown[]) => unknown;
  getLastError: (...args: unknown[]) => unknown;
  extendedLimitSize: number;
  limitFlagsOffset: number;
  accountingType: import("koffi").TypeObject;
}

let API: IWindowsApi | undefined;

function windowsApi(): IWindowsApi {
  if (API !== undefined) return API;
  if (process.platform !== "win32") {
    throw new Error("@samchon/graph: Windows Job Object used outside Windows");
  }
  // Loaded only on Windows so POSIX startup does not initialize an unused
  // native FFI module.
  const koffi = require("koffi") as typeof import("koffi");
  const kernel32 = koffi.load("kernel32.dll");
  const basicLimit = koffi.struct("JOBOBJECT_BASIC_LIMIT_INFORMATION", {
    PerProcessUserTimeLimit: "int64_t",
    PerJobUserTimeLimit: "int64_t",
    LimitFlags: "uint32_t",
    MinimumWorkingSetSize: "uintptr_t",
    MaximumWorkingSetSize: "uintptr_t",
    ActiveProcessLimit: "uint32_t",
    Affinity: "uintptr_t",
    PriorityClass: "uint32_t",
    SchedulingClass: "uint32_t",
  });
  const ioCounters = koffi.struct("IO_COUNTERS", {
    ReadOperationCount: "uint64_t",
    WriteOperationCount: "uint64_t",
    OtherOperationCount: "uint64_t",
    ReadTransferCount: "uint64_t",
    WriteTransferCount: "uint64_t",
    OtherTransferCount: "uint64_t",
  });
  const extendedLimit = koffi.struct(
    "JOBOBJECT_EXTENDED_LIMIT_INFORMATION",
    {
      BasicLimitInformation: basicLimit,
      IoInfo: ioCounters,
      ProcessMemoryLimit: "uintptr_t",
      JobMemoryLimit: "uintptr_t",
      PeakProcessMemoryUsed: "uintptr_t",
      PeakJobMemoryUsed: "uintptr_t",
    },
  );
  const accountingType = koffi.struct(
    "JOBOBJECT_BASIC_ACCOUNTING_INFORMATION",
    {
      TotalUserTime: "int64_t",
      TotalKernelTime: "int64_t",
      ThisPeriodTotalUserTime: "int64_t",
      ThisPeriodTotalKernelTime: "int64_t",
      TotalPageFaultCount: "uint32_t",
      TotalProcesses: "uint32_t",
      ActiveProcesses: "uint32_t",
      TotalTerminatedProcesses: "uint32_t",
    },
  );
  API = {
    createJobObject: kernel32.func(
      "__stdcall",
      "CreateJobObjectW",
      "void *",
      ["void *", "str16"],
    ),
    setInformationJobObject: kernel32.func(
      "__stdcall",
      "SetInformationJobObject",
      "bool",
      ["void *", "int", "void *", "uint32_t"],
    ),
    openProcess: kernel32.func("__stdcall", "OpenProcess", "void *", [
      "uint32_t",
      "bool",
      "uint32_t",
    ]),
    assignProcessToJobObject: kernel32.func(
      "__stdcall",
      "AssignProcessToJobObject",
      "bool",
      ["void *", "void *"],
    ),
    queryInformationJobObject: kernel32.func(
      "__stdcall",
      "QueryInformationJobObject",
      "bool",
      ["void *", "int", "void *", "uint32_t", "void *"],
    ),
    terminateJobObject: kernel32.func(
      "__stdcall",
      "TerminateJobObject",
      "bool",
      ["void *", "uint32_t"],
    ),
    closeHandle: kernel32.func("__stdcall", "CloseHandle", "bool", [
      "void *",
    ]),
    getLastError: kernel32.func(
      "__stdcall",
      "GetLastError",
      "uint32_t",
      [],
    ),
    extendedLimitSize: extendedLimit.size,
    limitFlagsOffset:
      extendedLimit.members!.BasicLimitInformation!.offset +
      basicLimit.members!.LimitFlags!.offset,
    accountingType,
  };
  return API;
}

function activeProcesses(job: windowsJobObject.IJob): number {
  if (job.closed) return 0;
  const api = windowsApi();
  const buffer = Buffer.alloc(api.accountingType.size);
  if (
    api.queryInformationJobObject(
      job.handle,
      JOB_OBJECT_BASIC_ACCOUNTING_INFORMATION,
      buffer,
      buffer.length,
      null,
    ) !== true
  ) {
    fail(api, "QueryInformationJobObject");
  }
  const koffi = require("koffi") as typeof import("koffi");
  return (
    koffi.decode(buffer, api.accountingType) as {
      ActiveProcesses: number;
    }
  ).ActiveProcesses;
}

function fail(api: IWindowsApi, operation: string): never {
  throw new Error(
    `@samchon/graph: ${operation} failed with Windows error ${String(
      api.getLastError(),
    )}`,
  );
}
/* c8 ignore stop */
