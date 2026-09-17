# Dirigo REST API design

## 1. Common Agreement

*Implementation status: partial*

The default path is`/api/v1 `and use JSON. During the P2 dashboard transition period, the`/api/projects`, `/api/md/share` non-version paths outlined in issue # 003 will first be provided, and the `/api/v1` alias will be added in the backwards compatibility hierarchy.
Only the original Markdown download returns` text/markdown `.
Authentication is a HttpOnly, Secure, SameSite cookie-based session.
The average user views only their own resources, while the administrator views the specified administrative resources.

| Items | Rules |
|---|---|
| ID | UUID string |
| Time | ISO 8601 UTC |
| page | `cursor`, `limit` default 20 up to 100 |
| Idempotency | `Idempotency-Key` recommended for creation requests |
| Error | code, message, details, request_id |
| Version | URL major version |

```json
{
  "error": {
    "code": "validation_error",
"message": "Please confirm your request.",
"details": [{"field": "timeout_min", "reason": "Must be at least 1."}],
    "request_id": "req_example"
  }
}
```

The major status codes are 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500.
Unauthorized and other non-existent user resources may unify to 404 to prevent information disclosure.

## 2. Endpoint Summary

*Implementation status: partial*

| Method | Path | Permissions | Description |
|---|---|---|---|
| post | `/auth/login` | Public | Login |
| post | `/auth/logout` | user | Logout |
| get | `/auth/me` | user | Current account |
| get | `/users` | admin | User list |
| post | `/users` | admin | Create user |
| patch | `/users/{userId}` | admin | Change role/status |
| delete | `/users/{userId}` | admin | Deactivate user |
| get | `/projects` | user | Project list/card data |
| post | `/projects` | user | Create Project |
| get | `/projects/{projectId}` | user | Project details |
| patch | `/projects/{projectId}` | user | Edit name · view mode |
| delete | `/projects/{projectId}` | user | project archive |
| get | `/projects/{projectId}/tasks` | user | Task list by status |
| get | `/projects/{projectId}/tasks/summary` | user | Task and report counts |
| get | `/projects/{projectId}/reports` | user | Report list |
| post | `/projects/{projectId}/tasks/from-chat` | user | Chatbot Order |
| post | `/tasks/{taskId}/move` | user | Allowed state transitions |
| get | `/tasks/{taskId}/report` | user | Latest reports |
| get | `/workers/status` | admin | worker · cue status |
| get | `/workers/config` | admin | worker Settings |
| patch | `/workers/config` | admin | Change worker Settings |
| get | `/usage` | user | Self Usage |
| get | `/admin/usage` | admin | Total usage |
| get | `/llm-connections` | admin | Connections list |
| post | `/llm-connections` | admin | Create connection |
| patch | `/llm-connections/{id}` | admin | Edit connection |
| delete | `/llm-connections/{id}` | admin | Disable connection |
| get | `/settings` | user | Account Settings |
| put | `/settings/{key}` | user | Account settings upsert |
| delete | `/settings/{key}` | user | Delete account settings |
| get | `/md` | user | View Markdown |
| post | `/md/share-links` | user | Create share link |
| delete | `/md/share-links/{id}` | user | Revoke share link |
| get | `/md/download` | user/share | Markdown Download |
| get | `/chat/sessions?project_slug={slug}` | user | List sessions restricted to an owned project |
| post | `/chat/sessions` | user | Create a session; `project_slug` binds it to an owned project |
| get | `/sessions?project_slug={slug}` | user | List project sessions, or projectless sessions when omitted |
| post | `/sessions` | user | Create a project-bound or projectless chat session |
| patch | `/sessions/{id}` | owner | Rename a chat session |
| delete | `/sessions/{id}` | owner | Delete a session and cascade-delete its messages |
| post | `/admin/llm-connections/{id}` | admin | Test a connection and return its final request URL |
| get/put | `/api/config[?project=slug]` | admin/project owner | Effective configuration / conditional apply |
| get | `/api/config/raw[?project=slug]` | admin/project owner | Raw scoped YAML |
| post | `/api/config/validate[?project=slug]` | admin/project owner | Validate YAML |
| post | `/api/config/diff[?project=slug]` | admin/project owner | Leaf-level diff |

### Configuration API

Global requests require admin; project-scoped requests require that project's owner. `GET /api/config` returns `{config,sources,warnings,hash}` with secrets masked and an ETag. Raw returns YAML and its ETag. Validate and diff accept `application/yaml` text or `{"yaml":"..."}`. `PUT` accepts the same body and `If-Match: <sha256>`; invalid YAML returns 400 with `errors`, stale hashes return 409, and success returns effective values, sources, new hash, and changes. Responses are not cached.

