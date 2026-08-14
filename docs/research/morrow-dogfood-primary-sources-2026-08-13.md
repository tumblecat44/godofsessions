# Morrow V2 개밥먹기용 1차 자료 조사

- 작성 기준일: 2026-08-13
- 범위: Pi Agent SDK, 모델·인증·세션 계약, 도구 승인·고정 루트, Electron 보안
- 출처 정책: Pi·Electron·OpenAI·Anthropic의 공식 문서 및 공식 저장소만 사용

## 결론

Morrow는 “로컬 Pi 프로그램에 요청을 보내는 껍데기”가 아니다. `@earendil-works/pi-coding-agent`를 Electron 메인 프로세스 안에 라이브러리로 불러오고, `createAgentSession()`이 만든 에이전트 세션이 공급자 API와 직접 통신하는 구조다. 공급자 목록, 인증, 모델 선택은 `ModelRuntime`이 담당하고, 대화 기록은 `SessionManager`가 관리한다. 이 SDK의 공식 목적도 커스텀 데스크톱 UI나 자동화에 Pi 에이전트를 임베드하는 것이다. ([Pi SDK](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [Pi 저장소](https://github.com/earendil-works/pi))

다만 Pi는 고의로 내장 샌드박스나 완성된 권한 체계를 제공하지 않는다. 파일 도구, 셸, 확장은 Pi 프로세스를 실행한 사용자와 같은 권한으로 동작한다. 따라서 Morrow의 “고정 실행 루트”, “읽기는 자동”, “변경은 승인”, “승인은 이 대화 동안만 기억”은 시스템 프롬프트가 아니라 Morrow의 실행 정책과 가능하면 OS 수준 경계로 강제해야 한다. ([Pi 보안](https://pi.dev/docs/latest/security), [Pi 확장·도구 차단 API](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md))

## 어떤 Pi 패키지를 써야 하는가

### `@earendil-works`와 `@mariozechner`의 관계

두 패키지는 서로 무관한 대안이라기보다 프로젝트 이관 전후의 계보에 가깝다. 공식 릴리스는 0.74.0에서 저장소와 npm 스코프를 `earendil-works/pi`와 `@earendil-works/*`로 옮겼다고 명시한다. 이관 전 스코프의 공개 패키지는 `@mariozechner/pi-coding-agent`, 이관 후 현재 계열은 `@earendil-works/pi-coding-agent`다. ([공식 릴리스](https://github.com/earendil-works/pi/releases), [이관 전 npm 패키지](https://www.npmjs.com/package/@mariozechner/pi-coding-agent), [현재 npm 패키지](https://www.npmjs.com/package/@earendil-works/pi-coding-agent))

SDK 표면도 달라졌다.

| 계약 | 이관 전 `@mariozechner` 문서 | 현재 `@earendil-works` 문서 |
|---|---|---|
| 모델·인증 중심 객체 | `AuthStorage` + `ModelRegistry` | 비동기 `ModelRuntime`이 공급자, 자격 증명, 모델 카탈로그를 통합 관리 |
| 모델 카탈로그 | 정적 내장·사용자 모델 중심 | 캐시된 원격 카탈로그, 명시적 refresh와 timeout/abort 계약 포함 |
| 인증 | 저장소와 레지스트리 조합 | 공급자 소유 API 키·OAuth 흐름, `login/logout/checkAuth` 제공 |
| thinking 단계 | `off`부터 `xhigh` | `max`까지 포함하고 모델별 지원 범위를 사용 |
| 프로젝트 신뢰 | 구버전에는 현재 경계가 없음 | 0.79.0부터 프로젝트 리소스 신뢰 게이트 추가 |

비교 근거는 [이관 전 SDK 문서](https://github.com/badlogic/pi-mono/blob/main/packages/coding-agent/docs/sdk.md), [현재 SDK 문서](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md), [프로젝트 신뢰 보안 공지](https://github.com/earendil-works/pi/security/advisories/GHSA-mqxh-6gq7-558m)다.

Morrow V2는 현재 유지되는 `@earendil-works/pi-coding-agent`를 고정해 사용하는 편이 맞다. 단순히 패키지 이름만 바꾸는 선택이 아니라, Morrow 온보딩에 필요한 `ModelRuntime`의 공급자 소유 인증 계약과 현재 보안 수정까지 포함하는 선택이다.

## Pi SDK의 실제 계약

### 1. 세션 생성과 실행 위치

`createAgentSession()`은 한 에이전트 세션의 메인 팩터리다. `cwd`는 도구의 상대 경로, 프로젝트 리소스 탐색, 세션 이름에 영향을 준다. 커스텀 `cwd`와 도구 이름 배열을 넘기면 현재 SDK가 해당 `cwd`용 내장 도구를 만든다. 사용 가능한 내장 도구는 `read`, `grep`, `find`, `ls`, `bash`, `edit`, `write`다. ([SDK 디렉터리·도구 계약](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#directories))

하지만 `cwd`는 보안 경계가 아니다. Pi 공식 보안 문서는 내장 도구가 Pi 프로세스의 사용자 권한으로 파일과 셸에 접근한다고 명시한다. 절대 경로, `..`, 심볼릭 링크, 셸 명령을 별도 정책 없이 허용하면 실행 루트 밖으로 나갈 수 있다. ([Pi 보안: No Built-in Sandbox](https://pi.dev/docs/latest/security#no-built-in-sandbox))

Morrow가 맞춰야 할 행동:

- 앱 시작 시 결정한 하나의 canonical root를 모든 세션에 사용한다. UI에는 프로젝트 선택기를 두지 않는다.
- 도구 이름과 입력을 실행 직전에 다시 검사한다. 프롬프트의 “루트 밖에 가지 마라”는 보조 설명일 뿐 경계로 취급하지 않는다.
- 경로 검사는 문자열 `..` 검사로 끝내지 않고, 기존 대상은 `realpath`, 새 파일은 가장 가까운 기존 부모의 `realpath`까지 확인해 심볼릭 링크 탈출을 막는다.
- 셸을 제공한다면 경로 도구와 별개로 격리해야 한다. 최소 V2에서는 명령별 승인만으로 “루트 밖 접근 불가”라고 표현하지 말고, 제한된 셸 실행기나 OS 샌드박스가 없으면 그 한계를 명시한다.

### 2. 공급자와 인증

`ModelRuntime`은 공급자 목록과 공급자별 인증 방법을 노출한다. `getProviders()`로 공급자와 API 키/OAuth 방식을 표시하고, `checkAuth(providerId)`로 연결 상태를 확인하며, `getAvailable()`로 실제 인증이 준비된 모델만 얻는다. 인증 해석 우선순위는 런타임 키, `auth.json`, 환경 변수, 커스텀 모델 키 순서다. ([SDK 인증 계약](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#api-keys-and-oauth), [공급자 문서](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md))

`ModelRuntime.login()`의 흐름은 공급자가 소유한다. API 키 비밀 입력, 브라우저 OAuth, 디바이스 코드, 수동 코드, 선택지가 공급자마다 다를 수 있으므로 Morrow는 하나의 고정 폼을 흉내 내기보다 SDK의 UI-중립 prompt/notify 이벤트를 온보딩 UI로 번역해야 한다. 커스텀 공급자 문서의 OAuth 콜백도 URL 열기, 디바이스 코드 표시, 진행 알림, 텍스트 입력, 선택 입력을 별도 상호작용으로 정의한다. ([Pi 커스텀 공급자 OAuth 계약](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/custom-provider.md#oauth-support))

저장 자격 증명은 기본적으로 `~/.pi/agent/auth.json`에 보관되고 파일 권한은 사용자 읽기·쓰기만 가능한 `0600`이다. Morrow처럼 앱 전용 `authPath`를 지정하면 같은 계약을 앱 데이터 폴더에 격리할 수 있다. OAuth 토큰은 만료 시 공급자가 갱신한다. ([Pi 공급자 인증 저장](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/providers.md#auth-file))

Morrow가 맞춰야 할 행동:

- 온보딩은 `공급자 선택 → 공급자가 제공하는 인증 방식 선택 → provider-owned prompt/notice 처리 → checkAuth 재확인 → 사용 가능한 모델 선택` 순서다.
- 연결됨 표시는 입력을 받았다는 뜻이 아니라 `checkAuth()` 성공을 뜻해야 한다.
- 키 값과 OAuth 토큰은 renderer 상태, 로그, 대화 기록에 보내지 않는다. Electron main 안의 `ModelRuntime`과 앱 전용 자격 증명 파일에만 둔다.
- `login/logout/setRuntimeApiKey` 뒤에는 로컬 카탈로그 일관성이 보장되지만 원격 freshness까지 기다리는 것은 아니다. 앱이 refresh를 부르면 timeout과 취소를 직접 정하고, 실패해도 저장 성공을 되돌리지 않는다. ([ModelRuntime 동기화·timeout 계약](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#api-keys-and-oauth))

### 3. 기본 모델은 무엇인가

SDK에 모델을 넘기지 않으면 다음 순서로 정한다.

1. 이어 여는 세션에 저장된 모델 복원
2. Pi settings의 기본 모델
3. 인증된 첫 번째 모델로 fallback

이 순서는 [공식 SDK 모델 계약](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#model)에 명시되어 있다. 그러므로 “Pi 설정을 그대로 따른다”는 말은 로컬 Pi 프로세스에 요청한다는 뜻이 아니라, Morrow가 별도 모델을 넘기지 않고 Pi의 `SettingsManager`와 동일한 agent directory를 사용할 때 Pi 설정 파일의 기본값을 읽는다는 뜻이다.

Morrow가 앱 안에서 모델을 고르게 한다면 계약을 더 명확히 해야 한다.

- 새 대화: Morrow preferences의 선택 모델을 명시적으로 전달한다.
- 이어 보기: 세션에 저장된 모델·thinking을 우선 복원한다.
- 저장 모델을 더 이상 사용할 수 없으면 `modelFallbackMessage`를 UI에 보여 주고 실제 fallback 모델을 분명히 표시한다.
- 인증된 모델이 하나도 없으면 프롬프트 전송을 실패시킨 뒤 일반 오류를 띄우는 대신 공급자 설정으로 안내한다.

### 4. 세션과 기록

Pi 세션은 JSONL 기반 트리 구조이며 엔트리의 `id/parentId`로 분기를 표현한다. `SessionManager.create`, `open`, `continueRecent`, `list`를 제공하고, 세션 메시지에는 provider/model/usage, thinking, tool call, tool result가 포함된다. ([SDK 세션 관리](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#session-management), [세션 포맷](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/session-format.md))

Morrow가 맞춰야 할 행동:

- 새 대화는 새 persistent `SessionManager`를 만든다.
- 과거 대화는 앱 대화 저장소 안의 경로만 열고, 저장소 밖 경로는 거절한다.
- 이어 열 때 모델·thinking·도구 결과를 세션에서 복원한다.
- 대화를 바꾸거나 새 대화를 시작하면 승인 기억을 모두 지우고, 대기 중 승인은 거절 상태로 종료한다.
- 모델이 fallback되었거나 세션 파일이 손상되었을 때 조용히 다른 상태를 보여 주지 말고 친절한 복구 설명을 표시한다.

### 5. 시스템 프롬프트와 `.agents/skills`

커스텀 시스템 프롬프트는 `DefaultResourceLoader`의 override를 통해 공급할 수 있다. 기본 로더는 root와 상위 경로의 `.agents/skills/`, 홈의 `~/.agents/skills/`, `AGENTS.md` 등을 발견한다. 커스텀 loader를 사용하면 탐색 범위를 앱이 직접 통제할 수 있다. ([SDK 시스템 프롬프트](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#system-prompt), [SDK skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/sdk.md#skills))

Pi 0.79.0부터 프로젝트 로컬 설정·스킬·확장에는 project trust가 추가되었지만, project trust는 샌드박스가 아니다. 특히 확장은 Pi 프로세스와 같은 권한의 실행 코드다. Morrow가 사용자가 요청한 `.agents/skills`만 자동 로딩하려면 `.pi/extensions`, package resources, prompt templates, themes는 기본 탐색에서 제외하고, root와 홈의 `.agents/skills`만 명시적으로 포함하는 편이 안전하다. ([Pi project trust](https://pi.dev/docs/latest/security#project-trust), [관련 보안 공지](https://github.com/earendil-works/pi/security/advisories/GHSA-mqxh-6gq7-558m))

시스템 프롬프트는 Morrow의 성격과 도구 사용 기준을 정의해야 한다.

- 기본은 일반 대화다.
- 사용자가 명시적으로 파일 확인·변경이나 명령 실행을 부탁했을 때만 도구를 쓴다.
- 도구가 존재한다는 이유만으로 저장소를 탐색하지 않는다.
- 사용자의 언어를 유지하고, 실행한 일과 하지 못한 일을 구분한다.
- 승인 거절을 우회하거나 같은 행동을 다른 도구로 재시도하지 않는다.

다만 이 항목들은 모델 행동 지침이고 실행 권한의 근거가 아니다.

## 권한 체계: 공식 제품에서 가져올 원칙

### Codex

Codex는 샌드박스와 승인을 서로 다른 두 계층으로 정의한다. 샌드박스는 기술적으로 가능한 파일·네트워크 범위를 정하고, 승인 정책은 언제 멈춰 사용자에게 물을지 정한다. 기본 `workspace-write` 흐름에서는 작업공간 안 읽기·편집·일상 명령을 자동 수행하고, 작업공간 밖 편집이나 네트워크는 승인한다. 승인은 한 번 또는 세션 범위로 줄 수 있다. ([OpenAI Agent approvals & security](https://learn.chatgpt.com/docs/agent-approvals-security), [OpenAI Sandbox](https://learn.chatgpt.com/docs/sandboxing), [Running Codex safely at OpenAI](https://openai.com/index/running-codex-safely/))

핵심은 승인 피로를 줄이는 방법이 “모델을 믿고 전부 허용”이 아니라 “낮은 위험 작업을 실제 경계 안에 넣은 뒤 자동 허용”이라는 점이다. OpenAI 문서도 이미 승인된 경계 안에서는 계속 진행하고, 경계를 넘을 때 승인 흐름이 개입한다고 설명한다. ([OpenAI Sandbox](https://learn.chatgpt.com/docs/sandboxing))

### Claude Code

Claude Code의 공식 기본 표는 읽기·grep은 무승인, 셸은 명령 단위, 파일 수정은 세션 종료까지 기억하는 구조다. `allow`, `ask`, `deny`는 deny → ask → allow 순서로 평가하며 deny가 항상 우선한다. Bash 복합 명령은 각 하위 명령을 분리해 평가하고, 단순 문자열 패턴만으로 URL이나 모든 셸 효과를 안전하게 제한하기 어렵다고 경고한다. Read/Edit 규칙과 OS sandbox도 별개다. ([Claude Code permissions](https://code.claude.com/docs/en/permissions), [Claude Code permission modes](https://code.claude.com/docs/en/permission-modes))

### Morrow V2 승인 행렬

Morrow는 전문 코딩 도구가 아니라 대화가 기본이고, 부탁받으면 Pi 도구로 일을 할 수 있는 앱이다. 따라서 기본 권한을 다음처럼 고정하는 것이 제품 정의와 공식 사례를 함께 만족시킨다.

| 행동 | 기본 결정 | 기억 범위 | UI에 보여 줄 내용 |
|---|---|---|---|
| `read`, `grep`, `find`, `ls` — canonical root 안 | 자동 허용 | 없음 | 필요할 때 대화 속 도구 진행 표시 |
| 모든 파일 도구 — root 밖 또는 symlink 탈출 | 거절 | 기억 불가 | 고정 루트 밖이라 실행하지 않았다고 설명 |
| `edit`, `write` — root 안 | 첫 실행 승인 | 현재 대화에서 같은 `write-in-root` 범위 | 정확한 대상 경로와 변경 목적 |
| `bash` — 정확히 검증된 무부작용 조회 명령 | 승인 또는 매우 좁은 자동 허용 | 현재 대화의 정확한 명령 signature | 전체 명령과 실행 위치 |
| 일반 `bash` | 매번 승인 | 기본적으로 없음 | 전체 명령, 실행 위치, 예상 효과 |
| 삭제·배포·publish·push·권한 상승 등 고위험 명령 | 매번 승인 | 기억 불가 | 되돌리기 어려운 효과를 별도 경고 |
| 알 수 없는 custom/extension tool | 승인 | 기억 불가 | 도구 이름과 전체 입력 |

승인 기억은 앱 전체나 다음 실행으로 저장하지 않는다. 새 대화, 대화 전환, 앱 재시작 때 사라져야 한다. “같은 종류”가 무엇인지 UI에서 숨기지 말고 `이 대화의 루트 안 파일 변경` 또는 `이 정확한 명령`처럼 범위를 말로 보여 줘야 한다.

Pi에서 이 흐름은 extension의 `tool_call` 이벤트로 실행 직전 차단할 수 있다. 공식 문서는 permission gate를 대표 사례로 들며 `{ block: true, reason }` 반환을 계약으로 정의한다. handler 오류도 fail-safe로 도구를 차단한다. 반대로 `tool_call` 반환의 공식 제어 계약은 block과 reason이므로, 별도 `terminate` 같은 필드에 전체 턴 중단을 의존하면 안 된다. ([Pi tool events](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md#tool-events))

## Electron 보안 계약

Electron renderer에 모델 출력과 인증 안내가 표시되므로, 일반 웹 XSS가 로컬 권한 상승으로 이어지지 않도록 main/preload 경계를 좁혀야 한다. Electron 공식 체크리스트는 최신 Electron, `nodeIntegration: false`, `contextIsolation: true`, renderer sandbox, 제한적 CSP, navigation·새 창 제한, `shell.openExternal`의 불신 URL 금지, 모든 IPC sender 검증, Electron API 최소 노출을 요구한다. ([Electron Security](https://www.electronjs.org/docs/latest/tutorial/security))

Morrow의 필수 기준:

- Pi SDK, 자격 증명, 파일·셸 실행은 Electron main에만 둔다.
- renderer는 `contextBridge`로 작업별 좁은 함수만 받고, `ipcRenderer.send/invoke` 원본을 노출하지 않는다. ([Electron Context Isolation](https://www.electronjs.org/docs/latest/tutorial/context-isolation), [Electron IPC](https://www.electronjs.org/docs/latest/tutorial/ipc))
- `BrowserWindow`는 `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`로 고정한다.
- renderer 문서에 최소 `default-src 'self'; script-src 'self'` 수준의 CSP를 둔다. 개발 서버 예외는 개발 빌드에만 둔다.
- 모든 main IPC handler에서 sender가 Morrow 창의 trusted `webContents`인지 확인하고 입력 shape·문자열 길이·enum을 런타임 검증한다.
- 앱 내부 navigation과 새 창을 차단한다. 외부 URL은 `https:`만 확인하는 데서 끝내지 않고 OAuth 공급자가 방금 제공한 URL 또는 명시적 허용 도메인만 열며, 모델이 만든 임의 URL을 특권 API로 바로 넘기지 않는다.
- remote content를 Morrow의 privileged renderer 안에 직접 load하지 않는다.

## 개밥먹기 합격 기준

### 응답 행동

1. `오늘 할 일을 같이 정리해줘` 같은 일반 대화에는 파일·셸 도구를 호출하지 않고 바로 대화한다.
2. `이 앱 괜찮아 보여?`처럼 모호한 질문에는 저장소를 임의 탐색하지 않고, 필요한 맥락을 물어보거나 현재 대화만으로 답한다.
3. `README 제목만 읽어줘`에는 root 안 `read`를 무승인 실행하고 결과를 간결하게 설명한다.
4. `이 문장을 파일에 저장해줘`에는 정확한 경로를 정하거나 물은 뒤 승인 카드를 한 번 띄운다.
5. 사용자가 쓰기 승인을 대화 동안 기억하면 같은 대화의 root 안 쓰기는 이어지고, 새 대화에서는 다시 묻는다.
6. 승인 거절 후에는 거절을 존중하고, Bash나 다른 도구로 같은 변경을 우회하지 않는다.
7. root 밖 절대 경로, `..`, root 안 symlink를 통한 밖 접근은 읽기·쓰기 모두 거절한다.
8. 셸 승인 후에도 명령이 root 밖 파일이나 네트워크에 닿을 수 있는 현재 한계를 숨기지 않는다. 실제 sandbox가 있다면 경계 탈출이 기술적으로 실패해야 한다.

### 인증·모델

1. 자격 증명이 없으면 대화 입력 전에 친절한 공급자 설정 안내가 나온다.
2. API 키 입력은 마스킹되고 renderer 로그·세션 JSONL에 남지 않는다.
3. 브라우저 OAuth, device code, manual code, 취소, timeout을 각각 시험한다.
4. 연결 성공 후 `checkAuth`와 모델 목록이 갱신되고 새 대화를 만들 수 있다.
5. 기존 세션은 저장된 모델·thinking으로 재개된다.
6. 저장 모델이 사라지면 fallback 사실과 실제 선택 모델을 사용자에게 알린다.

### 승인·세션

1. 동시에 여러 tool call이 오더라도 승인 카드가 덮어써지거나 다른 call의 응답에 연결되지 않는다.
2. 승인 대기 중 대화를 전환하거나 앱을 닫으면 대기 call이 안전하게 거절된다.
3. 고위험 명령은 같은 문자열이어도 기억 옵션이 나타나지 않는다.
4. 승인 카드에는 전체 대상이나 명령이 잘리지 않은 상태로 확인 가능한 확장 UI가 있다.
5. 앱 재시작 후 대화 기록은 복원되지만 승인 기억은 복원되지 않는다.

### Electron

1. renderer에서 `require`, `process`, raw `ipcRenderer`에 접근할 수 없다.
2. CSP 위반, navigation, popup, 임의 external URL이 차단된다.
3. 다른 `webContents`나 변조된 IPC payload는 main handler에서 거절된다.
4. 모델이 HTML, `javascript:` URL, 로컬 파일 URL, 매우 긴 payload를 답해도 특권 실행으로 이어지지 않는다.

## 구현 우선순위 판단

1. fixed root를 문자열 규칙이 아닌 canonical path + 셸 실행 경계로 증명한다.
2. 실제 공급자 하나로 일반 대화·명시적 읽기·쓰기 승인·거절·세션 재개를 반복한다.
3. `modelFallbackMessage`, 인증 취소·timeout, 세션 손상처럼 정상 경로 밖의 설명 품질을 다듬는다.
4. Electron CSP, IPC sender·payload 검증, 외부 URL 허용 범위를 보강한다.
5. 각 수정 뒤 위 합격 기준을 같은 대화와 새 대화에서 다시 수행한다.

이 순서는 “권한을 빡세게 만드는 것”이 목적이 아니다. read 계열과 root 안의 승인된 변경은 빠르게 흘려보내되, 사용자가 보고 있는 고정 루트와 대화 단위 기억이 실제 실행 계약과 어긋나지 않게 만드는 것이 목적이다.
