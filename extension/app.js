const STORAGE_LAST_URL = "vsvn:last-url";

const authForm = document.getElementById("authForm");
const svnUrl = document.getElementById("svnUrl");
const svnUser = document.getElementById("svnUser");
const svnPass = document.getElementById("svnPass");
const scanDepth = document.getElementById("scanDepth");
const fetchBtn = document.getElementById("fetchBtn");
const downloadBtn = document.getElementById("downloadBtn");
const clearBtn = document.getElementById("clearBtn");
const statusNode = document.getElementById("status");
const treeBody = document.getElementById("treeBody");
const toggleSearchBtn = document.getElementById("toggleSearchBtn");
const treeSearch = document.getElementById("treeSearch");
const clearSearchBtn = document.getElementById("clearSearchBtn");
const searchMeta = document.getElementById("searchMeta");

const sessionFetchCache = new Map();
const HAS_FILE_SYSTEM_ACCESS = typeof window.showDirectoryPicker === "function";

const state = {
  isBusy: false,
  lastResult: null,
  entryMap: new Map(),
};

function ensureTrailingSlash(url) {
  return url.endsWith("/") ? url : `${url}/`;
}

function setStatus(message, kind = "info") {
  statusNode.textContent = message;
  statusNode.className = `status${kind === "info" ? "" : ` ${kind}`}`;
}

function setBusy(isBusy) {
  state.isBusy = isBusy;
  fetchBtn.disabled = isBusy;
  downloadBtn.disabled = isBusy || !HAS_FILE_SYSTEM_ACCESS;
  clearBtn.disabled = isBusy;
  toggleSearchBtn.disabled = isBusy;
  treeSearch.disabled = isBusy;
  clearSearchBtn.disabled = isBusy;
}

function toBasicAuth(user, pass) {
  const bytes = new TextEncoder().encode(`${user || ""}:${pass || ""}`);
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return `Basic ${btoa(binary)}`;
}

function getAuthHeaders() {
  const headers = {};
  if (svnUser.value || svnPass.value) {
    headers.Authorization = toBasicAuth(svnUser.value, svnPass.value);
  }
  return headers;
}

function cacheSvnUrl() {
  const value = svnUrl.value.trim();
  if (value) localStorage.setItem(STORAGE_LAST_URL, value);
}

function loadCachedSvnUrl() {
  const cached = localStorage.getItem(STORAGE_LAST_URL);
  if (cached) svnUrl.value = cached;
}

function parseScanDepth(value) {
  const text = String(value).trim();
  if (!text) return 10;
  const parsed = Number(text);
  if (!Number.isInteger(parsed) || parsed < -1) {
    throw new Error("Depth phai la so nguyen >= -1.");
  }
  return parsed;
}

function getRequestContext() {
  const rawUrl = svnUrl.value.trim();
  if (!rawUrl) {
    throw new Error("Vui long nhap SVN URL.");
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(rawUrl);
  } catch (_) {
    throw new Error("SVN URL khong hop le.");
  }

  if (parsedUrl.protocol !== "http:" && parsedUrl.protocol !== "https:") {
    throw new Error("Chi ho tro SVN URL voi giao thuc http/https.");
  }

  const url = parsedUrl.href;

  const depthValue = parseScanDepth(scanDepth.value);
  const headers = getAuthHeaders();
  return { url, depthValue, headers };
}

function decodeSafe(value) {
  try {
    return decodeURIComponent(value);
  } catch (_) {
    return value;
  }
}

function getNameFromHref(href) {
  const withoutQuery = href.split("?")[0].split("#")[0];
  const withoutTrailing = withoutQuery.endsWith("/") ? withoutQuery.slice(0, -1) : withoutQuery;
  const segments = withoutTrailing.split("/").filter(Boolean);
  return segments.length ? decodeSafe(segments[segments.length - 1]) : "";
}

function parseSvnIndexXmlEntries(text) {
  const xmlDoc = new DOMParser().parseFromString(text, "application/xml");
  const parserError = xmlDoc.querySelector("parsererror");
  if (parserError) return null;

  const indexNode = xmlDoc.querySelector("svn > index");
  if (!indexNode) return null;

  const entries = [];
  Array.from(indexNode.children).forEach((node) => {
    const tag = String(node.tagName || "").toLowerCase();
    if (tag !== "file" && tag !== "dir") return;

    const name = (node.getAttribute("name") || "").trim().replace(/\/+$/g, "");
    const href = (node.getAttribute("href") || "").trim();
    if (!name) return;

    entries.push({ type: tag, name, href });
  });
  return entries;
}