### Chat panel and LLM URL behavior

*Implementation status: implemented*

Project chat clients send `project_slug` instead of accepting a freely selected project ID. The server resolves ownership and stores the resulting `project_id`. OpenAI and compatible connection base URLs are stored without trailing slashes or a trailing `/v1`; calls append exactly `/v1/chat/completions`. Connection tests return `url` alongside the abbreviated model response.

### Project chat web tools

*Implementation status: implemented*

`fetch_url` input is `{"url":"https://example.com/page"}` and success is `{"url":"...","finalUrl":"...","title":"...","text":"...","truncated":false}`. Only public HTTP(S) HTML is accepted. The reader allows three redirects, 10 seconds, 2 MB of response bytes, and 8,000 extracted text characters. Its stable user messages are `URL 읽기 실패 — 접속 오류`, `URL 읽기 실패 — 타임아웃(10초)`, `URL 읽기 실패 — 차단(403·429)`, `URL 읽기 실패 — 지원하지 않는 형식`, and `URL 읽기 실패 — 차단된 주소(내부망)`; redirect and size limits are reported separately.

`web_search` input is `{"query":"...","count":5}` where `count` is clamped to 1–5. Success contains `query`, selected `language`, `unresponsiveEngines`, and `results: [{"title":"...","url":"...","snippet":"...","engine":"..."}]`. It is exposed only when `DIRIGO_SEARXNG_URL` exists and is limited to five calls per session per minute. Stable failures are `검색 실패 — SearXNG 연결 불가`, `검색 실패 — 결과 없음(응답 엔진 n개)`, and `검색 실패 — 요청 한도 초과`.

The chat handler executes at most three tool rounds, injects each result as untrusted system context, then creates a final answer. Every tool message reuses the existing `messages.metadata` JSONB with `tool`, `tool_call_id`, `target`, `status`, and `duration_ms`. Successful web answers include a final `출처:` URL list; planning entries and task bodies keep the same sources when those operations are combined.

### Chat session lifecycle

*Implementation status: implemented*

`GET /api/sessions` returns only projectless sessions; adding `project_slug` returns sessions for that owned project. Results are ordered by the most recent message time and include `last_message_at`. `PATCH /api/sessions/{id}` accepts `{"title":"..."}` and normalizes whitespace. `DELETE` returns 204 and PostgreSQL cascades deletion to messages. Both mutations return 403 when the session belongs to another user. The first user message replaces the default title with its first 40 characters after line breaks are removed.

`GET /api/sessions/{id}` returns stored user and assistant messages normally, but converts every tool row to `{role:"tool", id, created_at, metadata:{tool,status,duration_ms,target|url}, summary}`. The fixed, tool-specific `summary` describes the title/URL, query/result count, planning section/add count, task card, or error code/message. The stored JSON `content`, fetched page text, search snippets, and document bodies are never included in the response.

## 3. Authentication

*Implementation status: implemented*

### POST `/auth/login`

```json
{"email":"user@example.com","password":"example-password"}
```

```json
{"user":{"id":"uuid","email":"user@example.com","role":"user"}}
```

Sets the session cookie on success.
Failure messages do not distinguish whether an account exists.
Apply the rate limit based on IP and account.

### POST `/auth/logout`

There is no request body and returns 204 after discarding the session.

### GET `/auth/me`

```json
{"id": "uuid", "email": "user@example.com", "display_name": "User", "role": "user"}
```

## 4. User management

*Implementation status: partial*

### GET `/users?cursor=&limit=20&role=user&status=active`

```json
{"items":[{"id":"uuid","email":"user@example.com","role":"user","disabled":false}],"next_cursor":null}
```

### POST `/users`

```json
{"email": "new@example.com", "display_name": "New User", "role": "user", "temporary_password": "one-time-value"}
```

```json
{"id":"uuid","email":"new@example.com","role":"user","must_change_password":true}
```

### PATCH `/users/{userId}`

```json
{"role":"admin","disabled":false}
```

Reject the removal of his or her last administrator privilege to 409.

### DELETE `/users/{userId}`

Deactivate instead of deleting the physics and return 204.

## 5. Project

*Implementation status: partial*

### GET `/projects?view=card&cursor=&limit=20`

