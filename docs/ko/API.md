# Dirigo REST API 설계

## 1. 공통 계약

*Implementation status: partial*

기본 경로는 `/api/v1`이고 JSON을 사용한다. P2 대시보드 전환 기간에는 이슈 #003에 명시된 `/api/projects`, `/api/md/share` 비버전 경로를 우선 제공하며, `/api/v1` 별칭은 후속 호환 계층에서 추가한다.
Markdown 원문 다운로드만 `text/markdown`을 반환한다.
인증은 HttpOnly, Secure, SameSite 쿠키 기반 세션이다.
일반 사용자는 자기 리소스만, 관리자는 명시된 관리 리소스를 조회한다.

| 항목 | 규칙 |
|---|---|
| ID | UUID 문자열 |
| 시각 | ISO 8601 UTC |
| 페이지 | `cursor`, `limit` 기본 20 최대 100 |
| 멱등성 | 생성 요청에 `Idempotency-Key` 권장 |
| 오류 | code, message, details, request_id |
| 버전 | URL major version |

```json
{
  "error": {
    "code": "validation_error",
    "message": "요청을 확인해 주세요.",
    "details": [{"field": "timeout_min", "reason": "1 이상이어야 합니다."}],
    "request_id": "req_example"
  }
}
```

주요 상태 코드는 200, 201, 204, 400, 401, 403, 404, 409, 422, 429, 500이다.
권한 없음과 다른 사용자 리소스 미존재는 정보 노출을 막기 위해 404로 통일할 수 있다.

## 2. 엔드포인트 요약

*Implementation status: partial*

| Method | Path | 권한 | 설명 |
|---|---|---|---|
| POST | `/auth/login` | 공개 | 로그인 |
| POST | `/auth/logout` | user | 로그아웃 |
| GET | `/auth/me` | user | 현재 계정 |
| GET | `/users` | admin | 사용자 목록 |
| POST | `/users` | admin | 사용자 생성 |
| PATCH | `/users/{userId}` | admin | 역할·상태 변경 |
| DELETE | `/users/{userId}` | admin | 사용자 비활성화 |
| GET | `/projects` | user | 프로젝트 목록/카드 데이터 |
| POST | `/projects` | user | 프로젝트 생성 |
| GET | `/projects/{projectId}` | user | 프로젝트 상세 |
| PATCH | `/projects/{projectId}` | user | 이름·보기 방식 수정 |
| DELETE | `/projects/{projectId}` | user | 프로젝트 archive |
| GET | `/projects/{projectId}/tasks` | user | 상태별 작업 목록 |
| GET | `/projects/{projectId}/tasks/summary` | user | 작업·리포트 개수 |
| GET | `/projects/{projectId}/reports` | user | 리포트 목록 |
| POST | `/projects/{projectId}/tasks/from-chat` | user | 챗봇 발주 |
| POST | `/tasks/{taskId}/move` | user | 허용 상태 전이 |
| GET | `/tasks/{taskId}/report` | user | 최신 보고서 |
| GET | `/workers/status` | admin | 워커·큐 상태 |
| GET | `/workers/config` | admin | 워커 설정 |
| PATCH | `/workers/config` | admin | 워커 설정 변경 |
| GET | `/usage` | user | 자기 사용량 |
| GET | `/admin/usage` | admin | 전체 사용량 |
| GET | `/llm-connections` | admin | 연결 목록 |
| POST | `/llm-connections` | admin | 연결 생성 |
| PATCH | `/llm-connections/{id}` | admin | 연결 수정 |
| DELETE | `/llm-connections/{id}` | admin | 연결 비활성화 |
| GET | `/settings` | user | 계정 설정 |
| PUT | `/settings/{key}` | user | 계정 설정 upsert |
| DELETE | `/settings/{key}` | user | 계정 설정 삭제 |
| GET | `/md` | user | Markdown 보기 |
| POST | `/md/share-links` | user | 공유 링크 생성 |
| DELETE | `/md/share-links/{id}` | user | 공유 링크 폐기 |
| GET | `/md/download` | user/share | Markdown 다운로드 |
| GET | `/sessions?project_slug={slug}` | user | 프로젝트 세션 또는 project_slug 생략 시 프로젝트 없는 세션 목록 |
| POST | `/sessions` | user | 프로젝트 바인딩 또는 프로젝트 없는 채팅 세션 생성 |
| PATCH | `/sessions/{id}` | 소유자 | 채팅 세션 이름 변경 |
| DELETE | `/sessions/{id}` | 소유자 | 세션과 소속 메시지 삭제 |

