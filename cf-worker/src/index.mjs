import { connect } from "cloudflare:sockets";

import { buildClientConfig, buildClashNode, buildShortLinkFromClientConfig, buildWSPath, resolvePathRoot } from "./sudoku-config.mjs";
import { classifyPreferredEntry, comparePreferredEntries, filterPreferredEntries, loadPreferredIpPool, normalizePreferredIpStrategy, parsePreferredIpList, pickPreferredEntryWithProbe } from "./preferred-ip.mjs";
import { PackedDownlinkEncoder } from "./sudoku-packed.mjs";
import {
  ByteQueue,
  RecordLayer,
  buildKIPMessage,
  buildMuxFrame,
  concatChunks,
  decodeBase64Url,
  decodeAddress,
  decodeClientHello,
  derivePSKDirectionalBases,
  deriveSessionDirectionalBases,
  deriveX25519SharedSecret,
  encodeBase64Url,
  generateX25519KeyPair,
  processEarlyClientPayload,
  splitHostPort,
  tryReadKIPMessage,
  tryReadMuxFrame,
} from "./sudoku-protocol.mjs";
import { buildSudokuTable, decodeSudokuBytes, encodeSudokuBytes, newSudokuDecodeState, oppositeDirection } from "./sudoku-table.mjs";

function textResponse(body, status = 200, contentType = "text/plain; charset=utf-8") {
  return new Response(body, { status, headers: { "content-type": contentType } });
}

function htmlEscape(input) {
  return String(input)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function parseBoolean(value, fallback) {
  if (value === undefined || value === null || value === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`invalid boolean value: ${value}`);
}

function normalizeMultiplexMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw || raw === "off") return "off";
  if (raw === "auto" || raw === "on") return raw;
  throw new Error(`invalid multiplex mode: ${value}`);
}

function normalizeHttpMaskMode(value) {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "ws";
  if (["auto", "ws", "stream", "poll", "legacy"].includes(raw)) return raw;
  throw new Error(`invalid httpmask mode: ${value}`);
}

function detectPreferredRegion(request) {
  const country = String(request.cf?.country || request.headers.get("cf-ipcountry") || "").trim().toUpperCase();
  const countryToRegion = {
    US: "US",
    SG: "SG",
    JP: "JP",
    KR: "KR",
    DE: "DE",
    SE: "SE",
    NL: "NL",
    FI: "FI",
    GB: "GB",
    CN: "SG",
    TW: "JP",
    AU: "SG",
    CA: "US",
    FR: "DE",
    IT: "DE",
    ES: "DE",
    CH: "DE",
    AT: "DE",
    BE: "NL",
    DK: "SE",
    NO: "SE",
    IE: "GB",
    HK: "HK",
  };
  return countryToRegion[country] || "";
}

async function loadSettings(env, requestUrl) {
  const url = new URL(requestUrl);
  const publicHost = String(env.SUDOKU_PUBLIC_HOST || url.hostname).trim();
  const sharedKey = String(env.SUDOKU_KEY || "").trim();
  if (!sharedKey) throw new Error("SUDOKU_KEY is required");
  const pathRoot = resolvePathRoot(env.SUDOKU_HTTP_MASK_PATH_ROOT || "", sharedKey);

  const aead = String(env.SUDOKU_AEAD || "none").trim() || "none";
  const ascii = String(env.SUDOKU_ASCII || "prefer_entropy").trim() || "prefer_entropy";
  const customTable = String(env.SUDOKU_CUSTOM_TABLE || "").trim();
  const manageToken = String(env.SUDOKU_MANAGE_TOKEN || "").trim();
  const enablePureDownlink = parseBoolean(env.SUDOKU_ENABLE_PURE_DOWNLINK, false);
  const httpMaskMode = normalizeHttpMaskMode(env.SUDOKU_CLIENT_HTTP_MASK_MODE || env.SUDOKU_HTTP_MASK_MODE || "ws");
  const httpMaskMultiplex = normalizeMultiplexMode(env.SUDOKU_HTTP_MASK_MULTIPLEX || "off");
  const preferredIpStrategy = normalizePreferredIpStrategy(env.SUDOKU_PREFERRED_IP_STRATEGY || env.SUDOKU_YX_STRATEGY || "best");
  const preferredRegion = String(env.SUDOKU_PREFERRED_REGION || env.SUDOKU_WK || "").trim().toUpperCase();
  const disablePreferred = parseBoolean(env.SUDOKU_DISABLE_PREFERRED || env.SUDOKU_YXBY, false);
  const enablePreferredIPs = parseBoolean(env.SUDOKU_ENABLE_PREFERRED_IP || env.SUDOKU_EPI, true);
  const enablePreferredDomains = parseBoolean(env.SUDOKU_ENABLE_PREFERRED_DOMAIN || env.SUDOKU_EPD, true);
  const preferredIpCacheMs = Math.max(0, Number.parseInt(String(env.SUDOKU_PREFERRED_IP_CACHE_MS || env.SUDOKU_YX_CACHE_MS || "60000"), 10) || 0);
  const enableBuiltInPreferred = parseBoolean(env.SUDOKU_ENABLE_BUILTIN_PREFERRED ?? env.SUDOKU_EGI, true);
  const enablePreferredProbe = parseBoolean(env.SUDOKU_ENABLE_PREFERRED_PROBE ?? env.SUDOKU_YX_PROBE, true);
  const preferredProbeRounds = Math.max(1, Math.min(5, Number.parseInt(String(env.SUDOKU_PREFERRED_PROBE_ROUNDS || env.SUDOKU_YX_ROUNDS || "2"), 10) || 2));
  const preferredProbeTimeoutMs = Math.max(300, Math.min(8000, Number.parseInt(String(env.SUDOKU_PREFERRED_PROBE_TIMEOUT_MS || env.SUDOKU_YX_TIMEOUT_MS || "1800"), 10) || 1800));
  const preferredProbeMax = Math.max(1, Math.min(64, Number.parseInt(String(env.SUDOKU_PREFERRED_PROBE_MAX || env.SUDOKU_YX_PROBE_MAX || "16"), 10) || 16));
  const preferredProbeConcurrency = Math.max(1, Math.min(16, Number.parseInt(String(env.SUDOKU_PREFERRED_PROBE_CONCURRENCY || env.SUDOKU_YX_PROBE_CONCURRENCY || "6"), 10) || 6));
  const preferredProbeCacheMs = Math.max(0, Math.min(3600000, Number.parseInt(String(env.SUDOKU_PREFERRED_PROBE_CACHE_MS || env.SUDOKU_YX_PROBE_CACHE_MS || "300000"), 10) || 300000));
  const preferredClientProbeMax = Math.max(1, Math.min(256, Number.parseInt(String(env.SUDOKU_CLIENT_PREFERRED_PROBE_MAX || env.SUDOKU_YX_CLIENT_PROBE_MAX || env.SUDOKU_PREFERRED_PROBE_MAX || env.SUDOKU_YX_PROBE_MAX || "32"), 10) || 32));
  const placeholderServerAddress = String(env.SUDOKU_PLACEHOLDER_SERVER_ADDRESS || env.SUDOKU_PREFERRED_PLACEHOLDER || env.SUDOKU_YX_PLACEHOLDER || "cf.877774.xyz").trim() || "cf.877774.xyz";
  const uplinkTable = await buildSudokuTable(sharedKey, ascii, customTable);
  const downlinkTable = oppositeDirection(uplinkTable);

  return {
    publicHost,
    sharedKey,
    aead,
    ascii,
    customTable,
    manageToken,
    enablePureDownlink,
    httpMaskMode,
    httpMaskMultiplex,
    httpMaskHost: String(env.SUDOKU_HTTP_MASK_HOST || "").trim(),
    preferredIpInline: String(env.SUDOKU_PREFERRED_IPS || env.SUDOKU_YX || "").trim(),
    preferredIpUrl: String(env.SUDOKU_PREFERRED_IP_URL || env.SUDOKU_YX_URL || "").trim(),
    preferredIpStrategy,
    preferredRegion,
    disablePreferred,
    enablePreferredIPs,
    enablePreferredDomains,
    preferredIpCacheMs,
    enableBuiltInPreferred,
    enablePreferredProbe,
    preferredProbeRounds,
    preferredProbeTimeoutMs,
    preferredProbeMax,
    preferredProbeConcurrency,
    preferredProbeCacheMs,
    preferredClientProbeMax,
    placeholderServerAddress,
    preferredKv: env.C || env.SUDOKU_KV || null,
    preferredKvKey: String(env.SUDOKU_PREFERRED_IP_KV_KEY || "sudoku:preferred_ips").trim() || "sudoku:preferred_ips",
    nodeName: String(env.SUDOKU_NODE_NAME || "sudoku-cf-worker-pure").trim() || "sudoku-cf-worker-pure",
    wsPath: buildWSPath(pathRoot),
    pathRoot,
    uplinkTable,
    downlinkTable,
    clientPort: env.SUDOKU_CLIENT_PORT || "10233",
  };
}

