import { expect, it, vi } from 'vitest';
import { getHealth, ApiError } from './api';
it.each(['lane', 'track'])(
  'preserves_safe_repair_identifiers_and_error_code_from_%s',
  async (field) => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 422,
        json: async () => ({
          error: {
            message: 'Repair this range.',
            code: 'invalid_range',
            [field]: field === 'track' ? 'independent_audio' : 'independent',
            segment_id: 'audio-1',
            source_id: 'source-1',
          },
        }),
      }),
    );
    await expect(getHealth()).rejects.toMatchObject({
      status: 422,
      code: 'invalid_range',
      lane: 'independent',
      segmentId: 'audio-1',
      sourceId: 'source-1',
    });
  },
);
it('network_failure_uses_AVStudio_brand_and_preserves_status', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('offline')));
  await expect(getHealth()).rejects.toMatchObject({
    message:
      'Could not reach AVStudio. Check your connection and make sure the backend is running.',
    status: 0,
  });
  await expect(getHealth()).rejects.toBeInstanceOf(ApiError);
});
