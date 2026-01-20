/**
 * Shared types for the marketing automation system
 */

export type SocialPlatform = 'reddit' | 'twitter' | 'instagram';

/**
 * A post discovered from a social platform
 */
export interface SocialPost {
  /** Composite ID: platform:externalId */
  id: string;
  platform: SocialPlatform;
  /** Platform-specific post ID */
  externalId: string;
  /** Direct URL to the post */
  url: string;
  /** Author's username (without @) */
  authorUsername: string;
  /** Post body/content */
  content: string;
  /** Post title (Reddit only) */
  title?: string;
  /** Subreddit name (Reddit only) */
  subreddit?: string;
  /** Hashtags found in the post */
  hashtags?: string[];
  /** Raw engagement score (likes, upvotes, etc.) */
  engagementScore: number;
  /** When the post was created */
  createdAt: Date;
  /** When we scanned this post */
  scannedAt: Date;
  /** Calculated relevance score (0-100) */
  relevanceScore: number;
}

/**
 * A generated reply ready for approval
 */
export interface GeneratedReply {
  /** References the SocialPost.id */
  postId: string;
  platform: SocialPlatform;
  /** The original post we're replying to */
  originalPost: SocialPost;
  /** AI-generated reply text */
  replyText: string;
  /** When the reply was generated */
  generatedAt: Date;
  /** Current status in the approval workflow */
  status: ReplyStatus;
  /** Telegram message ID for updating status */
  telegramMessageId?: string;
  /** Who approved/declined (Telegram username) */
  reviewedBy?: string;
  /** When the reply was posted (if approved) */
  postedAt?: Date;
  /** Error message if posting failed */
  errorMessage?: string;
  /** Suggested media to include */
  mediaSuggestions?: MediaSuggestion[];
}

export type ReplyStatus =
  | 'pending'      // Waiting for approval in Telegram
  | 'approved'     // Approved, about to post
  | 'declined'     // User declined
  | 'posted'       // Successfully posted
  | 'failed';      // Posting failed

/**
 * Media suggestion from Pexels or generated
 */
export interface MediaSuggestion {
  type: 'image' | 'video';
  source: 'pexels' | 'generated';
  /** Full-size URL */
  url: string;
  /** Thumbnail for preview */
  thumbnail: string;
  /** Attribution text (required for Pexels) */
  attribution?: string;
  /** Search query that found this */
  searchQuery?: string;
}

/**
 * Telegram callback data structure
 */
export interface TelegramCallbackData {
  action: 'approve' | 'approve_crosspost' | 'decline' | 'mark_done';
  postId: string;
  platform: SocialPlatform;
}

/**
 * Result of a scan operation
 */
export interface ScanResult {
  platform: SocialPlatform;
  postsScanned: number;
  postsNew: number;
  postsRanked: number;
  repliesGenerated: number;
  approvalsSent: number;
  errors: string[];
}

/**
 * Platform-specific ranking weights
 */
export interface RankingWeights {
  keyword: number;
  engagement: number;
  recency: number;
  question: number;
}

/**
 * Rate limit tracking per platform
 */
export interface PlatformRateLimit {
  platform: SocialPlatform;
  requestsPerWindow: number;
  windowSeconds: number;
  lastRequestAt: number;
  requestCount: number;
}

/**
 * Pending reply stored in KV for approval workflow
 */
export interface PendingReply {
  postId: string;
  platform: SocialPlatform;
  replyText: string;
  originalPostUrl: string;
  mediaSuggestions?: MediaSuggestion[];
  createdAt: number;
}
