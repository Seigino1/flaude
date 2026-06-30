#!/usr/bin/env python3
# 用途：把 Claude 导出目录转换成本地静态阅读器
# 参数：Claude 导出目录 [输出目录]；默认输出到 dist/
# 输出：生成目录、数据统计和本地启动提示
# 退出码：0=成功，1=出错
# Known Issues:

from __future__ import annotations

import json
import re
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
TEMPLATE_DIR = ROOT / "src" / "claude_reader"
DEFAULT_OUTPUT = ROOT / "dist"


def main() -> int:
    if len(sys.argv) < 2:
        print("用法：python3 scripts/build_claude_reader.py <Claude 导出目录> [输出目录]", file=sys.stderr)
        return 1

    source_dir = Path(sys.argv[1]).expanduser()
    output_dir = Path(sys.argv[2]).expanduser() if len(sys.argv) >= 3 else DEFAULT_OUTPUT

    try:
        require_source(source_dir)
        require_templates()
        output_dir.mkdir(parents=True, exist_ok=True)

        data = build_data(source_dir)
        copy_templates(output_dir)
        exported_files = export_attachment_files(data, output_dir)
        data_path = output_dir / "claude-data.json"
        data_text = json.dumps(data, ensure_ascii=False, indent=2)
        data_path.write_text(data_text, encoding="utf-8")
        data_script_path = output_dir / "claude-data.js"
        data_script_path.write_text(f"window.CLAUDE_DATA = {data_text};\n", encoding="utf-8")

        print(f"已生成阅读器：{output_dir}")
        print(f"数据文件：{data_path}")
        print(f"直开数据：{data_script_path}")
        print(
            "统计："
            f"{len(data['conversations'])} 个对话，"
            f"{len(data['projects'])} 个项目，"
            f"{data['meta']['totalMessages']} 条消息，"
            f"{data['meta']['totalAttachments']} 个附件，"
            f"{exported_files} 个可点击文件"
        )
        print(f"启动命令：python3 -m http.server --directory '{output_dir}' 8765")
        return 0
    except Exception as error:  # noqa: BLE001
        print(f"生成失败：{error}", file=sys.stderr)
        return 1


def require_source(source_dir: Path) -> None:
    required = ["conversations.json", "projects", "memories.json", "users.json"]
    missing = [name for name in required if not (source_dir / name).exists()]
    if missing:
        raise FileNotFoundError(f"Claude 导出目录缺少：{', '.join(missing)}")


def require_templates() -> None:
    required = ["index.html", "styles.css", "app.js", "logo.svg"]
    missing = [name for name in required if not (TEMPLATE_DIR / name).exists()]
    if missing:
        raise FileNotFoundError(f"阅读器模板缺少：{', '.join(missing)}")


def copy_templates(output_dir: Path) -> None:
    for name in ["index.html", "styles.css", "app.js", "logo.svg"]:
        shutil.copy2(TEMPLATE_DIR / name, output_dir / name)


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    with path.open("r", encoding="utf-8") as file:
        return json.load(file)


def build_data(source_dir: Path) -> dict[str, Any]:
    users = read_json(source_dir / "users.json", [])
    memories_raw = read_json(source_dir / "memories.json", [])
    projects = load_projects(source_dir, memories_raw)
    conversations = load_conversations(source_dir)
    design_chats = load_design_chats(source_dir)

    total_messages = sum(item["messageCount"] for item in conversations)
    total_messages += sum(len(item["messages"]) for item in design_chats)
    total_attachments = sum(item["attachmentCount"] for item in conversations)

    return {
        "meta": {
            "sourceDir": str(source_dir),
            "builtAt": datetime.now(timezone.utc).isoformat(),
            "userName": first_value(users, "full_name"),
            "userEmail": first_value(users, "email_address"),
            "totalMessages": total_messages,
            "totalAttachments": total_attachments,
        },
        "conversations": conversations,
        "projects": projects,
        "memories": normalize_memories(memories_raw, projects),
        "designChats": design_chats,
    }