### 채팅 세션 수명주기

*Implementation status: implemented*

`GET /api/sessions`는 프로젝트 없는 세션만 반환하고, `project_slug`를 지정하면 인증 사용자가 소유한 해당 프로젝트 세션을 반환한다. 결과는 마지막 메시지 시각 최신순이며 `last_message_at`을 포함한다. `PATCH /api/sessions/{id}`는 `{"title":"..."}`을 받아 공백을 정규화한다. `DELETE`는 204를 반환하고 PostgreSQL 외래 키 cascade로 메시지도 삭제한다. 두 변경 API는 다른 사용자의 세션에 403을 반환한다. 첫 사용자 메시지는 줄바꿈을 제거한 앞 40자로 기본 제목을 교체한다.

### 프로젝트 챗 웹 도구

*구현 상태: 구현 완료*

`fetch_url` 입력은 `{"url":"https://example.com/page"}`, 성공 결과는 `{"url":"...","finalUrl":"...","title":"...","text":"...","truncated":false}`다. 공개 HTTP(S) HTML만 허용한다. 리더는 리다이렉트 3회, 응답 10초·2MB, 추출 텍스트 8,000자를 상한으로 둔다. 안정된 사용자 문구는 `URL 읽기 실패 — 접속 오류`, `URL 읽기 실패 — 타임아웃(10초)`, `URL 읽기 실패 — 차단(403·429)`, `URL 읽기 실패 — 지원하지 않는 형식`, `URL 읽기 실패 — 차단된 주소(내부망)`이며 리다이렉트·크기 상한도 별도로 알린다.

`web_search` 입력은 `{"query":"...","count":5}`이고 `count`는 1–5로 제한한다. 성공 결과는 `query`, 선택된 `language`, `unresponsiveEngines`, `results: [{"title":"...","url":"...","snippet":"...","engine":"..."}]`를 포함한다. `DIRIGO_SEARXNG_URL`이 있을 때만 노출하고 세션별 분당 5회로 제한한다. 안정된 실패 문구는 `검색 실패 — SearXNG 연결 불가`, `검색 실패 — 결과 없음(응답 엔진 n개)`, `검색 실패 — 요청 한도 초과`다.

챗 핸들러는 최대 3회 도구 라운드를 실행하고 각 결과를 신뢰하지 않는 시스템 컨텍스트로 주입한 뒤 최종 답변을 만든다. 각 도구 메시지는 기존 `messages.metadata` JSONB에 `tool`, `tool_call_id`, `target`, `status`, `duration_ms`를 저장한다. 웹 도구 성공 답변은 말미에 `출처:` URL 목록을 포함하고, 결합 요청이면 같은 출처를 기획 항목과 작업 본문에도 남긴다.

## 3. 인증

*Implementation status: implemented*

### POST `/auth/login`

```json
{"email":"user@example.com","password":"example-password"}
```

```json
{"user":{"id":"uuid","email":"user@example.com","role":"user"}}
```

성공 시 세션 쿠키를 설정한다.
실패 메시지는 계정 존재 여부를 구분하지 않는다.
IP와 계정 기준 rate limit을 적용한다.

### POST `/auth/logout`

요청 본문은 없고 세션을 폐기한 뒤 204를 반환한다.

### GET `/auth/me`

```json
{"id":"uuid","email":"user@example.com","display_name":"사용자","role":"user"}
```

## 4. 사용자 관리

*Implementation status: partial*

### GET `/users?cursor=&limit=20&role=user&status=active`

```json
{"items":[{"id":"uuid","email":"user@example.com","role":"user","disabled":false}],"next_cursor":null}
```

### POST `/users`

```json
{"email":"new@example.com","display_name":"새 사용자","role":"user","temporary_password":"one-time-value"}
```

```json
{"id":"uuid","email":"new@example.com","role":"user","must_change_password":true}
```

### PATCH `/users/{userId}`

```json
{"role":"admin","disabled":false}
```

자기 자신의 마지막 관리자 권한 제거는 409로 거부한다.

