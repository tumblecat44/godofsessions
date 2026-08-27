import { isAbsolute, relative, resolve } from "node:path";
import type {
  DailySessionSummary,
  OvernightDisposition,
  OvernightExcludedSessionProposal,
  OvernightExecutor,
  OvernightReasonCode,
  OvernightRequestKind,
} from "../../src/shared/contracts";
import { hasPositivePrioritySignal, redactSensitive, type DailyContextSnapshot } from "./daily-context";

export type OvernightCandidateOrigin = "continuation" | "follow_up" | "proactive" | "batch" | "routine";

export interface OvernightGroundingEvidence {
  source: "session" | "workspace" | "user_goal" | "routine";
  summary: string;
}

export interface OvernightProposal {
  origin?: OvernightCandidateOrigin;
  disposition: OvernightDisposition;
  requestKind: OvernightRequestKind;
  title: string;
  rationale: string;
  reasonCodes: OvernightReasonCode[];
  sessionIds: string[];
  excludedSessions: OvernightExcludedSessionProposal[];
  outcome: string;
  verification: string;
  executor: "auto" | OvernightExecutor;
  executorReason: string;
  risks: string[];
  questions: string[];
  durationMinutes?: number;
  evidence?: OvernightGroundingEvidence[];
  coveredSessionIds?: string[];
}

export interface OvernightAssessment {
  disposition: OvernightDisposition;
  title: string;
  rationale: string;
  reasonCodes: OvernightReasonCode[];
  selectedSessions: DailySessionSummary[];
  excludedSessions: OvernightExcludedSessionProposal[];
  outcome: string;
  verification: string;
  executor?: OvernightExecutor;
  executorReason: string;
  risks: string[];
  questions: string[];
  durationMinutes?: number;
}

interface AssessOvernightProposalInput {
  proposal: OvernightProposal;
  context: DailyContextSnapshot;
  root: string;
  executors: Record<OvernightExecutor, boolean>;
  executorBlockers?: Partial<Record<OvernightExecutor, "unavailable" | "unauthenticated">>;
}

const positiveReasons = new Set<OvernightReasonCode>([
  "unfinished_work",
  "explicit_priority",
  "same_task",
  "bounded_scope",
  "clear_verification",
  "overnight_leverage",
]);
const MAX_RISKS = 8;
const MAX_QUESTIONS = 3;
const MAX_SUPPORTING_TEXT = 500;
const noRunReasons = new Set<OvernightReasonCode>([
  "completed",
  "outside_root",
  "external_side_effect",
  "credentials_required",
  "destructive_action",
  "unverifiable",
  "insufficient_context",
  "unknown_session",
  "no_executor",
  "not_relevant",
]);
const clarifyReasons = new Set<OvernightReasonCode>([
  "unknown_root",
  "needs_user_decision",
  "too_broad",
  "vague_outcome",
  "executor_unexplained",
  "executor_unavailable",
  "executor_unauthenticated",
  "insufficient_reasoning",
]);