def export_attachment_files(data: dict[str, Any], output_dir: Path) -> int:
    files_dir = output_dir / "files"
    if files_dir.exists():
        shutil.rmtree(files_dir)
    files_dir.mkdir(parents=True, exist_ok=True)

    exported = 0
    conversations = data.get("conversations", [])
    for conversation_index, conversation in enumerate(conversations, start=1):
        conversation_slug = slugify(conversation.get("title") or conversation.get("id") or str(conversation_index))
        conversation_dir = files_dir / f"{conversation_index:03d}-{conversation_slug}"
        for message_index, message in enumerate(conversation.get("messages", []), start=1):
            for attachment_index, attachment in enumerate(message.get("attachments", []), start=1):
                content = attachment.get("extractedContent") or ""
                filename = attachment.get("fileName") or f"attachment-{attachment_index}.md"
                suffix = Path(filename).suffix.lower()
                if suffix not in {".md", ".markdown", ".html", ".htm"} or not content:
                    continue

                conversation_dir.mkdir(parents=True, exist_ok=True)
                safe_name = slugify(Path(filename).stem) or "attachment"
                output_name = f"{message_index:03d}-{attachment_index:02d}-{safe_name}{suffix}"
                output_path = conversation_dir / output_name
                output_path.write_text(content, encoding="utf-8")
                attachment["viewPath"] = output_path.relative_to(output_dir).as_posix()
                attachment["viewKind"] = "html" if suffix in {".html", ".htm"} else "markdown"
                exported += 1
    return exported


def load_conversations(source_dir: Path) -> list[dict[str, Any]]:
    raw = read_json(source_dir / "conversations.json", [])
    conversations = []
    for item in raw:
        messages = [normalize_message(message) for message in item.get("chat_messages") or []]
        attachments = sum(len(message["attachments"]) for message in messages)
        file_names = sorted(
            {
                file_item.get("fileName", "")
                for message in messages
                for file_item in message["files"]
                if file_item.get("fileName")
            },
            key=collation_key,
        )
        preview = first_non_empty(message["text"] for message in messages)
        conversations.append(
            {
                "id": item.get("uuid", ""),
                "title": item.get("name") or "未命名对话",
                "summary": item.get("summary") or "",
                "createdAt": item.get("created_at") or "",
                "updatedAt": item.get("updated_at") or item.get("created_at") or "",
                "messageCount": len(messages),
                "attachmentCount": attachments,
                "fileNames": file_names,
                "preview": preview[:260],
                "messages": messages,
            }
        )
    conversations.sort(key=lambda item: item["updatedAt"], reverse=True)
    return conversations


def load_projects(source_dir: Path, memories_raw: Any) -> list[dict[str, Any]]:
    project_memories = {}
    if isinstance(memories_raw, list):
        for memory in memories_raw:
            project_memories.update(memory.get("project_memories") or {})

    projects_dir = source_dir / "projects"
    projects = []
    for path in sorted(projects_dir.glob("*.json")):
        raw = read_json(path, {})
        docs = [
            {
                "id": doc.get("uuid", ""),
                "filename": doc.get("filename") or "未命名文档",
                "content": doc.get("content") or "",
                "createdAt": doc.get("created_at") or "",
            }
            for doc in raw.get("docs") or []
        ]
        project_id = raw.get("uuid", path.stem)
        projects.append(
            {
                "id": project_id,
                "name": raw.get("name") or "未命名项目",
                "description": raw.get("description") or "",
                "isPrivate": bool(raw.get("is_private")),
                "isStarter": bool(raw.get("is_starter_project")),
                "promptTemplate": raw.get("prompt_template") or "",
                "createdAt": raw.get("created_at") or "",
                "updatedAt": raw.get("updated_at") or raw.get("created_at") or "",
                "creatorName": (raw.get("creator") or {}).get("full_name", ""),
                "docs": docs,
                "memory": project_memories.get(project_id, ""),
            }
        )
    projects.sort(key=lambda item: item["updatedAt"], reverse=True)
    return projects


def load_design_chats(source_dir: Path) -> list[dict[str, Any]]:
    chats_dir = source_dir / "design_chats"
    if not chats_dir.exists():
        return []

    chats = []
    for path in sorted(chats_dir.glob("*.json")):
        raw = read_json(path, {})
        project = raw.get("project") or {}
        messages = [normalize_message(message) for message in raw.get("messages") or []]
        chats.append(
            {
                "id": raw.get("uuid", path.stem),
                "title": raw.get("title") or "未命名设计对话",
                "projectId": project.get("uuid", ""),
                "projectName": project.get("name", ""),
                "createdAt": raw.get("created_at") or "",
                "updatedAt": raw.get("updated_at") or raw.get("created_at") or "",
                "preview": first_non_empty(message["text"] for message in messages)[:260],
                "messages": messages,
            }
        )
    chats.sort(key=lambda item: item["updatedAt"], reverse=True)
    return chats