### DELETE `/users/{userId}`

물리 삭제 대신 비활성화하고 204를 반환한다.

## 5. 프로젝트

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

생성 시 프로젝트 docs 5종과 tasks 상태 디렉터리를 초기화한다.

### GET `/projects/{projectId}`

```json
{"id":"uuid","name":"Sample App","slug":"sample-app","view_mode":"card","archived":false}
```

### PATCH `/projects/{projectId}`

```json
{"name":"Renamed App","view_mode":"list"}
```

slug 변경은 파일 경로 이동을 수반하므로 P1 API에서 허용하지 않는다.

### DELETE `/projects/{projectId}`

실행 중 작업이 있으면 409, 아니면 archive 후 204를 반환한다.

## 6. 작업

*Implementation status: 비버전 프로젝트 작업·리포트·요약 조회 구현 완료, 나머지 버전 API는 부분 구현*

### GET `/api/projects/{slug}/tasks?status=pending&limit=5&offset=0`

```json
{
  "items":[{
    "id":"uuid","filename":"20260909-001-task.md","title":"로그인 수정",
    "status":"pending","pre_task_id":null,"next_task_id":null,"created_at":"2026-09-09T06:00:00Z"
  }],
  "total":12,
  "limit":5,
  "offset":0
}
```

`status`는 쉼표로 복수 지정할 수 있으며 생략하면 전체다. offset 페이징은 기본 5개이고 `limit`은 최대 50이며, `offset`이 없거나 유효하지 않으면 0이다.

### GET `/api/projects/{slug}/reports?limit=5&offset=0`

최신순 리포트 Markdown 메타데이터를 같은 `{items, total, limit, offset}` 구조로 반환한다. 기본값과 상한은 작업 목록과 같다.

### GET `/api/projects/{slug}/tasks/summary`

```json
{"pending":2,"in_progress":1,"done":7,"failed":0,"reports":3}
```

작업 목록과 같은 인증·프로젝트 소유권 검증을 적용한다. 작업 개수는 DB 쿼리 한 번으로 상태별 집계하고, 리포트 개수는 소유 프로젝트의 리포트 디렉터리에서 읽는다.

### POST `/projects/{projectId}/tasks/from-chat`

