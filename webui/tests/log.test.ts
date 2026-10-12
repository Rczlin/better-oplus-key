import { describe, it, expect } from "vitest";
import { parseExplainLog, parseEventsJsonl } from "../src/lib/log";

describe("parseExplainLog", () => {
  it("parses a sequence explanation line", () => {
    const line = "2026-10-12 16:00:01 INFO seq=00 action=echo double result=0";
    const rows = parseExplainLog(line);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: "INFO", seq: "00", action: "echo double", result: "0" });
  });

  it("keeps non-sequence lines with level and message", () => {
    const rows = parseExplainLog("2026-10-12 16:00:00 ERROR grab failed: EBUSY");
    expect(rows[0]).toMatchObject({ level: "ERROR", message: "grab failed: EBUSY" });
    expect(rows[0].seq).toBeUndefined();
  });

  it("skips blank and malformed lines without throwing", () => {
    // 输入共 5 行，只有最后一行是合法日志行
    const rows = parseExplainLog("\n\nnot a log line\n2026-10-12 16:00:00 WARN ok\n");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ level: "WARN", message: "ok" });
  });

  it("parses a dropped sequence as result 'dropped'", () => {
    const rows = parseExplainLog("2026-10-12 16:00:02 INFO seq=111 action=none result=dropped");
    expect(rows[0]).toMatchObject({ seq: "111", action: "none", result: "dropped" });
  });
});

describe("parseEventsJsonl", () => {
  it("parses one JSON object per line", () => {
    const text = '{"wall_ms":1,"mono_ms":10,"edge":"down","code":735}\n{"wall_ms":2,"mono_ms":20,"edge":"up","code":735}\n';
    const rows = parseEventsJsonl(text);
    expect(rows.map((r) => r.edge)).toEqual(["down", "up"]);
  });

  it("drops corrupt lines instead of failing the whole panel", () => {
    const text = '{"wall_ms":1,"mono_ms":10,"edge":"down","code":735}\n{broken\n';
    expect(parseEventsJsonl(text)).toHaveLength(1);
  });

  it("drops objects missing required fields", () => {
    const text = '{"wall_ms":1}\n{"wall_ms":2,"mono_ms":20,"edge":"up","code":735}\n';
    expect(parseEventsJsonl(text)).toHaveLength(1);
  });
});
