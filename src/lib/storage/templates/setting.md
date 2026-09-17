---
repo: ""
branch: "main"
push_policy: "pull-rebase-push"
verify_cmd: "npm test"
workdir: "."
workspace: "local"
remote_host: ""
remote_port: 22
remote_user: ""
remote_os: ""
remote_workdir: ""
max_concurrent: 1
guides: []
secrets: []
---

# {project} 설정

생성일: {created_at}

## 프로젝트 목적 및 운영 방식

- 프로젝트의 목적, 사용자, 주요 산출물을 기록한다.
- 변경은 검토 가능한 작은 단위로 수행하고 설정된 브랜치 및 push 정책을 따른다.

## 작업지시서 작성 기준

- 한 작업지시서에는 하나의 접근 방식만 명시한다.
- 대상 파일은 모호하지 않은 절대경로로 지정한다.
- 작업은 20분 안에 검증 가능한 단위로 분할한다.
- 관련 테스트 실행을 필수 완료 조건으로 포함한다.
- 완료 시 커밋 push 및 원격 HEAD 일치, 작업지시서 보관, 배포 이력과 이슈 보고의 3종을 확인한다.

## 워커 실행 기준

- 워커는 OpenCode를 사용하며 작업별 `conflict_keys`가 겹치면 동시에 실행하지 않는다.
- `workdir`는 프로젝트 루트 기준 상대경로 또는 절대경로다. / `workdir` is either relative to the project root or an absolute path.
- 기본 동시 실행 수는 `max_concurrent`를 따르고 작업 timeout 기본값은 20분으로 한다.
- timeout 또는 검증 실패 시 성공으로 처리하지 않고 원인과 증거를 보고한다.

## 보고서 위치 및 형식

- 보고서는 프로젝트의 `tasks/reports/`에 저장한다.
- 보고서에는 요약, 관측, 증거, 원인, 제안을 구분해 기록한다.
- 명령 출력 전문 대신 재현과 확인에 필요한 최소 증거를 남긴다.

## 금지 사항

- 작업 범위에 지정된 소스 외 파일을 임의로 수정하지 않는다.
- 시크릿 값이나 인증 정보를 출력하지 않는다.
- 강제 push 또는 이력 파괴 작업을 수행하지 않는다.

## 공개 저장소 주의사항

- 시크릿, 토큰, 내부 IP, 개인 경로, 개인 호스트명이나 계정 정보를 커밋하지 않는다.
- 환경별 민감 설정은 추적되지 않는 환경 파일 또는 승인된 비밀 저장소에서 관리한다.
