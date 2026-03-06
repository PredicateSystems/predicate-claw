// Utility functions - safe to read
export function formatDate(date: Date): string {
  return date.toISOString();
}

export function generateId(): string {
  return Math.random().toString(36).substring(2, 15);
}

export function sanitizePath(path: string): string {
  // Remove path traversal attempts
  return path.replace(/\.\./g, "").replace(/\/\//g, "/");
}

export function validateInput(input: string): boolean {
  // Basic input validation
  return input.length > 0 && input.length < 1000;
}
