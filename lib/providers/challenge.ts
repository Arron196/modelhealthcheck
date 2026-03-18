/**
 * 随机挑战生成器
 *
 * 生成随机数学题用于验证 AI 回复的真实性，
 * 防止假站点用固定回复绕过检测
 */

export interface Challenge {
  /** 发送给模型的问题 */
  prompt: string;
  /** 期望的正确答案 */
  expectedAnswer: string;
}

interface BinaryArithmeticCase {
  expression: string;
  claimedAnswer: number;
  expectedAnswer: "yes" | "no";
}

interface CheckCxChallengeConfig {
  challengeMode?: "numeric" | "yes_no_arithmetic";
  promptInstruction?: string;
  cases?: BinaryArithmeticCase[];
}

interface ChallengeMetadata {
  checkCx?: CheckCxChallengeConfig;
}

const DEFAULT_BINARY_ARITHMETIC_CASES: BinaryArithmeticCase[] = [
  {expression: "1 + 1", claimedAnswer: 2, expectedAnswer: "yes"},
  {expression: "1 + 2", claimedAnswer: 4, expectedAnswer: "no"},
  {expression: "2 + 2", claimedAnswer: 4, expectedAnswer: "yes"},
  {expression: "3 - 1", claimedAnswer: 1, expectedAnswer: "no"},
];

/**
 * 构建带有 few-shot 示例的 prompt
 *
 * 通过示例引导模型仅输出数字结果，减少验证失败率
 *
 * @param question - 实际的数学问题
 * @returns 包含示例的完整 prompt
 */
function buildPromptWithExamples(question: string): string {
  return `Calculate and respond with ONLY the number, nothing else.

Q: 3 + 5 = ?
A: 8

Q: 12 - 7 = ?
A: 5

Q: ${question}
A:`;
}

function buildBinaryArithmeticPrompt(challengeCase: BinaryArithmeticCase, instruction?: string): string {
  const promptInstruction =
    instruction?.trim() ||
    "Read the arithmetic statement and answer with ONLY yes or no in lowercase.";

  return `${promptInstruction}

Q: Is 1 + 1 = 2?
A: yes

Q: Is 1 + 2 = 4?
A: no

Q: Is ${challengeCase.expression} = ${challengeCase.claimedAnswer}?
A:`;
}

function normalizeBinaryArithmeticCase(value: unknown): BinaryArithmeticCase | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const row = value as Record<string, unknown>;
  const expression = typeof row.expression === "string" ? row.expression.trim() : "";
  const claimedAnswer = typeof row.claimedAnswer === "number" ? row.claimedAnswer : Number.NaN;
  const expectedAnswer = row.expectedAnswer === "yes" || row.expectedAnswer === "no" ? row.expectedAnswer : null;

  if (!expression || Number.isNaN(claimedAnswer) || !expectedAnswer) {
    return null;
  }

  return {expression, claimedAnswer, expectedAnswer};
}

function getChallengeConfig(metadata?: Record<string, unknown> | null): CheckCxChallengeConfig | null {
  const candidate = metadata?.checkCx;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return null;
  }

  const config = candidate as Record<string, unknown>;
  const cases = Array.isArray(config.cases)
    ? config.cases.map(normalizeBinaryArithmeticCase).filter((item): item is BinaryArithmeticCase => Boolean(item))
    : undefined;

  const challengeMode =
    config.challengeMode === "yes_no_arithmetic" || config.challengeMode === "numeric"
      ? config.challengeMode
      : undefined;

  return {
    challengeMode,
    promptInstruction:
      typeof config.promptInstruction === "string" ? config.promptInstruction : undefined,
    cases,
  };
}

/**
 * 生成一个随机数学挑战
 *
 * 使用简单的加减法，确保所有 LLM 都能正确计算
 */
export function generateChallenge(metadata?: ChallengeMetadata | null): Challenge {
  const challengeConfig = getChallengeConfig(metadata as Record<string, unknown> | null | undefined);
  if (challengeConfig?.challengeMode === "yes_no_arithmetic") {
    const cases =
      challengeConfig.cases && challengeConfig.cases.length > 0
        ? challengeConfig.cases
        : DEFAULT_BINARY_ARITHMETIC_CASES;
    const challengeCase = cases[Math.floor(Math.random() * cases.length)];

    return {
      prompt: buildBinaryArithmeticPrompt(challengeCase, challengeConfig.promptInstruction),
      expectedAnswer: challengeCase.expectedAnswer,
    };
  }

  // 生成 1-50 范围内的随机数，避免数字太大或太小
  const a = Math.floor(Math.random() * 50) + 1;
  const b = Math.floor(Math.random() * 50) + 1;

  // 随机选择加法或减法
  const isAddition = Math.random() > 0.5;

  if (isAddition) {
    const answer = a + b;
    return {
      prompt: buildPromptWithExamples(`${a} + ${b} = ?`),
      expectedAnswer: String(answer),
    };
  } else {
    // 确保结果为正数（大数减小数）
    const larger = Math.max(a, b);
    const smaller = Math.min(a, b);
    const answer = larger - smaller;
    return {
      prompt: buildPromptWithExamples(`${larger} - ${smaller} = ?`),
      expectedAnswer: String(answer),
    };
  }
}

/** 验证结果 */
export interface ValidationResult {
  /** 是否验证通过 */
  valid: boolean;
  /** 从回复中提取到的数字(用于显示) */
  extractedNumbers: string[] | null;
}

/**
 * 验证模型回复是否包含正确答案
 *
 * @param response 模型的回复内容
 * @param expectedAnswer 期望的答案
 * @returns 验证结果,包含是否通过和提取到的数字
 */
export function validateResponse(
  response: string,
  expectedAnswer: string,
  metadata?: ChallengeMetadata | null
): ValidationResult {
  if (!response || !expectedAnswer) {
    return { valid: false, extractedNumbers: null };
  }

  const challengeConfig = getChallengeConfig(metadata as Record<string, unknown> | null | undefined);
  if (challengeConfig?.challengeMode === "yes_no_arithmetic") {
    const normalized = response.trim().toLowerCase();
    if (!normalized) {
      return {valid: false, extractedNumbers: null};
    }

    const match = normalized.match(/\b(yes|no)\b/);
    return {
      valid: match?.[1] === expectedAnswer.toLowerCase(),
      extractedNumbers: match ? [match[1]] : [normalized],
    };
  }

  // 从回复中提取所有数字
  const numbers = response.match(/-?\d+/g);
  if (!numbers) {
    return { valid: false, extractedNumbers: null };
  }

  // 检查是否包含正确答案
  const valid = numbers.includes(expectedAnswer);
  return { valid, extractedNumbers: numbers };
}
