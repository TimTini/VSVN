#!/usr/bin/env node
"use strict";

const http = require("http");
const fs = require("fs");
const fsp = fs.promises;
const path = require("path");

function parseArgs(argv) {
  const options = {
    host: "127.0.0.1",
    port: 8787,
    root: path.resolve(process.cwd(), "svn-local", "seed"),
    user: "",
    pass: "",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--host" && argv[i + 1]) {
      options.host = argv[i + 1];
      i += 1;
      continue;
    }
    if (arg === "--port" && argv[i + 1]) {
      options.port = Number(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--root" && argv[i + 1]) {
      options.root = path.resolve(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--user" && argv[i + 1]) {
      options.user = String(argv[i + 1]);
      i += 1;
      continue;
    }
    if (arg === "--pass" && argv[i + 1]) {
      options.pass = String(argv[i + 1]);
      i += 1;
      continue;
    }
  }

  if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65535) {
    throw new Error("Invalid --port. Use an integer in range 1..65535.");
  }

  return options;
}

function parseBasicAuthHeader(authHeader) {
  if (!authHeader || typeof authHeader !== "string") return null;
  const parts = authHeader.split(" ");
  if (parts.length !== 2 || String(parts[0]).toLowerCase() !== "basic") return null;

  let decoded = "";
  try {
    decoded = Buffer.from(parts[1], "base64").toString("utf8");
  } catch (_) {
    return null;
  }

  const colonIndex = decoded.indexOf(":");
  if (colonIndex < 0) return null;
  return {
    user: decoded.slice(0, colonIndex),
    pass: decoded.slice(colonIndex + 1),
  };
}

function htmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function getContentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".html":
      return "text/html; charset=utf-8";
    case ".js":
      return "application/javascript; charset=utf-8";
    case ".json":
      return "application/json; charset=utf-8";
    case ".css":
      return "text/css; charset=utf-8";
    case ".md":
    case ".txt":
      return "text/plain; charset=utf-8";
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    default:
      return "application/octet-stream";
  }
}

function safeResolve(root, pathname) {
  const decoded = decodeURIComponent(pathname);
  const resolved = path.resolve(root, `.${decoded}`);
  const rootLower = root.toLowerCase();
  const resolvedLower = resolved.toLowerCase();
  const insideRoot =
    resolvedLower === rootLower || resolvedLower.startsWith(`${rootLower}${path.sep}`);
  if (!insideRoot) {
    return null;
  }
  return resolved;
}

function toHrefName(name, isDir) {
  return `${encodeURIComponent(name)}${isDir ? "/" : ""}`;
}

function buildDirectoryListingHtml(requestPath, entries) {
  const items = [];
  items.push('    <li><a href="../"></a></li>');

  entries.forEach((entry) => {
    const href = toHrefName(entry.name, entry.isDirectory());
    const label = htmlEscape(entry.name);
    items.push(`    <li><a href="${href}">${label}</a></li>`);
  });

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Index of ${htmlEscape(requestPath)}</title>
</head>
<body>
  <h1>Index of ${htmlEscape(requestPath)}</h1>
  <ul>
${items.join("\n")}
  </ul>
</body>
</html>`;
}

async function createServer(options) {
  const rootStats = await fsp.stat(options.root).catch(() => null);
  if (!rootStats || !rootStats.isDirectory()) {
    throw new Error(`Root folder does not exist or is not a directory: ${options.root}`);
  }

  const authEnabled = options.user.length > 0 || options.pass.length > 0;

  const server = http.createServer(async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");

    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      res.statusCode = 405;
      res.end("Method Not Allowed");
      return;
    }

    if (authEnabled) {
      const provided = parseBasicAuthHeader(req.headers.authorization || "");
      const valid = provided && provided.user === options.user && provided.pass === options.pass;
      if (!valid) {
        res.statusCode = 401;
        res.setHeader("WWW-Authenticate", 'Basic realm="VSVN Test Listing", charset="UTF-8"');
        res.end("Unauthorized");
        return;
      }
    }

    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);
    const filePath = safeResolve(options.root, url.pathname);
    if (!filePath) {
      res.statusCode = 403;
      res.end("Forbidden");
      return;
    }

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch (_) {
      res.statusCode = 404;
      res.end("Not Found");
      return;
    }

    if (stat.isDirectory()) {
      if (!url.pathname.endsWith("/")) {
        res.statusCode = 301;
        res.setHeader("Location", `${url.pathname}/${url.search}`);
        res.end();
        return;
      }

      let dirents = await fsp.readdir(filePath, { withFileTypes: true });
      dirents = dirents
        .filter((d) => !d.name.startsWith("."))
        .sort((a, b) => {
          if (a.isDirectory() !== b.isDirectory()) return a.isDirectory() ? -1 : 1;
          return a.name.localeCompare(b.name, "en");
        });

      const html = buildDirectoryListingHtml(url.pathname, dirents);
      res.statusCode = 200;
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      if (req.method === "HEAD") {
        res.end();
        return;
      }
      res.end(html);
      return;
    }

    if (req.method === "HEAD") {
      res.statusCode = 200;
      res.setHeader("Content-Type", getContentType(filePath));
      res.setHeader("Content-Length", String(stat.size));
      res.end();
      return;
    }

    res.statusCode = 200;
    res.setHeader("Content-Type", getContentType(filePath));
    fs.createReadStream(filePath).pipe(res);
  });

  return server;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const server = await createServer(options);

  server.listen(options.port, options.host, () => {
    console.log("[html-listing-server] started");
    console.log(`  Root: ${options.root}`);
    console.log(`  URL : http://${options.host}:${options.port}/`);
    if (options.user || options.pass) {
      console.log(`  Auth: Basic (${options.user || "<empty-user>"} / ${options.pass || "<empty-pass>"})`);
    } else {
      console.log("  Auth: disabled");
    }
    console.log("  Stop: Ctrl+C");
  });
}

main().catch((err) => {
  console.error(`[html-listing-server] error: ${err.message}`);
  process.exit(1);
});