```json
{
  "session_id":"uuid",
  "message":"로그인 실패 원인을 수정하고 테스트해 줘",
  "context":[{"role":"user","content":"재현 조건은 ..."}],
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

서버는 소유권, 세션 프로젝트, 의존성, timeout 범위를 검증한다.
LLM 출력 검증 후 pending 파일 원자 생성과 tasks upsert를 수행한다.
동일 Idempotency-Key 재요청은 최초 응답을 반환한다.

### POST `/tasks/{taskId}/move`

```json
{"to":"pending","reason":"문제 수정 후 재시도"}
```

사용자에게 허용되는 대표 전이는 failed→pending이다.
스케줄러 전용 전이는 내부 서비스 자격으로만 호출한다.

### GET `/tasks/{taskId}/report`

```json
{
  "task_id":"uuid","run_id":"uuid","status":"failed",
  "filename":"20260909-001-report.md","summary":"테스트 실패","download_url":"/api/v1/md/download?token=..."
}
```

## 7. 워커

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

## 8. 사용량

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

응답 형태는 `/usage`와 같고 관리자만 다른 사용자를 필터링할 수 있다.
날짜 범위 최대값을 두어 고비용 집계를 제한한다.

## 9. LLM 연결

*Implementation status: partial*

### GET `/llm-connections`

```json
{"items":[{"id":"uuid","name":"primary","provider":"compatible","default_model":"model-a","has_api_key":true,"api_key_hint":"…abcd","enabled":true}]}
```

### POST `/llm-connections`

```json
{"name":"primary","provider":"compatible","base_url":"https://provider.example/v1","default_model":"model-a","api_key":"secret-value"}
```

응답에는 `api_key`를 반환하지 않는다.

### PATCH `/llm-connections/{id}`

```json
{"default_model":"model-b","enabled":true,"api_key":"rotated-value"}
```

키 필드가 생략되면 기존 암호문을 유지한다.

### DELETE `/llm-connections/{id}`

사용 중인 연결은 비활성화하며 204를 반환한다.

## 10. 계정 설정

*Implementation status: partial*

### GET `/settings`

```json
{"items":[{"key":"email_notifications","value":true,"sensitive":false},{"key":"personal_llm_key","value":null,"sensitive":true,"configured":true}]}
```

### PUT `/settings/{key}`

```json
{"value":true}
```

민감 키로 분류된 값은 암호화 저장하고 이후 응답에서 마스킹한다.

### DELETE `/settings/{key}`

계정별 override를 제거하고 204를 반환한다.

## 11. Markdown 보기와 공유

*Implementation status: partial*

### GET `/md?project_id={id}&kind=guide`

```json
{"path":"sample-app/docs/sample-app.guide.md","content":"# 프로젝트 지침\n...","sha256":"hex","updated_at":"2026-09-09T06:00:00Z"}
```

임의 절대 경로 입력은 받지 않고 project ID와 문서 kind 또는 task ID로 해석한다.

### POST `/md/share-links`

```json
{"resource":{"type":"task_report","id":"uuid"},"expires_in_sec":86400,"allow_download":true}
```

```json
{"id":"uuid","url":"https://dirigo.craftbay.io/share/random-token","expires_at":"2026-09-10T06:00:00Z"}
```

공유 토큰 원문은 생성 응답에서 한 번만 제공하고 DB에는 hash를 저장한다.

### DELETE `/md/share-links/{id}`

소유자 또는 관리자가 링크를 폐기하고 204를 반환한다.

### GET `/md/download?project_id={id}&kind=proposal`

인증 세션 또는 유효한 공유 토큰을 요구한다.
응답은 `text/markdown; charset=utf-8`과 안전한 attachment 파일명을 사용한다.

## 12. 챗봇 발주 프롬프트 계약

### `append_planning` 도구

*구현 상태: 구현 완료*

프로젝트 챗은 LLM 내부 도구로 다음 스키마를 제공합니다.

```json
{
  "name": "append_planning",
  "parameters": {
    "type": "object",
    "properties": {
      "project": { "type": "string" },
      "date": { "type": "string", "description": "Asia/Seoul 기준 YYYY-MM-DD" },
      "entries": { "type": "array", "items": { "type": "string" }, "minItems": 1 }
    },
    "required": ["project", "date", "entries"]
  }
}
```

서버는 소유 프로젝트를 확인하고 proposal Markdown 전체를 보존하면서 `## 기획 YYYY-MM-DD` 절을 재사용하거나 생성하며, 정규화한 bullet을 비교해 중복을 병합합니다. 문서별 잠금으로 챗 append를 직렬화하고, 쓰기마다 content hash를 조건부 비교해 충돌 시 한 번 재시도한 뒤에도 충돌하면 `planning_write_conflict`를 반환합니다. `sk-`, `cfut_`, `password=` 같은 자격 증명 패턴이 있는 항목은 파일을 바꾸지 않고 `planning_secret_rejected`로 거부합니다. 기존 `update_doc`과 `create_task` 계약은 유지합니다.

성공 응답은 서버가 `기획서에 기록했습니다.`, `기록 위치: proposal > ## 기획 YYYY-MM-DD`, `요약: …`, `열린 질문: …`(또는 `없음`)의 네 줄로 생성합니다. 사용자가 구현·발주·배포를 명시한 경우에만 작업 발주 줄을 추가합니다.

*Implementation status: partial*

LLM 입력은 시스템 규칙, project guide, 제한된 대화 컨텍스트, 현재 사용자 요청 순서다.
서버가 신뢰 경계를 표시하고 문서 안의 프롬프트 인젝션을 데이터로 취급한다.

| 입력 | 필수 | 설명 |
|---|---|---|
| `user` | 예 | slug와 권한 범위 |
| `project` | 예 | slug와 프로젝트 메타데이터 |
| `project_guide` | 예 | guide 원문과 hash |
| `conversation_context` | 예 | 순서 있는 role/content 배열 |
| `request` | 예 | 최신 사용자 발주 의도 |
| `dependencies` | 아니오 | 허용된 pre/next 후보 |
| `constraints` | 예 | timeout, 파일 규격, 보안 정책 |

모델 출력은 Markdown 작업지시서 하나이며 설명용 코드펜스나 머리말을 포함하지 않는다.