function parseHtmlDirectoryEntries(text) {
  const htmlDoc = new DOMParser().parseFromString(text, "text/html");
  const links = Array.from(htmlDoc.querySelectorAll("a[href]"));
  if (!links.length) return null;

  const entries = [];
  const seen = new Set();

  links.forEach((link) => {
    const rawHref = (link.getAttribute("href") || "").trim();
    if (!rawHref) return;
    if (rawHref === "." || rawHref === ".." || rawHref === "../" || rawHref === "./") return;
    if (rawHref.startsWith("#") || rawHref.toLowerCase().startsWith("javascript:")) return;

    const cleanedHref = rawHref.split("?")[0].split("#")[0];
    const textLabel = (link.textContent || "").trim();
    const fallbackName = getNameFromHref(cleanedHref);
    const normalizedName = (textLabel || fallbackName).replace(/\/+$/g, "").trim();
    if (!normalizedName || normalizedName === "." || normalizedName === "..") return;

    const isDir = cleanedHref.endsWith("/") || textLabel.endsWith("/");
    const key = `${isDir ? "dir" : "file"}::${normalizedName}`;
    if (seen.has(key)) return;
    seen.add(key);

    entries.push({
      type: isDir ? "dir" : "file",
      name: normalizedName,
      href: cleanedHref,
    });
  });

  return entries;
}

function parseDirectoryEntries(text) {
  const xmlEntries = parseSvnIndexXmlEntries(text);
  if (xmlEntries !== null) return xmlEntries;
  return parseHtmlDirectoryEntries(text);
}

function createFetchCacheKey(rootUrl, headers) {
  const authKey = headers.Authorization || "anonymous";
  return `${ensureTrailingSlash(rootUrl)}::${authKey}`;
}

function getOrCreateSessionCache(rootUrl, headers) {
  const key = createFetchCacheKey(rootUrl, headers);
  if (!sessionFetchCache.has(key)) {
    sessionFetchCache.set(key, { dirsByUrl: new Map() });
  }
  return sessionFetchCache.get(key);
}

function resolveEntryHref(entryHref, baseUrl, type) {
  if (!entryHref) return "";
  const absolute = new URL(entryHref, baseUrl).href;
  return type === "dir" ? ensureTrailingSlash(absolute) : absolute;
}

function createNetworkPolicy(rootUrl) {
  const root = new URL(ensureTrailingSlash(rootUrl));
  return {
    origin: root.origin,
  };
}

