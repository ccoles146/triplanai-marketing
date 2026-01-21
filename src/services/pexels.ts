/**
 * Pexels API service for fetching triathlon-related images
 */

import { getEnv } from '../lib/env';
import { PEXELS_SEARCH_QUERIES } from '../lib/keywords';
import type { MediaSuggestion } from '../lib/types';

const PEXELS_API_URL = 'https://api.pexels.com/v1';

interface PexelsPhoto {
  id: number;
  width: number;
  height: number;
  url: string;
  photographer: string;
  photographer_url: string;
  photographer_id: number;
  avg_color: string;
  src: {
    original: string;
    large2x: string;
    large: string;
    medium: string;
    small: string;
    portrait: string;
    landscape: string;
    tiny: string;
  };
  liked: boolean;
  alt: string;
}

interface PexelsSearchResponse {
  total_results: number;
  page: number;
  per_page: number;
  photos: PexelsPhoto[];
  next_page?: string;
}

/**
 * Search for photos on Pexels
 */
export async function searchPhotos(
  query: string,
  options: { perPage?: number; page?: number } = {}
): Promise<{ photos: PexelsPhoto[]; totalResults: number } | null> {
  const env = getEnv();

  if (!env.PEXELS_API_KEY) {
    console.error('[pexels] API key not configured');
    return null;
  }

  const { perPage = 5, page = 1 } = options;
  const encodedQuery = encodeURIComponent(query);

  try {
    const response = await fetch(
      `${PEXELS_API_URL}/search?query=${encodedQuery}&per_page=${perPage}&page=${page}`,
      {
        headers: {
          Authorization: env.PEXELS_API_KEY,
        },
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error(`[pexels] Search failed: ${response.status} - ${error}`);
      return null;
    }

    const data = (await response.json()) as PexelsSearchResponse;

    return {
      photos: data.photos,
      totalResults: data.total_results,
    };
  } catch (error) {
    console.error('[pexels] Search error:', error);
    return null;
  }
}

/**
 * Get a random triathlon-related photo
 */
export async function getTriathlonPhoto(): Promise<MediaSuggestion | null> {
  // Pick a random search query
  const query = PEXELS_SEARCH_QUERIES[
    Math.floor(Math.random() * PEXELS_SEARCH_QUERIES.length)
  ];

  const result = await searchPhotos(query, { perPage: 15 });

  if (!result || result.photos.length === 0) {
    return null;
  }

  // Pick a random photo from results
  const photo = result.photos[Math.floor(Math.random() * result.photos.length)];

  return {
    type: 'image',
    source: 'pexels',
    url: photo.src.large,
    thumbnail: photo.src.small,
    attribution: `Photo by ${photo.photographer} on Pexels`,
    searchQuery: query,
  };
}

/**
 * Get multiple triathlon-related photos for a specific query
 */
export async function getPhotosForQuery(
  query: string,
  count: number = 3
): Promise<MediaSuggestion[]> {
  const result = await searchPhotos(query, { perPage: count * 2 });

  if (!result || result.photos.length === 0) {
    return [];
  }

  // Shuffle and take the requested count
  const shuffled = result.photos.sort(() => Math.random() - 0.5);

  return shuffled.slice(0, count).map((photo) => ({
    type: 'image' as const,
    source: 'pexels' as const,
    url: photo.src.large,
    thumbnail: photo.src.small,
    attribution: `Photo by ${photo.photographer} on Pexels`,
    searchQuery: query,
  }));
}

/**
 * Check if Pexels API is configured and accessible
 */
export async function checkPexelsHealth(): Promise<{ ok: boolean; error?: string }> {
  const env = getEnv();

  if (!env.PEXELS_API_KEY) {
    return { ok: false, error: 'Pexels API key not configured' };
  }

  try {
    const result = await searchPhotos('triathlon', { perPage: 1 });

    if (result === null) {
      return { ok: false, error: 'Failed to connect to Pexels API' };
    }

    return { ok: true };
  } catch (error) {
    return { ok: false, error: `Pexels API error: ${error}` };
  }
}