```yaml
---
title: 로그인 오류 수정
project: sample-app
user: team-user
pre-task: null
next-task: null
type: task
created_at: 2026-09-09T06:00:00Z
timeout_min: 20
---
```

본문 필수 섹션은 `목표`, `작업 범위`, `구현 요구사항`, `검증 체크리스트`, `완료 보고`다.
모델은 파일명과 번호를 결정하지 않으며 서버가 원자적으로 채번한다.
모델이 절대 경로, 비밀값, 허용되지 않은 의존성을 출력하면 검증 실패다.
서버는 frontmatter를 파싱하고 사용자·프로젝트 값을 권위 있는 값으로 대조한다.
실패 시 최대 한 번 구조화 수정 프롬프트를 보내고, 다시 실패하면 422를 반환한다.

## 13. 완료 기준

*Implementation status: partial*

- 모든 엔드포인트에 method, path, 권한이 정의돼 있다.
- 사용자와 관리자의 조회 범위가 분리된다.
- 카드와 목록 보기가 같은 프로젝트 API로 지원된다.
- 챗봇 발주가 검증된 task Markdown을 생성한다.
- API Key는 생성 입력 외 응답에 노출되지 않는다.
- Markdown은 안전한 식별자로만 조회·공유·다운로드된다.
- 중복 발주와 상태 전이가 멱등적으로 처리된다.

| GET | `/chat/sessions?project_slug={slug}` | user | 소유 프로젝트에 고정된 세션 목록 |
| POST | `/chat/sessions` | user | `project_slug`로 소유 프로젝트에 세션 생성 |
| POST | `/admin/llm-connections/{id}` | admin | 연결 테스트와 최종 호출 URL 반환 |

### 챗 패널과 LLM URL 동작

*Implementation status: implemented*

프로젝트 챗 클라이언트는 자유롭게 선택 가능한 프로젝트 ID 대신 `project_slug`를 전송한다. 서버는 소유권을 확인해 해당 `project_id`를 세션에 저장한다. OpenAI 및 호환 연결의 base URL은 끝의 슬래시와 `/v1`을 제거해 저장하고, 호출 시 `/v1/chat/completions`를 정확히 한 번 붙인다. 연결 테스트 응답은 축약된 모델 응답과 함께 `url`을 반환한다.

## 14. 프로젝트 문서 편집

*Implementation status: implemented*

`GET /api/projects/{slug}/docs/{kind}`는 Markdown 원문과 `ETag`, `X-Updated-At` 리비전 헤더를 반환한다. ETag는 정확한 UTF-8 Markdown 콘텐츠의 SHA-256을 따옴표로 감싼 strong ETag이며 파일시스템 시각에 의존하지 않는다. `PUT`은 `guide`, `next`, `setting`에만 허용하며 가장 최근에 불러오거나 저장 성공 응답에서 받은 ETag를 `If-Match`로 보내야 한다. 비교할 때 따옴표 유무와 전송 중 붙은 `W/` 접두 형식을 정규화한 뒤 콘텐츠 해시를 대조한다. 오래된 콘텐츠 리비전은 파일을 쓰지 않고 409, 조건 누락은 428을 반환한다. 성공 응답에는 `ok`, 새 `etag`, `updated_at`이 포함되며 클라이언트는 다음 저장을 위해 이 ETag를 보관해야 한다.

`setting`은 YAML frontmatter가 필수이며 허용된 비민감 실행 키만 정해진 문자열·정수·문자열 배열 타입으로 받는다. `secrets`에는 이름만 저장한다. 잘못된 frontmatter는 사용자 메시지와 함께 400, 소유권 위반은 403을 반환한다.
# LLM 연결 상태