function normalizeAllowedUrl(candidateUrl, networkPolicy) {
  if (!candidateUrl) return "";

  let parsed;
  try {
    parsed = new URL(candidateUrl);
  } catch (_) {
    return "";
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return "";
  if (parsed.origin !== networkPolicy.origin) return "";
  parsed.hash = "";
  return parsed.href;
}

async function fetchSvnIndexRecursive(rootUrl, headers, maxDepth) {
  const normalizedRoot = ensureTrailingSlash(rootUrl);
  const networkPolicy = createNetworkPolicy(normalizedRoot);
  const cacheEntry = getOrCreateSessionCache(normalizedRoot, headers);
  const pathsSet = new Set();
  const filesByPath = new Map();
  const dirsByPath = new Map();
  const queue = [{ url: normalizedRoot, rel: "", depth: 0 }];
  const visitedInRun = new Set();
  let fetchedDirs = 0;

  while (queue.length) {
    const current = queue.shift();
    const currentUrl = normalizeAllowedUrl(ensureTrailingSlash(current.url), networkPolicy);
    if (!currentUrl) continue;
    if (visitedInRun.has(currentUrl)) continue;
    visitedInRun.add(currentUrl);

    let dirEntries = cacheEntry.dirsByUrl.get(currentUrl);
    if (!dirEntries) {
      const response = await fetch(currentUrl, {
        method: "GET",
        headers,
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText} at ${currentUrl}`);
      }

      const responseText = await response.text();
      const parsedEntries = parseDirectoryEntries(responseText);
      if (parsedEntries === null) {
        throw new Error(`Khong nhan dien duoc danh sach tai ${currentUrl}`);
      }

      dirEntries = parsedEntries.map((entry) => {
        const resolved = resolveEntryHref(entry.href, currentUrl, entry.type);
        return {
          type: entry.type,
          name: entry.name,
          absHref: normalizeAllowedUrl(resolved, networkPolicy),
        };
      });
      cacheEntry.dirsByUrl.set(currentUrl, dirEntries);
      fetchedDirs += 1;
    }

    dirEntries.forEach((entry) => {
      if (entry.type === "dir") {
        const dirPath = `${current.rel}${entry.name}/`;
        const fallback = ensureTrailingSlash(new URL(entry.name, currentUrl).href);
        const dirUrl = normalizeAllowedUrl(entry.absHref || fallback, networkPolicy);
        if (!dirUrl) return;
        pathsSet.add(dirPath);
        dirsByPath.set(dirPath, dirUrl);

        if (dirUrl && (maxDepth === -1 || current.depth < maxDepth)) {
          queue.push({
            url: dirUrl,
            rel: dirPath,
            depth: current.depth + 1,
          });
        }
        return;
      }

      const filePath = `${current.rel}${entry.name}`;
      const fallback = new URL(entry.name, currentUrl).href;
      const fileUrl = normalizeAllowedUrl(entry.absHref || fallback, networkPolicy);
      if (!fileUrl) return;
      pathsSet.add(filePath);
      filesByPath.set(filePath, fileUrl);
    });
  }

  const sortedPaths = Array.from(pathsSet).sort((a, b) => a.localeCompare(b, "vi"));
  const files = Array.from(filesByPath.entries())
    .map(([path, url]) => ({ path, url }))
    .sort((a, b) => a.path.localeCompare(b.path, "vi"));
  const dirs = Array.from(dirsByPath.entries())
    .map(([path, url]) => ({ path, url }))
    .sort((a, b) => {
      const depthDiff = a.path.split("/").length - b.path.split("/").length;
      if (depthDiff !== 0) return depthDiff;
      return a.path.localeCompare(b.path, "vi");
    });

  return {
    paths: sortedPaths,
    fetchedDirs,
    files,
    dirs,
  };
}

function sanitizeSegment(name) {
  const cleaned = String(name || "")
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, "_")
    .replace(/\.+$/g, "")
    .trim();
  return cleaned || "_";
}

function getDownloadFolderName(sourceUrl) {
  const parsed = new URL(sourceUrl);
  const pathParts = parsed.pathname.split("/").filter(Boolean);
  const lastPart = pathParts.length ? pathParts[pathParts.length - 1] : "root";
  return sanitizeSegment(`${parsed.hostname}_${lastPart}`);
}

function getLastPathSegment(itemPath) {
  const clean = itemPath.replace(/\/+$/g, "");
  const parts = clean.split("/").filter(Boolean);
  return parts.length ? parts[parts.length - 1] : "root";
}

async function ensureDirectoryHandle(baseHandle, relativeDirPath) {
  let current = baseHandle;
  const segments = relativeDirPath.split("/").filter(Boolean);
  for (const segment of segments) {
    current = await current.getDirectoryHandle(sanitizeSegment(segment), { create: true });
  }
  return current;
}

async function writeBlobToPath(rootHandle, relativeFilePath, blob) {
  const parts = relativeFilePath.split("/").filter(Boolean);
  const rawFileName = parts.pop() || "file.bin";
  const safeFileName = sanitizeSegment(rawFileName);
  const parentPath = parts.join("/");
  const targetDir = await ensureDirectoryHandle(rootHandle, parentPath);
  const fileHandle = await targetDir.getFileHandle(safeFileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

async function writeTextFile(rootHandle, fileName, text) {
  const fileHandle = await rootHandle.getFileHandle(fileName, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(text);
  await writable.close();
}

function buildLinksManifest(sourceUrl, depthValue, result) {
  const lines = [
    `source_url\t${sourceUrl}`,
    `depth\t${depthValue}`,
    "type\tpath\turl",
  ];
  result.dirs.forEach((item) => {
    lines.push(`dir\t${item.path}\t${item.url || ""}`);
  });
  result.files.forEach((item) => {
    lines.push(`file\t${item.path}\t${item.url || ""}`);
  });
  return lines.join("\n");
}

function buildEntryMap(result) {
  const map = new Map();
  result.dirs.forEach((item) => {
    map.set(item.path, { type: "dir", path: item.path, url: item.url || "" });
  });
  result.files.forEach((item) => {
    map.set(item.path, { type: "file", path: item.path, url: item.url || "" });
  });
  return map;
}

function buildTree(paths) {
  const root = { name: "/", type: "dir", children: new Map() };

  paths.forEach((item) => {
    const normalized = item.replace(/^\/+|\/+$/g, "");
    if (!normalized) return;

    const parts = normalized.split("/").filter(Boolean);
    let current = root;

    parts.forEach((part, index) => {
      const isFile = index === parts.length - 1 && !item.endsWith("/");
      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          type: isFile ? "file" : "dir",
          children: new Map(),
        });
      }
      const next = current.children.get(part);
      if (!isFile) next.type = "dir";
      current = next;
    });
  });

  return root;
}

function mapChildrenToArray(node) {
  node.children = Array.from(node.children.values()).map(mapChildrenToArray);
  return node;
}

function sortTreeNodes(nodes) {
  nodes.sort((a, b) => {
    if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name, "vi");
  });
  nodes.forEach((node) => sortTreeNodes(node.children));
}

function countNodes(node) {
  let files = 0;
  let dirs = 0;
  node.children.forEach((child) => {
    if (child.type === "dir") dirs += 1;
    if (child.type === "file") files += 1;
    const sub = countNodes(child);
    files += sub.files;
    dirs += sub.dirs;
  });
  return { files, dirs };
}

function createLabel(type, name) {
  const nameSpan = document.createElement("span");
  nameSpan.className = "node-name";
  nameSpan.dataset.raw = name;
  nameSpan.textContent = name;

  const typeSpan = document.createElement("span");
  typeSpan.className = "node-type";
  typeSpan.textContent = type === "dir" ? "DIR" : "FILE";

  const wrap = document.createDocumentFragment();
  wrap.appendChild(nameSpan);
  wrap.appendChild(typeSpan);
  return wrap;
}

function getEntryByPath(path) {
  return state.entryMap.get(path) || null;
}

async function copyTextToClipboard(text) {
  if (!text) throw new Error("Khong co du lieu de copy.");

  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const temp = document.createElement("textarea");
  temp.value = text;
  document.body.appendChild(temp);
  temp.select();
  const ok = document.execCommand("copy");
  document.body.removeChild(temp);
  if (!ok) throw new Error("Clipboard API khong kha dung.");
}

function makeActionButton(label, title, onClick) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "item-action secondary";
  btn.textContent = label;
  btn.title = title;
  btn.addEventListener("click", (event) => {
    event.stopPropagation();
    onClick();
  });
  return btn;
}

function renderHighlightedName(nameSpan, queryLower) {
  const raw = nameSpan.dataset.raw || "";
  if (!queryLower) {
    nameSpan.textContent = raw;
    return false;
  }

  const lower = raw.toLowerCase();
  if (!lower.includes(queryLower)) {
    nameSpan.textContent = raw;
    return false;
  }

  nameSpan.textContent = "";
  let cursor = 0;
  while (cursor < raw.length) {
    const idx = lower.indexOf(queryLower, cursor);
    if (idx === -1) {
      nameSpan.appendChild(document.createTextNode(raw.slice(cursor)));
      break;
    }

    if (idx > cursor) {
      nameSpan.appendChild(document.createTextNode(raw.slice(cursor, idx)));
    }

    const mark = document.createElement("mark");
    mark.className = "search-hit";
    mark.textContent = raw.slice(idx, idx + queryLower.length);
    nameSpan.appendChild(mark);
    cursor = idx + queryLower.length;
  }

  return true;
}

function applyFilterOnList(ul, queryLower) {
  let matchCount = 0;
  const items = Array.from(ul.children).filter((el) => el.tagName === "LI");

  items.forEach((li) => {
    const row = li.querySelector(":scope > .node");
    const nameSpan = row ? row.querySelector(".node-name") : null;
    const selfMatch = nameSpan ? renderHighlightedName(nameSpan, queryLower) : false;

    const sub = li.querySelector(":scope > ul");
    let childMatches = 0;
    if (sub) {
      childMatches = applyFilterOnList(sub, queryLower);
    }

    const visible = !queryLower || selfMatch || childMatches > 0;
    li.style.display = visible ? "" : "none";

    if (queryLower && sub && childMatches > 0) {
      sub.style.display = "";
      const toggle = row ? row.querySelector(".toggle") : null;
      if (toggle) toggle.textContent = "▾";
    }

    if (selfMatch) matchCount += 1;
    matchCount += childMatches;
  });

  return matchCount;
}

function applyTreeSearch() {
  const rootUl = treeBody.querySelector("ul.tree");
  if (!rootUl) {
    searchMeta.textContent = "Chua co du lieu de search.";
    return;
  }

  const query = treeSearch.value.trim();
  const queryLower = query.toLowerCase();
  const matchedCount = applyFilterOnList(rootUl, queryLower);

  if (queryLower) {
    searchMeta.textContent = `Tim thay ${matchedCount} ket qua khop.`;
  } else {
    searchMeta.textContent = `Dang hien thi ${state.entryMap.size} muc.`;
  }
}

async function handleCopyPath(path) {
  try {
    await copyTextToClipboard(path);
    setStatus(`Da copy path: ${path}`, "ok");
  } catch (err) {
    setStatus(`Copy that bai: ${err.message}`, "error");
  }
}

async function handleCopyUrl(url) {
  if (!url) {
    setStatus("Muc nay khong co URL de copy.", "error");
    return;
  }

  try {
    await copyTextToClipboard(url);
    setStatus("Da copy URL hien tai.", "ok");
  } catch (err) {
    setStatus(`Copy that bai: ${err.message}`, "error");
  }
}

async function downloadResultToHandle(result, rootHandle, headers, progressPrefix) {
  for (const dir of result.dirs) {
    await ensureDirectoryHandle(rootHandle, dir.path);
  }

  let failedCount = 0;
  const failedItems = [];

  for (let i = 0; i < result.files.length; i += 1) {
    const file = result.files[i];
    setStatus(`${progressPrefix} ${i + 1}/${result.files.length}: ${file.path}`, "info");

    try {
      const response = await fetch(file.url, {
        method: "GET",
        headers,
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }
      const blob = await response.blob();
      await writeBlobToPath(rootHandle, file.path, blob);
    } catch (err) {
      failedCount += 1;
      failedItems.push(`${file.path}: ${err.message}`);
    }
  }

  return { failedCount, failedItems };
}

async function handleDownloadEntry(path) {
  if (!HAS_FILE_SYSTEM_ACCESS) {
    setStatus("Trinh duyet khong ho tro File System Access API.", "error");
    return;
  }

  const entry = getEntryByPath(path);
  if (!entry || !entry.url) {
    setStatus("Muc nay khong co URL hop le de download.", "error");
    return;
  }

  const headers = getAuthHeaders();
  setBusy(true);

  try {
    if (entry.type === "file") {
      const pickedHandle = await window.showDirectoryPicker({ mode: "readwrite" });
      const response = await fetch(entry.url, {
        method: "GET",
        headers,
        credentials: "omit",
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const blob = await response.blob();
      await writeBlobToPath(pickedHandle, sanitizeSegment(getLastPathSegment(entry.path)), blob);
      await writeTextFile(
        pickedHandle,
        "_vsvn_links.tsv",
        ["type\tpath\turl", `file\t${entry.path}\t${entry.url}`].join("\n")
      );
      setStatus(`Da tai file: ${entry.path}`, "ok");
      return;
    }

    const pickedHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const folderName = sanitizeSegment(getLastPathSegment(entry.path));
    const rootHandle = await pickedHandle.getDirectoryHandle(folderName, { create: true });

    setStatus(`Dang quet folder: ${entry.path}`, "info");
    const subResult = await fetchSvnIndexRecursive(entry.url, headers, -1);

    const outcome = await downloadResultToHandle(subResult, rootHandle, headers, "Dang tai");
    await writeTextFile(rootHandle, "_vsvn_links.tsv", buildLinksManifest(entry.url, -1, subResult));

    if (outcome.failedCount > 0) {
      await writeTextFile(rootHandle, "_vsvn_failed_downloads.log", outcome.failedItems.join("\n"));
      setStatus(
        `Tai folder xong voi loi: ${subResult.files.length - outcome.failedCount}/${subResult.files.length} file.`,
        "error"
      );
    } else {
      setStatus(`Tai folder xong: ${subResult.files.length}/${subResult.files.length} file.`, "ok");
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      setStatus("Da huy thao tac chon thu muc luu.", "error");
    } else {
      setStatus(`Download that bai: ${err.message}`, "error");
    }
  } finally {
    setBusy(false);
  }
}

function renderNode(node, parent, prefixPath = "") {
  node.children.forEach((child) => {
    const li = document.createElement("li");
    li.className = child.type === "dir" ? "folder" : "file";

    const row = document.createElement("div");
    row.className = "node";

    const fullPath = `${prefixPath}${child.name}${child.type === "dir" ? "/" : ""}`;
    const entry = state.entryMap.get(fullPath);

    if (child.type === "dir") {
      const toggle = document.createElement("span");
      toggle.className = "toggle";
      toggle.textContent = "▾";
      row.appendChild(toggle);
      row.appendChild(createLabel("dir", child.name));

      const actions = document.createElement("span");
      actions.className = "node-actions";
      actions.appendChild(makeActionButton("📄", "Copy path", () => handleCopyPath(fullPath)));
      actions.appendChild(makeActionButton("🔗", "Copy URL", () => handleCopyUrl(entry ? entry.url : "")));
      actions.appendChild(makeActionButton("⬇", "Download folder", () => handleDownloadEntry(fullPath)));
      row.appendChild(actions);

      const sub = document.createElement("ul");
      renderNode(child, sub, fullPath);

      toggle.addEventListener("click", (event) => {
        event.stopPropagation();
        const hidden = sub.style.display === "none";
        sub.style.display = hidden ? "" : "none";
        toggle.textContent = hidden ? "▾" : "▸";
      });

      li.appendChild(row);
      li.appendChild(sub);
    } else {
      const marker = document.createElement("span");
      marker.className = "leaf-marker";
      marker.textContent = ".";
      row.appendChild(marker);
      row.appendChild(createLabel("file", child.name));

      const actions = document.createElement("span");
      actions.className = "node-actions";
      actions.appendChild(makeActionButton("📄", "Copy path", () => handleCopyPath(fullPath)));
      actions.appendChild(makeActionButton("🔗", "Copy URL", () => handleCopyUrl(entry ? entry.url : "")));
      actions.appendChild(makeActionButton("⬇", "Download file", () => handleDownloadEntry(fullPath)));
      row.appendChild(actions);

      li.appendChild(row);
    }

    parent.appendChild(li);
  });
}

function renderTree(result) {
  state.lastResult = result;
  state.entryMap = buildEntryMap(result);

  if (!result.paths.length) {
    treeBody.innerHTML = "<p class=\"empty\">Khong tim thay file/folder trong danh sach thu muc.</p>";
    setStatus("Tong: 0 folder, 0 file.", "ok");
    searchMeta.textContent = "Khong co du lieu de search.";
    return;
  }

  let tree = buildTree(result.paths);
  tree = mapChildrenToArray(tree);
  sortTreeNodes(tree.children);

  const ul = document.createElement("ul");
  ul.className = "tree";
  renderNode(tree, ul, "");

  const totals = countNodes(tree);
  setStatus(`Tong: ${totals.dirs} folder, ${totals.files} file.`, "ok");
  treeBody.innerHTML = "";
  treeBody.appendChild(ul);

  applyTreeSearch();
}

async function fetchStructureAndRender(context) {
  const result = await fetchSvnIndexRecursive(context.url, context.headers, context.depthValue);
  renderTree(result);
  return result;
}

async function handleFetch(event) {
  event.preventDefault();

  let context;
  try {
    context = getRequestContext();
  } catch (err) {
    setStatus(`Loi: ${err.message}`, "error");
    return;
  }

  cacheSvnUrl();
  setBusy(true);
  setStatus(`Dang fetch cau truc (depth: ${context.depthValue})...`, "info");

  try {
    const result = await fetchStructureAndRender(context);
    if (result.fetchedDirs === 0) {
      setStatus(`${statusNode.textContent} (dung cache phien, khong fetch moi)`, "ok");
    } else {
      setStatus(`${statusNode.textContent} (fetch moi ${result.fetchedDirs} thu muc)`, "ok");
    }
  } catch (err) {
    setStatus(`Fetch that bai: ${err.message}`, "error");
    treeBody.innerHTML = "<p class=\"empty\">Khong co du lieu de hien thi.</p>";
    searchMeta.textContent = "Chua co du lieu de search.";
  } finally {
    setBusy(false);
  }
}

async function handleDownloadAll() {
  if (!HAS_FILE_SYSTEM_ACCESS) {
    setStatus("Trinh duyet khong ho tro File System Access API.", "error");
    return;
  }

  let context;
  try {
    context = getRequestContext();
  } catch (err) {
    setStatus(`Loi: ${err.message}`, "error");
    return;
  }

  cacheSvnUrl();
  setBusy(true);
  setStatus(`Dang lay cau truc de download (depth: ${context.depthValue})...`, "info");

  try {
    const result = await fetchStructureAndRender(context);

    const pickedHandle = await window.showDirectoryPicker({ mode: "readwrite" });
    const rootFolderName = getDownloadFolderName(context.url);
    const rootHandle = await pickedHandle.getDirectoryHandle(rootFolderName, { create: true });

    const outcome = await downloadResultToHandle(result, rootHandle, context.headers, "Dang tai");
    await writeTextFile(rootHandle, "_vsvn_links.tsv", buildLinksManifest(context.url, context.depthValue, result));

    const fetchInfo =
      result.fetchedDirs === 0
        ? "dung cache phien, khong fetch moi"
        : `fetch moi ${result.fetchedDirs} thu muc`;

    if (outcome.failedCount > 0) {
      await writeTextFile(rootHandle, "_vsvn_failed_downloads.log", outcome.failedItems.join("\n"));
      setStatus(
        `Tai xong voi loi: ${result.files.length - outcome.failedCount}/${result.files.length} file (${fetchInfo}).`,
        "error"
      );
    } else {
      setStatus(`Tai xong: ${result.files.length}/${result.files.length} file (${fetchInfo}).`, "ok");
    }
  } catch (err) {
    if (err && err.name === "AbortError") {
      setStatus("Da huy thao tac chon thu muc luu.", "error");
    } else {
      setStatus(`Download that bai: ${err.message}`, "error");
    }
  } finally {
    setBusy(false);
  }
}

function clearTree() {
  state.lastResult = null;
  state.entryMap = new Map();
  treeSearch.value = "";
  treeBody.innerHTML = "<p class=\"empty\">Nhan \"Fetch cau truc\" de tai cay thu muc SVN.</p>";
  searchMeta.textContent = "Chua co du lieu de search.";
  setStatus("Da xoa ket qua hien tai.");
}

function handleToggleSearch() {
  const hidden = treeSearch.classList.contains("hidden");
  if (hidden) {
    treeSearch.classList.remove("hidden");
    clearSearchBtn.classList.remove("hidden");
    treeSearch.focus();
    return;
  }

  treeSearch.value = "";
  treeSearch.classList.add("hidden");
  clearSearchBtn.classList.add("hidden");
  applyTreeSearch();
}

function handleClearSearch() {
  treeSearch.value = "";
  applyTreeSearch();
  treeSearch.focus();
}

function handleTreeSearchInput() {
  applyTreeSearch();
}

svnUrl.addEventListener("change", cacheSvnUrl);
authForm.addEventListener("submit", handleFetch);
downloadBtn.addEventListener("click", handleDownloadAll);
clearBtn.addEventListener("click", clearTree);
toggleSearchBtn.addEventListener("click", handleToggleSearch);
clearSearchBtn.addEventListener("click", handleClearSearch);
treeSearch.addEventListener("input", handleTreeSearchInput);

loadCachedSvnUrl();
setBusy(false);

if (!HAS_FILE_SYSTEM_ACCESS) {
  downloadBtn.title = "Trinh duyet khong ho tro File System Access API.";
}
