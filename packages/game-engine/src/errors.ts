export type EngineErrorCode =
  | "INVALID_CARD_COUNT"
  | "INVALID_CARD"
  | "DUPLICATE_CARD"
  | "INVALID_RANDOM_VALUE";

export class EngineValidationError extends Error {
  override readonly name = "EngineValidationError";

  constructor(public readonly code: EngineErrorCode, message: string) {
    super(message);
  }
}
