const state = {
  data: null,
  view: "conversations",
  selectedId: null,
  query: "",
};

const labels = {
  conversations: { kicker: "对话记录", title: "对话" },
  projects: { kicker: "项目资料", title: "项目" },
  memories: { kicker: "长期记忆", title: "记忆" },
  designChats: { kicker: "设计会话", title: "设计对话" },
};

const els = {
  source: document.querySelector("#source-label"),
  importButton: document.querySelector("#import-folder"),
  folderInput: document.querySelector("#folder-input"),
  importStatus: document.querySelector("#import-status"),
  search: document.querySelector("#search-input"),
  clear: document.querySelector("#clear-search"),
  nav: [...document.querySelectorAll(".nav-item")],
  list: document.querySelector("#item-list"),
  reader: document.querySelector("#reader"),
  kicker: document.querySelector("#view-kicker"),
  title: document.querySelector("#view-title"),
  counts: {
    conversations: document.querySelector("#count-conversations"),
    projects: document.querySelector("#count-projects"),
    memories: document.querySelector("#count-memories"),
    designChats: document.querySelector("#count-design"),
  },
  stats: {
    messages: document.querySelector("#stat-messages"),
    attachments: document.querySelector("#stat-attachments"),
  },
};

const collator = new Intl.Collator("zh-Hans-CN");

init();

async function init() {
  state.data = emptyData();
  try {
    if (window.CLAUDE_DATA?.conversations) {
      state.data = window.CLAUDE_DATA;
    } else if (location.protocol !== "file:") {
      const response = await fetch("./claude-data.json");
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      state.data = await response.json();
    }
  } catch (error) {
    els.importStatus.textContent = `未读取内置数据，可直接添加文件夹。${error.message ? `(${error.message})` : ""}`;
  }

  prepareSearch(state.data);
  hydrateCounts();
  state.selectedId = firstItem(itemsForView())?.id ?? null;
  render();
}

function emptyData() {
  return {
    meta: {
      sourceDir: "未选择文件夹",
      builtAt: "",
      userName: "",
      userEmail: "",
      totalMessages: 0,
      totalAttachments: 0,
    },
    conversations: [],
    projects: [],
    memories: {
      conversationsMemory: "",
      projectMemories: [],
    },
    designChats: [],
  };
}

els.search.addEventListener("input", (event) => {
  state.query = event.target.value.trim();
  state.selectedId = firstItem(itemsForView())?.id ?? null;
  render();
});

els.clear.addEventListener("click", () => {
  state.query = "";
  els.search.value = "";
  state.selectedId = firstItem(itemsForView())?.id ?? null;
  render();
});

for (const button of els.nav) {
  button.addEventListener("click", () => {
    state.view = button.dataset.view;
    state.selectedId = firstItem(itemsForView())?.id ?? null;
    render();
  });
}

els.reader.addEventListener("click", async (event) => {
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;

  const action = actionButton.dataset.action;
  const item = currentReaderItem();
  if (!item) return;

  const messageId = actionButton.dataset.messageId;
  const message = messageId ? (item.messages || []).find((candidate) => candidate.id === messageId) : null;

  if (action === "download-attachment") {
    const attachment = message?.attachments?.[Number(actionButton.dataset.attachmentIndex)];
    if (!attachment) return;
    downloadText(attachment.fileName || "attachment.md", attachment.extractedContent || "", attachment.fileType || "text/plain");
    flashAction(actionButton, "已下载");
    return;
  }

  const text = message ? messageToMarkdown(message) : conversationToMarkdown(item);
  const filename = message
    ? `${slugForDownload(item.title || item.name || "conversation")}-${slugForDownload(message.sender || "message")}-${message.id || "message"}.md`
    : `${slugForDownload(item.title || item.name || "conversation")}.md`;

  if (action === "copy") {
    await copyText(text);
    flashAction(actionButton, "已复制");
  }
  if (action === "download") {
    downloadText(filename, text);
    flashAction(actionButton, "已下载");
  }
});

els.importButton.addEventListener("click", () => {
  els.folderInput.click();
});

els.folderInput.addEventListener("change", async (event) => {
  const files = [...event.target.files];
  if (!files.length) return;
  els.importStatus.textContent = "正在解析导出文件夹...";
  try {
    state.data = await buildDataFromFiles(files);
    prepareSearch(state.data);
    hydrateCounts();
    state.view = "conversations";
    state.query = "";
    els.search.value = "";
    state.selectedId = firstItem(itemsForView())?.id ?? null;
    render();
    els.importStatus.textContent = `已读取 ${state.data.conversations.length} 个对话，${state.data.meta.totalMessages} 条消息。`;
  } catch (error) {
    els.importStatus.textContent = `解析失败：${error.message}`;
  } finally {
    els.folderInput.value = "";
  }
});