def normalize_message(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": raw.get("uuid", ""),
        "sender": raw.get("sender") or raw.get("role") or "unknown",
        "createdAt": raw.get("created_at") or "",
        "updatedAt": raw.get("updated_at") or "",
        "text": raw.get("text") or text_from_content(raw.get("content") or []),
        "attachments": [normalize_attachment(item) for item in raw.get("attachments") or []],
        "files": [normalize_file(item) for item in raw.get("files") or []],
        "contentItems": [normalize_content_item(item) for item in raw.get("content") or []],
    }


def normalize_attachment(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "fileName": raw.get("file_name") or "",
        "fileSize": raw.get("file_size") or 0,
        "fileType": raw.get("file_type") or "",
        "extractedContent": raw.get("extracted_content") or "",
    }


def normalize_file(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "fileUuid": raw.get("file_uuid") or raw.get("uuid") or "",
        "fileName": raw.get("file_name") or raw.get("filename") or "",
    }


def normalize_content_item(item: Any) -> dict[str, Any]:
    if not isinstance(item, dict):
        return {"type": "unknown", "text": str(item)}

    item_type = item.get("type") or "unknown"
    if item_type == "text":
        return {"type": "text", "text": item.get("text") or ""}
    if item_type == "thinking":
        return {"type": "thinking", "text": item.get("thinking") or item.get("text") or ""}
    if item_type == "tool_use":
        return {
            "type": "tool_use",
            "name": item.get("name") or "",
            "message": item.get("message") or "",
            "input": item.get("input") or {},
        }
    if item_type == "tool_result":
        return {
            "type": "tool_result",
            "name": item.get("name") or "",
            "text": content_to_text(item.get("content")),
            "content": item.get("content"),
        }
    return slim_unknown_content(item)


def slim_unknown_content(item: dict[str, Any]) -> dict[str, Any]:
    result = {"type": item.get("type") or "unknown"}
    for key in ["text", "name", "title", "url", "message"]:
        if key in item:
            result[key] = item[key]
    return result


def text_from_content(items: list[Any]) -> str:
    parts = []
    for item in items:
        if isinstance(item, dict):
            if item.get("type") == "text":
                parts.append(item.get("text") or "")
            elif item.get("type") == "thinking":
                parts.append(item.get("thinking") or "")
    return "\n\n".join(part for part in parts if part)


def content_to_text(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    if isinstance(value, list):
        parts = []
        for item in value:
            if isinstance(item, dict):
                title = item.get("title") or item.get("name") or ""
                url = item.get("url") or ""
                text = item.get("text") or item.get("content") or ""
                parts.append("\n".join(part for part in [title, url, text] if part))
            else:
                parts.append(str(item))
        return "\n\n".join(parts)
    return json.dumps(value, ensure_ascii=False, indent=2)


def normalize_memories(memories_raw: Any, projects: list[dict[str, Any]]) -> dict[str, Any]:
    project_names = {project["id"]: project["name"] for project in projects}
    conversations_memory = ""
    project_memories = {}

    if isinstance(memories_raw, list):
        for memory in memories_raw:
            conversations_memory = conversations_memory or memory.get("conversations_memory") or ""
            project_memories.update(memory.get("project_memories") or {})

    return {
        "conversationsMemory": conversations_memory,
        "projectMemories": [
            {
                "projectId": project_id,
                "projectName": project_names.get(project_id, ""),
                "text": text,
            }
            for project_id, text in sorted(project_memories.items(), key=lambda item: project_names.get(item[0], item[0]))
        ],
    }


def first_value(items: Any, key: str) -> str:
    if isinstance(items, list) and items and isinstance(items[0], dict):
        return items[0].get(key) or ""
    return ""


def first_non_empty(values: Any) -> str:
    for value in values:
        if value:
            return str(value).strip()
    return ""


def collation_key(value: str) -> str:
    return value.casefold()


def slugify(value: str) -> str:
    normalized = re.sub(r"[^\w\u4e00-\u9fff.-]+", "-", value.strip(), flags=re.UNICODE)
    normalized = re.sub(r"-{2,}", "-", normalized).strip("-._")
    return normalized[:80]


if __name__ == "__main__":
    raise SystemExit(main())
