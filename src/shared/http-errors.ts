export function openAiError(statusCode: number, message: string, type: string, code?: string) {
  return {
    statusCode,
    body: {
      error: {
        message,
        type,
        code
      }
    }
  };
}