async function buildDataFromFiles(files) {
  const byPath = new Map(files.map((file) => [relativeFilePath(file).toLowerCase(), file]));
  const conversationsFile = findFile(byPath, (path) => path.endsWith("/conversations.json") || path === "conversations.json");
  const usersFile = findFile(byPath, (path) => path.endsWith("/users.json") || path === "users.json");
  const memoriesFile = findFile(byPath, (path) => path.endsWith("/memories.json") || path === "memories.json");
  if (!conversationsFile) throw new Error("没有找到 conversations.json");

  const conversationsRaw = await readJsonFile(conversationsFile, []);
  const users = usersFile ? await readJsonFile(usersFile, []) : [];
  const memoriesRaw = memoriesFile ? await readJsonFile(memoriesFile, []) : [];
  const projectFiles = [...byPath.entries()]
    .filter(([path]) => path.includes("/projects/") && path.endsWith(".json"))
    .map(([, file]) => file);
  const designChatFiles = [...byPath.entries()]
    .filter(([path]) => path.includes("/design_chats/") && path.endsWith(".json"))
    .map(([, file]) => file);

  const projects = await loadProjectsFromFiles(projectFiles, memoriesRaw);
  const conversations = conversationsRaw.map(normalizeConversation).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const designChats = (await Promise.all(designChatFiles.map(readJsonFile))).map(normalizeDesignChat).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const totalMessages = conversations.reduce((sum, item) => sum + item.messageCount, 0) + designChats.reduce((sum, item) => sum + item.messages.length, 0);
  const totalAttachments = conversations.reduce((sum, item) => sum + item.attachmentCount, 0);

  return {
    meta: {
      sourceDir: sourceFolderName(files),
      builtAt: new Date().toISOString(),
      userName: users?.[0]?.full_name || "",
      userEmail: users?.[0]?.email_address || "",
      totalMessages,
      totalAttachments,
    },
    conversations,
    projects,
    memories: normalizeMemoriesForBrowser(memoriesRaw, projects),
    designChats,
  };
}