Implementation status: 구현 완료 (#017).

`GET /api/llm/status`는 인증 사용자에게 자격 증명을 노출하지 않고 기본 연결의 상태를 반환한다. `reason`은 `no_default`, `unreachable`, `auth`, `model_missing`, `ok` 중 하나이며 `message`, `last_check_at`, `last_error`, `is_admin`도 포함한다. 상태가 60초보다 오래됐으면 반환 전에 다시 확인한다.

`POST /api/admin/llm-connections/{id}`는 스케줄러와 같은 5초 제한 헬스 프로브를 실행하고 `ok`, `reason`, 최종 `url`, `response_ms`, `error`, `checked_at`을 반환한다. OpenAI 및 호환 provider는 `{base_url}/v1/models`를 호출해 설정 모델 존재 여부를 확인하고 Anthropic은 최소 Messages 요청을 사용한다. `PATCH`의 `{"is_default":true}`는 전역 기본 연결을 교체한다.

`POST /api/chat`은 사용자 메시지를 저장하기 전에 선택된 기본 연결을 확인한다. 실패하면 상태 배너와 같은 `code`, 한글 `error`, 진단용 `last_error`를 HTTP 503으로 반환한다. 성공 스트림에는 사용자 `user_created_at`과 assistant `created_at`이 포함된다.
## LLM 연결 상태

*Implementation status: implemented*

`GET /api/llm/status`는 로그인 사용자에게 기본 연결의 상태를 반환합니다. `reason`은 `no_default`, `unreachable`, `auth`, `model_missing`, `ok` 중 하나이며 `last_error`, 최종 확인 URL, 확인 시각, 관리자 여부를 함께 제공합니다. API 키는 절대 반환하지 않습니다.

관리자 연결 테스트는 `POST /api/admin/llm-connections/{id}`를 사용합니다. 응답에는 최종 모델 목록 URL, 응답 시간, 원인 분류, 업스트림 오류 원문이 포함됩니다. `PATCH /api/admin/llm-connections/{id}`에 `{"is_default":true}`를 보내면 기존 전역 기본 연결을 해제한 뒤 요청한 연결을 기본으로 지정합니다.

채팅 전송은 사용자 메시지를 저장하기 전에 동일한 실시간 헬스체크를 수행합니다. 실패하면 상태 배너와 동일한 `reason`, 조치 가능한 한글 `error`, 정리된 `last_error`를 HTTP 503으로 반환합니다. 성공 스트림은 `user_created_at`, assistant `created_at`, `changed: string[]`를 포함합니다. `changed`에는 성공 또는 중복만 확인된 `append_planning` 뒤 `proposal`, 성공한 `create_task` 뒤 `tasks`가 들어가며 무관하거나 실패한 도구는 포함하지 않습니다.

## 채팅 메시지 시각

*Implementation status: implemented*

세션 상세 응답은 모든 메시지의 `created_at`과 세션 체인의 1부터 시작하는 `handover_number`를 포함합니다. 채팅 성공 이벤트에는 assistant 메시지의 `created_at`과 저장된 사용자 메시지의 `user_created_at`이 포함됩니다. 클라이언트는 KST 기준 오늘은 `HH:mm`, 그 외에는 `M/d HH:mm`으로 표시하고 DOM 툴팁에는 전체 ISO 시각을 둡니다.

## 현재 사용자 설정

*Implementation status: implemented*

`GET /api/me`는 로그인 본인의 계정 필드와 정규화된 preferences를 반환합니다. `PUT /api/me`는 1~40자의 `display_name`과 `language`(`ko|en`), 320~720의 `chat_panel_width`, `task_default_sections`, `email_notifications`, 올바른 `notification_email`을 받습니다. 잘못된 입력은 400입니다.

`POST /api/me/password`는 현재·새·확인 비밀번호를 받습니다. 새 비밀번호는 8자 이상이며 형식·확인 불일치는 400, 현재 비밀번호 불일치는 403입니다. 모든 경로는 세션 본인만 사용할 수 있습니다.

## 설정 API

*구현 상태: 구현 완료*

전역 요청은 관리자, `?project=<slug>` 요청은 해당 프로젝트 소유자만 허용합니다. `GET /api/config`는 시크릿을 `***`로 마스킹한 `{config,sources,warnings,hash}`와 ETag를 반환합니다. `GET /api/config/raw`는 해당 스코프의 YAML 원문과 ETag를 반환합니다.

`POST /api/config/validate`와 `/api/config/diff`는 `application/yaml` 원문 또는 `{"yaml":"..."}` JSON을 받습니다. `PUT /api/config`는 같은 본문과 `If-Match: <sha256>`를 받아 원자적으로 적용합니다. 검증 오류는 경로가 든 `errors`와 HTTP 400, 오래된 해시는 409, 성공은 유효값·출처·새 해시·변경 목록을 반환합니다. 모든 응답은 캐시하지 않습니다.
