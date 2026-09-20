import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, vi } from 'vitest';
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
Object.defineProperty(URL, 'createObjectURL', {
  writable: true,
  value: vi.fn(() => 'blob:clip'),
});
Object.defineProperty(URL, 'revokeObjectURL', {
  writable: true,
  value: vi.fn(),
});
