"use client";

import type { FormEvent, KeyboardEvent as ReactKeyboardEvent } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import ModeToggle from "@/app/mode-toggle";
import { formatKstShort, fullIso } from "@/lib/format-time";
import {
  CHAT_PANEL_FULLSCREEN_KEY,
  CHAT_PANEL_WIDTH_KEY,
  DEFAULT_CHAT_PANEL_WIDTH,
  MOBILE_CHAT_BREAKPOINT,
  clampChatPanelWidth,
  restoredChatPanelWidth,
} from "./panel-width";
import { isNearBottom } from "./scroll";
import {
  debounceChatDraft,
  deleteChatDraft,
  readChatDraft,
  writeChatDraft,
} from "./draft-storage";
import "./ChatPanel.css";

export type ChatPanelLayout = "page" | "panel" | "fullscreen";
type Session = {
  id: string;
  title: string;
  project_name?: string;
  status: string;
  context_tokens: number;
  context_limit: number;
  created_at?: string;
  parent_session_id?: string | null;
  handover_number?: number;
  last_message_at?: string;
  continuation?: { id: string; title: string; handover_number: number } | null;
};
type Message = {
  id?: string;
  role: string;
  content: string;
  summary?: string;
  created_at?: string;
  metadata?: {
    cards?: Array<{ card?: string }>;
    changed?: string[];
    tool?: string;
    status?: string;
    duration_ms?: number;
    target?: string;
    url?: string;
  };
};
type LlmStatus = {
  reason: "no_default" | "unreachable" | "auth" | "model_missing" | "ok";
  ok: boolean;
  message: string;
  last_error?: string | null;
  is_admin?: boolean;
};
export function chatSessionStorageKey(projectSlug?: string) {
  return `apms.chat.session.${projectSlug || "global"}`;
}

function ToolMessageGroup({ messages }: { messages: Message[] }) {
  return (
    <div className="tool-message-group" aria-label="도구 호출 내역">
      {messages.map((message, index) => {
        const metadata = message.metadata || {};
        const failed = metadata.status === "error";
        const duration = Math.max(0, Number(metadata.duration_ms || 0));
        const target = metadata.target || metadata.url;
        return (
          <details
            className={`tool-message ${failed ? "tool-message-error" : ""}`}
            key={message.id || `tool-${index}`}
          >
            <summary>
              <span aria-hidden="true">🔧</span>
              <strong>{metadata.tool || "tool"}</strong>
              <span aria-label={failed ? "실패" : "성공"}>{failed ? "✗" : "✓"}</span>
              <span>{(duration / 1000).toFixed(1)}s</span>
              {target && <span className="tool-message-target">— {target}</span>}
            </summary>
            <p>{message.summary || "도구 실행 결과"}</p>
          </details>
        );
      })}
    </div>
  );
}

