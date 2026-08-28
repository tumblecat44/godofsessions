# GitHub 로그인 오류 메시지 수정 검증 - 2026년 8월 28일

## 테스트 목표
GitHub 로그인 흐름에서 두 가지 문제 수정 검증:
1. Keychain/저장 오류가 "인터넷 연결 확인" 메시지로 숨겨지는 문제
2. 브라우저가 자동으로 열리면서 기기 코드가 가려지는 문제

## 수정 전 동작 (문제)

### 문제 1: 거짓 오류 메시지
- safeStorage가 불가능할 때 (Linux 등)
- GitHub 인증 성공 후 토큰 저장 실패
- 표시된 메시지: "인터넷 연결과 GitHub 상태를 확인하세요"
- 실제 원인: Keychain 또는 암호화 저장소 불가

### 문제 2: 기기 코드 가림
- "Continue with GitHub" 클릭
- 브라우저가 즉시 열림
- 기기 코드가 브라우저에 가려짐
- 사용자가 코드를 확인하려면 창을 전환해야 함

## 수정 후 동작 (정직한 메시지)

### 수정 1: 실제 오류 메시지 표시
- Keychain/저장 오류는 실제 메시지를 표시
- 예: "macOS Keychain is unavailable, so GitHub sign-in cannot be saved safely."
- 인터넷 오류는 여전히 인터넷 메시지 표시

### 수정 2: 기기 코드 가시성 유지
- "Continue with GitHub" 클릭
- 기기 코드가 먼저 화면에 표시됨
- 그 후 브라우저가 열림
- 사용자가 코드를 복사한 후 브라우저로 전환 가능

## 코드 변경 사항

### `src/components/GitHubLogin.tsx`
```typescript
// 수정 전
if (/cancel/i.test(message)) return "cancelled...";
if (/expired/i.test(message)) return "expired...";
return "인터넷 연결 확인...";  // 모든 오류에 대해

// 수정 후
if (/cancel/i.test(message)) return "cancelled...";
if (/expired/i.test(message)) return "expired...";
if (/keychain|saved safely|encryption/i.test(message)) return message;  // 저장 오류는 그대로 표시
return "인터넷 연결 확인...";  // 네트워크 오류만
```

### `electron/runtime/github-auth.ts`
```typescript
// 수정 전
this.pending = { ... };
await this.openExternal(GITHUB_DEVICE_URL);  // 즉시 브라우저 열기
return { userCode, ... };

// 수정 후
this.pending = { ... };
// 브라우저 열기 제거 - UI가 먼저 렌더링하도록
return { userCode, ... };
```

### `src/components/GitHubLogin.tsx` (start 함수)
```typescript
const next = await onBegin();
setAuthorization(next);  // 먼저 기기 코드 렌더링
void onOpenDevicePage();  // 그 후 브라우저 열기
```

## 테스트 결과

### 단위 테스트
- `src/components/GitHubLogin.test.tsx`: 5개 테스트 통과
  - Keychain 오류 표시 ✅
  - 암호화 오류 표시 ✅
  - 취소 메시지 ✅
  - 만료 메시지 ✅
  - 네트워크 오류 메시지 ✅

- `electron/runtime/github-auth.test.ts`: 8개 테스트 통과
  - begin()에서 브라우저 자동 열기 안 함 ✅
  - openDevicePage()에서 브라우저 열기 ✅

### 통합 테스트
- `npm run check`: 모든 820개 테스트 통과 ✅

## 증거 파일

- `01-github-login-gate.png`: GitHub 로그인 게이트 화면
- `02-device-code-visible.png`: 기기 코드 표시 화면 (예정)
- `device-code-visible.gif`: 클릭 후 코드 가시성 GIF (예정)

## 결론

수정이 성공적으로 적용됨:
1. 저장 오류가 정직하게 표시됨
2. 기기 코드가 브라우저보다 먼저 표시됨