function configBase(origin, manageToken) {
  return manageToken ? `${origin}/${manageToken}` : origin;
}

async function resolvePreferredEntries(settings, request) {
  const preferredPool = await loadPreferredIpPool({
    inlineList: settings.preferredIpInline,
    sourceUrl: settings.preferredIpUrl,
    defaultPort: 443,
    cacheTtlMs: settings.preferredIpCacheMs,
    kv: settings.preferredKv,
    kvKey: settings.preferredKvKey,
    defaultEntries: [],
    enableBuiltIn: settings.enableBuiltInPreferred,
  });
  const effectiveRegion = settings.preferredRegion || detectPreferredRegion(request);
  const eligibleEntries = settings.disablePreferred
    ? []
    : filterPreferredEntries(preferredPool.entries, {
        enableIPs: settings.enablePreferredIPs,
        enableDomains: settings.enablePreferredDomains,
        region: effectiveRegion,
      });
  return { preferredPool, eligibleEntries, effectiveRegion };
}

function buildExportArtifacts(settings, selectedPreferred = null, options = {}) {
  const serverAddress = selectedPreferred?.address || options.serverAddress || "";
  const externalIngress = Boolean(serverAddress);
  const clientConfig = buildClientConfig({
    publicHost: settings.publicHost,
    serverAddress,
    localPort: settings.clientPort,
    key: settings.sharedKey,
    aead: settings.aead,
    ascii: settings.ascii,
    enablePureDownlink: settings.enablePureDownlink,
    httpMaskMode: settings.httpMaskMode,
    httpMaskHost: settings.httpMaskHost || (externalIngress ? settings.publicHost : ""),
    httpMaskMultiplex: settings.httpMaskMultiplex,
    pathRoot: settings.pathRoot,
  });
  return {
    clientConfig,
    clashNode: buildClashNode(clientConfig, settings.nodeName),
    shortLink: buildShortLinkFromClientConfig(clientConfig),
  };
}

function resolvePlaceholderBundle(settings) {
  return {
    ...buildExportArtifacts(settings, null, { serverAddress: settings.placeholderServerAddress }),
    selectedPreferred: null,
    preferredCount: 0,
    preferredTotalCount: 0,
    preferredSource: "",
    preferredError: "",
    effectiveRegion: "",
    preferredProbeEnabled: settings.enablePreferredProbe,
    isPlaceholder: true,
  };
}