function SessionPicker({
  sessions,
  active,
  onOpen,
  onCreate,
  onRename,
  onDelete,
}: {
  sessions: Session[];
  active: Session | null;
  onOpen: (s: Session) => void;
  onCreate: () => void;
  onRename: (s: Session, t: string) => Promise<void>;
  onDelete: (s: Session) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false),
    [editing, setEditing] = useState<string | null>(null),
    [title, setTitle] = useState("");
  return (
    <div className="session-picker">
      <button
        className="session-picker-toggle"
        aria-expanded={expanded}
        title={active?.title || "세션 선택"}
        onClick={() => setExpanded((v) => !v)}
      >
        <span className="session-title">{active?.title || "세션 선택"}</span>
        <span className="session-picker-caret" aria-hidden="true">▾</span>
      </button>
      {expanded && (
        <div className="session-menu" role="menu">
          <button
            className="session-create"
            onClick={() => {
              setExpanded(false);
              onCreate();
            }}
          >
            ＋ 새 채팅
          </button>
          {sessions.map((session) => (
            <div
              className={`session-menu-item ${active?.id === session.id ? "active" : ""}`}
              key={session.id}
            >
              {editing === session.id ? (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void onRename(session, title).then(() => setEditing(null));
                  }}
                >
                  <input
                    autoFocus
                    maxLength={120}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                    aria-label="세션 이름"
                  />
                  <button disabled={!title.trim()}>저장</button>
                  <button type="button" onClick={() => setEditing(null)}>
                    취소
                  </button>
                </form>
              ) : (
                <>
                  <button
                    className="session-open"
                    role="menuitem"
                    onClick={() => {
                      setExpanded(false);
                      onOpen(session);
                    }}
                  >
                    <span>{session.title}</span>
                    <small
                      title={
                        session.last_message_at
                          ? fullIso(session.last_message_at)
                          : ""
                      }
                    >
                      {session.last_message_at
                        ? formatKstShort(session.last_message_at)
                        : ""}
                    </small>
                    {session.status === "handed_over" && <em>종료</em>}
                  </button>
                  <div className="session-item-actions">
                    <button
                      onClick={() => {
                        setEditing(session.id);
                        setTitle(session.title);
                      }}
                    >
                      이름 변경
                    </button>
                    <button onClick={() => void onDelete(session)}>삭제</button>
                  </div>
                </>
              )}
            </div>
          ))}
          {!sessions.length && (
            <p className="session-menu-empty">저장된 세션이 없습니다.</p>
          )}
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({
  projectSlug,
  layout,
  user,
  llmConfigured = true,
  initialPrompt = "",
  onDocumentsChanged,
  onOpenDocument,
}: {
  projectSlug?: string;
  layout: ChatPanelLayout;
  user?: { email: string; role: string };
  llmConfigured?: boolean;
  initialPrompt?: string;
  onDocumentsChanged?: (changed: string[]) => void;
  onOpenDocument?: (section: string) => void;
}) {
  const router = useRouter();
  const [sessions, setSessions] = useState<Session[]>([]),
    [projectTitle, setProjectTitle] = useState(""),
    [active, setActive] = useState<Session | null>(null),
    [messages, setMessages] = useState<Message[]>([]),
    [input, setInput] = useState(initialPrompt),
    [busy, setBusy] = useState(false),
    [showLatest, setShowLatest] = useState(false),
    [unreadMessages, setUnreadMessages] = useState(0),
    [copiedMessage, setCopiedMessage] = useState<string | null>(null),
    [notice, setNotice] = useState(""),
    [llmStatus, setLlmStatus] = useState<LlmStatus | null>(
      llmConfigured
        ? null
        : {
            reason: "no_default",
            ok: false,
            message: "기본 LLM 연결이 지정되지 않았습니다.",
          },
    );
  const activeId = active?.id;
  const root = useRef<HTMLElement>(null),
    conversation = useRef<HTMLDivElement>(null),
    bottom = useRef<HTMLDivElement>(null),
    nearBottom = useRef(true),
    forceNextScroll = useRef(false),
    previousMessages = useRef<Message[]>([]),
    copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null),
    inputRef = useRef<HTMLTextAreaElement>(null),
    currentInput = useRef(initialPrompt),
    pendingExternalPrompt = useRef(initialPrompt),
    restoredDraftSession = useRef<string | null>(null),
    dragging = useRef(false),
    width = useRef(DEFAULT_CHAT_PANEL_WIDTH);
  const load = useCallback(async () => {
    const q = projectSlug
      ? `?project_slug=${encodeURIComponent(projectSlug)}`
      : "";
    const r = await fetch(`/api/sessions${q}`);
    if (r.ok) setSessions((await r.json()).items);
  }, [projectSlug]);
  const open = useCallback(
    async (session: Session) => {
      const r = await fetch(`/api/sessions/${session.id}`);
      if (!r.ok) return;
      const data = await r.json(),
        opened = { ...session, ...data.session };
      forceNextScroll.current = true;
      setActive(opened);
      setMessages(data.messages);
      setNotice("");
      localStorage.setItem(chatSessionStorageKey(projectSlug), opened.id);
    },
    [projectSlug],
  );
  useEffect(() => {
    let stopped = false;
    const refresh = async () => {
      const r = await fetch("/api/llm/status", { cache: "no-store" });
      if (r.ok && !stopped) setLlmStatus(await r.json());
    };
    void refresh();
    const timer = setInterval(() => void refresh(), 60_000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => {
    if (!projectSlug) return;
    void fetch(`/api/projects/${encodeURIComponent(projectSlug)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((p) => setProjectTitle(p?.name || projectSlug));
    const draft = localStorage.getItem(`apms.chat.prompt.${projectSlug}`);
    if (draft) {
      pendingExternalPrompt.current = draft;
      currentInput.current = draft;
      setInput(draft);
      localStorage.removeItem(`apms.chat.prompt.${projectSlug}`);
    }
  }, [projectSlug]);
  useEffect(() => {
    if (!activeId) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    const restored =
      pendingExternalPrompt.current || readChatDraft(sessionStorage, activeId);
    pendingExternalPrompt.current = "";
    restoredDraftSession.current = activeId;
    currentInput.current = restored;
    setInput(restored);
  }, [activeId]);
  useEffect(() => {
    if (!activeId) return;
    if (restoredDraftSession.current !== activeId) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = debounceChatDraft(sessionStorage, activeId, input);
  }, [activeId, input]);
  useEffect(() => {
    if (!activeId) return;
    return () => {
      if (draftTimer.current) clearTimeout(draftTimer.current);
      writeChatDraft(sessionStorage, activeId, currentInput.current);
    };
  }, [activeId]);
  useEffect(() => {
    if (!sessions.length || active) return;
    const saved = localStorage.getItem(chatSessionStorageKey(projectSlug));
    void open(sessions.find((s) => s.id === saved) || sessions[0]);
  }, [active, open, projectSlug, sessions]);
  useEffect(() => {
    const previous = previousMessages.current;
    const changed =
      messages.length !== previous.length ||
      (messages.at(-1)?.content || messages.at(-1)?.summary) !==
        (previous.at(-1)?.content || previous.at(-1)?.summary);
    previousMessages.current = messages;
    if (!changed && !notice) return;
    if (forceNextScroll.current || nearBottom.current) {
      forceNextScroll.current = false;
      bottom.current?.scrollIntoView({ behavior: "smooth" });
      nearBottom.current = true;
      setShowLatest(false);
      setUnreadMessages(0);
      return;
    }
    setShowLatest(true);
    setUnreadMessages((count) =>
      count + Math.max(1, messages.length - previous.length),
    );
  }, [messages, notice]);
  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    },
    [],
  );
  useEffect(() => {
    const receive = (event: Event) => {
      const prompt = (event as CustomEvent<{ prompt: string }>).detail?.prompt;
      if (prompt) {
        pendingExternalPrompt.current = active ? "" : prompt;
        currentInput.current = prompt;
        setInput(prompt);
        if (projectSlug)
          localStorage.removeItem(`apms.chat.prompt.${projectSlug}`);
      }
    };
    window.addEventListener("apms:chat-prompt", receive);
    return () => window.removeEventListener("apms:chat-prompt", receive);
  }, [active, projectSlug]);
  useEffect(() => {
    if (
      layout === "panel" &&
      projectSlug &&
      (window.innerWidth <= MOBILE_CHAT_BREAKPOINT ||
        localStorage.getItem(CHAT_PANEL_FULLSCREEN_KEY) === "true")
    )
      router.replace(`/p/${projectSlug}/chat`);
    if (layout !== "fullscreen") return;
    localStorage.setItem(CHAT_PANEL_FULLSCREEN_KEY, "true");
    const escape = (event: KeyboardEvent) => {
      if (
        event.key === "Escape" &&
        window.innerWidth > MOBILE_CHAT_BREAKPOINT
      ) {
        localStorage.setItem(CHAT_PANEL_FULLSCREEN_KEY, "false");
        router.push(`/p/${projectSlug}`);
      }
    };
    window.addEventListener("keydown", escape);
    return () => window.removeEventListener("keydown", escape);
  }, [layout, projectSlug, router]);
  useEffect(() => {
    if (layout !== "panel") return;
    const workspace = root.current?.closest<HTMLElement>(".project-workspace");
    const apply = (next: number) => {
      width.current = clampChatPanelWidth(next, window.innerWidth);
      workspace?.style.setProperty("--chat-width", `${width.current}px`);
    };
    apply(
      restoredChatPanelWidth(
        localStorage.getItem(CHAT_PANEL_WIDTH_KEY),
        window.innerWidth,
      ),
    );
    const move = (e: PointerEvent) => {
      if (dragging.current && window.innerWidth > MOBILE_CHAT_BREAKPOINT)
        apply(window.innerWidth - e.clientX);
    };
    const up = () => {
      if (!dragging.current) return;
      dragging.current = false;
      localStorage.setItem(CHAT_PANEL_WIDTH_KEY, String(width.current));
      document.body.classList.remove("chat-panel-dragging");
    };
    const resize = () => apply(width.current);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("resize", resize);
    };
  }, [layout]);
  async function create() {
    // project_slug:projectSlug is the project/session binding contract.
    const r = await fetch("/api/sessions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(projectSlug ? { project_slug: projectSlug } : {}),
    });
    if (!r.ok) return;
    const session = await r.json();
    setSessions((v) => [session, ...v]);
    await open(session);
  }
  async function rename(session: Session, title: string) {
    const r = await fetch(`/api/sessions/${session.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title }),
    });
    if (!r.ok) return;
    const updated = await r.json();
    setSessions((v) =>
      v.map((s) => (s.id === updated.id ? { ...s, ...updated } : s)),
    );
    setActive((v) => (v?.id === updated.id ? { ...v, ...updated } : v));
  }
  async function remove(session: Session) {
    if (!confirm(`“${session.title}” 세션과 메시지를 삭제할까요?`)) return;
    const r = await fetch(`/api/sessions/${session.id}`, { method: "DELETE" });
    if (!r.ok) return;
    const remaining = sessions.filter((s) => s.id !== session.id);
    setSessions(remaining);
    if (active?.id === session.id) {
      setActive(null);
      setMessages([]);
      localStorage.removeItem(chatSessionStorageKey(projectSlug));
      if (remaining[0]) await open(remaining[0]);
      else await create();
    }
  }
  async function send() {
    const text = input.trim();
    if (!text || !active || active.status !== "active" || busy) return;
    const sentSessionId = active.id;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    currentInput.current = "";
    setInput("");
    deleteChatDraft(sessionStorage, sentSessionId);
    setBusy(true);
    forceNextScroll.current = true;
    const optimistic = `pending-${Date.now()}`;
    setMessages((v) => [
      ...v,
      {
        id: optimistic,
        role: "user",
        content: text,
        created_at: new Date().toISOString(),
      },
    ]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ session_id: sentSessionId, message: text }),
      });
      if (!r.ok) {
        const e = await r
          .json()
          .catch(() => ({ error: "요청을 처리하지 못했습니다" }));
        setNotice(e.error || "요청을 처리하지 못했습니다");
        if (e.code)
          setLlmStatus({
            reason: e.code,
            ok: false,
            message: String(e.error).replace(/^LLM 연결 (필요|불가):\s*/, ""),
            last_error: e.last_error,
            is_admin: llmStatus?.is_admin,
          });
        return;
      }
      const raw = await r.text();
      let shouldReloadSessions = false;
      for (const line of raw.split("\n"))
        if (line.startsWith("data: ")) {
          const data = JSON.parse(line.slice(6));
          if (!data.content) continue;
          setMessages((v) => [
            ...v.map((message) =>
              message.id === optimistic
                ? { ...message, created_at: data.user_created_at }
                : message,
            ),
            {
              role: "assistant",
              content: data.content,
              created_at: data.created_at,
              metadata: { cards: data.cards, changed: data.changed },
            },
          ]);
          if (Array.isArray(data.changed) && data.changed.length) {
            onDocumentsChanged?.(data.changed);
            window.dispatchEvent(
              new CustomEvent("dirigo:documents-changed", {
                detail: { project: projectSlug, changed: data.changed },
              }),
            );
          }
          setActive(
            (v) =>
              v && {
                ...v,
                title: data.session?.title || v.title,
                context_tokens: data.usage.tokens,
                context_limit: data.usage.limit,
              },
          );
          if (data.session?.title)
            setSessions((v) => v.map((session) => session.id === data.session.id ? { ...session, title: data.session.title } : session));
          if (data.cards?.length)
            window.dispatchEvent(new CustomEvent("apms:tasks-changed"));
          if (data.handover) {
            shouldReloadSessions = true;
            setNotice(data.handover.notice);
            setActive(data.handover.session);
            localStorage.setItem(
              chatSessionStorageKey(projectSlug),
              data.handover.session.id,
            );
          }
        }
      if (shouldReloadSessions) await load();
      if (!currentInput.current) deleteChatDraft(sessionStorage, sentSessionId);
    } catch {
      setNotice("요청을 처리하지 못했습니다");
    } finally {
      setBusy(false);
      if (!currentInput.current) inputRef.current?.focus();
    }
  }
  function handleConversationScroll() {
    if (!conversation.current) return;
    const nextNearBottom = isNearBottom(conversation.current);
    nearBottom.current = nextNearBottom;
    setShowLatest(!nextNearBottom);
    if (nextNearBottom) setUnreadMessages(0);
  }
  function scrollToLatest() {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
    nearBottom.current = true;
    setShowLatest(false);
    setUnreadMessages(0);
  }
  function openDocument(section: string) {
    if (layout === "fullscreen" && projectSlug) {
      localStorage.setItem(CHAT_PANEL_FULLSCREEN_KEY, "false");
      localStorage.setItem(`apms.project.section.${projectSlug}`, section);
      router.push(`/p/${projectSlug}`);
      return;
    }
    onOpenDocument?.(section);
  }
  async function copyMessage(content: string, key: string) {
    let copied = false;
    try {
      await navigator.clipboard.writeText(content);
      copied = true;
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.setAttribute("readonly", "");
      textarea.className = "clipboard-fallback";
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand("copy");
      textarea.remove();
    }
    if (!copied) return;
    setCopiedMessage(key);
    if (copyResetTimer.current) clearTimeout(copyResetTimer.current);
    copyResetTimer.current = setTimeout(() => setCopiedMessage(null), 1500);
  }
  function submitComposer(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    void send();
  }
  function handleComposerKeyDown(
    event: ReactKeyboardEvent<HTMLTextAreaElement>,
  ) {
    const native = event.nativeEvent as KeyboardEvent & {
      isComposing?: boolean;
      keyCode?: number;
    };
    if (native.isComposing || native.keyCode === 229) return;
    if (event.key === "Enter" && !event.shiftKey) {
      if (busy) return;
      event.preventDefault();
      void send();
    }
  }
  const resetWidth = () => {
    width.current = clampChatPanelWidth(
      DEFAULT_CHAT_PANEL_WIDTH,
      window.innerWidth,
    );
    root.current
      ?.closest<HTMLElement>(".project-workspace")
      ?.style.setProperty("--chat-width", `${width.current}px`);
    localStorage.setItem(CHAT_PANEL_WIDTH_KEY, String(width.current));
  };
  const readOnly = active?.status === "handed_over",
    ratio = active
      ? Math.min(
          100,
          Math.round(
            (Number(active.context_tokens || 0) /
              Number(active.context_limit || 1)) *
              100,
          ),
        )
      : 0,
    projectName =
      active?.project_name || projectTitle || projectSlug || "전체 채팅";
  return (
    <main
      ref={root}
      className={`chat-app chat-${layout}`}
      data-chat-panel={layout}
    >
      {layout === "panel" && (
        <div
          className="chat-panel-resizer"
          data-testid="chat-panel-resizer"
          role="separator"
          aria-orientation="vertical"
          aria-label="채팅 패널 폭 조절"
          onPointerDown={() => {
            dragging.current = true;
            document.body.classList.add("chat-panel-dragging");
          }}
          onDoubleClick={resetWidth}
        />
      )}
      <div className="chat-main">
        <header className="chat-sticky-header">
          <div className="chat-session-heading chat-header-title">
            <span className="project-context">{projectName}</span>
            <SessionPicker
              sessions={sessions}
              active={active}
              onOpen={open}
              onCreate={create}
              onRename={rename}
              onDelete={remove}
            />
            {active && (
              <div className="usage">
                <span>
                  사용량 {ratio}% (
                  {Number(active.context_tokens).toLocaleString()}/
                  {Number(active.context_limit).toLocaleString()})
                </span>
                <i>
                  <em style={{ width: `${ratio}%` }} />
                </i>
              </div>
            )}
          </div>
          <div className="chat-header-actions">
            {layout === "panel" && (
              <button
                onClick={() => {
                  localStorage.setItem(CHAT_PANEL_FULLSCREEN_KEY, "true");
                  router.push(`/p/${projectSlug}/chat`);
                }}
              >
                전체화면
              </button>
            )}
            {layout === "fullscreen" && (
              <button
                className="panel-return"
                onClick={() => {
                  localStorage.setItem(CHAT_PANEL_FULLSCREEN_KEY, "false");
                  router.push(`/p/${projectSlug}`);
                }}
              >
                패널로
              </button>
            )}
            {layout === "page" && user && (
              <ModeToggle admin={user.role === "admin"} />
            )}
          </div>
        </header>
        <div className="conversation-shell">
        <div
          className="conversation"
          ref={conversation}
          onScroll={handleConversationScroll}
        >
          {!active && (
            <div className="empty">
              <h1>무엇을 만들어 볼까요?</h1>
              <p>새 채팅을 만들고 작업지시서를 발주하세요.</p>
              <button
                className="new-chat central"
                onClick={() => void create()}
              >
                ＋ 새 채팅
              </button>
            </div>
          )}
          {active?.parent_session_id && (
            <div className="handover-divider" data-testid="handover-divider">
              핸드오버 #{active.handover_number} ·{" "}
              {formatKstShort(active.created_at || new Date())}
            </div>
          )}
          {messages.map((message, index) => {
            const messageKey = message.id || `${message.role}-${index}`;
            if (message.role === "tool") {
              if (messages[index - 1]?.role === "tool") return null;
              const nextNonTool = messages.findIndex(
                (candidate, candidateIndex) =>
                  candidateIndex > index && candidate.role !== "tool",
              );
              const group = messages.slice(
                index,
                nextNonTool === -1 ? messages.length : nextNonTool,
              );
              return <ToolMessageGroup messages={group} key={`tool-group-${messageKey}`} />;
            }
            if (message.role !== "user" && message.role !== "assistant") return null;
            const streamingAssistant =
              busy &&
              message.role === "assistant" &&
              index === messages.length - 1;
            return (
              <article className={message.role} key={messageKey}>
                {(message.role === "user" || message.role === "assistant") && (
                  <button
                    type="button"
                    className="message-copy"
                    aria-label={
                      copiedMessage === messageKey ? "복사됨" : "메시지 복사"
                    }
                    disabled={streamingAssistant}
                    onClick={() => void copyMessage(message.content, messageKey)}
                  >
                    {copiedMessage === messageKey ? "복사됨" : "⧉"}
                  </button>
                )}
              {message.role === "assistant" ? (
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeHighlight]}
                >
                  {message.content}
                </ReactMarkdown>
              ) : (
                <p>{message.content}</p>
              )}
              {message.metadata?.cards?.map((card, j) => (
                <div className="task-card" key={j}>
                  ✓ {card.card}
                </div>
              ))}
              {message.role === "assistant" &&
                Boolean(message.metadata?.changed?.length) && (
                  <div className="message-document-links">
                    {message.metadata?.changed?.includes("proposal") && (
                      <button type="button" onClick={() => openDocument("proposal")}>
                        기획서 보기
                      </button>
                    )}
                    {message.metadata?.changed?.includes("tasks") && (
                      <button type="button" onClick={() => openDocument("tasks")}>
                        작업 보기
                      </button>
                    )}
                  </div>
                )}
              {message.created_at && (
                <time
                  className="message-time"
                  dateTime={fullIso(message.created_at)}
                  title={fullIso(message.created_at)}
                >
                  {formatKstShort(message.created_at)}
                </time>
              )}
              </article>
            );
          })}
          {readOnly && (
            <div className="handover">
              종료된 세션입니다.{" "}
              {active.continuation && (
                <button
                  onClick={() => {
                    const next = sessions.find(
                      (s) => s.id === active.continuation?.id,
                    );
                    if (next) void open(next);
                  }}
                >
                  핸드오버 #{active.continuation.handover_number}로 이어짐
                </button>
              )}
            </div>
          )}
          {notice && <div className="handover">{notice}</div>}
          <div ref={bottom} />
        </div>
        {showLatest && (
          <button
            type="button"
            className="scroll-to-latest"
            aria-label="최신 메시지로 이동"
            onClick={scrollToLatest}
          >
            <span aria-hidden="true">↓</span>
            <span>최신으로</span>
            {unreadMessages > 0 && (
              <span
                className="new-message-badge"
                aria-label={`새 메시지 ${unreadMessages}개`}
              >
                {unreadMessages}
              </span>
            )}
          </button>
        )}
        </div>
        <div className="composer-area">
          {llmStatus && !llmStatus.ok && (
            <div
              className="llm-status-banner"
              role="alert"
              data-reason={llmStatus.reason}
            >
              <strong>
                {llmStatus.reason === "no_default"
                  ? "LLM 연결 필요"
                  : "LLM 연결 불가"}
                : {llmStatus.message}
              </strong>
              {llmStatus.is_admin || user?.role === "admin" ? (
                <a href="/admin">LLM 연결 관리</a>
              ) : (
                <span>관리자에게 문의</span>
              )}
            </div>
          )}
          <form className="composer" onSubmit={submitComposer}>
            <textarea
              ref={inputRef}
              disabled={!active || readOnly}
              value={input}
              placeholder={
                !active
                  ? "먼저 새 채팅을 만드세요"
                  : readOnly
                    ? "종료된 세션은 읽기 전용입니다"
                    : "메시지를 입력하세요"
              }
              onChange={(e) => {
                currentInput.current = e.target.value;
                setInput(e.target.value);
              }}
              onKeyDown={handleComposerKeyDown}
            />
            <button
              type="submit"
              disabled={!active || readOnly || busy || !input.trim()}
              aria-disabled={!active || readOnly || busy || !input.trim()}
              title={busy ? "응답 생성 중 — 완료 후 전송할 수 있습니다" : "전송"}
            >
              {busy ? "…" : "↑"}
            </button>
          </form>
          <p className="composer-status" aria-live="polite">
            {busy ? "응답 생성 중 — 완료 후 전송할 수 있습니다" : ""}
          </p>
        </div>
      </div>
    </main>
  );
}
