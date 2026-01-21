import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  searchPhotos,
  getTriathlonPhoto,
  getPhotosForQuery,
  checkPexelsHealth,
} from './pexels';
import { mockPexelsResponses, createMockFetchResponse } from '../test/mocks';

// Mock the env module
vi.mock('../lib/env', () => ({
  getEnv: vi.fn(() => ({
    PEXELS_API_KEY: 'test-pexels-key',
  })),
}));

import { getEnv } from '../lib/env';

// Mock global fetch
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('Pexels Service', () => {
  beforeEach(() => {
    vi.resetAllMocks();  // Reset all mocks including queued responses
    mockFetch.mockReset();  // Ensure fetch mock is fully reset
    (getEnv as ReturnType<typeof vi.fn>).mockReturnValue({
      PEXELS_API_KEY: 'test-pexels-key',
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('searchPhotos', () => {
    it('should search for photos and return results', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockPexelsResponses.searchPhotos)
      );

      const result = await searchPhotos('triathlon');

      expect(result).not.toBeNull();
      expect(result!.photos).toHaveLength(1);
      expect(result!.totalResults).toBe(100);

      // Verify request
      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('api.pexels.com/v1/search');
      expect(fetchCall[0]).toContain('query=triathlon');
      expect(fetchCall[1].headers.Authorization).toBe('test-pexels-key');
    });

    it('should use custom perPage and page options', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockPexelsResponses.searchPhotos)
      );

      await searchPhotos('swimming', { perPage: 10, page: 2 });

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('per_page=10');
      expect(fetchCall[0]).toContain('page=2');
    });

    it('should return null when API key is not configured', async () => {
      (getEnv as ReturnType<typeof vi.fn>).mockReturnValue({
        PEXELS_API_KEY: '',
      });

      const result = await searchPhotos('triathlon');

      expect(result).toBeNull();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('should return null on API error', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'Invalid API key' }, false, 401)
      );

      const result = await searchPhotos('triathlon');

      expect(result).toBeNull();
    });

    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      const result = await searchPhotos('triathlon');

      expect(result).toBeNull();
    });

    it('should URL encode the query', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockPexelsResponses.searchPhotos)
      );

      await searchPhotos('triathlon training workout');

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('triathlon%20training%20workout');
    });
  });

  describe('getTriathlonPhoto', () => {
    it('should return a random triathlon photo', async () => {
      const multiPhotoResponse = {
        ...mockPexelsResponses.searchPhotos,
        photos: [
          ...mockPexelsResponses.searchPhotos.photos,
          {
            ...mockPexelsResponses.searchPhotos.photos[0],
            id: 456,
            photographer: 'Jane Smith',
          },
        ],
      };

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(multiPhotoResponse)
      );

      const result = await getTriathlonPhoto();

      expect(result).not.toBeNull();
      expect(result!.type).toBe('image');
      expect(result!.source).toBe('pexels');
      expect(result!.url).toContain('large');
      expect(result!.thumbnail).toContain('small');
      expect(result!.attribution).toContain('Photo by');
      expect(result!.attribution).toContain('on Pexels');
    });

    it('should return null when no photos found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          total_results: 0,
          page: 1,
          per_page: 15,
          photos: [],
        })
      );

      const result = await getTriathlonPhoto();

      expect(result).toBeNull();
    });

    it('should return null on API failure', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'Error' }, false, 500)
      );

      const result = await getTriathlonPhoto();

      expect(result).toBeNull();
    });
  });

  describe('getPhotosForQuery', () => {
    it('should return multiple photos for a query', async () => {
      const multiPhotoResponse = {
        total_results: 50,
        page: 1,
        per_page: 6,
        photos: Array(6).fill(null).map((_, i) => ({
          ...mockPexelsResponses.searchPhotos.photos[0],
          id: i + 1,
          photographer: `Photographer ${i + 1}`,
          src: {
            ...mockPexelsResponses.searchPhotos.photos[0].src,
            large: `https://images.pexels.com/photos/${i + 1}/large.jpg`,
            small: `https://images.pexels.com/photos/${i + 1}/small.jpg`,
          },
        })),
      };

      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(multiPhotoResponse)
      );

      const result = await getPhotosForQuery('cycling', 3);

      expect(result).toHaveLength(3);
      result.forEach((photo) => {
        expect(photo.type).toBe('image');
        expect(photo.source).toBe('pexels');
        expect(photo.searchQuery).toBe('cycling');
      });
    });

    it('should return empty array when no photos found', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          total_results: 0,
          page: 1,
          per_page: 6,
          photos: [],
        })
      );

      const result = await getPhotosForQuery('nonexistent');

      expect(result).toEqual([]);
    });

    it('should return fewer photos if not enough results', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          total_results: 2,
          page: 1,
          per_page: 6,
          photos: mockPexelsResponses.searchPhotos.photos.slice(0, 2),
        })
      );

      // Duplicate the photo for the test
      mockFetch.mock.calls = [];
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({
          total_results: 1,
          page: 1,
          per_page: 6,
          photos: mockPexelsResponses.searchPhotos.photos,
        })
      );

      const result = await getPhotosForQuery('rare query', 5);

      expect(result.length).toBeLessThanOrEqual(5);
    });

    it('should request double the count for variety', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockPexelsResponses.searchPhotos)
      );

      await getPhotosForQuery('triathlon', 3);

      const fetchCall = mockFetch.mock.calls[0];
      expect(fetchCall[0]).toContain('per_page=6'); // 3 × 2 = 6
    });
  });

  describe('checkPexelsHealth', () => {
    it('should return ok when API is working', async () => {
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse(mockPexelsResponses.searchPhotos)
      );

      const result = await checkPexelsHealth();

      expect(result).toEqual({ ok: true });
    });

    it('should return error when API key is not configured', async () => {
      (getEnv as ReturnType<typeof vi.fn>).mockReturnValue({
        PEXELS_API_KEY: '',
      });

      const result = await checkPexelsHealth();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('not configured');
    });

    it('should return error when API fails', async () => {
      // Ensure API key is configured so we don't return early
      (getEnv as ReturnType<typeof vi.fn>).mockReturnValue({
        PEXELS_API_KEY: 'test-pexels-key',
      });

      // When fetch returns non-ok status, searchPhotos returns null
      // which checkPexelsHealth treats as a failure
      mockFetch.mockResolvedValueOnce(
        createMockFetchResponse({ error: 'Error' }, false, 500)
      );

      const result = await checkPexelsHealth();

      expect(result.ok).toBe(false);
      expect(result.error).toContain('Failed to connect to Pexels API');
    });
  });
});
