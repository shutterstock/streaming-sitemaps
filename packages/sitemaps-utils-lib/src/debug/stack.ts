export const rebindStack =
  (stack: string) =>
  (error: Error): never => {
    error.stack += '\n' + stack;
    throw error;
  };

export const getStack = (): string => {
  const stack = new Error('Original Stack Dump').stack || '';

  const lines = stack.split('\n') || [];
  if (lines[1].includes('at getStack')) {
    return [lines[0], ...lines.slice(2)].join('\n');
  }

  return stack;
};