async function loadProjectsFromFiles(projectFiles, memoriesRaw) {
  const projectMemories = {};
  for (const memory of Array.isArray(memoriesRaw) ? memoriesRaw : []) {
    Object.assign(projectMemories, memory.project_memories || {});
  }

  const projects = [];
  for (const file of projectFiles) {
    const raw = await readJsonFile(file, {});
    const projectId = raw.uuid || relativeFilePath(file).split("/").pop()?.replace(/\.json$/i, "") || "";
    projects.push({
      id: projectId,
      name: raw.name || "未命名项目",
      description: raw.description || "",
      isPrivate: Boolean(raw.is_private),
      isStarter: Boolean(raw.is_starter_project),
      promptTemplate: raw.prompt_template || "",
      createdAt: raw.created_at || "",
      updatedAt: raw.updated_at || raw.created_at || "",
      creatorName: raw.creator?.full_name || "",
      docs: (raw.docs || []).map((doc) => ({
        id: doc.uuid || "",
        filename: doc.filename || "未命名文档",
        content: doc.content || "",
        createdAt: doc.created_at || "",
      })),
      memory: projectMemories[projectId] || "",
    });
  }
  return projects.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

function normalizeConversation(raw) {
  const messages = (raw.chat_messages || []).map(normalizeMessageFromRaw);
  const fileNames = [...new Set(messages.flatMap((message) => message.files.map((file) => file.fileName).filter(Boolean)))].sort(collator.compare);
  const preview = firstNonEmpty(messages.map((message) => message.text));
  return {
    id: raw.uuid || "",
    title: raw.name || "未命名对话",
    summary: raw.summary || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || raw.created_at || "",
    messageCount: messages.length,
    attachmentCount: messages.reduce((sum, message) => sum + message.attachments.length, 0),
    fileNames,
    preview: preview.slice(0, 260),
    messages,
  };
}

function normalizeDesignChat(raw) {
  const messages = (raw.messages || []).map(normalizeMessageFromRaw);
  return {
    id: raw.uuid || "",
    title: raw.title || "未命名设计对话",
    projectId: raw.project?.uuid || "",
    projectName: raw.project?.name || "",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || raw.created_at || "",
    preview: firstNonEmpty(messages.map((message) => message.text)).slice(0, 260),
    messages,
  };
}

function normalizeMessageFromRaw(raw) {
  return {
    id: raw.uuid || "",
    sender: raw.sender || raw.role || "unknown",
    createdAt: raw.created_at || "",
    updatedAt: raw.updated_at || "",
    text: raw.text || textFromContent(raw.content || []),
    attachments: (raw.attachments || []).map(normalizeAttachmentFromRaw),
    files: (raw.files || []).map((file) => ({
      fileUuid: file.file_uuid || file.uuid || "",
      fileName: file.file_name || file.filename || "",
    })),
    contentItems: (raw.content || []).map(normalizeContentItemFromRaw),
  };
}

function normalizeAttachmentFromRaw(raw) {
  const fileName = raw.file_name || "";
  const extractedContent = raw.extracted_content || "";
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  const attachment = {
    fileName,
    fileSize: raw.file_size || 0,
    fileType: raw.file_type || "",
    extractedContent,
  };
  if (["md", "markdown", "html", "htm"].includes(extension) && extractedContent) {
    const mimeType = ["html", "htm"].includes(extension) ? "text/html" : "text/markdown";
    attachment.viewUrl = URL.createObjectURL(new Blob([extractedContent], { type: `${mimeType};charset=utf-8` }));
    attachment.viewKind = ["html", "htm"].includes(extension) ? "html" : "markdown";
  }
  return attachment;
}

function normalizeContentItemFromRaw(item) {
  if (!item || typeof item !== "object") return { type: "unknown", text: String(item ?? "") };
  if (item.type === "text") return { type: "text", text: item.text || "" };
  if (item.type === "thinking") return { type: "thinking", text: item.thinking || item.text || "" };
  if (item.type === "tool_use") {
    return {
      type: "tool_use",
      name: item.name || "",
      message: item.message || "",
      input: item.input || {},
    };
  }
  if (item.type === "tool_result") {
    return {
      type: "tool_result",
      name: item.name || "",
      text: contentToText(item.content),
      content: item.content,
    };
  }
  return { type: item.type || "unknown", text: item.text || item.message || "" };
}

function normalizeMemoriesForBrowser(memoriesRaw, projects) {
  const projectNames = Object.fromEntries(projects.map((project) => [project.id, project.name]));
  let conversationsMemory = "";
  const projectMemories = {};
  for (const memory of Array.isArray(memoriesRaw) ? memoriesRaw : []) {
    conversationsMemory ||= memory.conversations_memory || "";
    Object.assign(projectMemories, memory.project_memories || {});
  }
  return {
    conversationsMemory,
    projectMemories: Object.entries(projectMemories)
      .sort(([left], [right]) => (projectNames[left] || left).localeCompare(projectNames[right] || right, "zh-Hans-CN"))
      .map(([projectId, text]) => ({
        projectId,
        projectName: projectNames[projectId] || "",
        text,
      })),
  };
}

function findFile(fileMap, predicate) {
  for (const [path, file] of fileMap.entries()) {
    if (predicate(path)) return file;
  }
  return null;
}

async function readJsonFile(file, fallback) {
  if (!file) return fallback;
  return JSON.parse(await file.text());
}

function relativeFilePath(file) {
  return file.webkitRelativePath || file.name;
}

function sourceFolderName(files) {
  const firstPath = relativeFilePath(files[0] || { name: "本地导入" });
  return firstPath.split("/")[0] || "本地导入";
}

function textFromContent(items) {
  return items
    .map((item) => {
      if (item?.type === "text") return item.text || "";
      if (item?.type === "thinking") return item.thinking || item.text || "";
      return "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function contentToText(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (!item || typeof item !== "object") return String(item ?? "");
      return [item.title || item.name || "", item.url || "", item.text || item.content || ""].filter(Boolean).join("\n");
    }).join("\n\n");
  }
  return JSON.stringify(value, null, 2);
}

function firstNonEmpty(values) {
  for (const value of values) {
    if (value) return String(value).trim();
  }
  return "";
}

function prepareSearch(data) {
  for (const conversation of data.conversations) {
    conversation._search = [
      conversation.title,
      conversation.summary,
      conversation.messages.map((message) => [
        message.text,
        message.attachments.map((item) => item.extractedContent).join("\n"),
        message.files.map((item) => item.fileName).join(" "),
      ].join("\n")).join("\n"),
    ].join("\n").toLowerCase();
  }

  for (const project of data.projects) {
    project._search = [
      project.name,
      project.description,
      project.promptTemplate,
      project.memory,
      project.docs.map((doc) => `${doc.filename}\n${doc.content}`).join("\n"),
    ].join("\n").toLowerCase();
  }

  for (const memory of memoryItems()) {
    memory._search = [memory.title, memory.text].join("\n").toLowerCase();
  }

  for (const chat of data.designChats) {
    chat._search = [
      chat.title,
      chat.projectName,
      chat.messages.map((message) => message.text).join("\n"),
    ].join("\n").toLowerCase();
  }
}