```json
{
  "items": [{
    "id":"uuid","name":"Sample App","slug":"sample-app","view":"card",
    "task_counts":{"pending":2,"in_progress":1,"done":7,"failed":0}
  }],
  "next_cursor": null
}
```

### POST `/projects`

```json
{"name":"Sample App","slug":"sample-app"}
```

```json
{"id":"uuid","name":"Sample App","slug":"sample-app","documents_initialized":true}
```

Initialize the state directory with 5 types of project docs and tasks when created.

### GET `/projects/{projectId}`

```json
{"id":"uuid","name":"Sample App","slug":"sample-app","view_mode":"card","archived":false}
```

### PATCH `/projects/{projectId}`

```json
{"name":"Renamed App","view_mode":"list"}
```

changing the slug involves moving the file path and is not allowed by the P1 API.

### DELETE `/projects/{projectId}`

If there is a job running, it returns 409, otherwise 204 after archive.

## 6. Tasks

*Implementation status: implemented for the unversioned project task, report, and summary reads; remaining versioned APIs are partial*

### GET `/api/projects/{slug}/tasks?status=pending&limit=5&offset=0`

```json
{
  "items":[{
"id": "uuid", "filename": "20260909-001-task.md", "title": "Modify Login",
    "status":"pending","pre_task_id":null,"next_task_id":null,"created_at":"2026-09-09T06:00:00Z"
  }],
  "total":12,
  "limit":5,
  "offset":0
}
```

`status` accepts a comma-separated list and returns all statuses when omitted. Offset pagination defaults to 5 items, caps `limit` at 50, and defaults invalid or missing `offset` to 0.

### GET `/api/projects/{slug}/reports?limit=5&offset=0`

Returns report Markdown metadata in the same `{items, total, limit, offset}` envelope, newest first. The default and maximum limits match the task list.

### GET `/api/projects/{slug}/tasks/summary`

```json
{"pending":2,"in_progress":1,"done":7,"failed":0,"reports":3}
```

The endpoint applies the same authentication and project ownership checks as the task list. Task counts are grouped in one database query; the report count is read from the owned project's report directory.

### POST `/projects/{projectId}/tasks/from-chat`

```json
{
  "session_id":"uuid",
"message": "Fix the login failure and test it",
"context": [{"role": "user", "content": "Reproduction conditions are..."}],
  "pre_task_id":null,
  "next_task_id":null,
  "timeout_min":20
}
```

```json
{
  "task":{"id":"uuid","filename":"20260909-001-task.md","status":"pending"},
  "session":{"id":"uuid","context_ratio":0.42},
  "warnings":[]
}
```

The server verifies ownership, session project, dependencies, and timeout scope.
After LLM output verification, pending file atom generation and tasks upsert are performed.
The same Idempotency-Key re-request will return the initial response.

### POST `/tasks/{taskId}/move`

```json
{"to": "pending", "reason": "Fix the problem and try again"}
```

The representative transition allowed for the user is→ failed pending.
Scheduler-only transitions are called only as internal service entitlements.

### GET `/tasks/{taskId}/report`

```json
{
  "task_id":"uuid","run_id":"uuid","status":"failed",
"filename": "20260909-001-report.md", "summary": "Test failed", "download_url": "/api/v1/md/download? token =..."
}
```

## 7. workers

*Implementation status: partial*

### GET `/workers/status`

```json
{
  "scheduler":{"leader":true,"last_heartbeat":"2026-09-09T06:00:00Z"},
  "capacity":{"running":4,"limit":20},
  "queue":{"pending":8,"blocked":2,"failed":1},
  "workers":[{"id":"worker-1","state":"busy","task_id":"uuid"}]
}
```

### GET `/workers/config`

```json
{"poll_interval_sec":2,"global_concurrency":20,"default_timeout_min":20,"runner":"subprocess"}
```

### PATCH `/workers/config`

```json
{"poll_interval_sec":3,"global_concurrency":20,"default_timeout_min":30}
```

```json
{"poll_interval_sec":3,"global_concurrency":20,"default_timeout_min":30,"effective_at":"2026-09-09T06:01:00Z"}
```

## 8. Usage

*Implementation status: partial*

### GET `/usage?from=2026-09-01&to=2026-09-30&group_by=project`

```json
{
  "currency":"USD",
  "totals":{"input_tokens":1200,"output_tokens":600,"cost":"0.04200000"},
  "groups":[{"project_id":"uuid","input_tokens":1200,"output_tokens":600,"cost":"0.04200000"}]
}
```

### GET `/admin/usage?user_id=&project_id=&group_by=user`

