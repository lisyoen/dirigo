import { apiError, requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

type StoredMessage = {
  id: string;
  role: string;
  content: string;
  tokens?: number;
  metadata?: Record<string, unknown> | null;
  created_at: string;
};

function object(value: unknown): Record<string, any> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function summarizeSessionMessage(message: StoredMessage) {
  if (message.role !== "tool") return message;
  const stored = object(message.metadata);
  let output: Record<string, any> = {};
  try {
    output = object(JSON.parse(message.content));
  } catch {}

  const tool = text(stored.tool) || "unknown_tool";
  const status =
    stored.status === "error" || output.ok === false || Boolean(output.error)
      ? "error"
      : "ok";
  const metadata: Record<string, unknown> = {
    tool,
    status,
    duration_ms: Number.isFinite(Number(stored.duration_ms))
      ? Number(stored.duration_ms)
      : 0,
  };
  if (text(stored.target)) metadata.target = text(stored.target);
  else if (typeof stored.url === "string") metadata.url = stored.url;

  let summary: string;
  if (status === "error") {
    summary = [text(output.error) || "tool_error", text(output.message)]
      .filter(Boolean)
      .join(" — ");
  } else if (tool === "fetch_url") {
    summary = [text(output.title) || "제목 없음", text(output.finalUrl) || text(output.url) || text(stored.target)]
      .filter(Boolean)
      .join(" — ");
  } else if (tool === "web_search") {
    const query = text(output.query) || text(stored.target) || "검색";
    summary = `${query} — 결과 ${Array.isArray(output.results) ? output.results.length : 0}건`;
  } else if (tool === "append_planning") {
    const count = Array.isArray(output.added) ? output.added.length : 0;
    summary = `${text(output.section) || "기획 절"} — 추가 ${count}건`;
  } else if (tool === "create_task") {
    summary = text(output.card) || text(output.task?.title) || "작업지시서 발주됨";
  } else {
    summary = `${tool} 실행 완료`;
  }

  return {
    role: "tool",
    id: message.id,
    created_at: message.created_at,
    metadata,
    summary,
  };
}

async function ownedSession(id: string, userId: string) {
  const result = await db.query("SELECT * FROM sessions WHERE id=$1", [id]);
  if (!result.rows[0])
    return { error: new Response("Not found", { status: 404 }) };
  if (result.rows[0].user_id !== userId)
    return { error: new Response("Forbidden", { status: 403 }) };
  return { session: result.rows[0] };
}

export async function GET(
  _req: Request,
  ctx: RouteContext<"/api/sessions/[id]">,
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const owned = await ownedSession(id, user.id);
    if (owned.error) return owned.error;
    const messages = await db.query(
      "SELECT id,role,content,tokens,metadata,created_at FROM messages WHERE session_id=$1 AND role<>'system' ORDER BY created_at",
      [id],
    );
    const continuation = await db.query(
      `WITH RECURSIVE ancestors AS (
         SELECT id,parent_session_id,1 AS depth FROM sessions WHERE id=$1
         UNION ALL SELECT s.id,s.parent_session_id,a.depth+1 FROM sessions s JOIN ancestors a ON s.id=a.parent_session_id
       ) SELECT child.id,child.title,child.created_at,(SELECT max(depth)+1 FROM ancestors) handover_number
       FROM sessions child WHERE child.parent_session_id=$1 ORDER BY child.created_at LIMIT 1`,
      [id],
    );
    const handover = await db.query(
      `WITH RECURSIVE ancestors AS (SELECT id,parent_session_id,1 depth FROM sessions WHERE id=$1 UNION ALL SELECT s.id,s.parent_session_id,a.depth+1 FROM sessions s JOIN ancestors a ON s.id=a.parent_session_id) SELECT max(depth) handover_number FROM ancestors`,
      [id],
    );
    return Response.json({
      session: {
        ...owned.session,
        handover_number: Number(handover.rows[0].handover_number),
        continuation: continuation.rows[0] || null,
      },
      messages: messages.rows.map(summarizeSessionMessage),
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function PATCH(
  req: Request,
  ctx: RouteContext<"/api/sessions/[id]">,
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const owned = await ownedSession(id, user.id);
    if (owned.error) return owned.error;
    const body = await req.json();
    const title =
      typeof body.title === "string"
        ? body.title.replace(/\s+/g, " ").trim().slice(0, 120)
        : "";
    if (!title)
      return Response.json({ error: "title이 필요합니다." }, { status: 400 });
    const result = await db.query(
      "UPDATE sessions SET title=$2 WHERE id=$1 RETURNING *",
      [id, title],
    );
    return Response.json(result.rows[0]);
  } catch (error) {
    return apiError(error);
  }
}

export async function DELETE(
  _req: Request,
  ctx: RouteContext<"/api/sessions/[id]">,
) {
  try {
    const user = await requireUser();
    const { id } = await ctx.params;
    const owned = await ownedSession(id, user.id);
    if (owned.error) return owned.error;
    await db.query("DELETE FROM sessions WHERE id=$1", [id]);
    return new Response(null, { status: 204 });
  } catch (error) {
    return apiError(error);
  }
}