function hydrateCounts() {
  const meta = state.data.meta;
  els.source.textContent = shortPath(meta.sourceDir);
  els.counts.conversations.textContent = state.data.conversations.length;
  els.counts.projects.textContent = state.data.projects.length;
  els.counts.memories.textContent = memoryItems().length;
  els.counts.designChats.textContent = state.data.designChats.length;
  els.stats.messages.textContent = formatNumber(meta.totalMessages);
  els.stats.attachments.textContent = formatNumber(meta.totalAttachments);
}

function render() {
  const { kicker, title } = labels[state.view];
  els.kicker.textContent = kicker;
  els.title.textContent = title;
  for (const button of els.nav) {
    button.classList.toggle("active", button.dataset.view === state.view);
  }

  const items = itemsForView();
  if (!items.some((item) => item.id === state.selectedId)) {
    state.selectedId = firstItem(items)?.id ?? null;
  }

  renderList(items);
  renderReader(items.find((item) => item.id === state.selectedId));
}

function itemsForView() {
  const query = state.query.toLowerCase();
  let items = [];
  if (state.view === "conversations") items = state.data.conversations;
  if (state.view === "projects") items = state.data.projects;
  if (state.view === "memories") items = memoryItems();
  if (state.view === "designChats") items = state.data.designChats;
  if (!query) return items;
  return items.filter((item) => item._search.includes(query));
}

function firstItem(items) {
  return items[0] ?? {};
}

function renderList(items) {
  if (!items.length) {
    els.list.innerHTML = `<div class="notice">没有匹配项。</div>`;
    return;
  }

  els.list.innerHTML = items.map((item) => {
    const active = item.id === state.selectedId ? " active" : "";
    const title = escapeHtml(item.title ?? item.name ?? "未命名");
    const meta = listMeta(item);
    const preview = highlight(escapeHtml(item.preview ?? item.description ?? item.text ?? ""), state.query);
    const chips = listChips(item).map((chip) => `<span class="chip">${escapeHtml(chip)}</span>`).join("");
    return `
      <button class="item${active}" type="button" data-id="${escapeHtml(item.id)}">
        <span class="item-title">${highlight(title, state.query)}</span>
        <span class="item-meta">${meta.map((part) => `<span>${escapeHtml(part)}</span>`).join("")}</span>
        ${chips ? `<span class="chips">${chips}</span>` : ""}
        ${preview ? `<span class="preview">${preview}</span>` : ""}
      </button>
    `;
  }).join("");

  for (const button of els.list.querySelectorAll(".item")) {
    button.addEventListener("click", () => {
      state.selectedId = button.dataset.id;
      render();
    });
  }
}

function renderReader(item) {
  if (!item) {
    els.reader.innerHTML = `
      <section class="empty">
        <h2>添加 Claude 导出文件夹开始阅读</h2>
        <p>选择包含 conversations.json、projects、memories.json 的 Claude 导出目录，内容会在本页本地解析。</p>
      </section>
    `;
    return;
  }

  if (state.view === "conversations") renderConversation(item);
  if (state.view === "projects") renderProject(item);
  if (state.view === "memories") renderMemory(item);
  if (state.view === "designChats") renderDesignChat(item);
}

function renderConversation(conversation) {
  const summary = conversation.summary ? markdown(conversation.summary) : "";
  els.reader.innerHTML = `
    <header class="reader-header">
      <h2>${highlight(escapeHtml(conversation.title), state.query)}</h2>
      <div class="meta-line">
        <span class="chip">${escapeHtml(formatDate(conversation.updatedAt))}</span>
        <span class="chip">${conversation.messageCount} 条消息</span>
        <span class="chip">${conversation.attachmentCount} 个附件</span>
      </div>
      <div class="reader-actions">
        <button type="button" data-action="copy">复制整段</button>
        <button type="button" data-action="download">下载整段</button>
      </div>
      ${summary ? `
        <details class="overview-card">
          <summary>Conversation overview</summary>
          <div class="markdown">${summary}</div>
        </details>
      ` : ""}
    </header>
    <div class="message-list">
      ${conversation.messages.map(renderMessage).join("")}
    </div>
  `;
}