The response type is the same as`/usage `and only the administrator can filter other users.
Place a date range maximum to limit high cost aggregation.

## 9. LLM Connection

*Implementation status: partial*

### GET `/llm-connections`

```json
{"items":[{"id":"uuid","name":"primary","provider":"compatible","default_model":"model-a","has_api_key":true,"api_key_hint":"…abcd","enabled":true}]}
```

### POST `/llm-connections`

```json
{"name":"primary","provider":"compatible","base_url":"https://provider.example/v1","default_model":"model-a","api_key":"secret-value"}
```

The response does not return `api_key`.

### PATCH `/llm-connections/{id}`

```json
{"default_model":"model-b","enabled":true,"api_key":"rotated-value"}
```

If the key field is omitted, retain the existing ciphertext.

### DELETE `/llm-connections/{id}`

Deactivate the connection in use and return 204.

## 10. Account settings

*Implementation status: partial*

### GET `/settings`

```json
{"items":[{"key":"email_notifications","value":true,"sensitive":false},{"key":"personal_llm_key","value":null,"sensitive":true,"configured":true}]}
```

### PUT `/settings/{key}`

```json
{"value":true}
```

Values classified as sensitive keys are encrypted and stored and then masked in the response.

### DELETE `/settings/{key}`

Remove account-specific overrides and return 204.

## 11. View and share Markdown

*Implementation status: partial*

### GET `/md?project_id={id}&kind=guide`

```json
{"path": "sample-app/docs/sample-app.guide.md", "content": "# Project instructions\ n...", "sha256": "hex", "updated_at": "2026-09-09T 06:00:00 Z"}
```

Random absolute path input is not received and is interpreted as project ID and document kind or task ID.

### POST `/md/share-links`

```json
{"resource":{"type":"task_report","id":"uuid"},"expires_in_sec":86400,"allow_download":true}
```

```json
{"id":"uuid","url":"https://dirigo.craftbay.io/share/random-token","expires_at":"2026-09-10T06:00:00Z"}
```

The original shared token will only be provided once in the generated response and the hash will be stored in the DB.

### DELETE `/md/share-links/{id}`

The owner or manager discards the link and returns 204.

### GET `/md/download?project_id={id}&kind=proposal`

Require an authentication session or a valid shared token.
The response uses` text/markdown; charset = utf-8 `and a secure attachment file name.

## 12. Chatbot Order Prompt Contract

### `append_planning` tool

*Implementation status: implemented*

Project chat exposes an internal LLM tool with this schema:

```json
{
  "name": "append_planning",
  "parameters": {
    "type": "object",
    "properties": {
      "project": { "type": "string" },
      "date": { "type": "string", "description": "YYYY-MM-DD in Asia/Seoul" },
      "entries": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
    },
    "required": ["project", "date", "entries"]
  }
}
```

The server resolves the owned project, preserves the complete proposal Markdown, reuses or creates `## 기획 YYYY-MM-DD`, and compares normalized bullets to merge duplicates. A per-document lock serializes chat appends; each write also compares the content hash and retries one conflict before returning `planning_write_conflict`. Entries matching credential patterns such as `sk-`, `cfut_`, or `password=` return `planning_secret_rejected` without changing the file. `update_doc` remains available and `create_task` keeps its existing contract.

Successful chat responses are server-generated as `기획서에 기록했습니다.`, `기록 위치: proposal > ## 기획 YYYY-MM-DD`, `요약: …`, and `열린 질문: …` (or `없음`). An additional task-order line appears only for an explicit implementation/order/deployment request.

*Implementation status: partial*

LLM inputs are system rules, project guide, restricted conversation context, and current user request sequence.
The server marks the trust boundary and treats the prompt injection inside the document as data.

| Input | Required | Description |
|---|---|---|
| `user` | Yes | Slug and scope |
| `project` | Example | Slug and project metadata |
| `project_guide` | Yes | hash with original guide text |
| `conversation_context` | Yes | Ordered role/content array |
| `request` | Yes | Latest User Order Intent |
| `dependencies` | No | Allowed pre/next candidates |
| `constraints` | Yes | timeout, file dimensions, security policy |

The model output is a Markdown work order and does not include an explanatory code fence or header.

```yaml
---
title: fix login errors
project: sample-app
user: team-user
pre-task: null
next-task: null
type: task
created_at: 2026-09-09T06:00:00Z
timeout_min: 20
---
```

