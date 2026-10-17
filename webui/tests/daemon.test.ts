import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { statusCmd, stopCmd, startCmd, saveCmd, parseDaemonResult, templatesReadCmd, templatesSaveCmd, parseTemplateSaveResult } from "../src/lib/daemon";

const M = "/data/adb/modules/oplus-sidekey";

// Windows 使用现有 Git 自带的 POSIX shell；不需要新服务或依赖。
const shell = process.platform === "win32"
  ? resolve(execFileSync("git", ["--exec-path"], { encoding: "utf8" }).trim(), "../../../bin/bash.exe")
  : "sh";

function runSave({ payload = "a2V5Y29kZT03MzUK", setup = "" } = {}) {
  const script = `
    ROOT=$(mktemp -d) || exit 1
    trap 'rm -rf "$ROOT"' EXIT
    D="$ROOT/module dir"
    mkdir -p "$D"
    printf 'original config\\n' > "$D/config.conf"
    SIGNALS="$ROOT/signals"
    : > "$SIGNALS"
    cat() {
      if [ "$1" = "$D/daemon.pid" ]; then printf '123\\n'; else command cat "$@"; fi
    }
    readlink() { [ "$1" = "/proc/123/exe" ] || return 1; printf '%s\\n' "$D/bin/oplus-sidekey"; }
    kill() { printf '%s\\n' "$*" >> "$SIGNALS"; return 0; }
    ${setup}
    (
      ${saveCmd(M, payload).replaceAll(M, "${D}")}
    )
    printf 'CONFIG\\n'
    command cat "$D/config.conf" 2>/dev/null || :
    printf 'SIGNALS\\n'
    command cat "$SIGNALS"
    printf 'TEMPFILES\\n'
    command find "$D" -type f ! -name config.conf 2>/dev/null || :
  `;
  return execFileSync(shell, ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

function runStop(setup = "") {
  const script = `
    ROOT=$(mktemp -d) || exit 1
    trap 'rm -rf "$ROOT"' EXIT
    PID=123
    EXE="$ROOT/exe"
    printf '%s\\n' '${M}/bin/oplus-sidekey' > "$EXE"
    TRACE="$ROOT/trace"
    : > "$TRACE"
    cat() {
      if [ "$1" = "${M}/daemon.pid" ]; then printf '%s\\n' "$PID"; else command cat "$@"; fi
    }
    readlink() {
      printf 'readlink %s\\n' "$1" >> "$TRACE"
      [ "$1" = "/proc/123/exe" ] || return 1
      command cat "$EXE"
    }
    kill() { printf 'kill %s\\n' "$*" >> "$TRACE"; return 0; }
    sleep() { printf 'sleep %s\\n' "$*" >> "$TRACE"; }
    ${setup}
    (
      ${stopCmd(M)}
    )
    printf 'TRACE\\n'
    command cat "$TRACE"
  `;
  return execFileSync(shell, ["-c", script], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

describe("save command", () => {
  // 故障模型：解码/写入失败却输出保存成功、覆盖旧配置，或对未验证 pid 发信号。
  it("persists UTF-8 bindings literally and requests HUP for the exact daemon", () => {
    const config = 'keycode=735\nbind.0=echo 中文; $(touch "$D/injected")\n';
    const output = runSave({ payload: Buffer.from(config, "utf8").toString("base64") });
    expect(output).toBe(`saved-hup-requested\nCONFIG\n${config}SIGNALS\n-HUP 123\nTEMPFILES\n`);
  });

  it("preserves a valid config after a failed decode and sends no signal", () => {
    expect(runSave({ payload: "a2V5Y29kZT03MzUK!" })).toBe("failed\nCONFIG\noriginal config\nSIGNALS\nTEMPFILES\n");
  });

  it("reports failed when the config cannot be written and sends no signal", () => {
    expect(runSave({ setup: 'D="$ROOT/missing dir"' })).toBe("failed\nCONFIG\nSIGNALS\nTEMPFILES\n");
  });

  it("preserves the valid config when atomic replacement fails", () => {
    expect(runSave({ setup: "mv() { return 1; }" })).toBe("failed\nCONFIG\noriginal config\nSIGNALS\nTEMPFILES\n");
  });

  it.each([
    ["missing pid", "cat() { return 1; }"],
    ["stale pid", "readlink() { return 1; }"],
    ["unrelated exe", "readlink() { printf '/system/bin/sh\\n'; }"],
    ["similar exe path", 'readlink() { printf "%s\\n" "$D/bin/oplus-sidekey-other"; }'],
  ])("saves without signalling for %s", (_name, setup) => {
    expect(runSave({ setup })).toBe("saved\nCONFIG\nkeycode=735\nSIGNALS\nTEMPFILES\n");
  });

  it("reports a failed HUP separately from a successful config write", () => {
    const output = runSave({ setup: 'kill() { printf "%s\\n" "$*" >> "$SIGNALS"; return 1; }' });
    expect(output).toBe("saved-hup-failed\nCONFIG\nkeycode=735\nSIGNALS\n-HUP 123\nTEMPFILES\n");
  });
});

describe("save result parsing", () => {
  it.each(["saved", "saved-hup-requested", "saved-hup-failed", "failed"] as const)(
    "accepts the final %s marker line", (marker) => {
      expect(parseDaemonResult(`diagnostic output\n${marker}\n`)).toBe(marker);
    },
  );

  it.each(["ok", "not-saved", "saved-hup-requested but failed", "saved\nunknown", ""])(
    "does not accept unconfirmed output '%s'", (stdout) => {
      expect(parseDaemonResult(stdout)).toBeNull();
    },
  );
});

describe("stop command lifecycle", () => {
  // 故障模型：TERM 接受被误认为退出，或确认时重新读取 pid 而漏掉原进程。
  it("reports failed when TERM is accepted but the same daemon survives the grace period", () => {
    expect(runStop()).toBe("failed\nTRACE\nreadlink /proc/123/exe\nkill -TERM 123\nsleep 1\nreadlink /proc/123/exe\n");
  });

  it("reports stopped only after the original daemon exits during the grace period", () => {
    const setup = 'sleep() { printf "sleep %s\\n" "$*" >> "$TRACE"; : > "$EXE"; }';
    expect(runStop(setup)).toBe("stopped\nTRACE\nreadlink /proc/123/exe\nkill -TERM 123\nsleep 1\nreadlink /proc/123/exe\n");
  });

  it("reports failed when TERM is rejected without waiting or retrying", () => {
    const setup = 'kill() { printf "kill %s\\n" "$*" >> "$TRACE"; return 1; }';
    expect(runStop(setup)).toBe("failed\nTRACE\nreadlink /proc/123/exe\nkill -TERM 123\n");
  });

  it.each([
    ["missing pid", 'PID=""', "not-running\nTRACE\n"],
    ["stale pid", ': > "$EXE"', "not-running\nTRACE\nreadlink /proc/123/exe\n"],
    ["unrelated exe", 'printf "/system/bin/sh\\n" > "$EXE"', "not-running\nTRACE\nreadlink /proc/123/exe\n"],
    ["similar exe path", 'printf "%s\\n" "/data/adb/modules/oplus-sidekey/bin/oplus-sidekey-other" > "$EXE"', "not-running\nTRACE\nreadlink /proc/123/exe\n"],
  ])("reports not-running for %s without signalling", (_name, setup, output) => {
    expect(runStop(setup)).toBe(output);
  });

  it("does not signal a reused pid after the original daemon exits", () => {
    const setup = 'sleep() { printf "sleep %s\\n" "$*" >> "$TRACE"; printf "/system/bin/sh\\n" > "$EXE"; }';
    expect(runStop(setup)).toBe("stopped\nTRACE\nreadlink /proc/123/exe\nkill -TERM 123\nsleep 1\nreadlink /proc/123/exe\n");
  });

  it("checks the original pid even when the pid file changes during the grace period", () => {
    const setup = 'sleep() { printf "sleep %s\\n" "$*" >> "$TRACE"; PID=456; }';
    expect(runStop(setup)).toBe("failed\nTRACE\nreadlink /proc/123/exe\nkill -TERM 123\nsleep 1\nreadlink /proc/123/exe\n");
  });
});

describe("daemon control commands", () => {
  it("status prints a fixed running/stopped marker", () => {
    const c = statusCmd(M);
    expect(c).toContain("echo running");
    expect(c).toContain("echo stopped");
  });

  it("start runs service.sh and reports started only after the pid matches", () => {
    const c = startCmd(M);
    expect(c).toContain(`sh ${M}/service.sh`);
    expect(c).toContain("echo started");
    expect(c).toContain("echo failed");
  });

  it("compares the pid exe with the daemon path inside the module dir", () => {
    expect(statusCmd(M)).toContain(`"${M}/bin/oplus-sidekey"`);
  });

  it("never swallows errors with 2>/dev/null followed by an unconditional ok", () => {
    for (const c of [statusCmd(M), stopCmd(M), startCmd(M)]) {
      expect(c).not.toContain("echo ok");
    }
  });
});

describe("template bridge commands", () => {
  it("reports an existing file read failure rather than an empty library", () => {
    const script = `D=$(mktemp -d); trap 'rm -rf "$D"' EXIT; : > "$D/templates.json"; cat() { printf 'read failed' >&2; return 1; }; ${templatesReadCmd(M).replaceAll(M, "$D")}`;
    expect(() => execFileSync(shell, ["-c", script], { encoding: "utf8", stdio: "pipe" })).toThrow();
  });
  it("reads an existing templates file and falls back to an empty array", () => {
    expect(templatesReadCmd(M)).toContain(`cat "${M}/templates.json"`);
    expect(templatesReadCmd(M)).toContain("printf '[]'");
  });

  it("reads the file contents or prints an empty array when absent", () => {
    const script = `D=$(mktemp -d); trap 'rm -rf "$D"' EXIT; printf '[{"id":"x"}]' > "$D/templates.json"; ${templatesReadCmd(M).replaceAll(M, "$D")}; rm "$D/templates.json"; ${templatesReadCmd(M).replaceAll(M, "$D")}`;
    expect(execFileSync(shell, ["-c", script], { encoding: "utf8" })).toBe('[{"id":"x"}][]');
  });

  it("writes through a same-directory temporary file and emits a template marker", () => {
    const command = templatesSaveCmd(M, "W10=");
    expect(command).toContain(`mktemp "${M}/templates.json.XXXXXX"`);
    expect(command).toContain(`mv "$T" "${M}/templates.json"`);
    expect(command).toContain("templates-saved");
    expect(command).toContain("templates-failed");
  });

  it("atomically saves decoded content and leaves no temporary file", () => {
    const payload = Buffer.from('[{"id":"x"}]', "utf8").toString("base64");
    const script = `D=$(mktemp -d); trap 'rm -rf "$D"' EXIT; ${templatesSaveCmd(M, payload).replaceAll(M, "$D")}; printf '\n'; cat "$D/templates.json"; printf '\n'; find "$D" -type f | wc -l`;
    expect(execFileSync(shell, ["-c", script], { encoding: "utf8" })).toBe("templates-saved\n\n[{\"id\":\"x\"}]\n1\n");
  });

  it.each(["templates-saved", "templates-failed"] as const)("parses %s separately", marker => {
    expect(parseTemplateSaveResult(`diagnostic\n${marker}\n`)).toBe(marker);
  });

  it("does not accept an unrelated marker", () => {
    expect(parseTemplateSaveResult("saved\n")).toBeNull();
  });
});