function renderProject(project) {
  els.reader.innerHTML = `
    <header class="reader-header">
      <h2>${highlight(escapeHtml(project.name), state.query)}</h2>
      <div class="meta-line">
        <span class="chip">${escapeHtml(project.isPrivate ? "私有项目" : "公开项目")}</span>
        <span class="chip">${project.docs.length} 份文档</span>
        <span class="chip">${escapeHtml(formatDate(project.updatedAt || project.createdAt))}</span>
      </div>
      ${project.description ? `<p>${highlight(escapeHtml(project.description), state.query)}</p>` : ""}
    </header>
    <div class="doc-list">
      ${project.memory ? renderDocCard("项目记忆", project.memory) : ""}
      ${project.promptTemplate ? renderDocCard("提示词模板", project.promptTemplate) : ""}
      ${project.docs.length ? project.docs.map((doc) => renderDocCard(doc.filename || "未命名文档", doc.content)).join("") : `<div class="notice">这个项目没有导出的文档。</div>`}
    </div>
  `;
}

function renderMemory(memory) {
  els.reader.innerHTML = `
    <header class="reader-header">
      <h2>${highlight(escapeHtml(memory.title), state.query)}</h2>
      <div class="meta-line">
        <span class="chip">${escapeHtml(memory.kind)}</span>
      </div>
    </header>
    <div class="doc-list">
      ${renderDocCard(memory.title, memory.text)}
    </div>
  `;
}

function renderDesignChat(chat) {
  els.reader.innerHTML = `
    <header class="reader-header">
      <h2>${highlight(escapeHtml(chat.title), state.query)}</h2>
      <div class="meta-line">
        <span class="chip">${escapeHtml(chat.projectName || "无项目")}</span>
        <span class="chip">${chat.messages.length} 条消息</span>
        <span class="chip">${escapeHtml(formatDate(chat.updatedAt || chat.createdAt))}</span>
      </div>
      <div class="reader-actions">
        <button type="button" data-action="copy">复制整段</button>
        <button type="button" data-action="download">下载整段</button>
      </div>
    </header>
    <div class="message-list">
      ${chat.messages.length ? chat.messages.map(renderMessage).join("") : `<div class="notice">这条设计对话没有导出消息。</div>`}
    </div>
  `;
}

function renderMessage(message) {
  const roleClass = message.sender === "human" ? " human" : " assistant";
  const roleName = message.sender === "human" ? "你" : "Claude";
  const displayParts = splitMessageText(message);
  const text = displayParts.visible ? renderFoldBlock(
    message.sender === "human" ? "对话" : "对话结果",
    `<div class="markdown">${markdown(displayParts.visible)}</div>`,
    { className: "message-fold dialogue-fold", open: true },
  ) : "";
  const content = renderContentBundle(message.contentItems, displayParts.inferredThought);
  const attachments = message.attachments.map((attachment, attachmentIndex) => renderAttachmentBlock(attachment, message, attachmentIndex)).join("");
  const files = message.files.length ? renderFoldBlock(
    `${message.files.length} 个文件引用`,
    `<pre class="raw">${escapeHtml(message.files.map((file) => file.fileName || file.fileUuid || "未命名").join("\n"))}</pre>`,
    { className: "message-fold file-fold" },
  ) : "";
  const emptyNotice = !text && !content && !attachments && !files ? `<div class="notice">这条消息没有文本。</div>` : "";

  return `
    <section class="message${roleClass}">
      <div class="message-head">
        <span class="sender">${roleName}</span>
        <span>${escapeHtml(formatDate(message.createdAt))}</span>
        <span class="message-actions">
          <button type="button" data-action="copy" data-message-id="${escapeHtml(message.id)}">复制</button>
          <button type="button" data-action="download" data-message-id="${escapeHtml(message.id)}">下载</button>
        </span>
      </div>
      ${text}
      ${emptyNotice}
      ${content}
      ${attachments}
      ${files}
    </section>
  `;
}

function renderFoldBlock(summary, body, options = {}) {
  const className = options.className || "message-fold";
  const open = options.open ? " open" : "";
  return `
    <details class="${className}"${open}>
      <summary>${summary}</summary>
      ${body}
    </details>
  `;
}

function renderContentBundle(items, inferredThought = "") {
  const useful = items.filter((item) => item.type !== "text");
  if (!useful.length && !inferredThought) return "";
  const thinkingCount = useful.filter((item) => item.type === "thinking").length;
  const toolCount = useful.length - thinkingCount;
  const summary = [
    inferredThought ? "1 段开头英文" : "",
    thinkingCount ? `${thinkingCount} 段原始思考` : "",
    toolCount ? `${toolCount} 个工具片段` : "",
  ].filter(Boolean).join("，");
  return `
    <details class="message-fold thought-bundle">
      <summary>思考过程${summary ? ` · ${summary}` : ""}</summary>
      <div class="thought-section">
        ${inferredThought ? renderInferredThought(inferredThought) : ""}
        ${useful.map(renderContentItem).join("")}
      </div>
    </details>
  `;
}