Required sections of the body are `Objectives`, `Scope of Work`, `Implementation Requirements`, `Validation Checklist`, and `Completion Reporting`.
The model does not determine the filename and number, and the server does it atomically.
If the model outputs an absolute path, a secret value, and an unacceptable dependency, the verification fails.
The server parses the frontmatter and contrasts the user and project values with authoritative values.
Send a structured correction prompt up to once on failure, or return 422 if it fails again.

## 13. Completion criteria

*Implementation status: partial*

- All endpoints have method, path, and permissions defined.
- The scope of inquiry between the user and the administrator is separated.
- Cards and list views are supported by the same project API.
- Create a task Markdown where the chatbot ordering is verified.
- API Keys are not exposed to responses other than generated input.
- Markdown is only viewed, shared and downloaded as a secure identifier.
- Duplicate orders and state transitions are handled idempotently.

## 14. Project document editing

*Implementation status: implemented*

`GET /api/projects/{slug}/docs/{kind}` returns Markdown plus `ETag` and `X-Updated-At` revision headers. The ETag is a strong, quoted SHA-256 hash of the exact UTF-8 Markdown content; it does not depend on filesystem timestamps. `PUT` is limited to `guide`, `next`, and `setting`; it requires the latest loaded or successfully saved ETag in `If-Match`. Comparison normalizes quoted, unquoted, and `W/`-prefixed transport forms before matching the content hash. Stale content revisions return 409 without writing and missing preconditions return 428. Success returns `ok`, the new `etag`, and `updated_at`, and clients must retain that ETag for the next save.

`setting` requires YAML frontmatter containing only allowed non-sensitive execution keys of the documented string, integer, or string-array types. `secrets` contains names only. Invalid frontmatter returns 400 with a user-facing message. Ownership failures return 403.
# LLM connection status

Implementation status: Implemented (#017).

`GET /api/llm/status` requires an authenticated user and returns the default connection's health without exposing credentials. `reason` is one of `no_default`, `unreachable`, `auth`, `model_missing`, or `ok`; the response also contains `message`, `last_check_at`, `last_error`, and `is_admin`. Stale status (older than 60 seconds) is refreshed before it is returned.

`POST /api/admin/llm-connections/{id}` runs the same five-second health probe used by the scheduler and returns `ok`, `reason`, final `url`, `response_ms`, `error`, and `checked_at`. For OpenAI and compatible providers it calls `{base_url}/v1/models` and verifies the configured model. The Anthropic probe makes a minimal Messages request. `PATCH` with `{"is_default":true}` atomically replaces the global default.

`POST /api/chat` checks the selected default before storing the user message. A failed probe returns HTTP 503 with the same `code`, localized `error`, and diagnostic `last_error` shown by the status banner. Successful streamed messages include `user_created_at`, assistant `created_at`, and `changed: string[]`. `changed` contains `proposal` after a successful or duplicate-only `append_planning` result and `tasks` after a successful `create_task`; unrelated and failed tool calls do not add entries.
## LLM connection status

*Implementation status: implemented*

`GET /api/llm/status` requires an authenticated user and reports the default connection's health. `reason` is one of `no_default`, `unreachable`, `auth`, `model_missing`, or `ok`; the response also includes `last_error`, the checked URL, check time, and whether the caller is an administrator. The endpoint never exposes API keys.

The administrator connection-test action calls `POST /api/admin/llm-connections/{id}`. Its response contains the final models URL, response latency, reason classification, and upstream error text. `PATCH /api/admin/llm-connections/{id}` with `{"is_default":true}` atomically clears the previous global default before selecting the requested connection.

Chat submission performs the same live health check before storing a user message. A failed submission returns HTTP 503 with the same `reason`, localized actionable `error`, and sanitized `last_error` used by the status banner.

## Chat message timestamps

*Implementation status: implemented*

Session detail responses include `created_at` for every message and a one-based `handover_number` for the session chain. Successful chat events include `created_at` for the assistant message and `user_created_at` for the stored user message. Clients display KST as `HH:mm` for today or `M/d HH:mm` otherwise, with the full ISO timestamp in the DOM tooltip.

## Current-user settings

*Implementation status: implemented*

`GET /api/me` returns only the signed-in user's account fields and normalized preferences. `PUT /api/me` accepts `display_name` (1–40 characters) and complete preferences: `language` (`ko|en`), `chat_panel_width` (320–720), `task_default_sections`, `email_notifications`, and a valid `notification_email`. Invalid payloads return 400.

`POST /api/me/password` accepts current, new, and confirmation passwords. New passwords require eight characters; malformed or mismatched input returns 400 and an incorrect current password returns 403. All routes are session-owner only.
