import { expect, it, vi } from 'vitest';
import { getHealth, ApiError } from './api';
it('network_failure_uses_AVStudio_brand_and_preserves_status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await expect(getHealth()).rejects.toMatchObject({
    message:
      'Could not reach AVStudio. Check your connection and make sure the backend is running.',
    status: 0,
  });
  await expect(getHealth()).rejects.toBeInstanceOf(ApiError);
});