function renderInferredThought(text) {
  return renderFoldBlock("开头英文段", `<pre class="raw">${escapeHtml(text)}</pre>`, {
    className: "message-fold thought-item inferred",
  });
}

function renderContentItem(item) {
    if (item.type === "tool_use") {
      return renderFoldBlock(`工具调用 · ${escapeHtml(item.name || "tool")}`, `<pre class="raw">${escapeHtml(JSON.stringify(item.input ?? {}, null, 2))}</pre>`, {
        className: "message-fold thought-item",
      });
    }
    if (item.type === "tool_result") {
      return renderFoldBlock(`工具结果 · ${escapeHtml(item.name || "result")}`, `<pre class="raw">${escapeHtml(item.text || JSON.stringify(item.content ?? {}, null, 2))}</pre>`, {
        className: "message-fold thought-item",
      });
    }
    if (item.type === "thinking") {
      return renderFoldBlock("原始思考", `<pre class="raw">${escapeHtml(item.text || "")}</pre>`, {
        className: "message-fold thought-item",
      });
    }
    return renderFoldBlock(escapeHtml(item.type || "内容块"), `<pre class="raw">${escapeHtml(JSON.stringify(item, null, 2))}</pre>`, {
      className: "message-fold thought-item",
    });
}

function renderAttachmentBlock(attachment, message, attachmentIndex) {
  const title = `${escapeHtml(attachment.fileName || "未命名附件")} · ${escapeHtml(attachment.fileType || "文件")} · ${formatBytes(attachment.fileSize)}`;
  const body = `
    ${renderAttachmentActions(attachment, message, attachmentIndex)}
    ${renderFoldBlock("附件内容", `<div class="markdown">${markdown(attachment.extractedContent || "没有可读文本。")}</div>`, {
      className: "message-fold nested-fold",
    })}
  `;
  return renderFoldBlock(title, body, {
    className: "message-fold attachment-card",
  });
}

function renderAttachmentActions(attachment, message, attachmentIndex) {
  const path = attachment.viewPath || attachment.viewUrl;
  if (!path) return "";
  const label = attachment.viewKind === "html" ? "打开 HTML" : "打开文件";
  return `
    <div class="file-actions">
      <a class="file-link" href="${escapeHtml(path)}" target="_blank" rel="noreferrer">${label}</a>
      <button class="file-link" type="button" data-action="download-attachment" data-message-id="${escapeHtml(message.id)}" data-attachment-index="${attachmentIndex}">下载文件</button>
    </div>
  `;
}

function currentReaderItem() {
  return itemsForView().find((item) => item.id === state.selectedId);
}

function conversationToMarkdown(item) {
  const title = item.title || item.name || "未命名对话";
  const lines = [`# ${title}`, ""];
  if (item.updatedAt || item.createdAt) lines.push(`日期：${formatDate(item.updatedAt || item.createdAt)}`, "");
  if (item.summary) lines.push("## 摘要", "", item.summary.trim(), "");
  if (item.messages?.length) {
    lines.push("## 对话", "");
    for (const message of item.messages) {
      lines.push(messageToMarkdown(message), "");
    }
  }
  return lines.join("\n").replace(/\n{4,}/g, "\n\n\n").trim() + "\n";
}

function messageToMarkdown(message) {
  const roleName = message.sender === "human" ? "你" : "Claude";
  const lines = [`### ${roleName}${message.createdAt ? ` · ${formatDate(message.createdAt)}` : ""}`, ""];
  const text = splitMessageText(message).visible;
  if (text) lines.push(text.trim(), "");

  if (message.attachments?.length) {
    lines.push("附件：");
    for (const attachment of message.attachments) {
      const name = attachment.fileName || "未命名附件";
      const path = attachment.viewPath || attachment.viewUrl || "";
      lines.push(`- ${path ? `[${name}](${path})` : name}`);
    }
    lines.push("");
  }

  return lines.join("\n").trim();
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch (error) {
      // 本地 file:// 打开时，部分浏览器会拒绝 Clipboard API，下面使用传统复制兜底。
    }
  }
  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