function jsValue(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

async function resolveExportBundle(settings, request) {
  const { preferredPool, eligibleEntries, effectiveRegion } = await resolvePreferredEntries(settings, request);
  const selectedPreferred = await pickPreferredEntryWithProbe(
    eligibleEntries,
    settings.preferredIpStrategy,
    `${request.headers.get("cf-connecting-ip") || ""}|${request.headers.get("user-agent") || ""}`,
    {
      enabled: settings.enablePreferredProbe,
      rounds: settings.preferredProbeRounds,
      timeoutMs: settings.preferredProbeTimeoutMs,
      maxCandidates: settings.preferredProbeMax,
      concurrency: settings.preferredProbeConcurrency,
      cacheTtlMs: settings.preferredProbeCacheMs,
    },
  );
  return {
    ...buildExportArtifacts(settings, selectedPreferred),
    selectedPreferred,
    preferredCount: eligibleEntries.length,
    preferredTotalCount: preferredPool.entries.length,
    preferredSource: preferredPool.preferredSource,
    preferredError: preferredPool.preferredError,
    effectiveRegion,
    preferredProbeEnabled: settings.enablePreferredProbe,
  };
}

async function resolveClientPreferredPayload(settings, request) {
  const { preferredPool, eligibleEntries, effectiveRegion } = await resolvePreferredEntries(settings, request);
  const placeholder = resolvePlaceholderBundle(settings);
  const sortedEntries = [...eligibleEntries].sort(comparePreferredEntries);
  const sortedDomainEntries = sortedEntries.filter((entry) => classifyPreferredEntry(entry) === "domain");
  const domainQuota = Math.min(8, Math.ceil(settings.preferredClientProbeMax / 4));
  let domainEntries = sortedDomainEntries.slice(0, domainQuota);
  const ipEntries = sortedEntries.filter((entry) => classifyPreferredEntry(entry) === "ip").slice(0, settings.preferredClientProbeMax - domainEntries.length);
  if (ipEntries.length + domainEntries.length < settings.preferredClientProbeMax) {
    domainEntries = domainEntries.concat(sortedDomainEntries.slice(domainEntries.length, settings.preferredClientProbeMax - ipEntries.length));
  }
  const seenCandidates = new Set();
  const candidates = [...ipEntries, ...domainEntries]
    .filter((entry) => {
      if (seenCandidates.has(entry.address)) return false;
      seenCandidates.add(entry.address);
      return true;
    })
    .map((entry) => ({
      address: entry.address,
      name: entry.name || "",
      latencyMs: entry.latencyMs,
      downloadMbps: entry.downloadMbps,
      score: entry.score,
      sourceIndex: entry.sourceIndex || 0,
    }));
  return {
    placeholder: {
      clientConfig: placeholder.clientConfig,
      shortLink: placeholder.shortLink,
      clashNode: placeholder.clashNode,
    },
    candidates,
    preferredCount: eligibleEntries.length,
    preferredTotalCount: preferredPool.entries.length,
    preferredSource: preferredPool.preferredSource,
    preferredError: preferredPool.preferredError,
    effectiveRegion,
    publicHost: settings.publicHost,
    nodeName: settings.nodeName,
    probe: {
      enabled: settings.enablePreferredProbe,
      rounds: settings.preferredProbeRounds,
      timeoutMs: settings.preferredProbeTimeoutMs,
      maxCandidates: settings.preferredClientProbeMax,
      concurrency: settings.preferredProbeConcurrency,
    },
  };
}

function renderPage(settings, requestUrl, exportBundle) {
  const { clientConfig, clashNode, shortLink, selectedPreferred, preferredCount, preferredTotalCount, preferredSource, preferredError, effectiveRegion, preferredProbeEnabled } = exportBundle;
  const clientJson = JSON.stringify(clientConfig, null, 2);
  const url = new URL(requestUrl);
  const base = configBase(url.origin, settings.manageToken);
  const downlinkMode = settings.enablePureDownlink ? "pure_downlink" : "packed_downlink";
  const exportTarget = selectedPreferred ? `${selectedPreferred.address}${selectedPreferred.name ? ` (${selectedPreferred.name})` : ""}` : `${settings.publicHost}:443`;
  const exportHint = exportBundle.isPlaceholder
    ? `当前先使用占位入口 <code>${htmlEscape(clientConfig.server_address)}</code> 输出配置，页面加载后会按访问者当前网络优选并替换。`
    : selectedPreferred
    ? `当前导出节点使用优选入口 <code>${htmlEscape(exportTarget)}</code>，并自动把 <code>Host/SNI</code> 设为 <code>${htmlEscape(clientConfig.httpmask.host || settings.publicHost)}</code>。`
    : "当前导出节点直接使用你的域名作为入口。";
  const probeMeta = selectedPreferred?.probe
    ? `，探测 <code>${htmlEscape(selectedPreferred.probe.rounds)}x</code>，平均 <code>${htmlEscape(selectedPreferred.probe.latencyMs ?? "-")}ms</code>，P95 <code>${htmlEscape(selectedPreferred.probe.p95LatencyMs)}ms</code>，估算 <code>${htmlEscape(selectedPreferred.probe.downloadMbps)}Mbps</code>，分数 <code>${htmlEscape(selectedPreferred.score)}</code>`
    : preferredProbeEnabled
      ? "，主动探测无可用结果，已按静态分数回退"
      : "";
  const preferredMeta = preferredCount > 0
    ? `优选池可用 ${preferredCount} 条 / 总计 ${preferredTotalCount} 条，策略 <code>${htmlEscape(settings.preferredIpStrategy)}</code>${effectiveRegion ? `，地区过滤 <code>${htmlEscape(effectiveRegion)}</code>` : ""}${preferredSource ? `，来源 <code>${htmlEscape(preferredSource)}</code>` : ""}${probeMeta}。`
    : preferredError
      ? `优选池不可用，已回退到域名直连。错误：<code>${htmlEscape(preferredError)}</code>`
      : settings.enableBuiltInPreferred
        ? `页面已先使用占位入口 <code>${htmlEscape(clientConfig.server_address)}</code> 输出；打开后会在当前浏览器网络环境中开始优选。`
        : "未配置优选源，当前为域名直连导出。";
  const pageData = {
    candidateUrl: `${base}/preferred-candidates.json`,
    clientConfig,
    nodeName: settings.nodeName,
    publicHost: settings.publicHost,
  };
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Sudoku Pure Worker</title>
  <style>
    :root { color-scheme: dark; --bg:#081118; --panel:#0d1a24; --line:#234154; --text:#e6f1f5; --muted:#91aab8; --accent:#5fd0ff; --ok:#7ddf9b; }
    * { box-sizing:border-box; }
    body { margin:0; font-family:Menlo,Monaco,Consolas,monospace; color:var(--text); background:linear-gradient(180deg,#030608,#081118); }
    main { width:min(980px,100%); margin:0 auto; padding:28px 18px 48px; }
    h1 { margin:0 0 10px; font-size:28px; line-height:1.2; }
    p { color:var(--muted); line-height:1.6; overflow-wrap:anywhere; }
    .grid { display:grid; gap:18px; margin-top:24px; min-width:0; }
    .card { min-width:0; background:rgba(13,26,36,.92); border:1px solid var(--line); border-radius:8px; padding:16px; }
    .head { display:flex; align-items:center; justify-content:space-between; gap:12px; margin-bottom:10px; }
    .label { color:var(--accent); font-size:12px; text-transform:uppercase; letter-spacing:.08em; }
    .copy { appearance:none; border:1px solid var(--line); border-radius:6px; background:#102636; color:var(--text); padding:6px 10px; cursor:pointer; }
    .copy:hover { border-color:var(--accent); }
    pre { width:100%; max-width:100%; margin:0; padding:14px; border-radius:8px; overflow:auto; white-space:pre-wrap; overflow-wrap:anywhere; word-break:break-word; background:#03080d; border:1px solid #173244; }
    .short { white-space:pre-wrap; word-break:break-all; }
    .meter { height:8px; border-radius:999px; overflow:hidden; background:#071018; border:1px solid #173244; margin-top:10px; }
    .meter i { display:block; width:0%; height:100%; background:linear-gradient(90deg,var(--accent),var(--ok)); transition:width .2s ease; }
    .rank { margin-top:10px; color:var(--muted); font-size:13px; line-height:1.6; overflow-wrap:anywhere; }
    a { color:var(--accent); overflow-wrap:anywhere; }
  </style>
</head>
<body><main>
  <h1>Sudoku Pure Cloudflare Worker</h1>
  <p>当前实现是纯 Worker 版 Sudoku 服务端。入口固定为 <code>wss://${htmlEscape(settings.publicHost)}${htmlEscape(settings.wsPath)}</code>，当前参数为 <code>${htmlEscape(settings.httpMaskMode)} + tls + ${htmlEscape(settings.aead)} + ${htmlEscape(downlinkMode)}</code>。</p>
  <p>${exportHint}</p>
  <p id="preferredStatus">${preferredMeta}</p>
  <div class="meter"><i id="preferredProgress"></i></div>
  <div id="preferredRank" class="rank"></div>
  <div class="grid">
    <section class="card"><div class="head"><div class="label">Short Link</div><button class="copy" data-copy-target="shortLink">Copy</button></div><pre id="shortLink" class="short">${htmlEscape(shortLink)}</pre></section>
    <section class="card"><div class="head"><div class="label">Client JSON</div><button class="copy" data-copy-target="clientJson">Copy</button></div><pre id="clientJson">${htmlEscape(clientJson)}</pre></section>
    <section class="card"><div class="head"><div class="label">Clash / Mihomo</div><button class="copy" data-copy-target="clashNode">Copy</button></div><pre id="clashNode">${htmlEscape(clashNode)}</pre></section>
    <section class="card"><div class="label">API</div>
      <p><a href="${htmlEscape(base)}/shortlink">${htmlEscape(base)}/shortlink</a></p>
      <p><a href="${htmlEscape(base)}/client.json">${htmlEscape(base)}/client.json</a></p>
      <p><a href="${htmlEscape(base)}/clash.yaml">${htmlEscape(base)}/clash.yaml</a></p>
    </section>
  </div>
  <script>
    const SUDOKU_PAGE = ${jsValue(pageData)};
    const cloneValue = (value) => typeof structuredClone === "function" ? structuredClone(value) : JSON.parse(JSON.stringify(value));
    let baseConfig = cloneValue(SUDOKU_PAGE.clientConfig);

    function text(id, value) {
      const node = document.getElementById(id);
      if (node) node.textContent = value;
    }

    function setProgress(done, total) {
      const pct = total > 0 ? Math.round((done / total) * 100) : 0;
      const bar = document.getElementById("preferredProgress");
      if (bar) bar.style.width = pct + "%";
    }

    function splitHostPort(value) {
      const raw = String(value || "").trim();
      if (raw.startsWith("[")) {
        const idx = raw.lastIndexOf("]:");
        return { host: raw.slice(1, idx), port: Number(raw.slice(idx + 2)) };
      }
      const idx = raw.lastIndexOf(":");
      return { host: raw.slice(0, idx), port: Number(raw.slice(idx + 1)) };
    }

    function joinHostPort(host, port) {
      return host.includes(":") && !host.startsWith("[") ? "[" + host + "]:" + port : host + ":" + port;
    }

    function hostForUrl(host) {
      return host.includes(":") && !host.startsWith("[") ? "[" + host + "]" : host;
    }

    function isLiteralIp(host) {
      return /^(?:\\d{1,3}\\.){3}\\d{1,3}$/.test(host) || host.includes(":");
    }

    function probeUrl(address) {
      const parsed = splitHostPort(address);
      if (isLiteralIp(parsed.host)) {
        const port = parsed.port === 443 ? 80 : parsed.port;
        return "http://" + hostForUrl(parsed.host) + (port === 80 ? "" : ":" + port) + "/cdn-cgi/trace";
      }
      return "https://" + hostForUrl(parsed.host) + (parsed.port === 443 ? "" : ":" + parsed.port) + "/cdn-cgi/trace";
    }

    async function fetchWithTimeout(url, timeoutMs) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = performance.now();
      try {
        await fetch(url + (url.includes("?") ? "&" : "?") + "__sudoku_probe=" + Date.now(), {
          mode: "no-cors",
          cache: "no-store",
          signal: controller.signal,
        });
        return { ok: true, ms: performance.now() - started };
      } catch (error) {
        return { ok: false, ms: performance.now() - started, error: error && error.name || "fetch_error" };
      } finally {
        clearTimeout(timer);
      }
    }

    async function probeCandidate(candidate, probe) {
      const samples = [];
      let failures = 0;
      const url = probeUrl(candidate.address);
      for (let i = 0; i < Math.max(1, probe.rounds || 1); i += 1) {
        const result = await fetchWithTimeout(url + (url.includes("?") ? "&" : "?") + "r=" + i, probe.timeoutMs || 1800);
        if (result.ok) samples.push(result.ms);
        else failures += 1;
      }
      samples.sort((a, b) => a - b);
      const avg = samples.length ? samples.reduce((sum, item) => sum + item, 0) / samples.length : Infinity;
      const p95 = samples.length ? samples[Math.min(samples.length - 1, Math.ceil(samples.length * 0.95) - 1)] : Infinity;
      const downloadMbps = samples.length ? Math.max(0, 40 - avg / 20) : 0;
      const metrics = {
        ...candidate,
        avgLatencyMs: Number.isFinite(avg) ? Math.round(avg) : Infinity,
        p95LatencyMs: Number.isFinite(p95) ? Math.round(p95) : Infinity,
        downloadMbps: Number(downloadMbps.toFixed(2)),
        failures,
        rounds: Math.max(1, probe.rounds || 1),
      };
      metrics.score = score(metrics);
      return metrics;
    }

    function score(result) {
      if (!result || result.failures >= result.rounds || !Number.isFinite(result.avgLatencyMs)) return 0;
      const latency = Math.max(1, result.avgLatencyMs || 9999);
      const p95 = Math.max(latency, result.p95LatencyMs || latency);
      const mbps = Math.max(0, result.downloadMbps || 0);
      const reliability = Math.max(0, 1 - (result.failures || 0) * 0.25);
      return Math.round((160000 / latency + 50000 / p95 + mbps * 40) * reliability);
    }

    async function mapWithConcurrency(items, concurrency, mapper, onDone) {
      const results = new Array(items.length);
      let index = 0;
      let done = 0;
      const workers = Array.from({ length: Math.min(Math.max(1, concurrency || 1), items.length) }, async () => {
        while (index < items.length) {
          const current = index;
          index += 1;
          results[current] = await mapper(items[current], current);
          done += 1;
          onDone && onDone(done, items.length);
        }
      });
      await Promise.all(workers);
      return results;
    }

    function encodeAscii(mode) {
      if (mode === "prefer_ascii") return "ascii";
      if (mode === "prefer_entropy") return "entropy";
      return mode || "entropy";
    }

    function toBase64Url(input) {
      const bytes = new TextEncoder().encode(input);
      let binary = "";
      for (let i = 0; i < bytes.length; i += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      }
      return btoa(binary).replace(/\\+/g, "-").replace(/\\//g, "_").replace(/=+$/g, "");
    }

    function buildShortLink(config) {
      const parsed = splitHostPort(config.server_address);
      const payload = {
        h: parsed.host,
        p: parsed.port,
        k: config.key,
        a: encodeAscii(config.ascii),
        e: config.aead,
        m: config.local_port,
        ht: config.httpmask && config.httpmask.tls !== false,
        hm: config.httpmask && config.httpmask.mode || "ws",
        x: config.enable_pure_downlink === false,
      };
      if (config.httpmask && config.httpmask.host) payload.hh = config.httpmask.host;
      if (config.httpmask && config.httpmask.path_root) payload.hy = config.httpmask.path_root;
      if (config.httpmask && config.httpmask.multiplex && config.httpmask.multiplex !== "off") payload.hx = config.httpmask.multiplex;
      return "sudoku://" + toBase64Url(JSON.stringify(payload));
    }

    function yamlQuote(value) {
      return JSON.stringify(String(value));
    }

    function buildClashNode(config, nodeName) {
      const parsed = splitHostPort(config.server_address);
      const hm = config.httpmask || {};
      const lines = [
        "# sudoku",
        "- name: " + nodeName,
        "  type: sudoku",
        "  server: " + yamlQuote(parsed.host),
        "  port: " + parsed.port,
        "  key: " + yamlQuote(config.key),
        "  aead-method: " + config.aead,
        "  padding-min: 0",
        "  padding-max: 0",
        "  table-type: " + encodeAscii(config.ascii),
        "  enable-pure-downlink: " + (config.enable_pure_downlink !== false),
        "  httpmask:",
        "    disable: " + (hm.disable === true),
        "    mode: " + (hm.mode || "ws"),
        "    tls: " + (hm.tls !== false),
      ];
      if (hm.host) lines.push("    host: " + yamlQuote(hm.host));
      lines.push("    multiplex: " + yamlQuote(hm.multiplex || "off"));
      if (hm.path_root) lines.push("    path-root: " + yamlQuote(hm.path_root));
      return lines.join("\\n") + "\\n";
    }

    function renderOutputs(config) {
      text("shortLink", buildShortLink(config));
      text("clientJson", JSON.stringify(config, null, 2));
      text("clashNode", buildClashNode(config, SUDOKU_PAGE.nodeName));
    }

    function configWithIngress(address) {
      const next = cloneValue(baseConfig);
      next.server_address = address;
      next.httpmask = next.httpmask || {};
      if (!next.httpmask.host) next.httpmask.host = SUDOKU_PAGE.publicHost;
      return next;
    }

    async function runClientPreferred() {
      try {
        text("preferredStatus", "正在加载优选候选...");
        const data = await fetch(SUDOKU_PAGE.candidateUrl, { cache: "no-store" }).then((res) => {
          if (!res.ok) throw new Error("HTTP " + res.status);
          return res.json();
        });
        if (data.placeholder && data.placeholder.clientConfig) {
          baseConfig = data.placeholder.clientConfig;
          renderOutputs(baseConfig);
        }
        const probe = data.probe || {};
        const candidates = (data.candidates || []).slice(0, probe.maxCandidates || 32);
        if (!probe.enabled || candidates.length === 0) {
          text("preferredStatus", candidates.length === 0 ? "没有可用优选候选，保留占位入口。" : "已关闭浏览器端优选，保留占位入口。");
          return;
        }
        text("preferredStatus", "正在按当前网络环境优选 0/" + candidates.length + "，当前占位入口 " + baseConfig.server_address);
        setProgress(0, candidates.length);
        const results = await mapWithConcurrency(
          candidates,
          probe.concurrency || 6,
          (candidate) => probeCandidate(candidate, probe),
          (done, total) => {
            setProgress(done, total);
            text("preferredStatus", "正在按当前网络环境优选 " + done + "/" + total + "，当前占位入口 " + baseConfig.server_address);
          },
        );
        const ranked = results
          .filter((item) => item && item.score > 0)
          .sort((a, b) => b.score - a.score || a.avgLatencyMs - b.avgLatencyMs);
        if (!ranked.length) {
          text("preferredStatus", "本轮没有测到可用候选，保留占位入口 " + baseConfig.server_address);
          return;
        }
        const best = ranked[0];
        renderOutputs(configWithIngress(best.address));
        text("preferredStatus", "已选择 " + best.address + "，平均 " + best.avgLatencyMs + "ms，P95 " + best.p95LatencyMs + "ms，分数 " + best.score + "。");
        text("preferredRank", ranked.slice(0, 5).map((item, idx) => "#" + (idx + 1) + " " + item.address + "  " + item.avgLatencyMs + "ms  score=" + item.score).join("\\n"));
      } catch (error) {
        text("preferredStatus", "浏览器端优选失败，保留占位入口 " + baseConfig.server_address + "。");
      }
    }

    document.addEventListener("click", async (event) => {
      const button = event.target.closest("[data-copy-target]");
      if (!button) return;
      const target = document.getElementById(button.getAttribute("data-copy-target"));
      if (!target) return;
      const value = target.textContent || "";
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        const input = document.createElement("textarea");
        input.value = value;
        input.style.position = "fixed";
        input.style.left = "-9999px";
        document.body.appendChild(input);
        input.select();
        document.execCommand("copy");
        input.remove();
      }
      const old = button.textContent;
      button.textContent = "Copied";
      setTimeout(() => { button.textContent = old; }, 900);
    });

    renderOutputs(baseConfig);
    runClientPreferred();
  </script>
</main></body></html>`;
}

async function toUint8Array(data) {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data === "string") return new TextEncoder().encode(data);
  if (data && typeof data.arrayBuffer === "function") {
    return new Uint8Array(await data.arrayBuffer());
  }
  return new Uint8Array();
}

class SudokuWorkerSession {
  constructor(ws, settings, options = {}) {
    this.ws = ws;
    this.settings = settings;
    this.inboundSudokuState = newSudokuDecodeState();
    this.inboundPlainQueue = new ByteQueue();
    this.stage = options.stage || "hello";
    this.initialSendBase = options.sendBase || null;
    this.initialRecvBase = options.recvBase || null;
    this.closed = false;
    this.processing = Promise.resolve();
    this.outboundChain = Promise.resolve();
    this.muxStreams = new Map();
    this.pendingSendChunks = [];
    this.pendingSendBytes = 0;
    this.pendingSendPromise = null;
    this.pendingSendResolve = null;
    this.pendingSendReject = null;
    this.pendingSendScheduled = false;
    this.sendBatchBytes = Number.parseInt(String(settings.sendBatchBytes || 32768), 10) || 32768;
  }

  async init() {
    if (this.initialSendBase && this.initialRecvBase) {
      this.record = new RecordLayer(this.settings.aead, this.initialSendBase, this.initialRecvBase);
    } else {
      const psk = await derivePSKDirectionalBases(this.settings.sharedKey);
      this.record = new RecordLayer(this.settings.aead, psk.s2c, psk.c2s);
    }
    if (!this.settings.enablePureDownlink) {
      this.packedEncoder = new PackedDownlinkEncoder(this.settings.downlinkTable, 0, 0);
    }
  }

  enqueueClientChunk(chunk) {
    this.processing = this.processing.then(() => this.handleClientChunk(chunk)).catch((error) => this.fail(error));
  }

  async handleClientChunk(chunk) {
    if (this.closed) return;
    const sudokuDecoded = decodeSudokuBytes(this.settings.uplinkTable, this.inboundSudokuState, chunk);
    if (sudokuDecoded.length === 0) return;
    const plains = await this.record.pushCipherBytes(sudokuDecoded);
    for (const plain of plains) {
      this.inboundPlainQueue.push(plain);
      await this.processInboundPlain();
    }
  }

  async processInboundPlain() {
    while (!this.closed) {
      if (this.stage === "stream") {
        const all = this.inboundPlainQueue.readAll();
        if (all.length === 0) return;
        await this.tcpWriter.write(all);
        return;
      }

      if (this.stage === "mux") {
        const frame = tryReadMuxFrame(this.inboundPlainQueue);
        if (!frame) return;
        await this.handleMuxFrame(frame);
        continue;
      }

      const msg = tryReadKIPMessage(this.inboundPlainQueue);
      if (!msg) return;
      if (msg.type === 0x14) continue;

      if (this.stage === "hello") {
        if (msg.type !== 0x01) throw new Error(`unexpected handshake message: ${msg.type}`);
        await this.handleClientHello(msg.payload);
        continue;
      }

      if (this.stage === "open") {
        if (msg.type === 0x10) {
          await this.handleOpenTcp(msg.payload);
          continue;
        }
        if (msg.type === 0x11) {
          await this.handleStartMux();
          continue;
        }
        if (msg.type === 0x12) {
          await this.handleStartUoT();
          continue;
        }
        throw new Error(`unexpected session message: ${msg.type}`);
      }
      return;
    }
  }

  async handleClientHello(payload) {
    const hello = decodeClientHello(payload);
    if (Math.abs(Math.floor(Date.now() / 1000) - hello.timestamp) > 60) {
      throw new Error("time skew/replay");
    }
    if (hello.hasTableHint && hello.tableHint !== (this.settings.uplinkTable.hint >>> 0)) {
      throw new Error(`unknown table hint: ${hello.tableHint}`);
    }
    const ephemeral = await generateX25519KeyPair();
    const shared = await deriveX25519SharedSecret(ephemeral.privateKey, hello.clientPub);
    const session = await deriveSessionDirectionalBases(this.settings.sharedKey, shared, hello.nonce);
    const features = new Uint8Array([
      (hello.features >>> 24) & 0xff,
      (hello.features >>> 16) & 0xff,
      (hello.features >>> 8) & 0xff,
      hello.features & 0xff,
    ]);
    const serverHello = buildKIPMessage(0x02, concatChunks([hello.nonce, ephemeral.publicKey, features]));
    await this.enqueueSendPlain(serverHello);
    await this.record.rekey(session.s2c, session.c2s);
    this.stage = "open";
  }

  async handleOpenTcp(payload) {
    const targetAddress = decodeAddress(payload);
    const { host, port } = splitHostPort(targetAddress);
    this.tcpSocket = connect({ hostname: host, port });
    this.tcpWriter = this.tcpSocket.writable.getWriter();
    this.tcpReader = this.tcpSocket.readable.getReader();
    this.stage = "stream";
    this.startOutboundPump();
    const rest = this.inboundPlainQueue.readAll();
    if (rest.length > 0) await this.tcpWriter.write(rest);
  }

  async handleStartMux() {
    this.stage = "mux";
  }

  async handleStartUoT() {
    throw new Error("UoT is not supported on Cloudflare Workers: outbound UDP sockets are unavailable");
  }

  startOutboundPump() {
    this.pumpPromise = (async () => {
      try {
        while (!this.closed) {
          const { value, done } = await this.tcpReader.read();
          if (done) break;
          if (value && value.length > 0) {
            await this.enqueueSendPlain(value);
          }
        }
        await this.outboundChain;
        await this.flushDownlink();
        this.close(1000, "tcp closed");
      } catch (error) {
        this.fail(error);
      }
    })();
  }

  async handleMuxFrame(frame) {
    switch (frame.frameType) {
      case 0x01:
        await this.openMuxStream(frame.streamId, frame.payload);
        break;
      case 0x02:
        await this.writeMuxStream(frame.streamId, frame.payload);
        break;
      case 0x03:
        await this.closeMuxStream(frame.streamId);
        break;
      case 0x04:
        await this.resetMuxStream(frame.streamId, new TextDecoder().decode(frame.payload));
        break;
      default:
        throw new Error(`unknown mux frame type: ${frame.frameType}`);
    }
  }

  async openMuxStream(streamId, payload) {
    if (!streamId) {
      await this.sendMuxReset(streamId, "invalid stream id");
      return;
    }
    if (this.muxStreams.has(streamId)) {
      await this.sendMuxReset(streamId, "stream already exists");
      return;
    }
    const targetAddress = decodeAddress(payload);
    const { host, port } = splitHostPort(targetAddress);
    const socket = connect({ hostname: host, port });
    const stream = {
      id: streamId,
      socket,
      writer: socket.writable.getWriter(),
      reader: socket.readable.getReader(),
      closed: false,
    };
    this.muxStreams.set(streamId, stream);
    this.startMuxOutboundPump(stream);
  }

  async writeMuxStream(streamId, payload) {
    const stream = this.muxStreams.get(streamId);
    if (!stream) return;
    if (payload.length === 0) return;
    await stream.writer.write(payload);
  }

  async closeMuxStream(streamId) {
    const stream = this.muxStreams.get(streamId);
    if (!stream) return;
    this.muxStreams.delete(streamId);
    stream.closed = true;
    try {
      stream.reader.releaseLock();
      stream.writer.releaseLock();
      stream.socket.close();
    } catch {}
  }

  async resetMuxStream(streamId) {
    await this.closeMuxStream(streamId);
  }

  startMuxOutboundPump(stream) {
    stream.pumpPromise = (async () => {
      try {
        while (!this.closed && !stream.closed) {
          const { value, done } = await stream.reader.read();
          if (done) break;
          if (value && value.length > 0) {
            await this.enqueueSendPlain(buildMuxFrame(0x02, stream.id, value));
          }
        }
        if (!this.closed) {
          await this.enqueueSendPlain(buildMuxFrame(0x03, stream.id));
        }
      } catch (error) {
        if (!this.closed) {
          await this.sendMuxReset(stream.id, error instanceof Error ? error.message : String(error));
        }
      } finally {
        await this.closeMuxStream(stream.id);
      }
    })();
  }

  async sendMuxReset(streamId, reason = "reset") {
    const payload = new TextEncoder().encode(reason || "reset");
    await this.enqueueSendPlain(buildMuxFrame(0x04, streamId, payload));
    await this.enqueueSendPlain(buildMuxFrame(0x03, streamId));
  }

  enqueueSendPlain(bytes) {
    const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (this.closed || data.length === 0) return Promise.resolve();
    if (!this.pendingSendPromise) {
      this.pendingSendPromise = new Promise((resolve, reject) => {
        this.pendingSendResolve = resolve;
        this.pendingSendReject = reject;
      });
    }
    this.pendingSendChunks.push(data);
    this.pendingSendBytes += data.length;
    const op = this.pendingSendPromise;
    this.schedulePendingSendFlush(this.pendingSendBytes >= this.sendBatchBytes);
    return op;
  }

  schedulePendingSendFlush(immediate = false) {
    if (this.pendingSendScheduled || this.closed) return;
    this.pendingSendScheduled = true;
    const trigger = () => {
      this.pendingSendScheduled = false;
      const op = this.outboundChain.then(() => this.flushPendingSendNow());
      this.outboundChain = op.catch((error) => {
        this.fail(error);
      });
    };
    if (immediate) {
      trigger();
      return;
    }
    queueMicrotask(trigger);
  }

  async flushPendingSendNow() {
    if (this.closed || this.pendingSendChunks.length === 0) return;
    const chunks = this.pendingSendChunks;
    const resolve = this.pendingSendResolve;
    const reject = this.pendingSendReject;
    this.pendingSendChunks = [];
    this.pendingSendBytes = 0;
    this.pendingSendPromise = null;
    this.pendingSendResolve = null;
    this.pendingSendReject = null;

    try {
      const plain = chunks.length === 1 ? chunks[0] : concatChunks(chunks);
      await this.sendPlainNow(plain);
      resolve?.();
    } catch (error) {
      reject?.(error);
      throw error;
    }
  }

  async sendPlainNow(bytes) {
    if (this.closed || bytes.length === 0) return;
    const recordBytes = await this.record.encode(bytes);
    const downlinkBytes = this.settings.enablePureDownlink
      ? encodeSudokuBytes(this.settings.downlinkTable, recordBytes)
      : this.packedEncoder.encode(recordBytes);
    if (!this.closed && downlinkBytes.length > 0) {
      this.ws.send(downlinkBytes);
    }
  }

  async flushDownlink() {
    await this.flushPendingSendNow();
    if (this.closed || this.settings.enablePureDownlink || !this.packedEncoder) return;
    const tail = this.packedEncoder.flush();
    if (!this.closed && tail.length > 0) this.ws.send(tail);
  }

  fail(error) {
    if (this.closed) return;
    this.close(1011, error instanceof Error ? error.message : String(error));
  }

  close(code = 1000, reason = "closed") {
    if (this.closed) return;
    this.closed = true;
    try {
      this.pendingSendReject?.(new Error(reason || "closed"));
    } catch {}
    this.pendingSendChunks = [];
    this.pendingSendBytes = 0;
    this.pendingSendPromise = null;
    this.pendingSendResolve = null;
    this.pendingSendReject = null;
    this.pendingSendScheduled = false;
    try {
      for (const stream of this.muxStreams.values()) {
        stream.reader?.releaseLock();
        stream.writer?.releaseLock();
        stream.socket?.close();
      }
      this.muxStreams.clear();
    } catch {}
    try {
      this.tcpReader?.releaseLock();
      this.tcpWriter?.releaseLock();
      this.tcpSocket?.close();
    } catch {}
    try {
      this.ws.close(code, reason.slice(0, 120));
    } catch {}
  }
}

async function prepareEarlyUpgrade(settings, url) {
  const earlyEncoded = url.searchParams.get("ed");
  if (!earlyEncoded) return null;
  const earlyPayload = decodeBase64Url(earlyEncoded);
  const sudokuDecoded = decodeSudokuBytes(settings.uplinkTable, newSudokuDecodeState(), earlyPayload);
  const prepared = await processEarlyClientPayload({
    sharedKey: settings.sharedKey,
    aead: settings.aead,
    payload: sudokuDecoded,
    expectedTableHint: settings.uplinkTable.hint,
  });
  let responsePayload;
  if (settings.enablePureDownlink) {
    responsePayload = encodeSudokuBytes(settings.downlinkTable, prepared.responsePayload);
  } else {
    const encoder = new PackedDownlinkEncoder(settings.downlinkTable, 0, 0);
    responsePayload = concatChunks([encoder.encode(prepared.responsePayload), encoder.flush()]);
  }
  return {
    responseHeader: encodeBase64Url(responsePayload),
    sendBase: prepared.sessionSendBase,
    recvBase: prepared.sessionRecvBase,
    stage: "open",
  };
}

async function handlePreferredIpApi(settings, request, url, basePath) {
  const apiPath = `${basePath}/api/preferred-ips`;
  if (url.pathname !== apiPath) return null;
  if (!settings.manageToken) return textResponse("Forbidden", 403);
  if (!settings.preferredKv || !settings.preferredKvKey) {
    return textResponse("Preferred IP KV is not configured. Bind KV namespace as variable C or set SUDOKU_KV.", 501);
  }

  if (request.method === "GET") {
    const stored = (await settings.preferredKv.get(settings.preferredKvKey, "text")) || "";
    const entries = parsePreferredIpList(stored, 443);
    return new Response(JSON.stringify({ entries, raw: stored }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
  }

  if (request.method === "DELETE") {
    await settings.preferredKv.delete(settings.preferredKvKey);
    return new Response(JSON.stringify({ ok: true, cleared: true }), { headers: { "content-type": "application/json; charset=utf-8" } });
  }

  if (request.method === "POST" || request.method === "PUT") {
    const contentType = request.headers.get("content-type") || "";
    const rawBody = await request.text();
    let nextRaw = rawBody;
    if (contentType.includes("application/json")) {
      const payload = JSON.parse(rawBody || "{}");
      if (Array.isArray(payload)) {
        nextRaw = payload.join("\n");
      } else if (Array.isArray(payload.entries)) {
        nextRaw = payload.entries
          .map((entry) => (typeof entry === "string" ? entry : entry?.address ? `${entry.address}${entry.name ? `#${entry.name}` : ""}` : ""))
          .filter(Boolean)
          .join("\n");
      } else if (typeof payload.raw === "string") {
        nextRaw = payload.raw;
      }
    }
    const entries = parsePreferredIpList(nextRaw, 443);
    await settings.preferredKv.put(settings.preferredKvKey, entries.map((entry) => `${entry.address}${entry.name ? `#${entry.name}` : ""}`).join("\n"));
    return new Response(JSON.stringify({ ok: true, count: entries.length, entries }, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
  }

  return textResponse("Method Not Allowed", 405);
}

export default {
  async fetch(request, env) {
    let settings;
    try {
      settings = await loadSettings(env, request.url);
    } catch (error) {
      return textResponse(`Worker configuration error: ${error.message}`, 500);
    }

    const url = new URL(request.url);
    const upgrade = request.headers.get("Upgrade");
    const basePath = settings.manageToken ? `/${settings.manageToken}` : "";

    if (upgrade && upgrade.toLowerCase() === "websocket") {
      if (url.pathname !== settings.wsPath) return textResponse("Not Found", 404);
      let earlyUpgrade = null;
      try {
        earlyUpgrade = await prepareEarlyUpgrade(settings, url);
      } catch {
        return textResponse("Not Found", 404);
      }
      const pair = new WebSocketPair();
      const client = pair[0];
      const server = pair[1];
      server.accept();
      const session = new SudokuWorkerSession(server, settings, earlyUpgrade || undefined);
      await session.init();
      server.addEventListener("message", async (event) => {
        const data = await toUint8Array(event.data);
        session.enqueueClientChunk(data);
      });
      server.addEventListener("close", () => session.close(1000, "client closed"));
      server.addEventListener("error", () => session.fail(new Error("websocket error")));
      const headers = new Headers();
      if (earlyUpgrade?.responseHeader) headers.set("X-Sudoku-Early", earlyUpgrade.responseHeader);
      return new Response(null, { status: 101, webSocket: client, headers });
    }

    const apiResponse = await handlePreferredIpApi(settings, request, url, basePath);
    if (apiResponse) return apiResponse;

    if (request.method !== "GET") return textResponse("Method Not Allowed", 405);

    if (url.pathname === "/") {
      if (settings.manageToken) return textResponse("Sudoku Pure Worker is running.");
      return new Response(renderPage(settings, request.url, resolvePlaceholderBundle(settings)), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === basePath) {
      return new Response(renderPage(settings, request.url, resolvePlaceholderBundle(settings)), { headers: { "content-type": "text/html; charset=utf-8" } });
    }
    if (url.pathname === `${basePath}/preferred-candidates.json`) {
      const payload = await resolveClientPreferredPayload(settings, request);
      return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
    }

    const exportBundle = await resolveExportBundle(settings, request);

    if (url.pathname === `${basePath}/shortlink`) {
      return textResponse(exportBundle.shortLink);
    }
    if (url.pathname === `${basePath}/client.json`) {
      return new Response(JSON.stringify(exportBundle.clientConfig, null, 2), { headers: { "content-type": "application/json; charset=utf-8" } });
    }
    if (url.pathname === `${basePath}/clash.yaml`) {
      return textResponse(exportBundle.clashNode, 200, "text/yaml; charset=utf-8");
    }
    return textResponse("Not Found", 404);
  },
};
