import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  SEQUENCES,
  parseConfig,
  serializeConfig,
  validateTiming,
  type ParsedConfig,
  type Sequence,
} from "@/lib/config";
import { isKsuEnvironment, runShell } from "@/lib/ksu";
import { parseEventsJsonl, parseExplainLog, type ExplainRow, type EventRow } from "@/lib/log";

const MODDIR = "/data/adb/modules/oplus-sidekey";
const CONF = `${MODDIR}/config.conf`;
const PIDFILE = `${MODDIR}/daemon.pid`;
const LOG = `${MODDIR}/log.txt`;
const EVENTS = `${MODDIR}/events.jsonl`;
const LOG_TAIL_LINES = 200;

// 写配置：内容以 base64 传入，避免命令注入。base64 仅含 A-Za-z0-9+/=，单引号包裹安全。
function encodeBase64(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

export default function App() {
  const ksu = isKsuEnvironment();
  const [cfg, setCfg] = useState<ParsedConfig>(() => parseConfig(""));
  const [explain, setExplain] = useState<ExplainRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [running, setRunning] = useState<boolean | null>(null);

  const setTiming = (key: "longPressMs" | "windowMs", raw: string) => {
    const n = Number.parseInt(raw, 10);
    setCfg((c) => ({ ...c, [key]: Number.isNaN(n) ? c[key] : n }));
  };

  const setBinding = (seq: Sequence, value: string) => {
    setCfg((c) => ({ ...c, bindings: { ...c.bindings, [seq]: value } }));
  };

  const save = async () => {
    for (const [key, v] of [["长按阈值", cfg.longPressMs], ["窗口期", cfg.windowMs]] as const) {
      if (!validateTiming(v)) {
        toast.error(`${key} 必须是 100–800 之间的整数`);
        return;
      }
    }
    const b64 = encodeBase64(serializeConfig(cfg));
    try {
      const r = await runShell(
        `echo '${b64}' | base64 -d > ${CONF} && kill -HUP $(cat ${PIDFILE} 2>/dev/null) 2>/dev/null; echo ok`,
      );
      if (r.errno === 0) toast.success("配置已保存，守护进程已热加载");
      else toast.error(`保存失败：${r.stderr || r.errno}`);
    } catch (e) {
      toast.error(String(e));
    }
  };

  const toggleDaemon = async () => {
    try {
      if (running) {
        const r = await runShell(`kill -TERM $(cat ${PIDFILE} 2>/dev/null) 2>/dev/null; echo ok`);
        if (r.errno === 0) {
          setRunning(false);
          toast.success("已请求停止守护进程");
        }
      } else {
        const r = await runShell(`sh ${MODDIR}/service.sh; echo ok`);
        if (r.errno === 0) {
          setRunning(true);
          toast.success("已请求启动守护进程");
        }
      }
    } catch (e) {
      toast.error(String(e));
    }
  };

  // 日志仅在手动点击「刷新」时读取，不做实时流。
  const refreshLogs = async () => {
    try {
      const [a, b] = await Promise.all([
        runShell(`tail -n ${LOG_TAIL_LINES} ${LOG} 2>/dev/null`),
        runShell(`tail -n ${LOG_TAIL_LINES} ${EVENTS} 2>/dev/null`),
      ]);
      setExplain(parseExplainLog(a.stdout));
      setEvents(parseEventsJsonl(b.stdout));
    } catch (e) {
      toast.error(String(e));
    }
  };

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4">
      <Toaster />

      <Card data-test="warning-root" className="border-destructive/50">
        <CardContent className="pt-6 text-sm">
          命令以 root 执行，无沙箱。请勿输入不信任的命令。
        </CardContent>
      </Card>

      {!ksu && (
        <Card data-test="non-ksu-banner">
          <CardContent className="pt-6 text-sm">
            非 KSU 环境，仅显示界面，无法读写配置或执行命令。
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            守护进程
            {running !== null && (
              <Badge variant={running ? "default" : "secondary"}>
                {running ? "运行中" : "已停止"}
              </Badge>
            )}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Button data-test="daemon-toggle" onClick={toggleDaemon} disabled={!ksu}>
            {running ? "停止" : "启动"}
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>时间参数（100–800 毫秒）</CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-4">
          <div className="grid gap-2">
            <Label htmlFor="long-press">长按阈值</Label>
            <Input
              id="long-press"
              type="number"
              min={100}
              max={800}
              step={1}
              value={cfg.longPressMs}
              disabled={!ksu}
              onChange={(e) => setTiming("longPressMs", e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="window">窗口期</Label>
            <Input
              id="window"
              type="number"
              min={100}
              max={800}
              step={1}
              value={cfg.windowMs}
              disabled={!ksu}
              onChange={(e) => setTiming("windowMs", e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>按压序列绑定</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          {SEQUENCES.map((seq) => (
            <div key={seq} className="grid grid-cols-[4rem_1fr] items-center gap-2">
              <Label htmlFor={`bind-${seq}`} className="font-mono">
                {seq}
              </Label>
              <Input
                id={`bind-${seq}`}
                data-test={`binding-${seq}`}
                value={cfg.bindings[seq]}
                placeholder="未绑定"
                disabled={!ksu}
                onChange={(e) => setBinding(seq, e.target.value)}
              />
            </div>
          ))}
          <Button onClick={save} disabled={!ksu} data-test="save-config">
            保存配置
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            日志
            <Button data-test="log-refresh" variant="outline" size="sm" onClick={refreshLogs} disabled={!ksu}>
              刷新
            </Button>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div>
            <h3 className="mb-2 text-sm font-medium">解释日志</h3>
            <pre data-test="log-explain" className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
              {explain.length === 0
                ? "（无内容，点击刷新读取）"
                : explain.map((r, i) => (
                    <div key={i}>
                      {r.time} {r.level} {r.message}
                    </div>
                  ))}
            </pre>
          </div>
          <div>
            <h3 className="mb-2 text-sm font-medium">原始按压记录</h3>
            <pre data-test="log-events" className="max-h-64 overflow-auto rounded bg-muted p-2 text-xs">
              {events.length === 0
                ? "（无内容，点击刷新读取）"
                : events.map((e, i) => (
                    <div key={i}>
                      {JSON.stringify(e)}
                    </div>
                  ))}
            </pre>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
