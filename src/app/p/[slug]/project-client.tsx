"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import MdViewer from "@/components/MdViewer";
import MdEditor, { type SaveResult } from "@/components/md/MdEditor";
import ChatPanel from "@/components/chat/ChatPanel";
import TaskSections, { type TaskItem, type TaskSectionKey } from "./task-sections";
import NewTaskModal, { type NewTaskPayload } from "./new-task-modal";
const docs = [
  { key: "dev", label: "개요" },
  { key: "guide", label: "지침" },
  { key: "setting", label: "설정" },
  { key: "proposal", label: "기획서" },
  { key: "tasks", label: "작업" },
  { key: "next", label: "핸드오버" },
];
const sectionKeys: TaskSectionKey[] = ["in-progress", "pending", "done", "failed", "reports"];
const emptyItems = (): Record<TaskSectionKey, TaskItem[]> => ({ "in-progress": [], pending: [], done: [], failed: [], reports: [] });
const emptyOffsets = (): Record<TaskSectionKey, number> => ({ "in-progress": 0, pending: 0, done: 0, failed: 0, reports: 0 });
export default function ProjectClient({ slug }: { slug: string }) {
  const [project, setProject] = useState<{ name: string } | null>(null);
  const [section, setSection] = useState("dev");
  const [content, setContent] = useState("");
  const [etag, setEtag] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [editing, setEditing] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const [toast, setToast] = useState("");
  const [taskItems, setTaskItems] = useState(emptyItems);
  const [taskTotals, setTaskTotals] = useState({ pending: 0, in_progress: 0, done: 0, failed: 0, reports: 0 });
  const [taskOffsets, setTaskOffsets] = useState(emptyOffsets);
  const [openFile, setOpenFile] = useState<string | null>(null);
  const [newTaskOpen, setNewTaskOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(true);
  const [chatWidth, setChatWidth] = useState(420);
  const dragging = useRef(false);
  const skipNextDocumentEvent = useRef(false);
  const loadDoc = useCallback(async (kind: string) => {
    const r = await fetch(`/api/projects/${slug}/docs/${kind}`,{cache:"no-store"});
    if (r.ok) {setContent(await r.text());setEtag(r.headers.get("etag")||"");setUpdatedAt(r.headers.get("x-updated-at")||"");}
  }, [slug]);
  const loadSummary = useCallback(async () => {
    const response = await fetch(`/api/projects/${slug}/tasks/summary`, { cache: "no-store" });
    if (response.ok) setTaskTotals(await response.json());
  }, [slug]);
  const loadTaskSection = useCallback(async (key: TaskSectionKey, offset = taskOffsets[key]) => {
    const endpoint = key === "reports" ? "reports" : `tasks?status=${key}`;
    const separator = endpoint.includes("?") ? "&" : "?";
    const response = await fetch(`/api/projects/${slug}/${endpoint}${separator}limit=${key === "in-progress" ? 50 : 5}&offset=${offset}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    let allItems = body.items as TaskItem[];
    if (key === "in-progress" && allItems.length < body.total) {
      for (let nextOffset = 50; nextOffset < body.total; nextOffset += 50) {
        const next = await fetch(`/api/projects/${slug}/tasks?status=in-progress&limit=50&offset=${nextOffset}`, { cache: "no-store" });
        if (next.ok) allItems = allItems.concat((await next.json()).items);
      }
    }
    setTaskItems((current) => ({ ...current, [key]: allItems }));
  }, [slug, taskOffsets]);
  const refreshTasks = useCallback(async () => {
    await Promise.all([loadSummary(), ...sectionKeys.map((key) => loadTaskSection(key))]);
  }, [loadSummary, loadTaskSection]);
  useEffect(() => {
    fetch(`/api/projects/${slug}`)
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then(setProject)
      .catch(() => (location.href = "/dashboard"));
  }, [slug]);
  useEffect(() => {
    setChatOpen(localStorage.getItem("apms.project.chat.open") !== "false");
    const saved = Number(localStorage.getItem("apms.project.chat.width"));
    if (saved >= 320 && saved <= 720) setChatWidth(saved);
    const requestedSection = localStorage.getItem(`apms.project.section.${slug}`);
    if (requestedSection && docs.some((doc) => doc.key === requestedSection)) {
      setSection(requestedSection);
      localStorage.removeItem(`apms.project.section.${slug}`);
    }
  }, [slug]);
  useEffect(() => {
    if (section === "tasks") void refreshTasks();
    else {
      setOpenFile(null);
      void loadDoc(section);
    }
  }, [section, loadDoc, refreshTasks]);
  useEffect(() => {
    if (section !== "tasks") return;
    const refresh = () => void refreshTasks();
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener("apms:tasks-changed", refresh);
    return () => { window.clearInterval(timer);window.removeEventListener("apms:tasks-changed", refresh); };
  }, [section, refreshTasks]);
  const handleDocumentsChanged = useCallback((changed: string[]) => {
    if (!changed.includes(section)) return;
    if (section === "tasks") {
      void refreshTasks();
      return;
    }
    if (editing) {
      setExternalChange(true);
      return;
    }
    void loadDoc(section);
  }, [editing, loadDoc, refreshTasks, section]);
  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<{ project?: string; changed?: string[] }>).detail;
      if (detail?.project !== slug || !Array.isArray(detail.changed)) return;
      if (skipNextDocumentEvent.current) {
        skipNextDocumentEvent.current = false;
        return;
      }
      handleDocumentsChanged(detail.changed);
    };
    window.addEventListener("dirigo:documents-changed", receive);
    return () => window.removeEventListener("dirigo:documents-changed", receive);
  }, [handleDocumentsChanged, slug]);
  useEffect(() => {
    const move = (event: PointerEvent) => {
      if (!dragging.current) return;
      const width = Math.max(320, Math.min(720, window.innerWidth - event.clientX));
      setChatWidth(width);
    };
    const up = () => { if (dragging.current) { dragging.current=false;localStorage.setItem("apms.project.chat.width",String(chatWidth)); } };
    window.addEventListener("pointermove", move);window.addEventListener("pointerup", up);
    return () => { window.removeEventListener("pointermove", move);window.removeEventListener("pointerup", up); };
  }, [chatWidth]);
  async function save(nextContent:string):Promise<SaveResult> {
    const r=await fetch(`/api/projects/${slug}/docs/${section}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "If-Match":etag },
      body: JSON.stringify({ content:nextContent }),
    });
    const body=await r.json().catch(()=>({}));
    if(!r.ok)return{ok:false,conflict:r.status===409,message:body.message||body.error||"저장하지 못했습니다."};
    setContent(nextContent);setEtag(body.etag);setUpdatedAt(body.updated_at);
    setEditing(false);
    setToast("문서를 저장했습니다.");window.setTimeout(()=>setToast(""),3000);
    return{ok:true,content:nextContent,etag:body.etag,updatedAt:body.updated_at};
  }
  async function createTask(payload: NewTaskPayload): Promise<string | null> {
    const r = await fetch(`/api/projects/${slug}/tasks`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    if (r.ok) {
      setTaskOffsets((current) => ({ ...current, pending: 0 }));
      await Promise.all([loadSummary(), loadTaskSection("pending", 0)]);
      setNewTaskOpen(false);
      return null;
    }
    const body = await r.json().catch(() => ({}));
    return body.error || "작업을 등록하지 못했습니다.";
  }
  async function move(file: string, target: string) {
    const r = await fetch(`/api/projects/${slug}/tasks/${file}/move`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ target }),
    });
    if (r.ok) await refreshTasks();
  }
  async function open(item: TaskItem, itemSection: TaskSectionKey) {
    const prefix = itemSection === "reports" ? "reports" : "tasks";
    const r = await fetch(`/api/projects/${slug}/${prefix}/${item.filename}`);
    if (r.ok) {
      setContent(await r.text());
      setOpenFile(item.filename);
    }
  }
  async function share() {
    const resource = openFile
      ? { project: slug, file: openFile }
      : { project: slug, kind: section };
    const r = await fetch("/api/md/share", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(resource),
    });
    const body = await r.json();
    if (!r.ok) throw new Error(body.error);
    return `${location.origin}${body.url}`;
  }
  function openInChat(task: TaskItem) {
    setChatOpen(true);localStorage.setItem("apms.project.chat.open","true");
    const prompt=`다음 작업지시서를 요약하고 현재 상태와 다음 조치를 알려줘: ${task.filename} — ${task.title}`;
    localStorage.setItem(`apms.chat.prompt.${slug}`,prompt);
    window.dispatchEvent(new CustomEvent("apms:chat-prompt", {detail:{prompt}}));
  }
  return (
    <div className={`project-workspace ${chatOpen ? "chat-open" : "chat-closed"}`} style={{"--chat-width":`${chatWidth}px`} as React.CSSProperties}>
    <main className="project-layout">
      <aside className="project-sidebar">
        <a className="back" href="/dashboard">
          ← 프로젝트
        </a>
        <h1>{project?.name || slug}</h1>
        <nav>
          {docs.map((d) => (
            <button
              className={section === d.key ? "active" : ""}
              key={d.key}
              onClick={() => setSection(d.key)}
            >
              {d.label}
            </button>
          ))}
        </nav>
      </aside>
      <section className={`project-content ${section === "tasks" ? "tasks-active" : ""}`}>
        {toast&&<div className="toast" role="status">{toast}</div>}
        {section !== "tasks" ? (
          <>
            {editing ? (
              <>
                {externalChange && (
                  <div className="document-change-banner" role="alert">
                    채팅이 기획서를 갱신했습니다. 저장 시 충돌이 날 수 있습니다 —{" "}
                    <button type="button" onClick={async()=>{await loadDoc(section);setEditing(false);setExternalChange(false);}}>다시 불러오기</button>
                  </div>
                )}
                <MdEditor title={`${slug}.${section}`} initialContent={content} project={slug} documentPath={`docs/${slug}.${section}.md`} onSave={save} onCancel={()=>{setEditing(false);setExternalChange(false);}} onReload={async()=>{await loadDoc(section);setEditing(false);setExternalChange(false);}} />
              </>
            ) : (
                <MdViewer
                  key={`${section}:${updatedAt}`}
                  content={content}
                  title={`${slug}.${section}`}
                  onShare={share}
                  editable={["guide","next","setting"].includes(section)}
                  onEdit={()=>{setEditing(true);setExternalChange(false);}}
                />
            )}
          </>
        ) : (
          <div className="tasks-view">
            {openFile ? (
              <div className="task-detail-scroll" data-testid="task-detail-scroll">
                <button onClick={() => setOpenFile(null)}>← 목록</button>
                <MdViewer content={content} title={openFile} onShare={share} />
              </div>
            ) : (
              <TaskSections slug={slug} items={taskItems} totals={taskTotals} offsets={taskOffsets} onNewTask={()=>setNewTaskOpen(true)} onMove={(file,target)=>void move(file,target)} onOpen={(item,itemSection)=>void open(item,itemSection)} onOpenInChat={openInChat} onPage={(key,offset)=>{setTaskOffsets((current)=>({...current,[key]:offset}));void loadTaskSection(key,offset);}} />
            )}
          </div>
        )}
      </section>
    </main>
    {newTaskOpen&&<NewTaskModal pendingTasks={taskItems.pending} onClose={()=>setNewTaskOpen(false)} onCreate={createTask} />}
    <button className="chat-collapse" aria-expanded={chatOpen} onClick={()=>{const next=!chatOpen;setChatOpen(next);localStorage.setItem("apms.project.chat.open",String(next));}}>{chatOpen?"챗봇 접기":"챗봇 펴기"}</button>
    {chatOpen&&<aside className="project-chat" data-testid="project-chat-panel"><div className="chat-resizer" onPointerDown={(event)=>{dragging.current=true;event.currentTarget.setPointerCapture(event.pointerId);}}/><ChatPanel projectSlug={slug} layout="panel" onDocumentsChanged={(changed)=>{skipNextDocumentEvent.current=true;handleDocumentsChanged(changed);}} onOpenDocument={setSection} /></aside>}
    </div>
  );
}