function downloadText(filename, text, mimeType = "text/markdown") {
  const url = URL.createObjectURL(new Blob([text], { type: `${mimeType};charset=utf-8` }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function flashAction(button, label) {
  const original = button.textContent;
  button.textContent = label;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = original;
    button.disabled = false;
  }, 900);
}

function renderDocCard(title, content) {
  return `
    <section class="doc-card">
      <h3>${highlight(escapeHtml(title), state.query)}</h3>
      <div class="markdown">${markdown(content || "")}</div>
    </section>
  `;
}

function listMeta(item) {
  if (state.view === "conversations") {
    return [formatDate(item.updatedAt), `${item.messageCount} 条`, `${item.attachmentCount} 附件`];
  }
  if (state.view === "projects") {
    return [formatDate(item.updatedAt || item.createdAt), `${item.docs.length} 文档`];
  }
  if (state.view === "memories") return [item.kind];
  return [formatDate(item.updatedAt || item.createdAt), item.projectName || "无项目"];
}

function listChips(item) {
  if (state.view === "conversations") return item.fileNames.slice(0, 2);
  if (state.view === "projects") return item.docs.slice(0, 2).map((doc) => doc.filename);
  return [];
}

function memoryItems() {
  const memories = state.data?.memories;
  if (!memories) return [];
  const items = [];
  if (memories.conversationsMemory) {
    items.push({
      id: "memory-global",
      title: "全局对话记忆",
      kind: "账号记忆",
      text: memories.conversationsMemory,
      preview: memories.conversationsMemory.slice(0, 180),
    });
  }
  for (const memory of memories.projectMemories) {
    items.push({
      id: `memory-${memory.projectId}`,
      title: memory.projectName ? `${memory.projectName} 记忆` : `项目记忆 ${memory.projectId}`,
      kind: "项目记忆",
      text: memory.text,
      preview: memory.text.slice(0, 180),
    });
  }
  return items;
}

function cleanMessageText(text) {
  return String(text || "")
    .replace(/```[\s\r\n]*This block is not supported on your current device yet\.[\s\r\n]*```/g, "")
    .replace(/This block is not supported on your current device yet\./g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function splitMessageText(message) {
  const text = cleanMessageText(message.text);
  if (message.sender === "human" || !text) {
    return { visible: text, inferredThought: "" };
  }

  const englishRun = extractInitialEnglishRun(text);
  if (englishRun) return englishRun;

  return { visible: text, inferredThought: "" };
}

function extractInitialEnglishRun(text) {
  const startMatch = text.match(/^[\s"'`({\[]*/);
  const start = startMatch ? startMatch[0].length : 0;
  if (!/[A-Za-z]/.test(text[start] || "")) return null;

  let englishCharacters = 0;
  let previousOffset = 0;
  const paragraphBreak = /\n{2,}/g;
  let match;

  while ((match = paragraphBreak.exec(text))) {
    const nextOffset = match.index + match[0].length;
    englishCharacters += countEnglishCharacters(text.slice(previousOffset, nextOffset));
    const candidate = text.slice(nextOffset).trimStart();
    const internalAnswerOffset = findInternalChineseAnswerOffset(candidate);
    if (englishCharacters >= 200 && internalAnswerOffset >= 0) {
      return {
        visible: candidate.slice(internalAnswerOffset).trim(),
        inferredThought: `${text.slice(0, nextOffset)}${candidate.slice(0, internalAnswerOffset)}`.trim(),
      };
    }
    if (englishCharacters >= 200 && isLikelyChineseAnswerStart(candidate)) {
      return {
        visible: candidate.trim(),
        inferredThought: text.slice(0, nextOffset).trim(),
      };
    }
    previousOffset = nextOffset;
  }

  return null;
}

function countEnglishCharacters(text) {
  return (text.match(/[A-Za-z]/g) || []).length;
}

function isLikelyChineseAnswerStart(text) {
  const sample = String(text || "").slice(0, 700);
  const firstLine = sample.split("\n").find((line) => line.trim()) || "";
  const normalized = firstLine
    .trim()
    .replace(/^#{1,6}\s*/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+[.、]\s*/, "")
    .replace(/^\*\*/, "")
    .trim();

  if (!normalized || startsWithReasoningCue(normalized) || startsWithChineseReasoningCue(normalized)) return false;
  if (/^[\u3400-\u9fff\uf900-\ufaff]/.test(normalized)) return true;

  const firstChinese = normalized.search(/[\u3400-\u9fff\uf900-\ufaff]/);
  if (firstChinese < 0 || firstChinese > 36) return false;

  const prefix = normalized.slice(0, firstChinese);
  const trimmedPrefix = prefix.trim();
  const englishWords = trimmedPrefix.match(/[A-Za-z]{2,}/g) || [];
  if (englishWords.length <= 1) return /^[A-Z0-9._/\-]{2,}$/.test(trimmedPrefix);
  return trimmedPrefix.length <= 18 && /^[A-Z0-9._/\-\s]+$/.test(trimmedPrefix);
}

function startsWithReasoningCue(text) {
  return /^(?:The user|The second part|The context|I need|I should|I understand|I'm|I'll|Looking at|Given that|Now I|Let me|Since this|This is|For the|Looking through)\b/i.test(text);
}

function startsWithChineseReasoningCue(text) {
  return /^(?:哦[，,]?我之前|我应该|这样就能|我对这个|我会用|我需要|我正在|我理解|我注意到|最后对比|最后指出)/.test(text);
}

function findInternalChineseAnswerOffset(text) {
  const raw = String(text || "");
  const leadingWhitespace = raw.match(/^\s*/)?.[0].length || 0;
  const sample = raw.slice(leadingWhitespace, leadingWhitespace + 1200);
  if (!startsWithChineseReasoningCue(sample)) return -1;

  const sentenceBreak = /[。！？]\s*/g;
  let match;
  while ((match = sentenceBreak.exec(sample))) {
    const offset = match.index + match[0].length;
    const rest = sample.slice(offset).trimStart();
    if (!rest) continue;
    if (startsWithChineseReasoningCue(rest) || startsWithReasoningCue(rest)) continue;
    if (/^[\u3400-\u9fff\uf900-\ufaff]/.test(rest)) {
      return leadingWhitespace + offset + (sample.slice(offset).match(/^\s*/)?.[0].length || 0);
    }
  }

  return -1;
}

function markdown(input) {
  let text = escapeHtml(input || "");
  const codeBlocks = [];
  text = text.replace(/```([\s\S]*?)```/g, (_, code) => {
    const token = `@@CODE${codeBlocks.length}@@`;
    codeBlocks.push(`<pre><code>${code}</code></pre>`);
    return token;
  });
  text = text
    .replace(/^### (.*)$/gm, "<h3>$1</h3>")
    .replace(/^## (.*)$/gm, "<h2>$1</h2>")
    .replace(/^# (.*)$/gm, "<h1>$1</h1>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");

  const blocks = text.split(/\n{2,}/).map((block) => {
    if (/^<(h1|h2|h3|pre)/.test(block) || block.startsWith("@@CODE")) return block;
    if (isMarkdownTable(block)) return renderMarkdownTable(block);
    if (/^[-*] /m.test(block)) {
      const items = block.split("\n").filter(Boolean).map((line) => `<li>${line.replace(/^[-*] /, "")}</li>`).join("");
      return `<ul>${items}</ul>`;
    }
    return `<p>${block.replace(/\n/g, "<br>")}</p>`;
  }).join("");

  const restored = codeBlocks.reduce((html, code, index) => html.replace(`@@CODE${index}@@`, code), blocks);
  return highlight(restored, state.query);
}

function isMarkdownTable(block) {
  const lines = block.trim().split("\n").filter(Boolean);
  if (lines.length < 2) return false;
  return lines[0].includes("|") && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(lines[1]);
}

function renderMarkdownTable(block) {
  const lines = block.trim().split("\n").filter(Boolean);
  const headers = splitTableRow(lines[0]);
  const rows = lines.slice(2).map(splitTableRow);
  return `
    <div class="table-wrap">
      <table>
        <thead>
          <tr>${headers.map((cell) => `<th>${inlineMarkdown(cell)}</th>`).join("")}</tr>
        </thead>
        <tbody>
          ${rows.map((row) => `<tr>${headers.map((_, index) => `<td>${inlineMarkdown(row[index] || "")}</td>`).join("")}</tr>`).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function splitTableRow(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((cell) => cell.trim());
}

function inlineMarkdown(text) {
  return text
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function highlight(html, query) {
  if (!query) return html;
  const safe = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (!safe) return html;
  const pattern = new RegExp(safe, "gi");
  return html
    .split(/(<[^>]+>)/g)
    .map((part) => (part.startsWith("<") ? part : part.replace(pattern, (match) => `<mark>${match}</mark>`)))
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function formatDate(value) {
  if (!value) return "无日期";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" });
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(value ?? 0);
}

function formatBytes(value) {
  const size = Number(value || 0);
  if (!size) return "未知大小";
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function shortPath(path) {
  if (!path) return "本地导出";
  const parts = path.split("/");
  return parts.slice(-2).join("/");
}

function slugForDownload(value) {
  const slug = String(value || "")
    .trim()
    .replace(/[^\w\u4e00-\u9fff.-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-.]+|[-.]+$/g, "");
  return slug.slice(0, 80) || "conversation";
}