const externalSideEffect = /(?:\bdeploy(?:ment|ed|ing)?\b|\bpublish(?:ed|ing)?\b|\bgit\s+push\b|\bgh\s+(?:pr\s+(?:create|merge|close|reopen|comment|edit|review)|issue\s+(?:create|close|reopen|comment|edit)|release\s+(?:create|delete|edit|upload)|workflow\s+run|run\s+(?:cancel|delete|rerun)|secret\s+(?:set|delete)|variable\s+(?:set|delete)|api\b[^.;\n]{0,100}(?:(?:-X|--method)\s*(?:POST|PUT|PATCH|DELETE)))\b|\bglab\s+(?:mr\s+(?:create|merge|close|reopen|update|approve)|issue\s+(?:create|close|reopen|update)|release\s+(?:create|delete|update))\b|\bforce[- ]push\b|\bterraform\s+(?:apply|import)\b|\bkubectl\s+(?:apply|create|delete|patch|replace|scale|set|rollout\s+(?:restart|undo))\b|\b(?:aws|gcloud|az)\b[^.;\n]{0,80}\b(?:apply|create|delete|deploy|import|put|restart|sync|update|upload)\b|\bcurl\b[^;\n]{0,100}(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b|\b(?:send|make|issue)\s+(?:an?\s+)?HTTP\s+(?:POST|PUT|PATCH|DELETE)\s+(?:request|call)\b|\b(?:ship|release|promote)\b[^.;\n]{0,40}\bproduction\b|\b(?:create|publish|edit|delete)\s+(?:an?\s+|the\s+)?(?:github\s+)?release\b|\b(?:delete|remove)\s+(?:the\s+)?remote\b[^.;\n]{0,30}\b(?:branch|tag)\b|\bpost\s+(?:the\s+)?announcement\b|\b(?:send|post)\b[^.;\n]{0,40}\b(?:discord|microsoft\s+teams|telegram|sms|text\s+message)\b|\b(?:create|update|edit|delete|publish|append)\b[^.;\n]{0,40}\b(?:notion|airtable|trello|asana|clickup)\b|\bnotify\s+(?:the\s+)?customer\b|\bsend\s+(?:an?\s+)?(?:slack|email|message|webhook)\b|\b(?:call|invoke|trigger)\b[^.;\n]{0,30}\bwebhook\b|\b(?:open|create)\s+(?:an?\s+)?(?:pull\s+request|pr)\b|\bmerge\s+(?:the\s+)?(?:pull\s+request|pr)\b|\b(?:open|create|file)\s+(?:an?\s+)?(?:(?:github|linear|jira)\s+)?(?:issue|ticket)\b|\b(?:close|reopen|assign|label|comment|reply)\b[^.;\n]{0,30}\b(?:pull\s+request|pr|issue|ticket)\b|\btrigger\s+(?:the\s+)?(?:release|deployment)\b|\bupload\b[^.;\n]{0,50}\b(?:app\s+store|play\s+console|signed\s+build|release)\b|배포|게시|출시|(?:운영|프로덕션)\s*(?:환경)?에?.{0,20}(?:올리|반영|적용)|(?:운영|프로덕션).{0,20}(?:DB|데이터베이스|계정|레코드).{0,30}(?:갱신|변경|수정|삭제|생성)|외부\s*(?:메시지|메일|API).{0,20}(?:호출|전송|요청)|고객(?:에게|에)\s*(?:알림|연락)|슬랙\s*(?:전송|메시지)|(?:이슈|티켓)\s*(?:생성|등록)|(?:PR|이슈|티켓).{0,20}(?:댓글|답글|종료|재개)|웹훅\s*(?:호출|전송))/iu;
const destructiveAction = /(?:\brm\s+(?:-[^\s]+\s+)*\S+|\b(?:unlink|shred)\s+\S+|\bfind\b[^;\n]{0,100}\s-delete\b|\bgit\s+(?:reset\s+--hard|clean\s+-[^\s]*f[^\s]*|checkout\s+(?:--\s+\S+|(?:-[^\s]*f[^\s]*|--force)\b)|switch\s+--discard-changes\b|restore(?:\s+--[^\s]+)*\s+\S+|stash\s+(?:drop|clear)|branch\s+-D\b|reflog\s+expire\b|gc\s+--prune(?:=\S+)?)(?=\s|$)|\bterraform\s+destroy\b|\bkubectl\s+delete\s+(?:namespace|cluster|persistentvolume)\b|\b(?:drop|truncat(?:e|ing))\s+(?:database|schema|table|(?:the\s+)?\w+\s+table)\b|\bdelete\s+(?:all\s+records|(?:the\s+)?production\s+database)\b|\bformat\s+(?:the\s+)?disk\b|운영\s*(?:데이터베이스|DB).*삭제|테이블\s*(?:전체\s*)?(?:삭제|비우기)|파괴적)/iu;
const unboundedScope = /(?:\b(?:rewrite|redesign|rebuild|migrate|replace|refactor|modernize)\s+(?:the\s+)?(?:entire|whole|all|every)\s+(?:\w+\s+){0,2}(?:app|application|codebase|repository|system|modules?|packages?)\b|\bmodernize\s+(?:the\s+)?(?:app|application|codebase|repository|system)\s+end[- ]to[- ]end\b|\b(?:fix|resolve)\s+(?:all|every)\s+(?:the\s+)?(?:failing\s+)?(?:tests?|errors?|issues?|warnings?)\b|(?:앱|애플리케이션|코드베이스|저장소|시스템).{0,20}(?:전체|전면).{0,20}(?:재작성|재설계|교체|마이그레이션|리팩터링))/iu;
const unresolvedDecision = /(?:\bwhich\s+of\s+(?:the\s+)?(?:two|these|those)\b|\bchoose\s+between\b|\beither\b[^.;\n]{0,80}\bor\b|\bwhether\b[^.;\n]{0,80}\bor\b|\btwo\s+incompatible\b|\b(?:owner|user|maintainer)\b[^.;\n]{0,50}\b(?:hasn['’]?t|has\s+not)\s+(?:picked|chosen|decided|approved)\b|\b(?:need|require|await|wait(?:ing)?)\b[^.;\n]{0,50}\buser\s+(?:to\s+)?(?:decide|choose|approve|decision|approval)\b|(?:둘|두\s*안|A와\s*B)\s*중|양자택일|서로\s*다른.{0,30}(?:선택|결정)|어느\s*(?:쪽|것).{0,30}(?:선택|결정)|사용자.{0,40}(?:선택|결정|승인|골라).{0,20}(?:필요|대기|해야))/iu;
const missingDecision = /(?:\bno\s+(?:(?:implementation|product|user)\s+)?decision\b(?:[^.;\n]{0,20}\byet\b|\s+(?:has\s+been|was|is)\s+(?:made|recorded|selected|available)\b)|\b(?:decision|direction|choice)\b[^.;\n]{0,30}\b(?:missing|unknown|undecided|not\s+(?:made|selected))\b|(?:결정|방향|선택).{0,20}(?:없|누락|미정|불명))/iu;
const missingVerification = /(?:\b(?:cannot|can['’]?t|unable\s+to)\b[^.;\n]{0,40}\bverif(?:y|ication)\b|\bno\b[^.;\n]{0,30}\b(?:test|check|verification)\b|\b(?:only\s+(?:a\s+)?human|human[- ]only)\b[^.;\n]{0,50}\b(?:can\s+)?(?:judge|verify|decide)\b|\bno\s+machine[- ]readable\s+(?:success\s+)?signal\b|\b(?:test|check|verification)(?:\s+method)?\b[^.;\n]{0,25}\b(?:missing|undefined|unknown|tbd|not\s+(?:defined|specified|decided))\b|(?:검증|테스트)(?:\s*방법)?.{0,20}(?:불가|없|누락|못|미정|불명))/iu;
const successfulNoFailureVerification = /\bno\s+(?:(?:test|check)s?\s+(?:fail(?:ed|ing)|are\s+failing)|(?:test|check)\s+failures?)\b/iu;
const missingContext = /(?:\b(?:missing|unknown|unrecorded|not\s+enough|insufficient)\b[^.;\n]{0,40}\b(?:context|detail|information|requirement)\b|(?:문맥|정보|요구사항|세부사항).{0,20}(?:없|누락|부족|불명|미정))/iu;
const credentialRequirement = /(?:\b(?:use|provide|enter(?:ing)?|load|need|requires?|requiring)\b[^.;\n]{0,40}\b(?:(?:production|live)\s+)?(?:api[ -]?(?:key|token)|access[ -]?token|oauth[ -]?token|refresh[ -]?token|credentials?|password|ssh[ -]?key|signing[ -]?(?:key|certificate)|key|token)\b|\b(?:authenticated|signed[- ]in)\s+(?:browser|session|dashboard)\b|\bprivate\s+dashboard\b|\b(?:log|sign)\s+in\s+to\b|(?:API\s*(?:키|토큰)|접근\s*토큰|OAuth\s*토큰|리프레시\s*토큰|인증\s*정보|비밀번호|SSH\s*키|서명\s*(?:키|인증서)).{0,20}(?:사용|입력|필요|요구)|(?:로그인|인증).{0,20}(?:필요|해야))/iu;
const credentialEnvironmentRequirement = /(?:\b(?:use|read|provide|load|need|requires?|export|set)\b[^.;\n]{0,60}\$?[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?|PROFILE)\b|\$?[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?|PROFILE)\b.{0,30}(?:environment\s+variable|env\s+var|환경\s*변수).{0,30}(?:use|load|사용|불러|필요))/iu;
const credentialedCliUse = /(?:\b(?:run|execute|invoke|use)\s+(?:the\s+)?(?:gh|glab|aws|gcloud|az|kubectl)\b|(?:gh|glab|aws|gcloud|az|kubectl)\b[^.;\n]{0,80}(?:실행|사용|호출))/iu;
const credentialFreeCliProbe = /\b(?:gh|glab|aws|gcloud|az|kubectl)\s+(?:--help|help|--version|version)\b/iu;
const syntheticCredentialRequirement = /(?:\b(?:fake|synthetic|mock|test-only)\b[^.;\n]{0,30}\b(?:api[ -]?key|access[ -]?token|oauth[ -]?token|refresh[ -]?token|credentials?|password|ssh[ -]?key|signing[ -]?(?:key|certificate))\b|\b(?:api[ -]?key|access[ -]?token|oauth[ -]?token|refresh[ -]?token|credentials?|password|ssh[ -]?key|signing[ -]?(?:key|certificate))\s+(?:fixture|mock)\b|(?:가짜|합성|테스트용).{0,20}(?:API\s*키|접근\s*토큰|OAuth\s*토큰|리프레시\s*토큰|인증\s*정보|비밀번호|SSH\s*키|서명\s*(?:키|인증서)))/iu;
const syntheticCredentialEnvironment = /(?:\b(?:fake|synthetic|mock|test-only|fixture)\b[^.;\n]{0,40}\$?[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?|PROFILE)\b|(?:가짜|합성|테스트용|픽스처).{0,30}\$?[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?|PROFILE)\b)/iu;
const credentialValue = /(?:\[(?:민감값\s*숨김|sensitive value hidden)\]|-----BEGIN [A-Z ]*PRIVATE KEY-----|\bBearer\s+[A-Za-z0-9._~+/=-]{8,}\b|\bAKIA[0-9A-Z]{16}\b|\bgithub_pat_[A-Za-z0-9_]{8,}\b|\b(?:sk-|ghp_|glpat-|npm_|xox[baprs]-)[A-Za-z0-9_-]{8,}\b|\b[A-Z][A-Z0-9_]*_(?:TOKEN|KEY|SECRET|PASSWORD|CREDENTIALS?)\s*[:=]\s*\S+|\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@|\b(?:api[_-]?key|apikey|password|secret|authorization|bearer)\s*[:=]\s*\S+)/iu;
const completionEvidence = /(?:\b(?:completed|done|finished)\b|\b(?:change|fix|patch|work|implementation)\s+has\s+landed\b|\bCI\s+is\s+green\b|\b(?:tests?|checks?)\s+(?:pass|passed|are\s+green)\b|\ball\s+(?:tests?|checks?)\s+(?:pass|passed|are\s+green)\b|\bfully\s+implemented\b|\b(?:fixed|resolved)\b[^.;\n]{0,80}\btests?\s+(?:pass|passed)\b|완료(?:했|되었|됨|입니다)|(?:작업|수정|구현).{0,20}(?:끝났|마쳤|마무리)|다\s*(?:했|끝냈|마쳤)|테스트.{0,20}(?:녹색|통과)|모두\s+통과|검증\s+완료|수정(?:했|됨).{0,30}테스트.{0,20}통과)/iu;
const completionQuestion = /(?:\b(?:is|are|was|were|did|does|has|have|can|could|should|would)\b[^?\n]{0,120}\b(?:completed|done|finished|pass(?:ed)?)\b[^?\n]*\?|(?:완료|끝|통과).{0,40}(?:인가|인가요|됐나|됐나요|했나|했나요|맞나|맞나요|니|나요)\s*\?)/iu;
const completionLabelRequest = /(?:\b(?:please\s+)?(?:mark|label|set|treat|declare)\b[^.\n]{0,80}\b(?:as\s+)?(?:completed|done|finished)\b|(?:완료|끝)(?:로)?\s*(?:처리|표시|간주|기록).{0,20}(?:해|하))/iu;
const negatedAction = /(?:\b(?:do|does|did|must|should|will)\s+not\b|\b(?:don['’]?t|doesn['’]?t|didn['’]?t|mustn['’]?t|shouldn['’]?t|won['’]?t)\b|\bnot\s+(?:needed|required|requested|included)\b|\bnever\b|\bwithout\b|\bavoid(?:ed|ing)?\b|\bout\s+of\s+scope\b|\bprohibit(?:ed)?\b|\bforbid(?:den)?\b|(?:하|지)\s*(?:마|않)|안\s*(?:한다|함)|없이|필요\s*없|제외|금지)/iu;
const negationRequiringAction = /(?:\b(?:do\s+not|don['’]?t|must\s+not|mustn['’]?t|never)\s+(?:skip|avoid|omit|exclude|forget|prevent|block)\b|(?:생략|제외|회피|막)(?:하지\s*마|하지\s*않))/iu;
const syntheticUnsafeEvidence = /(?:\b(?:synthetic|fixture|literal|test[- ]only|unit\s+test|parser\s+test|detection\s+test)\b|(?:합성|가짜|테스트용|단위\s*테스트|파서\s*테스트|탐지\s*테스트).{0,20}(?:fixture|픽스처|문자열|명령))/iu;
const nonExecutionEvidence = /(?:\b(?:without|never)\s+(?:actually\s+)?(?:executing|running|invoking)\b|\b(?:must|should|does|do|will)\s+not\s+(?:execute|run|invoke)\b|\b(?:command|action)s?\b[^.;\n]{0,40}\b(?:is|are|must\s+be|should\s+be)\s+(?:rejected|blocked)\b|실행(?:하지\s*않|하지\s*마|하지\s*못하게|\s*없이)|(?:명령|동작).{0,30}(?:거부|차단))/iu;
const negatedCompletion = /(?:\bnot\s+(?:yet\s+)?completed\b|\bisn['’]?t\s+completed\b|\bnever\s+completed\b|아직\s*(?:완료|끝)|미완료|완료되지\s*않|끝나지\s*않)/iu;
const incompleteContinuation = /(?:\b(?:but|however|yet)\b[^.;\n]{0,100}\b(?:remain(?:s|ing)?|unfinished|incomplete|fails?|broken)\b|\b(?:analysis|setup|part|step)\s+(?:is\s+)?(?:completed|done|finished)\b[^.\n]{0,100}\b(?:implementation|work|tests?|issue|task)\s+(?:still\s+)?remain(?:s|ing)?\b|\b(?:implemented|completed|done|finished)\b[^.;\n]{0,100}\b(?:tests?\s+(?:were\s+)?not\s+(?:run|executed)|not\s+(?:tested|verified))\b|(?:완료|통과|끝났|마쳤|마무리).{0,60}(?:하지만|했지만|남았|남음|실패|깨짐|미검증|테스트\s*안\s*함))/iu;
const prospectiveCompletion = /(?:\bbefore\b[^.\n]{0,100}\b(?:call\s+(?:this|it)\s+)?(?:done|complete(?:d)?)\b|\bnot\s+(?:done|complete)\s+until\b|\b(?:will|would|can|could|should)\s+be\s+(?:completed|done|finished)\b[^.\n]{0,100}\b(?:when|once|after|if)\b|\b(?:when|once|after|if)\b[^.\n]{0,100}\b(?:will|would|can|could|should)\s+be\s+(?:completed|done|finished)\b|(?:완료|끝).{0,30}(?:전에|하려면)|(?:전에|해야).{0,30}(?:완료|끝))/iu;
const pendingAfterCompletion = /(?:\b(?:completed|done|finished)\b[^.\n]{0,140}\b(?:is\s+next|still\s+needs?|needs?\s+(?:implementation|work|tests?|fix)|remains?|except\s+for)\b|(?:완료|끝냈|마쳤).{0,100}(?:이제|다음).{0,50}(?:구현|수정|테스트).{0,30}(?:해야|필요|남았))/iu;
const actionableFollowup = /(?:\b(?:actually|still|however|but)\b[^.;\n]{0,100}\b(?:fails?|failed|broken|not\s+fixed|missing|unfinished|continue|needs?\s+to)\b|\b(?:also|please|continue|again)\b[^.;\n]{0,100}\b(?:add|fix|change|implement|run|verify|continue)\b|(?:^|\n)\s*(?:please\s+)?(?:fix|add|change|implement|continue)\b|\b(?:fails?|failed|broken|not\s+fixed|more\s+work|follow-up|todo|unfinished)\b|아직|다시|추가|계속|남았|남음|실패|깨짐|고쳐|안\s*돼)/iu;
const unfinishedWorkEvidence = /(?:\b(?:unfinished|incomplete|todo|failing\s+tests?)\b|\b(?:implementation|work|fix|tests?)\b[^.;\n]{0,60}\b(?:remain(?:s|ing)?|still\s+(?:fails?|broken)|not\s+(?:done|complete))\b|미완료|(?:구현|작업|수정|테스트).{0,40}(?:남았|남아|남음|실패|깨짐|미완성))/iu;
const exactVerificationCommand = /^(?:npm|pnpm|yarn|bun|deno|dart|flutter|cargo|pytest|vitest|playwright|make|node|python3?|ruby)\b(?:\s+\S+)*$/iu;
const naturalLanguageExternalSideEffect = /(?:\b(?:curl|wget|httpie)\b|\b(?:fetch(?:ing)?|download(?:ing)?|retriev(?:e|ing))\b[^.;\n]{0,80}\bhttps?:\/\/|\bpush\b[^.;\n]{0,60}\b(?:branch|tag)\b[^.;\n]{0,30}\b(?:origin|remote|github|gitlab)\b|\b(?:post|share)\b[^.;\n]{0,60}\b(?:slack|team\s+channel)\b|\bemail\b[^.;\n]{0,50}\b(?:team|customer|client|user|maintainer)\b|\b(?:submit|raise)\s+(?:an?\s+|the\s+)?(?:pull\s+request|pr)\b|(?:브랜치|태그).{0,40}(?:origin|원격|github|gitlab).{0,20}(?:push|푸시|올(?:리|린|려|렸|림))|슬랙.{0,30}(?:게시|올(?:리|린|려|렸|림)|보내|전송)|이메일.{0,30}(?:보내|전송)|PR(?:을|를|은|는)?.{0,20}올(?:리|린|려|렸|림)|외부\s*(?:URL|사이트|API).{0,60}(?:다운로드|내려받|가져오|조회))/iu;
const externalTrackerMutation = /(?:\b(?:create|open|file|update|edit|close|reopen|assign|label|comment\s+on)\b[^.;\n]{0,50}\b(?:github|gitlab|linear|jira)?\s*(?:issues?|tickets?)\b|(?:github|gitlab|linear|jira)?\s*(?:이슈|티켓).{0,30}(?:생성|등록|수정|종료|재개|할당|라벨|댓글))/iu;
const naturalLanguageDestructiveAction = /(?:\b(?:delete|remove)\b[^.;\n]{0,50}\b(?:directory|folder)\b|(?:디렉터리|폴더).{0,20}(?:삭제|제거))/iu;
const vagueVerification = /^(?:check|verify|confirm|확인|검증)(?:\s+that)?\s*(?:the\s+)?(?:it|this|screen|result|output|behavior|작동|동작|화면|결과|출력)?(?:\s+is\s+(?:correct|right))?[.!]?$/iu;
const maskedVerificationShell = /(?:\|\||(?<!&)&(?!&)|(?<!\|)\|(?!\|)|\$\(|`|;\s*(?:(?:true|:|exit\s+0)\b|(?=(?:npm|pnpm|yarn|bun|deno|dart|flutter|cargo|go|pytest|vitest|playwright|make|xcodebuild|\.\/))))/u;
const optionalVerification = /(?:\bif\s+(?:possible|time\s+permits|there(?:['’]?s|\s+is)\s+time)\b|\bwhen\s+(?:possible|convenient)\b|\boptional(?:ly)?\b|가능하면|시간(?:이)?\s*(?:되면|나면)|여유가\s*있으면|선택적으로)/iu;
const waivedVerificationFailure = /(?:\b(?:ignore|accept|allow)\b[^.\n]{0,30}\b(?:failure|failures|errors?|exit\s+code)\b|\b(?:failure|failures|errors?)\b[^.\n]{0,30}\b(?:acceptable|okay|fine|can\s+be\s+ignored)\b|실패.{0,20}(?:무시|괜찮|허용))/iu;
const enforcedVerificationFailure = /(?:\b(?:do\s+not|don['’]?t|must\s+not|never)\s+(?:ignore|accept|allow)\b[^.\n]{0,30}\b(?:failure|failures|errors?)\b|\bfailures?\s+must\s+not\s+be\s+ignored\b|실패.{0,20}무시하지\s*(?:말|않))/iu;
const verificationCommand = /(?:^|\b(?:run|execute)\s+)(?:(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|check|lint|typecheck|build)\b|(?:deno|dart|flutter|cargo)\s+(?:test|check|analyze|build)\b|(?:pytest|vitest|playwright|make|xcodebuild)\b|(?:node|python3?|ruby)\s+\S+|go\s+test\b|\.\/\S+)/iu;
const unrecognizedVerificationCommand = /(?:^|[.;]\s+)(?:run|execute)\s+(?!a\b|an\b|the\b|this\b|that\b)[A-Za-z0-9_.\/-]+/iu;
const observableVerificationTarget = /(?:\b(?:file|screen|screenshot|snapshot|output|result|response|element|record|report|document)\b|\.(?:md|json|txt)\b|스크린샷|화면|파일|출력|결과|응답|요소|레코드|보고서|문서)/iu;
const observableVerificationPredicate = /(?:\b(?:pass(?:es|ed)?|exit(?:s|ed)?|contain(?:s|ed)?|show(?:s|ed)?|remain(?:s|ed)?|exist(?:s|ed)?|match(?:es|ed)?|equal(?:s|ed)?|absent|present|visible|hidden|created|updated|removed|no\s+longer|must)\b|통과|종료\s*코드|표시|포함|유지|존재|일치|동일|없음|보임|숨김|생성|업데이트|제거)/iu;
const vagueOutcomes = new Set([
  "make it better",
  "improve it",
  "fix it",
  "overnight를 더 좋게 만들기",
  "더 좋게 만들기",
  "개선하기",
]);
const vagueOutcomePattern = /^(?:(?:make|improve|fix|finish|complete)\s+(?:it|this|things?|everything|the\s+(?:app|application))\b|(?:make|improve)\b[^.!?]{0,60}\b(?:better|nicer|great|good|overall)\b|(?:더|잘|완전히)\s*(?:좋게|개선|수정|완료))/iu;
const observableOutcome = /(?:\b(?:pass(?:es|ed)?|exit(?:s|ed)?|contain(?:s|ed)?|show(?:s|ed)?|remain(?:s|ed)?|fixed|removed|created|updated|no\s+longer|without)\b|통과|종료|표시|포함|유지|수정됨|제거됨|생성됨|업데이트됨|없이)/iu;
const executorFitEvidence = /(?:\b(?:repository|repo|code|patch|implementation|debug(?:ging)?|regression|tests?|documentation|docs?|writing|review|synthesis|analysis|audit|investigation|routine|repeatable|command|report|exact\s+contract)\b|저장소|코드|패치|구현|디버깅|회귀|테스트|검증\s*명령|문서|작성|검토|종합|분석|감사|조사|루틴|반복|명령|보고서|정확한\s*계약)/iu;
const unattendedBenefitEvidence = /(?:\b(?:unattended|overnight|uninterrupted|time-consuming|long-running|batch)\b|\bwhile\b[^.\n]{0,40}\b(?:away|asleep|offline)\b|\bwithout\b[^.\n]{0,40}\b(?:supervision|interaction)\b|무인|밤새|밤사이|야간|자리를\s*비운|사용자\s*(?:상호작용|개입)\s*없이|시간이\s*오래|일괄\s*작업)/iu;
const repositoryImplementationEvidence = /(?:\b(?:bug|regression|patch|implement(?:ation|ed|ing)?|debug(?:ging)?|refactor(?:ing)?|fix(?:ed|ing)?|failing\s+tests?|repository\s+change)\b|버그|회귀|패치|구현|디버깅|리팩터링|코드\s*수정|테스트\s*(?:실패|수정))/iu;
const writingAndReviewEvidence = /(?:\b(?:documentation|docs?|readme|adr|writing|copy|review|synthesis|research|analysis)\b|문서|README|ADR|카피|작성|검토|종합|조사|분석)/iu;
const taskStopWords = new Set([
  "about", "add", "after", "all", "and", "are", "before", "behavior", "bounded", "bug", "change", "continue", "create", "debug", "element", "error", "everything", "failed", "failing", "fails", "failure", "file", "finish", "fix", "fixed", "flow", "implement", "implementation", "investigate", "is", "issue", "local", "output", "patch", "problem", "record", "regression", "remain", "remaining", "remains", "remove", "repair", "resolve", "resolved", "result", "run", "screen", "state", "still", "test", "tests", "the", "this", "task", "update", "verify", "was", "were", "work",
  "결과", "계속", "검증", "구현", "로컬", "문제", "상태", "수정", "실패", "오류", "원인", "요소", "작업", "출력", "추가", "테스트", "파일", "화면", "회귀", "흐름", "관련",
]);
const completionStatusToken = /^(?:all|are|check(?:s|ed)?|complete(?:d|ly)?|done|everything|finish(?:ed)?|green|is|npm|pnpm|requested|successful(?:ly)?|test\p{L}*|verified|verification|yarn|bun|pass(?:ed|es)?|검사\p{L}*|검증\p{L}*|끝\p{L}*|녹색\p{L}*|다|마무리\p{L}*|마쳤\p{L}*|모두|완료\p{L}*|전부|테스트\p{L}*|통과\p{L}*|했\p{L}*)$/iu;

/**
 * Derive only safety blockers from transient evidence. Callers may preserve
 * these reason codes without persisting the evidence text itself.
 */
export function overnightSafetyReasonsFromTransientEvidence(text: string, root: string): OvernightReasonCode[] {
  const reasons: OvernightReasonCode[] = [];
  if (hasDestructiveAction(text)) reasons.push("destructive_action");
  if (hasExternalSideEffect(text)) reasons.push("external_side_effect");
  if (hasCredentialRequirement(text)) reasons.push("credentials_required");
  if (hasOutsideRequestedPath(root, [text])) reasons.push("outside_root");
  if (hasRequestedAction(text, unboundedScope)) reasons.push("too_broad");
  if (unresolvedDecision.test(text) || missingDecision.test(text)) reasons.push("needs_user_decision");
  if (hasMissingVerificationEvidence(text)) reasons.push("unverifiable");
  return unique(reasons);
}

export function overnightTransientEvidenceShowsCompletion(text: string) {
  return hasCompletionEvidence(text);
}

export function overnightSessionHasCompletionEvidence(session: DailyContextSnapshot["sessions"][number]) {
  return sessionHasCompletionEvidence(session);
}

export function assessOvernightProposal({ proposal, context, root, executors, executorBlockers = {} }: AssessOvernightProposalInput): OvernightAssessment {
  const title = limitText(proposal.title, 120);
  const rationale = limitText(proposal.rationale, 2_000);
  const outcome = limitText(proposal.outcome, 4_000);
  const verification = limitText(proposal.verification, 2_000);
  const executorReason = limitText(proposal.executorReason, 2_000);
  let reasonCodes = unique(proposal.reasonCodes).slice(0, 24);
  // Executor readiness is a runtime fact, not a model judgment. For a proposed
  // recommendation, discard model-authored readiness codes and let the actual
  // availability/authentication checks below derive the precise blocker. This
  // prevents an unused or fabricated executor claim from vetoing a ready route.
  if (proposal.disposition === "recommend") {
    reasonCodes = reasonCodes.filter((reason) => ![
      "no_executor",
      "executor_unavailable",
      "executor_unauthenticated",
    ].includes(reason));
  }
  const sessionIds = unique(proposal.sessionIds);
  const risks = normalizeTextList(proposal.risks, MAX_RISKS);
  const questions = normalizeTextList(proposal.questions, MAX_QUESTIONS);
  const evidenceRisks = normalizeEvidenceTextList(proposal.risks, MAX_RISKS);
  const evidenceQuestions = normalizeEvidenceTextList(proposal.questions, MAX_QUESTIONS);
  const groundingEvidence = (proposal.evidence ?? [])
    .filter((item) => ["session", "workspace", "user_goal", "routine"].includes(item.source))
    .map((item) => evidenceTextValue(item.summary, MAX_SUPPORTING_TEXT))
    .filter(Boolean)
    .slice(0, 12);
  const contextSessions = new Map(context.summary.sessions.map((session) => [session.id, session]));
  const contextBriefs = new Map(context.sessions.map((session) => [session.id, session]));
  const unknownIds = sessionIds.filter((id) => !contextSessions.has(id) || !contextBriefs.has(id));
  const selectedSessions = sessionIds.flatMap((id) => contextSessions.get(id) ?? []);
  const selectedBriefs = sessionIds.flatMap((id) => contextBriefs.get(id) ?? []);
  const evidenceText = [
    evidenceTextValue(proposal.title, 120),
    evidenceTextValue(proposal.rationale, 2_000),
    evidenceTextValue(proposal.outcome, 4_000),
    evidenceTextValue(proposal.verification, 2_000),
    evidenceTextValue(proposal.executorReason, 2_000),
    ...evidenceRisks,
    ...evidenceQuestions,
    ...groundingEvidence,
    ...selectedBriefs.flatMap((session) => [session.title, ...session.excerpts.map((excerpt) => excerpt.text)]),
  ].join("\n");
  const proposalTaskText = [
    evidenceTextValue(proposal.title, 120),
    evidenceTextValue(proposal.rationale, 2_000),
    evidenceTextValue(proposal.outcome, 4_000),
    evidenceTextValue(proposal.executorReason, 2_000),
  ].join("\n");
  const executorTaskText = [
    proposalTaskText,
    ...selectedBriefs.map((session) => session.title),
  ].join("\n");
  const requestedPathEvidence = [
    evidenceTextValue(proposal.title, 120),
    evidenceTextValue(proposal.rationale, 2_000),
    evidenceTextValue(proposal.outcome, 4_000),
    evidenceTextValue(proposal.verification, 2_000),
    evidenceTextValue(proposal.executorReason, 2_000),
    ...evidenceRisks,
    ...evidenceQuestions,
    ...groundingEvidence,
    ...selectedBriefs.flatMap((session) => [session.title, ...session.excerpts.map((excerpt) => excerpt.text)]),
  ];
  const roots = selectedSessions.map((session) => workspaceRelation(root, session.workspace));

  const finish = (
    disposition: OvernightDisposition,
    additionalReasons: OvernightReasonCode[] = [],
    executor = chooseExecutor(proposal.executor, executors, executorTaskText),
    overrides: Partial<Pick<OvernightAssessment, "title" | "rationale" | "outcome" | "verification" | "executorReason" | "risks" | "questions">> = {},
  ): OvernightAssessment => {
    const finalReasons = normalizeReasonCodes([...reasonCodes, ...additionalReasons]);
    const finalExclusions = mergeExclusions(
      normalizeExclusions(proposal.excludedSessions, context, sessionIds, root),
      deterministicObservedExclusions(context, sessionIds, root),
    );
    const finalQuestions = disposition === "clarify"
      ? overrides.questions ?? (questions.length > 0
        ? questions
        : clarificationQuestions(finalReasons, {
          korean: /[가-힣]/u.test([title, rationale, outcome, ...selectedBriefs.map((brief) => brief.title)].join(" ")),
          root,
          requestedExecutor: proposal.executor,
          executors,
          selectedSessionCount: selectedBriefs.length,
        }))
      : [];
    return {
      disposition,
      title: overrides.title ?? (title || outcome.slice(0, 120)),
      rationale: overrides.rationale ?? rationale,
      reasonCodes: finalReasons,
      selectedSessions,
      excludedSessions: finalExclusions,
      outcome: overrides.outcome ?? outcome,
      verification: overrides.verification ?? verification,
      executor,
      executorReason: overrides.executorReason ?? executorReason,
      risks: overrides.risks ?? risks,
      questions: finalQuestions,
      durationMinutes: proposal.durationMinutes,
    };
  };

  const claimedNoRunReasons = reasonCodes.filter((reason) => noRunReasons.has(reason));
  const unsupportedNoRunReasons = claimedNoRunReasons.filter((reason) => {
    switch (reason) {
      case "completed": return !completionReasonHasEvidence(sessionIds, selectedBriefs, context.sessions);
      case "outside_root": return !roots.includes("outside") && !hasOutsideRequestedPath(root, requestedPathEvidence);
      case "external_side_effect": return !hasExternalSideEffect(evidenceText);
      case "credentials_required": return !hasCredentialRequirement(evidenceText);
      case "destructive_action": return !hasDestructiveAction(evidenceText);
      case "unverifiable": return isConcreteVerification(verification, proposalTaskText) && !hasMissingVerificationEvidence(evidenceText);
      case "insufficient_context": return !(proposal.requestKind === "discover" && discoverContextUnavailable(context, selectedBriefs)) && !missingContext.test(evidenceText);
      case "unknown_session": return unknownIds.length === 0;
      case "no_executor": return executors.codex || executors.claude;
      case "executor_unauthenticated": return !Object.values(executorBlockers).includes("unauthenticated");
      case "not_relevant": return !topLevelNotRelevantHasEvidence(proposal, proposalTaskText, selectedBriefs, context.sessions, context.summary.sessions, root);
      default: return false;
    }
  });
  if (unsupportedNoRunReasons.length > 0) {
    reasonCodes = reasonCodes.filter((reason) => !unsupportedNoRunReasons.includes(reason));
    if (!reasonCodes.some((reason) => noRunReasons.has(reason))) {
      return finish("no_run", ["insufficient_reasoning"], undefined, unsupportedDecisionCopy(proposal, unsupportedNoRunReasons));
    }
  }
  const claimedClarifyReasons = reasonCodes.filter((reason) => clarifyReasons.has(reason) && !noRunReasons.has(reason));
  const selectedEvidenceText = selectedBriefs.flatMap((brief) => [brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)]).join("\n");
  const proposalDecisionText = [proposalTaskText, ...evidenceQuestions].join("\n");
  const unsupportedClarifyReasons = claimedClarifyReasons.filter((reason) => {
    switch (reason) {
      case "unknown_root": return !roots.includes("unknown");
      case "needs_user_decision": {
        const evidence = selectedBriefs.length > 0
          ? selectedEvidenceText
          : proposal.requestKind === "discover"
            ? context.sessions.flatMap((brief) => [brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)]).join("\n")
            : proposalDecisionText;
        return !(unresolvedDecision.test(evidence) || missingDecision.test(evidence));
      }
      case "too_broad": return !hasRequestedAction(`${selectedEvidenceText}\n${proposalTaskText}`, unboundedScope);
      case "vague_outcome": return !isVagueOutcome(outcome);
      case "executor_unexplained": return executorReason.length >= 24 && executorFitEvidence.test(executorReason);
      case "executor_unavailable": return proposal.executor === "auto" || executors[proposal.executor];
      case "executor_unauthenticated": return proposal.executor === "auto"
        || executors[proposal.executor]
        || executorBlockers[proposal.executor] !== "unauthenticated";
      case "insufficient_reasoning": return false;
      default: return false;
    }
  });
  if (unsupportedClarifyReasons.length > 0) {
    reasonCodes = reasonCodes.filter((reason) => !unsupportedClarifyReasons.includes(reason));
    if (!reasonCodes.some((reason) => clarifyReasons.has(reason))) {
      return finish("no_run", ["insufficient_reasoning"], undefined, unsupportedDecisionCopy(proposal, unsupportedClarifyReasons));
    }
  }
  if (unknownIds.length) return finish("no_run", ["unknown_session"], undefined);
  const explicitNoRunReason = reasonCodes.find((reason) => noRunReasons.has(reason));
  if (explicitNoRunReason) return finish("no_run", [], undefined);
  const explicitClarifyReason = reasonCodes.find((reason) => clarifyReasons.has(reason));
  if (explicitClarifyReason) {
    return proposal.disposition === "clarify" && questions.length === 0
      ? finish("no_run", ["insufficient_context"], undefined)
      : finish("clarify");
  }
  if (hasDestructiveAction(evidenceText)) return finish("no_run", ["destructive_action"], undefined);
  if (hasExternalSideEffect(evidenceText)) return finish("no_run", ["external_side_effect"], undefined);
  if (hasCredentialRequirement(evidenceText)) return finish("no_run", ["credentials_required"], undefined);
  if (hasRequestedAction(evidenceText, unboundedScope)) return finish("clarify", ["too_broad"]);
  if (unresolvedDecision.test(evidenceText)) return finish("clarify", ["needs_user_decision"]);
  if (hasOutsideRequestedPath(root, requestedPathEvidence)) return finish("no_run", ["outside_root"], undefined);

  if (roots.includes("outside")) return finish("no_run", ["outside_root"], undefined);
  if (roots.includes("unknown")) return finish("clarify", ["unknown_root"]);
  if (selectedBriefs.some((brief) => brief.excerpts.length === 0)) {
    const korean = /[가-힣]/u.test(selectedBriefs.map((brief) => brief.title).join(" "));
    return finish("clarify", ["insufficient_context"], undefined, {
      title: korean ? "세션 제목만으로는 계획을 만들 수 없음" : "A session title is not enough to plan from",
      rationale: korean
        ? "선택된 세션의 대화 본문을 읽을 수 없어 미완료 범위와 검증 근거를 확인하지 못했습니다."
        : "The selected conversation body is unavailable, so Morrow cannot verify the unfinished scope or its checks.",
      questions: [korean
        ? "이 작업에서 정확히 끝내야 할 결과와 성공을 확인할 검증 방법은 무엇인가요?"
        : "What exact unfinished outcome and verification should Morrow use instead of this session title?"],
    });
  }

  const completedIds = selectedBriefs
    .filter(sessionHasCompletionEvidence)
    .map((session) => session.id);
  if (selectedBriefs.length === 0 && groundingEvidenceShowsSameWorkCompleted(`${title}\n${outcome}`, proposal.evidence ?? [])) {
    return finish("no_run", ["completed"], undefined);
  }
  const distinctPostCompletionOpportunity = proposal.origin !== undefined
    && proposal.origin !== "continuation"
    && postCompletionOpportunityIsDistinct(proposal, selectedBriefs);
  if (completedIds.length === selectedBriefs.length && completedIds.length > 0 && !distinctPostCompletionOpportunity) {
    return finish("no_run", ["completed"], undefined);
  }
  if (completedIds.length > 0 && !distinctPostCompletionOpportunity) return finish("clarify", ["completed"]);
  if (selectedBriefsHaveUnresolvedVerificationGap(selectedBriefs, proposalTaskText)) {
    const korean = /[가-힣]/u.test([title, ...selectedBriefs.flatMap((brief) => [brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)])].join(" "));
    return finish("clarify", ["unverifiable"], undefined, {
      rationale: korean
        ? "선택된 세션의 최신 근거에서 이 작업의 검증 방법을 확인하지 못해 제안된 명령으로 실행 계획을 만들지 않았습니다."
        : "The latest selected-session evidence does not define how to verify this task, so Morrow did not create a plan from the proposed command.",
    });
  }

  if (proposal.disposition === "no_run") {
    // A refusal is safe, but its explanation still appears as product truth.
    // Do not expose model-authored positive or arbitrary reasons as if they
    // justified excluding the work when no evidence-backed no-run reason
    // survived the checks above.
    reasonCodes = [];
    return finish("no_run", ["insufficient_reasoning"], undefined, unsupportedDecisionCopy(proposal, ["insufficient_reasoning"]));
  }
  if (proposal.disposition === "clarify") {
    return questions.length ? finish("clarify") : finish("no_run", ["insufficient_context"], undefined);
  }
  if (proposal.requestKind === "discover" && sessionIds.length === 0) {
    const groundedStandaloneOpportunity = proposal.origin !== undefined
      && proposal.origin !== "continuation"
      && groundingEvidence.length > 0;
    if (discoverContextUnavailable(context, selectedBriefs) && !groundedStandaloneOpportunity) {
      return finish("no_run", ["insufficient_context"], undefined);
    }
    if (groundedStandaloneOpportunity) {
      // Proactive, batch, and routine work may be grounded in read-only
      // workspace, user-goal, or approved-routine evidence rather than a
      // conversation. All normal scope, safety, verification, and executor
      // checks below still apply.
    } else {
      reasonCodes = [];
      return finish("no_run", ["insufficient_reasoning"], undefined, unsupportedDecisionCopy(proposal, ["insufficient_reasoning"]));
    }
  }
  if (questions.length) return finish("clarify", ["needs_user_decision"]);
  const selectedIdSet = new Set([...sessionIds, ...(proposal.coveredSessionIds ?? [])]);
  const omittedRunnablePriorities = proposal.requestKind === "discover"
    ? context.sessions.filter((brief) => !selectedIdSet.has(brief.id)
      && briefHasExplicitUserPriority(brief)
      && priorityBriefIsRunnable(brief, contextSessions.get(brief.id), root))
    : [];
  if (omittedRunnablePriorities.length > 0) {
    const priority = omittedRunnablePriorities[0];
    const korean = /[가-힣]/u.test(priority.title);
    return finish("clarify", ["insufficient_reasoning"], undefined, {
      title: korean ? "명시한 우선순위와 다른 작업이 선택됨" : "A different task was selected over an explicit priority",
      rationale: korean
        ? `“${priority.title}” 세션에 오늘 밤의 명시적 우선순위가 남아 있지만 다른 작업이 선택되어 계획을 만들지 않았습니다.`
        : `“${priority.title}” is explicitly marked as tonight's priority, but a different task was selected, so no plan was created.`,
      questions: [korean
        ? `오늘 밤에는 “${priority.title}” 작업을 우선할까요, 아니면 현재 선택한 작업으로 우선순위를 바꿀까요?`
        : `Should tonight prioritize “${priority.title}”, or should the currently selected work replace that priority?`],
    });
  }
  if (sessionIds.length > 1 && (!reasonCodes.includes("same_task") || !sessionsShareTaskEvidence(selectedBriefs))) {
    return finish("clarify", ["insufficient_reasoning"]);
  }
  if (selectedBriefs.length > 0 && !selectedBriefs.every((brief) => proposalSharesTaskEvidence(proposalTaskText, brief))) {
    return finish("clarify", ["insufficient_reasoning"]);
  }
  if (!executors.codex && !executors.claude) {
    const reason = Object.values(executorBlockers).includes("unauthenticated") ? "executor_unauthenticated" : "no_executor";
    return finish("no_run", [reason], undefined);
  }

  const executor = chooseExecutor(proposal.executor, executors, executorTaskText);
  if (proposal.executor !== "auto" && !executors[proposal.executor]) {
    const reason = executorBlockers[proposal.executor] === "unauthenticated" ? "executor_unauthenticated" : "executor_unavailable";
    return finish("clarify", [reason], undefined);
  }
  if (!executor) return finish("no_run", ["no_executor"], undefined);
  if (!reasonCodes.includes("overnight_leverage") || !unattendedBenefitEvidence.test(rationale)) {
    return finish("clarify", ["insufficient_reasoning"], executor);
  }
  if (!reasonCodes.some((reason) => positiveReasons.has(reason))) return finish("clarify", ["insufficient_reasoning"], executor);
  if (rationale.length < 24) return finish("clarify", ["insufficient_reasoning"], executor);
  if (isVagueOutcome(outcome)) return finish("clarify", ["vague_outcome"], executor);
  if (!isConcreteVerification(verification, proposalTaskText)) return finish("clarify", ["unverifiable"], executor);
  if (executorReason.length < 24 || !executorFitEvidence.test(executorReason) || !executorReasonMatchesSelection(executorReason, executor)) {
    return finish("clarify", ["executor_unexplained"], executor);
  }

  return finish("recommend", [], executor);
}

function discoverContextUnavailable(
  context: DailyContextSnapshot,
  selectedBriefs: DailyContextSnapshot["sessions"],
) {
  if (selectedBriefs.length > 0) return selectedBriefs.some((brief) => brief.excerpts.length === 0);
  return context.sessions.length === 0 || context.sessions.every((brief) => brief.excerpts.length === 0);
}

function deterministicObservedExclusions(
  context: DailyContextSnapshot,
  selectedIds: string[],
  root: string,
): OvernightExcludedSessionProposal[] {
  const selected = new Set(selectedIds);
  const summaries = new Map(context.summary.sessions.map((summary) => [summary.id, summary]));
  return context.sessions.flatMap((brief): OvernightExcludedSessionProposal[] => {
    if (selected.has(brief.id)) return [];
    const reasonCode = observedExclusionReason(brief, summaries.get(brief.id), root);
    if (!reasonCode) return [];
    const korean = /[가-힣]/u.test(brief.title);
    const label = exclusionReasonLabel(reasonCode, korean);
    const prioritized = briefHasExplicitUserPriority(brief);
    return [{
      sessionId: brief.id,
      reasonCode,
      explanation: limitText(prioritized
        ? korean
          ? `“${brief.title}”에는 명시적 우선순위가 있지만 ${label} 때문에 오늘 밤 실행 문맥에서 제외했습니다.`
          : `“${brief.title}” is explicitly prioritized but was excluded tonight because it ${label}.`
        : korean
          ? `“${brief.title}”은(는) ${label} 때문에 오늘 밤 실행 문맥에서 제외했습니다.`
          : `“${brief.title}” was excluded tonight because it ${label}.`, MAX_SUPPORTING_TEXT),
    }];
  });
}

function observedExclusionReason(
  brief: DailyContextSnapshot["sessions"][number],
  summary: DailySessionSummary | undefined,
  root: string,
): OvernightReasonCode | undefined {
  const relation = workspaceRelation(root, summary?.workspace);
  if (relation === "outside") return "outside_root";
  if (relation === "unknown") return "unknown_root";
  if (brief.excerpts.length === 0) return "insufficient_context";
  const evidence = [brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)].join("\n");
  if (hasDestructiveAction(evidence)) return "destructive_action";
  if (hasExternalSideEffect(evidence)) return "external_side_effect";
  if (hasCredentialRequirement(evidence)) return "credentials_required";
  if (sessionHasCompletionEvidence(brief)) return "completed";
  if (unresolvedDecision.test(evidence) || missingDecision.test(evidence)) return "needs_user_decision";
  if (hasRequestedAction(evidence, unboundedScope)) return "too_broad";
  if (hasMissingVerificationEvidence(evidence)) return "unverifiable";
  return undefined;
}

function exclusionReasonLabel(reason: OvernightReasonCode, korean: boolean) {
  const labels: Partial<Record<OvernightReasonCode, [string, string]>> = {
    completed: ["이미 완료됨", "is already complete"],
    outside_root: ["고정 실행 루트 밖 작업임", "is outside the fixed execution root"],
    unknown_root: ["작업 위치를 확인할 수 없음", "has an unknown workspace"],
    external_side_effect: ["외부 부작용이 필요함", "requires an external side effect"],
    credentials_required: ["자격 증명이 필요함", "requires credentials"],
    destructive_action: ["파괴적 작업이 필요함", "requires destructive work"],
    needs_user_decision: ["사용자 결정이 남아 있음", "still needs a user decision"],
    too_broad: ["범위가 지나치게 큼", "is too broad"],
    unverifiable: ["검증 방법이 없음", "has no usable verification"],
    insufficient_context: ["대화 본문이 없음", "has no readable conversation body"],
  };
  return labels[reason]?.[korean ? 0 : 1] ?? (korean ? "실행 근거가 부족함" : "lacks sufficient execution evidence");
}

function mergeExclusions(...groups: OvernightExcludedSessionProposal[][]) {
  const seen = new Set<string>();
  return groups.flat().filter((item) => {
    if (seen.has(item.sessionId)) return false;
    seen.add(item.sessionId);
    return true;
  });
}

function priorityBriefIsRunnable(
  brief: DailyContextSnapshot["sessions"][number],
  summary: DailySessionSummary | undefined,
  root: string,
) {
  if (!summary || workspaceRelation(root, summary.workspace) !== "inside" || brief.excerpts.length === 0 || sessionHasCompletionEvidence(brief)) return false;
  const evidence = [brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)].join("\n");
  return !hasDestructiveAction(evidence)
    && !hasExternalSideEffect(evidence)
    && !hasCredentialRequirement(evidence)
    && !hasRequestedAction(evidence, unboundedScope)
    && !unresolvedDecision.test(evidence)
    && !missingDecision.test(evidence)
    && !selectedBriefsHaveUnresolvedVerificationGap([brief], evidence);
}

function briefHasExplicitUserPriority(brief: DailyContextSnapshot["sessions"][number]) {
  return brief.excerpts.some((excerpt) => excerpt.role === "user" && hasPositivePrioritySignal(excerpt.text));
}

function normalizeReasonCodes(reasonCodes: OvernightReasonCode[]) {
  const normalized = new Set(reasonCodes);
  if (normalized.has("completed")) {
    normalized.delete("unfinished_work");
    normalized.delete("overnight_leverage");
  }
  if (normalized.has("unverifiable")) normalized.delete("clear_verification");
  if (normalized.has("too_broad")) normalized.delete("bounded_scope");
  return [...normalized];
}

function clarificationQuestions(
  reasons: OvernightReasonCode[],
  options: {
    korean: boolean;
    root: string;
    requestedExecutor: OvernightProposal["executor"];
    executors: Record<OvernightExecutor, boolean>;
    selectedSessionCount: number;
  },
) {
  const { korean, root, requestedExecutor, executors, selectedSessionCount } = options;
  if (reasons.includes("completed")) return [korean
    ? "완료된 세션을 제외하고 아직 미완료인 세션만 별도 작업으로 계속할까요?"
    : "Should Morrow exclude the completed sessions and continue only the unfinished work as a separate task?"];
  if (reasons.includes("unknown_root")) return [korean
    ? `이 세션의 작업이 고정 실행 루트 ${root} 안의 작업이 맞나요?`
    : `Does this session's work belong inside the fixed execution root ${root}?`];
  if (reasons.includes("needs_user_decision")) return [korean
    ? "세션에 남은 선택지 중 오늘 밤 작업자가 구현해야 할 결과는 정확히 어느 쪽인가요?"
    : "Which exact unresolved option should the Overnight worker implement?"];
  if (reasons.includes("too_broad")) return [korean
    ? "오늘 밤 하나의 유한한 작업으로 제한할 사용자 결과는 무엇인가요?"
    : "What single bounded user outcome should tonight's run prioritize?"];
  if (reasons.includes("vague_outcome")) return [korean
    ? "작업이 끝났다고 판정할 수 있는 정확하고 관찰 가능한 결과는 무엇인가요?"
    : "What exact observable outcome would prove this work is finished?"];
  if (reasons.includes("unverifiable")) return [korean
    ? "완료 여부를 판정할 정확한 명령이나 관찰 가능한 검증 결과는 무엇인가요?"
    : "What exact command or observable result should verify completion?"];
  if (reasons.includes("executor_unavailable") || reasons.includes("executor_unauthenticated")) {
    const alternative = requestedExecutor === "codex" && executors.claude ? "Claude"
      : requestedExecutor === "claude" && executors.codex ? "Codex"
        : undefined;
    return [korean
      ? alternative
        ? `선택한 실행기를 사용할 수 없습니다. 준비된 ${alternative}로 이 정확한 작업을 실행해도 될까요?`
        : "선택한 실행기를 설치하거나 로그인한 뒤 이 계획을 다시 준비할까요?"
      : alternative
        ? `The selected executor is not ready. May Morrow prepare this exact task for ${alternative} instead?`
        : "Should Morrow prepare this plan again after the selected executor is installed and signed in?"];
  }
  if (reasons.includes("executor_unexplained")) {
    if (executors.codex && !executors.claude) return [korean
      ? "준비된 Codex가 이 작업의 구현과 검증에 적합한 구체적인 이유는 무엇인가요?"
      : "What concrete task and verification evidence makes the available Codex executor a good fit?"];
    if (executors.claude && !executors.codex) return [korean
      ? "준비된 Claude가 이 작업의 작성과 검토에 적합한 구체적인 이유는 무엇인가요?"
      : "What concrete writing or review evidence makes the available Claude executor a good fit?"];
    return [korean
      ? "이 작업은 저장소 구현·테스트용 Codex와 문서·검토용 Claude 중 어느 실행기에 맡겨야 하나요?"
      : "Should this task use Codex for repository implementation and tests, or Claude for bounded writing and review?"];
  }
  if (reasons.includes("insufficient_context")) return [korean
    ? "오늘 밤 정확히 끝낼 미완료 결과와 그 검증 방법은 무엇인가요?"
    : "What exact unfinished outcome and verification should tonight's run use?"];
  if (reasons.includes("insufficient_reasoning") && selectedSessionCount > 1) return [korean
    ? "선택된 세션들이 가리키는 하나의 동일한 미완료 작업과 검증 방법은 정확히 무엇인가요?"
    : "What one exact unfinished task and verification do these selected sessions share?"];
  return [korean
    ? "오늘 밤 맡길 정확한 미완료 결과, 검증 방법, 구체적인 무인 실행 이득은 무엇인가요?"
    : "What exact unfinished outcome, verification, and concrete unattended-work benefit should this run use?"];
}

function completionReasonHasEvidence(
  selectedIds: string[],
  selectedBriefs: DailyContextSnapshot["sessions"],
  observedBriefs: DailyContextSnapshot["sessions"],
) {
  const briefs = selectedIds.length > 0 ? selectedBriefs : observedBriefs;
  return briefs.length > 0
    && (selectedIds.length === 0 || briefs.length === selectedIds.length)
    && briefs.every(sessionHasCompletionEvidence);
}

function unsupportedDecisionCopy(
  proposal: OvernightProposal,
  reasons: OvernightReasonCode[],
): Pick<OvernightAssessment, "title" | "rationale" | "outcome" | "verification" | "executorReason" | "risks"> {
  const korean = /[가-힣]/u.test([proposal.title, proposal.rationale, ...proposal.questions].join(" "));
  const completionOnly = reasons.every((reason) => reason === "completed");
  return {
    title: completionOnly
      ? korean ? "완료 근거를 확인할 수 없음" : "Completion claim is not supported"
      : korean ? "판단 근거를 확인할 수 없음" : "Decision evidence is not supported",
    rationale: completionOnly
      ? korean
        ? "선택된 세션에서 이 작업의 완료 근거를 확인하지 못해 오늘 밤 실행 계획을 만들지 않았습니다."
        : "The selected sessions do not support the completion claim, so no Overnight plan was created."
      : korean
        ? "제시된 실행 제외 이유를 세션 문맥에서 확인하지 못해 오늘 밤 실행 계획을 만들지 않았습니다."
        : "The proposed reason to exclude this work is not supported by the session context, so no Overnight plan was created.",
    outcome: "",
    verification: "",
    executorReason: "",
    risks: [],
  };
}

function topLevelNotRelevantHasEvidence(
  proposal: OvernightProposal,
  proposalTaskText: string,
  selectedBriefs: DailyContextSnapshot["sessions"],
  observedBriefs: DailyContextSnapshot["sessions"],
  observedSummaries: DailySessionSummary[],
  root: string,
) {
  if (selectedBriefs.length > 0) return selectedBriefs.every((brief) => !proposalSharesTaskEvidence(proposalTaskText, brief));
  if (proposal.requestKind === "goal" && observedBriefs.length > 0) {
    return observedBriefs.every((brief) => !proposalSharesTaskEvidence(proposalTaskText, brief));
  }
  if (proposal.requestKind !== "discover") return false;
  const summaries = new Map(observedSummaries.map((summary) => [summary.id, summary]));
  return !observedBriefs.some((brief) => unfinishedWorkEvidence.test([brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)].join("\n"))
    && priorityBriefIsRunnable(brief, summaries.get(brief.id), root));
}

function chooseExecutor(requested: OvernightProposal["executor"], executors: Record<OvernightExecutor, boolean>, taskText: string): OvernightExecutor | undefined {
  if (requested !== "auto") return executors[requested] ? requested : undefined;
  if (executors.codex && executors.claude && writingAndReviewEvidence.test(taskText) && !repositoryImplementationEvidence.test(taskText)) return "claude";
  if (executors.codex) return "codex";
  if (executors.claude) return "claude";
  return undefined;
}

function executorReasonMatchesSelection(reason: string, executor: OvernightExecutor) {
  const mentionsCodex = /\b(?:gpt\s+)?codex\b/iu.test(reason);
  const mentionsClaude = /\bclaude(?:\s+code)?\b/iu.test(reason);
  if (!mentionsCodex && !mentionsClaude) return true;
  return executor === "codex" ? mentionsCodex : mentionsClaude;
}

function workspaceRelation(root: string, workspace: string | undefined) {
  if (!workspace || !isAbsolute(workspace)) return "unknown" as const;
  const rel = relative(resolve(root), resolve(workspace));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel)) ? "inside" as const : "outside" as const;
}

function hasOutsideRequestedPath(root: string, values: string[]) {
  const fixedRoot = resolve(root);
  return values.some((value) => {
    if (/\b(?:cd|pushd)\s+["']?(?:\.\.(?:[/\\]|(?=["'\s;&|]|$))|\$(?:PWD)\/\.\.|\$\{PWD\}\/\.\.)/iu.test(value)) return true;
    if (/\bfile:\/\/(?!\/)/iu.test(value)) return true;
    const fileUrlPaths = [...value.matchAll(/\bfile:\/\/(\/[^\s,;)"'`]+)/giu)].map((match) => match[1].replace(/[.:]+$/u, ""));
    if (fileUrlPaths.some((path) => workspaceRelation(fixedRoot, path) === "outside")) return true;
    const candidates = [...value.matchAll(/(?:^|[\s("'`])((?:\/|~\/|\$HOME\/|\$\{HOME\}\/|(?:\.\.\/)+)[^\s,;)"'`]+)/gu)].map((match) => match[1].replace(/[.:]+$/u, ""));
    return candidates.some((candidate) => candidate.startsWith("~/")
      || candidate.startsWith("$HOME/")
      || candidate.startsWith("${HOME}/")
      || workspaceRelation(fixedRoot, candidate.startsWith("/") ? candidate : resolve(fixedRoot, candidate)) === "outside");
  });
}

function isVagueOutcome(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();
  if (normalized.length < 8 || vagueOutcomes.has(normalized) || vagueOutcomePattern.test(normalized)) return true;
  return normalized.length < 24 && !observableOutcome.test(normalized);
}

function isConcreteVerification(value: string, taskText: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  if (vagueVerification.test(normalized)
    || maskedVerificationShell.test(normalized)
    || optionalVerification.test(normalized)
    || (waivedVerificationFailure.test(normalized) && !enforcedVerificationFailure.test(normalized))) return false;
  if (exactVerificationCommand.test(normalized) || verificationCommand.test(normalized)) {
    return verificationCommandMatchesTask(normalized, taskText);
  }
  // A command-shaped instruction must use the same grammar as the result
  // collector. Otherwise it could fall through as an observable check and be
  // promoted by final-report prose without a structured execution receipt.
  if (unrecognizedVerificationCommand.test(normalized)) return false;
  return observableVerificationTarget.test(normalized)
    && observableVerificationPredicate.test(normalized)
    && intersects(taskTokens(normalized), taskTokens(taskText));
}

function verificationCommandMatchesTask(command: string, taskText: string) {
  const explicitTarget = command.match(/\s--\s+([^\s;&|]+)/u)?.[1];
  if (!explicitTarget) return true;
  const targets = taskTokens(explicitTarget.replace(/[-_/]+/gu, " "));
  const task = taskTokens(taskText.replace(/[-_/]+/gu, " "));
  if (targets.size === 0 || intersects(targets, task)) return true;
  if (/[가-힣]/u.test(taskText) && [...targets].every((token) => /^[a-z0-9]+$/u.test(token))) return true;
  return [...targets].some((target) => [...task].some((token) => target.length >= 4
    && token.length >= 4
    && (target.startsWith(token) || token.startsWith(target))));
}

function selectedBriefsHaveUnresolvedVerificationGap(
  briefs: DailyContextSnapshot["sessions"],
  taskText: string,
) {
  const states = briefs.flatMap((brief) => {
    const state = latestBriefVerificationState(brief, taskText);
    const parsedUpdatedAt = brief.updatedAt ? Date.parse(brief.updatedAt) : Number.NaN;
    return state ? [{ state, updatedAt: Number.isFinite(parsedUpdatedAt) ? parsedUpdatedAt : undefined }] : [];
  });
  if (!states.some(({ state }) => state === "gap")) return false;
  if (states.some(({ updatedAt }) => updatedAt === undefined)) return true;
  const latestTimestamp = Math.max(...states.map(({ updatedAt }) => updatedAt!));
  return states.some(({ state, updatedAt }) => updatedAt === latestTimestamp && state === "gap");
}

function latestBriefVerificationState(
  brief: DailyContextSnapshot["sessions"][number],
  taskText: string,
) {
  let state: "gap" | "concrete" | undefined;
  brief.excerpts.forEach((excerpt) => {
    splitEvidenceClauses(excerpt.text).forEach((clause) => {
      if (hasMissingVerificationEvidence(clause)) state = "gap";
      if (isConcreteVerification(clause, taskText)) state = "concrete";
    });
  });
  return state;
}

function hasMissingVerificationEvidence(value: string) {
  return missingVerification.test(value) && !successfulNoFailureVerification.test(value);
}

function hasExternalSideEffect(value: string) {
  return hasRequestedAction(value, [externalSideEffect, naturalLanguageExternalSideEffect, externalTrackerMutation]);
}

function hasDestructiveAction(value: string) {
  return hasRequestedAction(value, [destructiveAction, naturalLanguageDestructiveAction]);
}

function hasRequestedAction(value: string, patterns: RegExp | readonly RegExp[]) {
  const requestedPatterns = Array.isArray(patterns) ? patterns : [patterns];
  return splitEvidenceClauses(value)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some((clause) => requestedPatterns.some((pattern) => patternRequestsAction(clause, pattern)));
}

function patternRequestsAction(clause: string, pattern: RegExp) {
  const action = pattern.exec(clause);
  if (!action) return false;
  if (syntheticUnsafeEvidence.test(clause) && nonExecutionEvidence.test(clause)) return false;
  if (negationRequiringAction.test(clause)) return true;
  const negation = negatedAction.exec(clause);
  if (!negation) return true;
  // “Deploy … without changing metadata” still requests deployment. In
  // contrast, “without deploying” places the negation before the action.
  return negation.index > action.index && /^without\b/iu.test(negation[0]);
}

function hasCredentialRequirement(value: string) {
  return splitEvidenceClauses(value)
    .map((clause) => clause.trim())
    .filter(Boolean)
    .some((clause) => (credentialRequirement.test(clause)
      || credentialEnvironmentRequirement.test(clause)
      || credentialValue.test(clause)
      || (credentialedCliUse.test(clause) && !credentialFreeCliProbe.test(clause)))
      && (!negatedAction.test(clause) || negationRequiringAction.test(clause))
      && !syntheticCredentialRequirement.test(clause)
      && !syntheticCredentialEnvironment.test(clause)
      && !(syntheticUnsafeEvidence.test(clause) && nonExecutionEvidence.test(clause)));
}

function hasCompletionEvidence(value: string) {
  return completionEvidence.test(value)
    && !completionQuestion.test(value)
    && !completionLabelRequest.test(value)
    && !negatedCompletion.test(value)
    && !incompleteContinuation.test(value)
    && !prospectiveCompletion.test(value)
    && !pendingAfterCompletion.test(value);
}

function splitEvidenceClauses(value: string) {
  // A standalone dot is commonly a command/path argument (`git checkout -- .`,
  // `find . -delete`), so only treat dots attached to preceding text as stops.
  // Contrast conjunctions start a new authorization claim: negating the first
  // action must not excuse a dangerous action after “but/however/대신”.
  return value.split(/(?:[\n!?;]+|(?<!\s)\.(?=\s|$)|(?:,\s*)?\b(?:but|however|instead|then|and\s+then)\b|\band\b(?=\s+(?:run|execute|use|enter|deploy|publish|post|send|share|create|delete|remove|truncate|push|upload|invoke|trigger)\b)|(?:,?\s*)(?:하지만|그러나|대신)(?:\s*)|지만(?=\s))/iu);
}

function sessionHasCompletionEvidence(session: DailyContextSnapshot["sessions"][number]) {
  let lastAssistantIndex = -1;
  for (let index = session.excerpts.length - 1; index >= 0; index -= 1) {
    if (session.excerpts[index].role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  let completionIndex = -1;
  for (let index = session.excerpts.length - 1; index >= 0; index -= 1) {
    const excerpt = session.excerpts[index];
    const authoritativeStatus = excerpt.role === "assistant" || (excerpt.role === "user" && index >= lastAssistantIndex);
    if (authoritativeStatus && hasCompletionEvidence(excerpt.text)) {
      completionIndex = index;
      break;
    }
  }
  if (completionIndex < 0) return false;
  const titleTokens = taskTokens(session.title);
  const completionTokens = taskSpecificCompletionTokens(session.excerpts[completionIndex].text);
  if (titleTokens.size > 0 && completionTokens.size > 0 && !intersects(titleTokens, completionTokens)) return false;
  if (titleTokens.size > 0 && completionTokens.size === 0) {
    const precedingUser = session.excerpts.slice(0, completionIndex).reverse().find((excerpt) => excerpt.role === "user");
    if (!precedingUser || !intersects(titleTokens, taskTokens(precedingUser.text))) return false;
  }
  const laterText = session.excerpts
    .slice(completionIndex + 1)
    .map((excerpt) => excerpt.text)
    .join("\n");
  return !actionableFollowup.test(laterText) && !incompleteContinuation.test(laterText);
}

function groundingEvidenceShowsSameWorkCompleted(
  proposalTaskText: string,
  evidence: NonNullable<OvernightProposal["evidence"]>,
) {
  const proposed = taskTokens(proposalTaskText);
  const proposedShapes = workShapeTokens(proposalTaskText);
  return evidence.some((item) => {
    if (!["session", "workspace", "user_goal", "routine"].includes(item.source) || !hasCompletionEvidence(item.summary)) return false;
    if (!hasStrongTaskOverlap(proposed, taskTokens(item.summary))) return false;
    const observedShapes = workShapeTokens(item.summary);
    return proposedShapes.size === 0
      || observedShapes.size === 0
      || intersects(proposedShapes, observedShapes);
  });
}

function workShapeTokens(value: string) {
  const shapes = new Set<string>();
  const normalized = value.toLowerCase();
  if (/(?:\b(?:fix|repair|resolve)\b|수정|복구)/iu.test(normalized)) shapes.add("repair");
  if (/(?:\b(?:audit|scan|inventory)\b|감사|스캔|인벤토리)/iu.test(normalized)) shapes.add("audit");
  if (/(?:\b(?:document|documentation|docs?|report)\b|문서|보고서)/iu.test(normalized)) shapes.add("documentation");
  if (/(?:\b(?:test|tests|testing|coverage)\b|테스트|커버리지)/iu.test(normalized)) shapes.add("test");
  if (/(?:\b(?:implement|implementation)\b|구현)/iu.test(normalized)) shapes.add("implementation");
  if (/(?:\b(?:benchmark|measure|profile)\b|벤치마크|측정|프로파일)/iu.test(normalized)) shapes.add("measurement");
  if (/(?:\b(?:migrate|migration|upgrade)\b|마이그레이션|업그레이드)/iu.test(normalized)) shapes.add("migration");
  if (/(?:\b(?:refactor|cleanup|rename)\b|리팩터링|정리|이름\s*변경)/iu.test(normalized)) shapes.add("maintenance");
  return shapes;
}

function postCompletionOpportunityIsDistinct(
  proposal: OvernightProposal,
  sessions: DailyContextSnapshot["sessions"],
) {
  if (sessions.length === 0) return (proposal.evidence?.length ?? 0) > 0;
  const proposed = taskTokens([proposal.title, proposal.outcome].join(" "));
  const observed = taskTokens(sessions.map((session) => session.title).join(" "));
  const introducesNewSubject = [...proposed].some((token) => !observed.has(token));
  const proposesNewWorkShape = /(?:\b(?:add|audit|benchmark|cleanup|cover(?:age)?|document|harden|measure|migrate|rename|report|review|sample|scan|stress|upgrade)\b|\b(?:batch|routine)\b|추가|감사|벤치마크|정리|회귀\s*테스트|문서|강화|측정|마이그레이션|이름\s*변경|보고서|검토|샘플|스캔|업그레이드)/iu
    .test([proposal.title, proposal.outcome].join("\n"));
  return introducesNewSubject && (proposesNewWorkShape || (proposal.evidence?.length ?? 0) > 0);
}

function taskSpecificCompletionTokens(value: string) {
  return new Set([...taskTokens(value)].filter((token) => !completionStatusToken.test(token)));
}

function sessionsShareTaskEvidence(sessions: DailyContextSnapshot["sessions"]) {
  if (sessions.length < 2) return true;
  const tokenSets = sessions.map((session) => taskTokens([session.title, ...session.excerpts.map((excerpt) => excerpt.text)].join(" ")));
  for (let left = 0; left < tokenSets.length; left += 1) {
    for (let right = left + 1; right < tokenSets.length; right += 1) {
      if (!hasStrongTaskOverlap(tokenSets[left], tokenSets[right])) return false;
    }
  }
  return true;
}

function hasStrongTaskOverlap(left: Set<string>, right: Set<string>) {
  const shared = [...left].filter((token) => right.has(token));
  return shared.length >= 2 || shared.some((token) => /\d|[_-]/u.test(token));
}

function proposalSharesTaskEvidence(taskText: string, session: DailyContextSnapshot["sessions"][number]) {
  const proposedTokens = taskTokens(taskText);
  const sessionTokens = taskTokens([session.title, ...session.excerpts.map((excerpt) => excerpt.text)].join(" "));
  return intersects(proposedTokens, sessionTokens);
}

function taskTokens(value: string) {
  const expanded = value.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  return new Set(expanded.match(/[\p{L}\p{N}_-]+/gu)
    ?.map((token) => token.replace(/(?:은|는|이|가|을|를|의|에|에서|으로|와|과)$/u, ""))
    .map((token) => /^[a-z]{5,}s$/u.test(token) && !/ss$/u.test(token) ? token.slice(0, -1) : token)
    .filter((token) => (token.length >= 3 || (token.length >= 2 && /[가-힣]/u.test(token))) && !taskStopWords.has(token)) ?? []);
}

function intersects(left: Set<string>, right: Set<string>) {
  return [...left].some((token) => right.has(token));
}

function normalizeExclusions(
  proposed: OvernightExcludedSessionProposal[],
  context: DailyContextSnapshot,
  selectedIds: string[],
  root: string,
) {
  const selected = new Set(selectedIds);
  const summaries = new Map(context.summary.sessions.map((session) => [session.id, session]));
  const briefs = new Map(context.sessions.map((session) => [session.id, session]));
  const selectedBriefs = selectedIds.flatMap((id) => briefs.get(id) ?? []);
  const seen = new Set<string>();
  return proposed.flatMap((item) => {
    const explanation = limitText(item.explanation, MAX_SUPPORTING_TEXT);
    const summary = summaries.get(item.sessionId);
    const brief = briefs.get(item.sessionId);
    if (!summary || !brief || selected.has(item.sessionId) || seen.has(item.sessionId) || !explanation) return [];
    if (!exclusionReasonHasEvidence(item.reasonCode, summary, brief, root, selectedBriefs)) return [];
    seen.add(item.sessionId);
    return [{ ...item, explanation }];
  });
}

function exclusionReasonHasEvidence(
  reason: OvernightReasonCode,
  summary: DailySessionSummary,
  brief: DailyContextSnapshot["sessions"][number],
  root: string,
  selectedBriefs: DailyContextSnapshot["sessions"],
) {
  const evidence = [brief.title, ...brief.excerpts.map((excerpt) => excerpt.text)].join("\n");
  switch (reason) {
    case "completed": return sessionHasCompletionEvidence(brief);
    case "outside_root": return workspaceRelation(root, summary.workspace) === "outside";
    case "unknown_root": return workspaceRelation(root, summary.workspace) === "unknown";
    case "external_side_effect": return hasExternalSideEffect(evidence);
    case "credentials_required": return hasCredentialRequirement(evidence);
    case "destructive_action": return hasDestructiveAction(evidence);
    case "needs_user_decision": return unresolvedDecision.test(evidence) || missingDecision.test(evidence);
    case "too_broad": return hasRequestedAction(evidence, unboundedScope);
    case "unverifiable": return hasMissingVerificationEvidence(evidence);
    case "insufficient_context": return missingContext.test(evidence);
    // Relevance is a comparison with the chosen task rather than a property of
    // one brief. If there is no selected evidence, or any selected brief shares
    // a concrete task token, do not let the model discard this context as
    // unrelated merely by asserting a reason code.
    case "not_relevant": return selectedBriefs.length > 0
      && !selectedBriefs.some((selectedBrief) => sessionsShareTaskEvidence([selectedBrief, brief]));
    default: return false;
  }
}

function normalizeTextList(items: string[], limit: number) {
  return unique(items.map((item) => limitText(item, MAX_SUPPORTING_TEXT)).filter(Boolean)).slice(0, limit);
}

function normalizeEvidenceTextList(items: string[], limit: number) {
  return unique(items.map((item) => evidenceTextValue(item, MAX_SUPPORTING_TEXT)).filter(Boolean)).slice(0, limit);
}

function evidenceTextValue(value: string, limit: number) {
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim().slice(0, limit);
}

function limitText(value: string, limit: number) {
  const normalized = value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return redactSensitive(normalized).trim().slice(0, limit);
}

function unique<T>(items: T[]) {
  return [...new Set(items)];
}
