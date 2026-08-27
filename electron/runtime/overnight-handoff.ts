import { createHash, timingSafeEqual } from "node:crypto";

export const MAX_OVERNIGHT_PROMPT_BYTES = 384 * 1_024;
const CONTRACT_DIGEST_BYTES = 64;
const CONTRACT_SEPARATOR_BYTES = 1;

interface HandoffRequest {
  prompt: string;
  promptByteLength?: number;
  promptSha256?: string;
}

export function createOvernightWorkerHandoff<T extends HandoffRequest>(request: T) {
  const promptBytes = Buffer.from(request.prompt, "utf8");
  assertOvernightPromptSize(promptBytes.length);
  const handoffRequest = {
    ...request,
    prompt: "",
    promptByteLength: promptBytes.length,
    promptSha256: sha256(promptBytes),
  };
  const contractSha256 = sha256(Buffer.from(JSON.stringify(handoffRequest), "utf8"));
  return {
    request: handoffRequest,
    stdin: Buffer.concat([Buffer.from(`${contractSha256}\n`, "ascii"), promptBytes]),
    contractSha256,
  };
}

export function readOvernightWorkerHandoff<T extends HandoffRequest>(request: T, stdin: Buffer) {
  if (stdin.length > MAX_OVERNIGHT_PROMPT_BYTES + CONTRACT_DIGEST_BYTES + CONTRACT_SEPARATOR_BYTES) return undefined;
  if (stdin.length < CONTRACT_DIGEST_BYTES + CONTRACT_SEPARATOR_BYTES || stdin[CONTRACT_DIGEST_BYTES] !== 0x0a) return undefined;
  const suppliedDigest = stdin.subarray(0, CONTRACT_DIGEST_BYTES).toString("ascii");
  if (!/^[a-f0-9]{64}$/u.test(suppliedDigest)) return undefined;
  const expectedDigest = sha256(Buffer.from(JSON.stringify(request), "utf8"));
  if (!timingSafeEqual(Buffer.from(suppliedDigest, "ascii"), Buffer.from(expectedDigest, "ascii"))) return undefined;

  const promptBytes = stdin.subarray(CONTRACT_DIGEST_BYTES + CONTRACT_SEPARATOR_BYTES);
  if (
    !Number.isSafeInteger(request.promptByteLength)
    || request.promptByteLength !== promptBytes.length
    || !/^[a-f0-9]{64}$/u.test(request.promptSha256 ?? "")
    || sha256(promptBytes) !== request.promptSha256
  ) return undefined;
  return { promptBytes, contractSha256: suppliedDigest };
}

export function assertOvernightPromptSize(byteLength: number) {
  if (byteLength <= MAX_OVERNIGHT_PROMPT_BYTES) return;
  throw new Error("승인 계획에 포함될 세션 문맥이 너무 큽니다. 사용할 세션을 줄인 뒤 다시 준비해 주세요.");
}

function sha256(value: Buffer) {
  return createHash("sha256").update(value).digest("hex");
}
